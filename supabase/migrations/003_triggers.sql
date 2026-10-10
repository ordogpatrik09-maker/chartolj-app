-- =====================================================================
-- 003_triggers.sql — automatikus user-init + updated_at
-- =====================================================================
-- FONTOS SORREND: ezt a migrációt a 004_subscription.sql UTÁN kell
-- futtatni, mert a handle_new_chartolj_user() a `subscriptions` táblába
-- is ír. Ha mégis előbb futtatod, a trigger LÉTREJÖN, de csak az első
-- új regisztrációnál derül ki, ha a subscriptions tábla még hiányzik —
-- ezért a javasolt sorrend: 001 → 002 → 004 → 003, VAGY futtasd le a
-- 004-et is, mielőtt bármelyik éles regisztráció megtörténne.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.handle_new_chartolj_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, display_name)
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data ->> 'display_name',
            split_part(NEW.email, '@', 1)
        )
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

DROP TRIGGER IF EXISTS on_auth_user_created_chartolj ON auth.users;
CREATE TRIGGER on_auth_user_created_chartolj
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_chartolj_user();

-- ---------------------------------------------------------------------
-- Közös updated_at trigger — minden UPDATE-nél frissíti a mezőt.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_updated_at ON public.profiles;
CREATE TRIGGER profiles_updated_at
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS progress_updated_at ON public.progress;
CREATE TRIGGER progress_updated_at
    BEFORE UPDATE ON public.progress
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS subscriptions_updated_at ON public.subscriptions;
CREATE TRIGGER subscriptions_updated_at
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION public.set_updated_at();
