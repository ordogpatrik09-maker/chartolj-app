-- =====================================================================
-- 004_subscription.sql — subscriptions tábla (BIZTONSÁGKRITIKUS)
-- =====================================================================
-- MIÉRT KÜLÖN TÁBLA, NEM A profiles.is_premium OSZLOP?
--
-- A korábbi verzióban a kliens (authenticated szerepkörrel, saját
-- session-jével) ezt futtatta sikeres "fizetés" után:
--
--     supabase.from('profiles').update({ is_premium: true })
--
-- Mivel a normál RLS UPDATE policy a `profiles` táblán engedte, hogy a
-- felhasználó a SAJÁT sorát módosítsa (auth.uid() = id), ez azt is
-- jelentette, hogy BÁRKI, aki megnyitja a böngésző konzolját, egyetlen
-- paranccsal ingyen Prémiumot adhatott magának — a szerveroldali
-- ellenőrzés (Google Play Developer API hívás) megkerülésével.
--
-- A MEGOLDÁS: az előfizetési állapot egy KÜLÖN táblában van, amin az
-- authenticated szerepkörnek KIZÁRÓLAG SELECT policy-ja van — INSERT/
-- UPDATE/DELETE policy egyáltalán NINCS a normál kliens számára. Írni
-- csak a SERVICE ROLE kulcs tud (ami definíció szerint megkerüli az
-- RLS-t), és ez a kulcs KIZÁRÓLAG a Supabase Edge Function-ökben él,
-- soha nem kerül a kliensbe.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.subscriptions (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    -- 'free' | 'active' | 'expired' | 'cancelled' | 'grace_period'
    subscription_status text NOT NULL DEFAULT 'free',
    subscription_product_id text,
    subscription_platform text,          -- 'playbilling' | 'stripe' | 'demo'
    subscription_purchase_token text,
    expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

-- Csak SELECT a sajátjára — UPDATE/INSERT/DELETE policy SZÁNDÉKOSAN nincs.
DROP POLICY IF EXISTS "subscriptions_select_own" ON public.subscriptions;
CREATE POLICY "subscriptions_select_own"
    ON public.subscriptions FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- Ha a régi `profiles.is_premium` oszlop már létezik és van benne adat,
-- ez a lépés (opcionális, csak akkor fut le hibátlanul, ha az oszlop
-- létezik) átmásolja az igaz értékeket 'active' státuszként, hogy a
-- meglévő Prémium-felhasználók ne veszítsék el a hozzáférésüket az
-- átállás pillanatában.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'is_premium'
    ) THEN
        INSERT INTO public.subscriptions (user_id, subscription_status, subscription_platform)
        SELECT id, 'active', 'legacy_migration'
        FROM public.profiles
        WHERE is_premium = true
        ON CONFLICT (user_id) DO UPDATE SET subscription_status = 'active';
    END IF;
END $$;
