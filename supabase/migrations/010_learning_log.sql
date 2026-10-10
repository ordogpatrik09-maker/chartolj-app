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
