-- =====================================================================
-- 032_family_plan.sql — Családi Prémium (max. 5 fő) (ÚJ, ADDITÍV)
-- =====================================================================
-- A tulajdonos a családi éves csomagot (Play termék-azonosítóban "family")
-- vásárolja meg a MEGLÉVŐ verify-play-purchase úton; utána meghívókóddal
-- legfeljebb 4 tagot adhat hozzá. A tagok Prémiuma addig él, amíg a
-- tulajdonos családi előfizetése aktív. A subscriptions táblát NEM módosítja,
-- csak olvassa. Egy felhasználó egyszerre egy családnak lehet tagja.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.family_groups (
    owner_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    invite_code  text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.family_members (
    user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    owner_id   uuid NOT NULL REFERENCES public.family_groups(owner_id) ON DELETE CASCADE,
    joined_at  timestamptz NOT NULL DEFAULT now(),
    CHECK (user_id <> owner_id)
);
CREATE INDEX IF NOT EXISTS idx_family_members_owner ON public.family_members (owner_id);
ALTER TABLE public.family_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.family_members ENABLE ROW LEVEL SECURITY;

-- Aktív-e a megadott felhasználó CSALÁDI előfizetése (csak belső használatra).
CREATE OR REPLACE FUNCTION public.family_owner_active(p_owner uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = p_owner
          AND s.subscription_status IN ('active', 'grace_period')
          AND (s.expires_at IS NULL OR s.expires_at > now())
          AND coalesce(s.subscription_product_id, '') ILIKE '%family%'
    );
$$;

-- Állapot a hívónak: tulajdonos / tag / semmi, és jár-e Prémium a család révén.
CREATE OR REPLACE FUNCTION public.get_family_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_owner uuid;
    v_code text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    IF public.family_owner_active(v_uid) THEN
        SELECT invite_code INTO v_code FROM public.family_groups WHERE owner_id = v_uid;
        IF v_code IS NULL THEN
            LOOP
                v_code := 'CSAL-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
                BEGIN
                    INSERT INTO public.family_groups (owner_id, invite_code) VALUES (v_uid, v_code);
                    EXIT;
                EXCEPTION WHEN unique_violation THEN
                    IF EXISTS (SELECT 1 FROM public.family_groups WHERE owner_id = v_uid) THEN
                        SELECT invite_code INTO v_code FROM public.family_groups WHERE owner_id = v_uid; EXIT;
                    END IF;
                END;
            END LOOP;
        END IF;
        RETURN jsonb_build_object('role', 'owner', 'active', true, 'invite_code', v_code, 'max_members', 4,
            'members', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.user_id, 'name', coalesce(p.display_name, 'Családtag')) ORDER BY m.joined_at)
                                 FROM public.family_members m LEFT JOIN public.profiles p ON p.id = m.user_id WHERE m.owner_id = v_uid), '[]'::jsonb));
    END IF;
    SELECT owner_id INTO v_owner FROM public.family_members WHERE user_id = v_uid;
    IF v_owner IS NOT NULL THEN
        RETURN jsonb_build_object('role', 'member', 'active', public.family_owner_active(v_owner),
            'owner_name', (SELECT coalesce(display_name, 'Családfő') FROM public.profiles WHERE id = v_owner));
    END IF;
    RETURN jsonb_build_object('role', null, 'active', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.join_family(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_owner uuid;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    SELECT owner_id INTO v_owner FROM public.family_groups WHERE invite_code = upper(trim(coalesce(p_code, '')));
    IF v_owner IS NULL THEN RAISE EXCEPTION 'Nincs ilyen családi kód'; END IF;
    IF v_owner = v_uid THEN RAISE EXCEPTION 'Ez a saját családi csomagod'; END IF;
    IF NOT public.family_owner_active(v_owner) THEN RAISE EXCEPTION 'Ez a családi csomag nem aktív'; END IF;
    IF EXISTS (SELECT 1 FROM public.family_members WHERE user_id = v_uid) THEN RAISE EXCEPTION 'Már tagja vagy egy családnak — előbb lépj ki belőle'; END IF;
    IF (SELECT count(*) FROM public.family_members WHERE owner_id = v_owner) >= 4 THEN RAISE EXCEPTION 'A család megtelt (max. 5 fő)'; END IF;
    INSERT INTO public.family_members (user_id, owner_id) VALUES (v_uid, v_owner);
    RETURN jsonb_build_object('ok', true, 'owner_name', (SELECT coalesce(display_name, 'Családfő') FROM public.profiles WHERE id = v_owner));
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_family()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    DELETE FROM public.family_members WHERE user_id = auth.uid();
    RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.remove_family_member(p_user uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    DELETE FROM public.family_members WHERE user_id = p_user AND owner_id = auth.uid();
    RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.family_owner_active(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.family_owner_active(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.family_owner_active(uuid) FROM authenticated;
DO $$
DECLARE f text;
BEGIN
    FOREACH f IN ARRAY ARRAY['get_family_status()', 'join_family(text)', 'leave_family()', 'remove_family_member(uuid)'] LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM PUBLIC', f);
        EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%s FROM anon', f);
        EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated', f);
    END LOOP;
END $$;
