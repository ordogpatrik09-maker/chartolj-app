-- =====================================================================
-- 026_cancel_feedback.sql — Lemondási visszajelzés (ÚJ, ADDITÍV)
-- =====================================================================
-- Amikor a felhasználó az "Előfizetés kezelése" gombra koppint, egy rövid,
-- opcionális kérdőív kérdezi meg, miért mondaná le. A válasz ide kerül;
-- az admin a meglévő admin-panelen összesítve látja.
-- Meglévő táblához/RPC-hez NEM nyúl.
-- Biztonság: RLS bekapcsolva policy nélkül — írás csak a validáló RPC-n át
-- (felhasználónként naponta max. 5), olvasás csak az admin RPC-n át
-- (ugyanaz az admin-email ellenőrzés, mint a 020-ban).
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.cancel_feedback (
    id          bigserial PRIMARY KEY,
    user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    reason      text NOT NULL CHECK (reason IN ('price', 'no_time', 'not_useful', 'too_hard', 'too_easy', 'bugs', 'other')),
    note        text,
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cancel_feedback_created ON public.cancel_feedback (created_at DESC);
ALTER TABLE public.cancel_feedback ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.submit_cancel_feedback(p_reason text, p_note text DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_n integer;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    IF p_reason IS NULL OR p_reason NOT IN ('price', 'no_time', 'not_useful', 'too_hard', 'too_easy', 'bugs', 'other') THEN
        RAISE EXCEPTION 'Érvénytelen ok';
    END IF;
    SELECT count(*) INTO v_n FROM public.cancel_feedback WHERE user_id = v_uid AND created_at > now() - interval '24 hours';
    IF v_n >= 5 THEN RETURN false; END IF;
    INSERT INTO public.cancel_feedback (user_id, reason, note) VALUES (v_uid, p_reason, left(nullif(trim(p_note), ''), 500));
    RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_get_cancel_feedback(p_days integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
    v_since timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 365)));
BEGIN
    IF v_caller_email = '' OR v_caller_email NOT IN ('patrik66@gmail.com') THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez a művelethez.' USING ERRCODE = '42501';
    END IF;
    RETURN jsonb_build_object(
        'by_reason', coalesce((SELECT jsonb_object_agg(reason, n) FROM (SELECT reason, count(*) AS n FROM public.cancel_feedback WHERE created_at >= v_since GROUP BY reason) x), '{}'::jsonb),
        'recent', coalesce((SELECT jsonb_agg(jsonb_build_object('reason', reason, 'note', note, 'at', created_at) ORDER BY created_at DESC)
                            FROM (SELECT * FROM public.cancel_feedback WHERE created_at >= v_since AND note IS NOT NULL ORDER BY created_at DESC LIMIT 20) y), '[]'::jsonb)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_cancel_feedback(text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_cancel_feedback(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_cancel_feedback(text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.admin_get_cancel_feedback(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_cancel_feedback(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_cancel_feedback(integer) TO authenticated;
