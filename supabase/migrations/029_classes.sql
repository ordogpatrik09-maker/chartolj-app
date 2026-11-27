-- =====================================================================
-- 029_classes.sql — Osztály mód (tanár / csoportvezető) (ÚJ, ADDITÍV)
-- =====================================================================
-- Egy tanár (vagy bármely bejelentkezett felhasználó) osztályt hozhat létre
-- csatlakozási kóddal; a tanulók a kóddal csatlakoznak, és ezzel
-- HOZZÁJÁRULNAK, hogy az osztály tulajdonosa lássa a haladásuk ÖSSZESÍTETT
-- adatait (XP, kész leckék száma, heti XP, utolsó aktivitás, heti
-- szimulált kötések száma). Kötések részletei, jegyzetek NEM láthatók.
-- Bármikor kiléphetnek. Meglévő táblához/RPC-hez NEM nyúl.
-- Korlátok: tulajdonosonként 10 osztály, osztályonként 200 tag,
-- felhasználónként 10 tagság. RLS policy nincs — minden az RPC-ken át.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.classes (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
    join_code   text NOT NULL UNIQUE,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_classes_owner ON public.classes (owner_id);

CREATE TABLE IF NOT EXISTS public.class_members (
    class_id   uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    joined_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (class_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_class_members_user ON public.class_members (user_id);

ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_members ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.create_class(p_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_name text := left(trim(coalesce(p_name, '')), 60);
    v_code text;
    v_id uuid;
    v_tries int := 0;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    IF v_name = '' THEN RAISE EXCEPTION 'Adj nevet az osztálynak'; END IF;
    IF (SELECT count(*) FROM public.classes WHERE owner_id = v_uid) >= 10 THEN RAISE EXCEPTION 'Legfeljebb 10 osztályod lehet'; END IF;
    LOOP
        v_code := 'OSZT-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        BEGIN
            INSERT INTO public.classes (owner_id, name, join_code) VALUES (v_uid, v_name, v_code) RETURNING id INTO v_id;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            v_tries := v_tries + 1;
            IF v_tries > 10 THEN RAISE EXCEPTION 'Nem sikerült kódot generálni'; END IF;
        END;
    END LOOP;
    RETURN jsonb_build_object('id', v_id, 'name', v_name, 'join_code', v_code);
END;
$$;

CREATE OR REPLACE FUNCTION public.join_class(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_class public.classes%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    SELECT * INTO v_class FROM public.classes WHERE join_code = upper(trim(coalesce(p_code, '')));
    IF NOT FOUND THEN RAISE EXCEPTION 'Nincs ilyen osztálykód'; END IF;
    IF v_class.owner_id = v_uid THEN RAISE EXCEPTION 'Ez a saját osztályod'; END IF;
    IF EXISTS (SELECT 1 FROM public.class_members WHERE class_id = v_class.id AND user_id = v_uid) THEN
        RETURN jsonb_build_object('id', v_class.id, 'name', v_class.name, 'already', true);
    END IF;
    IF (SELECT count(*) FROM public.class_members WHERE user_id = v_uid) >= 10 THEN RAISE EXCEPTION 'Legfeljebb 10 osztálynak lehetsz tagja'; END IF;
    IF (SELECT count(*) FROM public.class_members WHERE class_id = v_class.id) >= 200 THEN RAISE EXCEPTION 'Az osztály megtelt'; END IF;
    INSERT INTO public.class_members (class_id, user_id) VALUES (v_class.id, v_uid);
    RETURN jsonb_build_object('id', v_class.id, 'name', v_class.name, 'already', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_class(p_class uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    DELETE FROM public.class_members WHERE class_id = p_class AND user_id = auth.uid();
    RETURN FOUND;
END;
$$;

-- Tulajdonos: osztály törlése (a tagságok is törlődnek), vagy tag eltávolítása.
CREATE OR REPLACE FUNCTION public.delete_class(p_class uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    DELETE FROM public.classes WHERE id = p_class AND owner_id = auth.uid();
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_my_classes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    RETURN jsonb_build_object(
        'owned', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'join_code', c.join_code,
                    'members', (SELECT count(*) FROM public.class_members m WHERE m.class_id = c.id)) ORDER BY c.created_at)
                  FROM public.classes c WHERE c.owner_id = v_uid), '[]'::jsonb),
        'joined', coalesce((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name,
                    'teacher', coalesce(p.display_name, 'Tanár')) ORDER BY m.joined_at)
                  FROM public.class_members m JOIN public.classes c ON c.id = m.class_id
                  LEFT JOIN public.profiles p ON p.id = c.owner_id WHERE m.user_id = v_uid), '[]'::jsonb)
    );
END;
$$;

-- Tulajdonos: összesített haladás tagonként.
CREATE OR REPLACE FUNCTION public.get_class_report(p_class uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_week date := date_trunc('week', now())::date;
    v_name text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    SELECT name INTO v_name FROM public.classes WHERE id = p_class AND owner_id = v_uid;
    IF v_name IS NULL THEN RAISE EXCEPTION 'Nincs jogosultság ehhez az osztályhoz' USING ERRCODE = '42501'; END IF;
    RETURN jsonb_build_object('name', v_name, 'members', coalesce((
        SELECT jsonb_agg(jsonb_build_object(
            'name', coalesce(p.display_name, 'Tanuló'),
            'xp', coalesce(pr.mobile_xp, 0),
            'lessons', CASE WHEN jsonb_typeof(pr.mobile_done_lessons) = 'array' THEN jsonb_array_length(pr.mobile_done_lessons) ELSE 0 END,
            'xp_week', CASE WHEN s.xp_at_start IS NULL THEN NULL ELSE greatest(coalesce(pr.mobile_xp, 0) - s.xp_at_start, 0) END,
            'last_active', p.last_active_at,
            'trades_week', (SELECT count(*) FROM public.sim_trades t WHERE t.user_id = m.user_id AND t.closed_at > now() - interval '7 days')
        ) ORDER BY coalesce(pr.mobile_xp, 0) DESC)
        FROM public.class_members m
        LEFT JOIN public.profiles p ON p.id = m.user_id
        LEFT JOIN public.progress pr ON pr.user_id = m.user_id
        LEFT JOIN public.xp_league_snapshots s ON s.user_id = m.user_id AND s.period_type = 'weekly' AND s.period_start = v_week
        WHERE m.class_id = p_class), '[]'::jsonb));
END;
$$;

DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY['create_class(text)', 'join_class(text)', 'leave_class(uuid)', 'delete_class(uuid)', 'get_my_classes()', 'get_class_report(uuid)'] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', f);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
