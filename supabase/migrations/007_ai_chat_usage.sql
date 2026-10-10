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
