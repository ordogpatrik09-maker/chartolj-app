-- =====================================================================
-- 018_admin_stats.sql — Admin-áttekintő statisztika RPC (ÚJ, ADDITÍV)
-- =====================================================================
-- CSAK ÚJ FÜGGVÉNYT ad hozzá — semmilyen meglévő táblát, oszlopot vagy
-- RPC-t nem módosít, nem töröl. Tisztán OLVASÁS-csak, aggregált (nem
-- egyéni felhasználói) statisztikákat ad vissza, KIZÁRÓLAG egyetlen,
-- kódba égetett admin-email számára.
--
-- BIZTONSÁGI MODELL (miért nem elég a kliensoldali gombrejtés):
-- A mobil kliens (index.html) csak UI-szinten rejti el az "Admin panel"
-- gombot nem-admin felhasználóknak — ez önmagában NEM biztonság, hiszen
-- bárki megkerülheti a böngésző konzoljából. A VALÓDI védelem ITT van:
-- ez a SECURITY DEFINER függvény a hívó felhasználó JWT-jéből kiolvasott
-- email-címet ellenőrzi, és AZONNAL hibát dob, ha az nem szerepel az
-- ADMIN_EMAILS listában — így a kliens UI-tól teljesen függetlenül,
-- szerveroldalon is ki van kényszerítve a hozzáférés-korlátozás.
--
-- Az admin-email itt és az index.html ADMIN_EMAIL_ALLOWLIST tömbjében
-- KÜLÖN van karbantartva — admin hozzáférés módosításakor MINDKETTŐT
-- frissíteni kell (ez a migráció csak a szerveroldali kényszert adja,
-- a UI-gombot nem).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_admin_app_stats()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email text;
    v_result jsonb;
BEGIN
    -- A hívó email-címe a JWT 'email' claim-jéből — ez a standard,
    -- kiegészítő-függvénytől független módja annak, hogy egy SECURITY
    -- DEFINER függvényen belül megbízhatóan azonosítsuk a bejelentkezett
    -- felhasználót a Supabase auth rendszerben.
    v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));

    IF v_caller_email IS NULL OR v_caller_email = '' OR v_caller_email NOT IN (
        'ordog.patrik.09@gmail.com'
    ) THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez a művelethez.' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object(
        'total_users', (SELECT count(*) FROM public.profiles),
        'new_users_7d', (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '7 days'),
        'new_users_30d', (SELECT count(*) FROM public.profiles WHERE created_at >= now() - interval '30 days'),
        'premium_active', (SELECT count(*) FROM public.subscriptions WHERE subscription_status = 'active'),
        'premium_grace_period', (SELECT count(*) FROM public.subscriptions WHERE subscription_status = 'grace_period'),
        'avg_xp', (SELECT round(coalesce(avg(mobile_xp), 0))::int FROM public.progress),
        'total_lessons_completed', (
            SELECT coalesce(sum(jsonb_array_length(mobile_done_lessons)), 0)
            FROM public.progress
            WHERE jsonb_typeof(mobile_done_lessons) = 'array'
        ),
        'total_demo_trades', (SELECT count(*) FROM public.user_events WHERE event_name = 'demo_trade_executed'),
        'dau', (SELECT count(DISTINCT user_id) FROM public.user_events WHERE created_at >= now() - interval '1 day'),
        'wau', (SELECT count(DISTINCT user_id) FROM public.user_events WHERE created_at >= now() - interval '7 days'),
        'generated_at', now()
    ) INTO v_result;

    RETURN v_result;
END;
$$;

-- Csak bejelentkezett (authenticated) felhasználó hívhatja egyáltalán —
-- a tényleges admin-ellenőrzés a függvény TÖRZSÉBEN történik fentebb.
-- Vendég (anon) soha nem éri el.
GRANT EXECUTE ON FUNCTION public.get_admin_app_stats() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_admin_app_stats() FROM anon;
