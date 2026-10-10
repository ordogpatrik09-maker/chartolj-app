-- =====================================================================
-- CHARTOLJ! — 015_push_subscriptions
-- =====================================================================
-- Valódi (böngésző-zárt állapotban is működő) push értesítésekhez kell
-- egy hely, ahol eltároljuk, melyik eszköz melyik push-végpontra
-- (endpoint) tud értesítést fogadni egy adott userhez — ez a szabványos
-- Web Push API alapja, FÜGGETLEN attól, hogy böngészőben vagy egy
-- TWA-csomagolt Android appban fut-e a Chartolj!.
--
-- Egy usernek több sora is lehet (pl. telefon + laptop), ezért nem
-- egyedi user_id, hanem egyedi (user_id, endpoint) pár.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint    text NOT NULL,
    p256dh      text NOT NULL,
    auth_key    text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, endpoint)
);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_subs_select_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_select_own" ON public.push_subscriptions
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_insert_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_insert_own" ON public.push_subscriptions
    FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_update_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_update_own" ON public.push_subscriptions
    FOR UPDATE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "push_subs_delete_own" ON public.push_subscriptions;
CREATE POLICY "push_subs_delete_own" ON public.push_subscriptions
    FOR DELETE USING (auth.uid() = user_id);

-- Kényelmi upsert RPC a kliensnek: ha a user újra feliratkozik (pl. a
-- böngésző lecserélte az endpointot), ne dobjon unique-violation hibát.
CREATE OR REPLACE FUNCTION public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth_key text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth_key)
    VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth_key)
    ON CONFLICT (user_id, endpoint)
    DO UPDATE SET p256dh = EXCLUDED.p256dh, auth_key = EXCLUDED.auth_key, last_seen_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_push_subscription(p_endpoint text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.push_subscriptions WHERE user_id = auth.uid() AND endpoint = p_endpoint;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_push_subscription(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_push_subscription(text) TO authenticated;

COMMIT;
