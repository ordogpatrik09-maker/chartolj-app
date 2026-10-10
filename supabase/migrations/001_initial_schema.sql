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
