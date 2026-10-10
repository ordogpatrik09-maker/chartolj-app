-- =====================================================================
-- 014_fix_profiles_tag.sql
-- =====================================================================
-- HIBA, AMIT EZ JAVÍT (2026-10-08, élő teszt során derült ki, a 013-as
-- javítás UTÁN):
--
-- A 013_drop_legacy_user_trigger.sql helyesen eltávolította a régi,
-- hibás "on_auth_user_created" triggert. Ezután viszont kiderült, hogy
-- a MARADÓ, hivatalos "on_auth_user_created_chartolj" trigger
-- (003_triggers.sql, handle_new_chartolj_user() függvény) is elbukott,
-- mert a `public.profiles` tábla `tag` oszlopa NOT NULL (kötelező),
-- ÁM a trigger-függvény csak az `id` és `display_name` mezőket adja meg
-- az INSERT-ben:
--
--     INSERT INTO public.profiles (id, display_name) VALUES (...);
--
-- Ez a Postgres hibaüzenetben pontosan látszott:
--   "null value in column \"tag\" of relation \"profiles\" violates
--    not-null constraint (SQLSTATE 23502)"
--
-- A `tag` oszlop egy korábbi, régi séma maradványa (feltehetően egy
-- egyedi felhasználói azonosító/becenév-cím volt, pl. "@valaki123"
-- formában) — a jelenlegi kliens kód nem használja, de az adatbázis
-- szinten még kötelezőnek van jelölve.
--
-- A MEGOLDÁS: a trigger-függvényt kiegészítjük, hogy egy automatikusan
-- generált, garantáltan egyedi `tag` értéket is beírjon minden új
-- felhasználóhoz (a saját UUID-jük alapján, pl. "u_3f9a21bc"), így a
-- NOT NULL feltétel mindig teljesül, anélkül hogy bármit módosítanunk
-- kellene a kliens HTML-ben.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_chartolj_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name, tag)
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'display_name',
            split_part(NEW.email, '@', 1)
        ),
        'u_' || substr(replace(NEW.id::text, '-', ''), 1, 10)
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.progress (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    INSERT INTO public.subscriptions (user_id, subscription_status)
    VALUES (NEW.id, 'free')
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;
