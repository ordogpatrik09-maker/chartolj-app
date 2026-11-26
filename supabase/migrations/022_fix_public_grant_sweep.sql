-- =====================================================================
-- 022_fix_public_grant_sweep.sql — Teljes PUBLIC-grant audit és javítás
-- (BIZTONSÁGI SZIGORÍTÁS, ADDITÍV, nem változtat RPC payload-sémát)
-- =====================================================================
-- A 021_fix_admin_rpc_public_grant.sql-ben felfedezett hiba (lásd ott a
-- részletes magyarázatot: PostgreSQL alapértelmezetten PUBLIC-nak ad
-- EXECUTE jogot egy új függvényen, és ez egy "REVOKE ... FROM anon"-tól
-- FÜGGETLENÜL megmarad) után VÉGIGMENTEM AZ ÖSSZES korábbi migráció
-- SECURITY DEFINER függvényén, nem csak az admin-RPC-ken.
--
-- Referencia a HELYES mintára: 011_secure_progress_rpc.sql már eleve
-- "REVOKE ALL ... FROM PUBLIC"-ot használt — ez bizonyítja, hogy a hiba
-- NEM egy rendszerszintű félreértés volt, csak nem lett következetesen
-- alkalmazva minden későbbi migrációban.
--
-- TALÁLT, TÉNYLEGESEN KIHASZNÁLHATÓ HATÁS (a 018/019-cel ellentétben,
-- ahol a függvénytörzs belső ellenőrzése miatt nem volt tényleges
-- adatszivárgás):
--   - get_global_leaderboard() (015_leaderboard_friends.sql) és
--     get_seasonal_leaderboard() (016_seasonal_leaderboard.sql) NEM
--     tartalmaznak auth.uid()-alapú szűrést a kimenetükben (ez a
--     tervezett viselkedésük — MINDENKI látja a teljes ranglistát) —
--     emiatt a hiányzó PUBLIC-revoke miatt egy BEJELENTKEZÉS NÉLKÜLI
--     (anon) hívó is le tudta volna kérdezni a teljes globális/
--     szezonális ranglistát (felhasználónév, avatar, XP), annak
--     ellenére, hogy a kód dokumentációja és a GRANT-sor szándéka
--     egyértelműen "csak bejelentkezett felhasználó" volt.
--   - A get_or_create_invite_code(), send_friend_request_by_code(),
--     remove_friend(), save_push_subscription(), delete_push_subscription(),
--     touch_last_active(), set_push_reminder_enabled() függvényeknél az
--     auth.uid() NULL-ra értékelődése anon hívónál VAGY néma no-op-ot
--     (DELETE/UPDATE WHERE ... = NULL sosem talál sort), VAGY egy NOT
--     NULL megszorítás-hibát eredményez — ténylegesen kihasználható
--     adatszivárgást vagy manipulációt EZEKNÉL NEM találtam, de a
--     jogosultsági réteg itt is helytelen volt, és a nyers Postgres-
--     hibaüzenet (NOT NULL violation) kiszivároghat a kliens felé,
--     ami nem kívánt belső implementációs részletet mutatna meg.
--
-- JAVÍTÁS: explicit "REVOKE EXECUTE ... FROM PUBLIC" mindegyik érintett,
-- MÁR ÉLES függvényre. Ez PUSZTÁN jogosultság-szigorítás — egyetlen
-- függvénytörzset, táblát vagy RPC-payload-sémát sem módosít ez a rész,
-- ezért biztonságosan additív.
--
-- PLUSZ: get_seasonal_leaderboard() és send_friend_request_by_code()
-- kapnak egy explicit "nincs bejelentkezve" korai kilépést is (defense
-- in depth, ugyanaz a minta, mint a save_cloud_progress()-ben a
-- 011-ben) — ez NEM változtatja meg egyetlen legitim, bejelentkezett
-- hívás viselkedését vagy visszatérési sémáját sem, csak egy tisztább,
-- szándékos hibaüzenetet ad egy (a PUBLIC-revoke után amúgy sem elérhető)
-- anon hívásnak a nyers "unique constraint"/üres-eredmény viselkedés
-- helyett.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.get_or_create_invite_code() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.send_friend_request_by_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.remove_friend(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_global_leaderboard(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_friends_leaderboard() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_push_subscription(text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_push_subscription(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_seasonal_leaderboard(text, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.touch_last_active() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_push_reminder_enabled(boolean) FROM PUBLIC;

-- Defense-in-depth: explicit, korai "nincs bejelentkezve" kilépés a két
-- függvénynél, ahol az auth.uid() NULL-ra értékelődése eddig vagy
-- kétértelmű (üres eredmény) vagy nyers constraint-hibát adott volna.
-- A visszatérési TÍPUS/SÉMA egyik függvénynél sem változik.

CREATE OR REPLACE FUNCTION public.send_friend_request_by_code(p_code text)
RETURNS TABLE(friend_id uuid, friend_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_id uuid;
    v_target_name text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Nincs bejelentkezve';
    END IF;

    SELECT id, display_name INTO v_target_id, v_target_name
    FROM public.profiles WHERE invite_code = upper(trim(p_code));

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'Nincs ilyen meghívókód.';
    END IF;
    IF v_target_id = auth.uid() THEN
        RAISE EXCEPTION 'Saját magadat nem adhatod hozzá.';
    END IF;

    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (auth.uid(), v_target_id, 'accepted')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING;

    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (v_target_id, auth.uid(), 'accepted')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING;

    RETURN QUERY SELECT v_target_id, v_target_name;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.send_friend_request_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_friend_request_by_code(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_seasonal_leaderboard(p_period_type text DEFAULT 'weekly', p_limit int DEFAULT 50)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, period_xp int, period_start date, period_ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_period_start date;
    v_period_end   timestamptz;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Nincs bejelentkezve';
    END IF;
    IF p_period_type NOT IN ('weekly', 'monthly') THEN
        RAISE EXCEPTION 'p_period_type csak ''weekly'' vagy ''monthly'' lehet';
    END IF;

    IF p_period_type = 'weekly' THEN
        v_period_start := date_trunc('week', now())::date;
        v_period_end   := (date_trunc('week', now()) + interval '7 days');
    ELSE
        v_period_start := date_trunc('month', now())::date;
        v_period_end   := (date_trunc('month', now()) + interval '1 month');
    END IF;

    INSERT INTO public.xp_league_snapshots (user_id, period_type, period_start, xp_at_start)
    SELECT pr.user_id, p_period_type, v_period_start, COALESCE(pr.mobile_xp, 0)
    FROM public.progress pr
    ON CONFLICT ON CONSTRAINT xp_league_snapshots_pkey DO NOTHING;

    RETURN QUERY
    SELECT p.id,
           COALESCE(p.display_name, 'Trader'),
           p.avatar_url,
           GREATEST(COALESCE(pr.mobile_xp, 0) - s.xp_at_start, 0) AS period_xp,
           v_period_start,
           v_period_end
    FROM public.xp_league_snapshots s
    JOIN public.profiles p ON p.id = s.user_id
    JOIN public.progress pr ON pr.user_id = s.user_id
    WHERE s.period_type = p_period_type AND s.period_start = v_period_start
    ORDER BY period_xp DESC
    LIMIT GREATEST(p_limit, 1);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.get_seasonal_leaderboard(text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_seasonal_leaderboard(text, int) TO authenticated;
