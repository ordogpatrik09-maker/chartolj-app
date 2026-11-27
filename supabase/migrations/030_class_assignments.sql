-- =====================================================================
-- 030_class_assignments.sql — Osztályfeladatok (ÚJ, ADDITÍV, a 029-re épül)
-- =====================================================================
-- Az osztály tulajdonosa leckéket adhat ki határidővel; a tanulók látják a
-- feladataikat, a tanár pedig, hogy hányan végezték el. "Elvégezve" = a
-- lecke indexe szerepel a tanuló progress.mobile_done_lessons tömbjében
-- (ugyanaz az adat, amit az app eddig is ment) — új kliensírás nem kell.
-- Korlát: osztályonként 50 feladat, leckénként egy.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.class_assignments (
    id          bigserial PRIMARY KEY,
    class_id    uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    lesson_idx  integer NOT NULL CHECK (lesson_idx BETWEEN 0 AND 10000),
    note        text CHECK (note IS NULL OR length(note) <= 200),
    due_date    date,
    created_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (class_id, lesson_idx)
);
ALTER TABLE public.class_assignments ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_class_assignment(p_class uuid, p_lesson integer, p_due date DEFAULT NULL, p_note text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id bigint;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class AND owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez az osztályhoz' USING ERRCODE = '42501';
    END IF;
    IF p_lesson IS NULL OR p_lesson < 0 OR p_lesson > 10000 THEN RAISE EXCEPTION 'Érvénytelen lecke'; END IF;
    IF p_due IS NOT NULL AND (p_due < current_date - 1 OR p_due > current_date + 365) THEN RAISE EXCEPTION 'Érvénytelen határidő'; END IF;
    IF (SELECT count(*) FROM public.class_assignments WHERE class_id = p_class) >= 50 THEN RAISE EXCEPTION 'Legfeljebb 50 feladat lehet egy osztályban'; END IF;
    INSERT INTO public.class_assignments (class_id, lesson_idx, due_date, note)
    VALUES (p_class, p_lesson, p_due, left(nullif(trim(p_note), ''), 200))
    ON CONFLICT (class_id, lesson_idx) DO UPDATE SET due_date = excluded.due_date, note = excluded.note
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_class_assignment(p_id bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    DELETE FROM public.class_assignments a USING public.classes c
    WHERE a.id = p_id AND c.id = a.class_id AND c.owner_id = auth.uid();
    RETURN FOUND;
END;
$$;

-- Tulajdonos: feladatok + teljesítési arány.
CREATE OR REPLACE FUNCTION public.get_class_assignments(p_class uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.classes WHERE id = p_class AND owner_id = auth.uid()) THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez az osztályhoz' USING ERRCODE = '42501';
    END IF;
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'id', a.id, 'lesson', a.lesson_idx, 'due', a.due_date, 'note', a.note,
            'members', (SELECT count(*) FROM public.class_members m WHERE m.class_id = a.class_id),
            'done', (SELECT count(*) FROM public.class_members m JOIN public.progress pr ON pr.user_id = m.user_id
                     WHERE m.class_id = a.class_id AND jsonb_typeof(pr.mobile_done_lessons) = 'array'
                       AND pr.mobile_done_lessons @> jsonb_build_array(a.lesson_idx))
        ) ORDER BY a.due_date NULLS LAST, a.created_at)
        FROM public.class_assignments a WHERE a.class_id = p_class), '[]'::jsonb);
END;
$$;

-- Tanuló: a csatlakozott osztályaim feladatai, elvégzettséggel.
CREATE OR REPLACE FUNCTION public.get_my_assignments()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_done jsonb;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    SELECT CASE WHEN jsonb_typeof(mobile_done_lessons) = 'array' THEN mobile_done_lessons ELSE '[]'::jsonb END INTO v_done
    FROM public.progress WHERE user_id = v_uid;
    v_done := coalesce(v_done, '[]'::jsonb);
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object('id', a.id, 'class', c.name, 'lesson', a.lesson_idx, 'due', a.due_date, 'note', a.note,
                    'done', v_done @> jsonb_build_array(a.lesson_idx)) ORDER BY a.due_date NULLS LAST, a.created_at)
        FROM public.class_members m JOIN public.classes c ON c.id = m.class_id
        JOIN public.class_assignments a ON a.class_id = m.class_id
        WHERE m.user_id = v_uid), '[]'::jsonb);
END;
$$;

DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY['create_class_assignment(uuid, integer, date, text)', 'delete_class_assignment(bigint)', 'get_class_assignments(uuid)', 'get_my_assignments()'] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', f);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
