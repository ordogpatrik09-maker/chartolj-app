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
