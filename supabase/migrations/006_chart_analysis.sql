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
