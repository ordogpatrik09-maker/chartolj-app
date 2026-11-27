-- =====================================================================
-- 028_email_digest_prefs.sql — Heti e-mail összefoglaló feliratkozás (ÚJ, ADDITÍV)
-- =====================================================================
-- Kifejezett, kikapcsolható hozzájárulás (opt-in) a heti összefoglaló
-- e-mailhez. Külön táblában, hogy a profiles oszlop-zárolását (012) ne
-- érintse. A weekly-digest Edge Function (service role) olvassa.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.email_prefs (
    user_id        uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    weekly_digest  boolean NOT NULL DEFAULT false,
    unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid(),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    last_sent_at   timestamptz
);
ALTER TABLE public.email_prefs ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.set_weekly_digest(p_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    INSERT INTO public.email_prefs (user_id, weekly_digest) VALUES (v_uid, coalesce(p_enabled, false))
    ON CONFLICT (user_id) DO UPDATE SET weekly_digest = excluded.weekly_digest, updated_at = now();
    RETURN coalesce(p_enabled, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_digest()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT coalesce((SELECT weekly_digest FROM public.email_prefs WHERE user_id = auth.uid()), false);
$$;

REVOKE EXECUTE ON FUNCTION public.set_weekly_digest(boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_weekly_digest(boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_weekly_digest(boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.get_weekly_digest() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_weekly_digest() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_digest() TO authenticated;
