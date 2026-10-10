-- =====================================================================
-- 000_COMBINED_RUN_THIS.sql
-- Ezt illeszd be a Supabase SQL Editorba A HIBÁS SCRIPT HELYETT.
-- Tartalma: a 10 meglévő migráció (001-010), a dokumentált helyes
-- futtatási sorrendben összefűzve: 001 -> 002 -> 004 -> 003 -> 005
-- -> 006 -> 007 -> 008 -> 009 -> 010. Mindegyik idempotens (IF NOT
-- EXISTS / DROP POLICY IF EXISTS mintát követ), tehát ha egy részük
-- esetleg már lefutott korábban nálad, az újrafuttatás nem árt.
-- =====================================================================

-- ========================= 001_initial_schema.sql =========================
-- =====================================================================
-- 001_initial_schema.sql — CHARTOLJ! alap séma
-- =====================================================================
-- IDEMPOTENS: biztonságosan újra futtatható. NEM töröl adatot, NEM
-- használ vak DROP TABLE-t. Ha a profiles/progress tábla már létezik
-- (korábbi migrációból), ez csak a hiányzó oszlopokat egészíti ki.
-- =====================================================================

-- ---------------------------------------------------------------------
-- PROFILES — a felhasználó nyilvános/megjelenítési adatai.
-- Szándékosan NEM tartalmaz Prémium/subscription mezőt — azok a
-- `subscriptions` táblában vannak (lásd 004_subscription.sql), mert
-- azt a kliens (authenticated szerepkör) csak OLVASNI tudja, írni nem.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name text,
    avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ha a tábla már létezett egy korábbi, egyszerűbb verzióból (pl. csak
-- `is_premium` oszloppal), egészítsük ki a hiányzó oszlopokkal.
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS display_name text,
    ADD COLUMN IF NOT EXISTS avatar_url text,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- MEGJEGYZÉS: ha a profiles táblán korábban volt egy `is_premium` oszlop,
-- azt SZÁNDÉKOSAN NEM töröljük itt (adatvesztés elkerülése) — de a
-- kliens mostantól a `subscriptions` táblát olvassa a Prémium-státuszhoz.
-- Ha biztosan nincs rá szükség, egy KÉSŐBBI, külön migrációban törölhető:
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_premium;
-- Ezt óvatosságból NEM futtatjuk automatikusan.

-- ---------------------------------------------------------------------
-- PROGRESS — a jelenlegi kliens (chartolj_mobile.html) által ténylegesen
-- használt mezőnevekkel, változtatás nélkül.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progress (
    user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    mobile_xp integer NOT NULL DEFAULT 0,
    mobile_coins integer NOT NULL DEFAULT 0,
    mobile_done_lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
    mobile_what_if_done jsonb NOT NULL DEFAULT '[]'::jsonb,
    claimed_ranks jsonb NOT NULL DEFAULT '[]'::jsonb,
    claimed_missions jsonb NOT NULL DEFAULT '[]'::jsonb,
    opened_premium_lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
    unlocked_chart_themes jsonb NOT NULL DEFAULT '["classic"]'::jsonb,
    mobile_hearts integer NOT NULL DEFAULT 3,
    mobile_hearts_regen_at bigint,
    mobile_mistake_bank jsonb NOT NULL DEFAULT '[]'::jsonb,
    mobile_drill_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
    mobile_replay_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
    mobile_replay_journal jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.progress
    ADD COLUMN IF NOT EXISTS mobile_xp integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mobile_coins integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS mobile_done_lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS mobile_what_if_done jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS claimed_ranks jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS claimed_missions jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS opened_premium_lessons jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS unlocked_chart_themes jsonb NOT NULL DEFAULT '["classic"]'::jsonb,
    -- FONTOS: a mobile_hearts alapértéke 3, összhangban az app
    -- ACADEMY_HEARTS_MAX = 3 konstansával. (Egy korábbi, külső
    -- javaslatból véletlenül 5 került be egy másik projektváltozatban —
    -- itt véglegesen 3-mal írjuk elő, hogy elkerüljük az eltérést.)
    ADD COLUMN IF NOT EXISTS mobile_hearts integer NOT NULL DEFAULT 3,
    ADD COLUMN IF NOT EXISTS mobile_hearts_regen_at bigint,
    ADD COLUMN IF NOT EXISTS mobile_mistake_bank jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS mobile_drill_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS mobile_replay_stats jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS mobile_replay_journal jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Ha egy MEGLÉVŐ táblában a mobile_hearts alapértéke korábban 5 volt,
-- ez a sor most 3-ra igazítja a JÖVŐBELI alapértéket (nem írja felül a
-- meglévő sorok jelenlegi értékét — az a felhasználók tényleges,
-- játékban elért szív-számát tükrözi, azt nem bántjuk).
ALTER TABLE public.progress ALTER COLUMN mobile_hearts SET DEFAULT 3;

-- ========================= 002_rls.sql =========================
-- =====================================================================
-- 002_rls.sql — Row Level Security: profiles + progress
-- =====================================================================
-- Elv: minden felhasználó KIZÁRÓLAG a saját sorát láthatja/módosíthatja.
-- Idempotens: DROP POLICY IF EXISTS + CREATE POLICY mintát követ.
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Nincs kliens-oldali INSERT/DELETE policy: a profiles sor a
-- handle_new_chartolj_user() trigger által jön létre (003_triggers.sql),
-- a törlés pedig ON DELETE CASCADE-del automatikus, ha az auth.users
-- sor törlődik (lásd delete-account Edge Function).

-- ---------------------------------------------------------------------
-- PROGRESS
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "progress_select_own" ON public.progress;
CREATE POLICY "progress_select_own"
    ON public.progress FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "progress_insert_own" ON public.progress;
CREATE POLICY "progress_insert_own"
    ON public.progress FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "progress_update_own" ON public.progress;
CREATE POLICY "progress_update_own"
    ON public.progress FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Ez teszi lehetővé a kliens "Fiók és adatok törlése" önkiszolgáló
-- funkcióját (a haladás-adat azonnali törlését).
DROP POLICY IF EXISTS "progress_delete_own" ON public.progress;
CREATE POLICY "progress_delete_own"
    ON public.progress FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ========================= 004_subscription.sql =========================
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

-- JAVÍTÁS: a projektben már létezett egy korábbi, más sémájú `subscriptions`
-- tábla, ezért a fenti CREATE TABLE IF NOT EXISTS kihagyta a létrehozást —
-- ez az ALTER TABLE pótolja a hiányzó oszlopokat rajta, ugyanúgy, ahogy a
-- 001_initial_schema.sql teszi a profiles/progress táblákkal.
ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'free',
    ADD COLUMN IF NOT EXISTS subscription_product_id text,
    ADD COLUMN IF NOT EXISTS subscription_platform text,
    ADD COLUMN IF NOT EXISTS subscription_purchase_token text,
    ADD COLUMN IF NOT EXISTS expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- JAVÍTÁS #2: a meglévő `subscriptions` táblán a user_id oszlopon nem volt
-- PRIMARY KEY / UNIQUE megszorítás (ezért bukott el az ON CONFLICT lejjebb).
-- Hibatűrő módon pótoljuk: ha már létezne bármilyen néven, a kivétel-kezelő
-- elnyeli a "már létezik" hibát, és a script folytatódik.
DO $$
BEGIN
    ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_user_id_key UNIQUE (user_id);
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN duplicate_table THEN NULL;
    WHEN OTHERS THEN
        RAISE NOTICE 'subscriptions_user_id_key megszorítás hozzáadása sikertelen (% — %), valószínűleg duplikált user_id sorok vannak. Ezt kézzel kell megvizsgálni.', SQLSTATE, SQLERRM;
END $$;

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

-- ========================= 003_triggers.sql =========================
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

-- ========================= 005_stripe.sql =========================
-- =====================================================================
-- 005_stripe.sql — Stripe-specifikus kiegészítés a subscriptions táblához
-- =====================================================================
-- A stripe_customer_id kell ahhoz, hogy a stripe-portal Edge Function
-- meg tudja nyitni a MEGFELELŐ felhasználó Stripe Billing Portal
-- munkamenetét, és hogy a stripe-webhook a bejövő Stripe eseményt vissza
-- tudja kötni a megfelelő Supabase felhasználóra.
-- =====================================================================

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS stripe_customer_id text,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- Gyors kereséshez a webhookban (customer.id alapján).
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
    ON public.subscriptions (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

-- Az authenticated kliens ezt is csak OLVASHATJA — írási policy erre
-- sincs, ugyanaz a védelem érvényes, mint a többi subscriptions mezőre
-- (lásd 004_subscription.sql). Nincs teendő itt, a meglévő
-- "subscriptions_select_own" SELECT policy már lefedi ezt az oszlopot is.

-- ========================= 006_chart_analysis.sql =========================
-- =====================================================================
-- 006_chart_analysis.sql — AI Chart Elemző előzmény-tábla
-- =====================================================================
-- FONTOS DÖNTÉS: magát a feltöltött KÉPET nem tároljuk (adatvédelem +
-- tárhelyköltség miatt) — csak az elemzés EREDMÉNYÉT (felismert alakzat,
-- magyarázat, dátum). A kép csak a kérés idejére, memóriában létezik az
-- Edge Function-ben, onnan nem kerül perzisztálásra.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.chart_analyses (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    detected_pattern_id text,       -- pl. 'headshoulders', 'bullish_engulfing' — a DRILL_PATTERN_POOL id-jaival kompatibilis
    detected_pattern_name text,     -- megjelenítendő név, pl. "Head and Shoulders"
    confidence text,                -- 'magas' | 'közepes' | 'alacsony'
    summary text NOT NULL,          -- rövid, 1-2 mondatos összegzés
    full_analysis text NOT NULL,    -- a teljes AI-válasz szövege
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chart_analyses_user_created
    ON public.chart_analyses (user_id, created_at DESC);

ALTER TABLE public.chart_analyses ENABLE ROW LEVEL SECURITY;

-- A felhasználó csak a SAJÁT elemzéseit láthatja.
DROP POLICY IF EXISTS "chart_analyses_select_own" ON public.chart_analyses;
CREATE POLICY "chart_analyses_select_own"
    ON public.chart_analyses FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- FONTOS: nincs kliens-oldali INSERT policy! Az elemzés írása KIZÁRÓLAG
-- az `analyze-chart` Edge Function-ön keresztül, service role kulccsal
-- történik — így egy felhasználó nem tud hamis "elemzést" beszúrni a
-- saját előzményébe, és a napi limit (lásd az Edge Function kódját)
-- nem kerülhető meg kliens-oldali trükkel.

-- A felhasználó a sajátját törölheti (pl. adatvédelmi okból).
DROP POLICY IF EXISTS "chart_analyses_delete_own" ON public.chart_analyses;
CREATE POLICY "chart_analyses_delete_own"
    ON public.chart_analyses FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);

-- ========================= 007_ai_chat_usage.sql =========================
-- =====================================================================
-- 007_ai_chat_usage.sql — AI Chat napi limit nyilvántartás
-- =====================================================================
-- FONTOS FELISMERÉS: az `ai-chat` Edge Function-nek eddig egyáltalán nem
-- volt napi limitje, miközben MÁR HÁROM funkció is ezen keresztül fut
-- (Coach chat, Replay utólagos elemzés, Mistake Bank magyarázat) — ez
-- korlátlan, kontroll nélküli Anthropic API-költséget jelentett volna
-- éles használat esetén (125. pont: AI Abuse Protection).
--
-- Ugyanaz a minta, mint a `chart_analyses` táblánál: csak a KÉRÉS TÉNYE
-- kerül naplózásra (időbélyeg), a kliens NEM tud írni ide közvetlenül —
-- a limit így nem kerülhető meg kliens-oldali trükkel.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ai_chat_usage (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_usage_user_created
    ON public.ai_chat_usage (user_id, created_at DESC);

ALTER TABLE public.ai_chat_usage ENABLE ROW LEVEL SECURITY;

-- A felhasználó csak a SAJÁT használati előzményét láthatja (diagnosztikai célra).
DROP POLICY IF EXISTS "ai_chat_usage_select_own" ON public.ai_chat_usage;
CREATE POLICY "ai_chat_usage_select_own"
    ON public.ai_chat_usage FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- FONTOS: nincs kliens-oldali INSERT policy — kizárólag az `ai-chat`
-- Edge Function írhat ide, service role kulccsal, minden egyes kérésnél.

-- ========================= 008_user_events.sql =========================
-- =====================================================================
-- 008_user_events.sql — Minimális termék-analitika (100-101. pont)
-- =====================================================================
-- A specifikáció kifejezetten kéri: "Measure onboarding completion, first
-- lesson, first practice, first decision, first demo trade, replay usage,
-- mistake review, retention, Premium interaction." Eddig EZ A FUNKCIÓ
-- EGYÁLTALÁN NEM LÉTEZETT az appban.
--
-- SZÁNDÉKOSAN EGYSZERŰ: csak az esemény NEVE + IDŐBÉLYEG kerül rögzítésre,
-- semmilyen extra, feleslegesen érzékeny adat nem társul hozzá
-- (161. pont: "Do not collect unnecessary sensitive information").
--
-- ELTÉRŐ MINTA A TÖBBI TÁBLÁHOZ KÉPEST: itt a kliens KÖZVETLENÜL írhat
-- (nincs szükség Edge Function-re, mint a Prémiumnál), mert egy analitikai
-- esemény meghamisítása nem jelent biztonsági vagy pénzügyi kockázatot —
-- legrosszabb esetben egy kicsit pontatlan statisztikát eredményezne,
-- nem tud vele senki magának Prémiumot vagy coinokat szerezni.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.user_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    event_name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_events_user_event
    ON public.user_events (user_id, event_name, created_at DESC);

ALTER TABLE public.user_events ENABLE ROW LEVEL SECURITY;

-- A kliens a SAJÁT eseményeit írhatja és olvashatja — mást nem.
DROP POLICY IF EXISTS "user_events_insert_own" ON public.user_events;
CREATE POLICY "user_events_insert_own"
    ON public.user_events FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "user_events_select_own" ON public.user_events;
CREATE POLICY "user_events_select_own"
    ON public.user_events FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

-- ========================= 009_avatar_storage.sql =========================
-- =====================================================================
-- 009_avatar_storage.sql — Profilkép tárolás (158-159. pont)
-- =====================================================================
-- Eddig a `profiles.avatar_url` mező LÉTEZETT és be is lett OLVASVA a
-- kliensben, de SOHA nem íródott — nem volt hozzá feltöltési felület,
-- és nem volt hozzá tárolóhely sem. Ez a migráció létrehozza a hiányzó
-- Storage bucket-et, felhasználó-specifikus elérési úttal (159. pont),
-- hogy egy felhasználó SOHA ne tudja felülírni vagy törölni egy másik
-- felhasználó profilképét.
--
-- ÚTVONAL-KONVENCIÓ: avatars/{user_id}/avatar.{kiterjesztés}
-- A kliens is ezt a mintát várja (lásd a chartolj_mobile.html
-- handleAvatarSelect() függvényét).
-- =====================================================================

-- A bucket NYILVÁNOS OLVASÁSRA van állítva (a profilképeket bárki
-- megnézheti, aki ismeri az URL-t — ez szokásos, alacsony kockázatú
-- gyakorlat profilképeknél), de ÍRÁSRA szigorúan felhasználó-specifikus.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE SET
    public = true,
    file_size_limit = 2097152,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Bárki olvashatja a profilképeket (a bucket maga is publikus, de RLS-szinten
-- is expliciten engedélyezzük, az egyértelműség kedvéért).
DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
    ON storage.objects FOR SELECT
    USING (bucket_id = 'avatars');

-- A felhasználó KIZÁRÓLAG a saját mappájába (avatars/{a_saját_user_id}/...)
-- tölthet fel, írhat felül vagy törölhet — a foldername() az útvonal első
-- szegmensét adja vissza, amit a user_id-val hasonlítunk össze.
DROP POLICY IF EXISTS "avatars_insert_own_folder" ON storage.objects;
CREATE POLICY "avatars_insert_own_folder"
    ON storage.objects FOR INSERT
    TO authenticated
    WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_update_own_folder" ON storage.objects;
CREATE POLICY "avatars_update_own_folder"
    ON storage.objects FOR UPDATE
    TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "avatars_delete_own_folder" ON storage.objects;
CREATE POLICY "avatars_delete_own_folder"
    ON storage.objects FOR DELETE
    TO authenticated
    USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ========================= 010_learning_log.sql =========================
-- =====================================================================
-- 010_learning_log.sql — Tanulási napló felhő-tárolás
-- =====================================================================
-- A mobile_learning_log oszlop tárolja a felhasználó összes hibatípusát
-- (chart-döntés, Replay-szokások, kvíz) időbélyeggel. A kliens csak akkor
-- küldi el, ha learningLogColumn === 'ready' — vagyis ez a migráció futott.
-- =====================================================================

ALTER TABLE public.progress
    ADD COLUMN IF NOT EXISTS mobile_learning_log jsonb DEFAULT '[]'::jsonb;

-- Index a user_id-ra (a haladás-lekérés már indexelt, ez redundáns, de explicit)
COMMENT ON COLUMN public.progress.mobile_learning_log IS
    'Tanulási napló: [{t, type, ref, d}] bejegyzések — a kliens 30 napos ablakot küld';

