-- =====================================================================
-- 019_admin_user_lookup.sql — Admin: egyedi felhasználó keresése email
-- alapján (ÚJ, ADDITÍV, TISZTÁN OLVASÁS)
-- =====================================================================
-- Ugyanaz a biztonsági modell, mint a 018_admin_stats.sql-ben: a VALÓDI
-- jogosultság-ellenőrzés ITT, a függvény törzsében történik (a hívó JWT
-- email-claim-je alapján) — a kliens UI-gomb elrejtése önmagában csak
-- kényelem, nem biztonság. Az admin-email itt és az index.html
-- ADMIN_EMAIL_ALLOWLIST tömbjében, valamint a 018-as migrációban is
-- KÜLÖN van karbantartva — admin-hozzáférés módosításakor MINDEGYIKET
-- frissíteni kell.
--
-- Célja: támogatási/hibakeresési célú, EGYETLEN felhasználó aggregált
-- (nem üzleti-titkos) adatainak megtekintése email-cím alapján — pl.
-- "X felhasználó azt írja, nem kapta meg az XP-jét, mi a helyzet nála
-- valójában". NEM ad vissza jelszót, fizetési adatot vagy bármilyen
-- auth-titkot — kizárólag display_name, regisztráció ideje, XP,
-- teljesített leckék száma, és az előfizetés állapota.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.admin_lookup_user(p_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email text;
    v_target_id uuid;
    v_result jsonb;
BEGIN
    v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    IF v_caller_email IS NULL OR v_caller_email = '' OR v_caller_email NOT IN (
        'patrik66@gmail.com'
    ) THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez a művelethez.' USING ERRCODE = '42501';
    END IF;

    IF p_email IS NULL OR trim(p_email) = '' THEN
        RAISE EXCEPTION 'Adj meg egy email-címet.';
    END IF;

    -- auth.users eléréséhez a SECURITY DEFINER (a függvény tulajdonosának
    -- jogosultságával fut) szükséges — a hívó (authenticated) felhasználó
    -- önmagában nem érné el az auth.users táblát.
    SELECT id INTO v_target_id FROM auth.users WHERE lower(email) = lower(trim(p_email)) LIMIT 1;

    IF v_target_id IS NULL THEN
        RETURN jsonb_build_object('found', false);
    END IF;

    SELECT jsonb_build_object(
        'found', true,
        'display_name', p.display_name,
        'created_at', p.created_at,
        'mobile_xp', coalesce(pr.mobile_xp, 0),
        'lessons_completed', (
            CASE WHEN jsonb_typeof(pr.mobile_done_lessons) = 'array'
                 THEN jsonb_array_length(pr.mobile_done_lessons) ELSE 0 END
        ),
        'subscription_status', coalesce(s.subscription_status, 'free'),
        'last_event_at', (
            SELECT max(created_at) FROM public.user_events WHERE user_id = v_target_id
        )
    ) INTO v_result
    FROM public.profiles p
    LEFT JOIN public.progress pr ON pr.user_id = p.id
    LEFT JOIN public.subscriptions s ON s.user_id = p.id
    WHERE p.id = v_target_id;

    RETURN coalesce(v_result, jsonb_build_object('found', false));
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_lookup_user(text) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_lookup_user(text) FROM anon;
