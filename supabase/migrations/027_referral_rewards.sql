-- =====================================================================
-- 027_referral_rewards.sql — Ajánlói program (ÚJ, ADDITÍV)
-- =====================================================================
-- Ha egy ÚJ felhasználó (fiókja max. 14 napos) egy meghívókóddal érkezik,
-- mindketten 100 coint kapnak. A szerver csak NYILVÁNTARTJA a jogosultságot
-- (egy meghívott csak egyszer, a meghívó max. 20 jutalomig), a coint a
-- kliens írja jóvá a MEGLÉVŐ save_cloud_progress úton (a coin-mező abszolút
-- értéket ment, így egy szerveroldali növelést a kliens következő mentése
-- felülírna). A jutalom felhasználónként egyszer "beváltható" (claimed_*).
-- Meglévő táblához/RPC-hez NEM nyúl. RLS bekapcsolva, policy nincs.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.referrals (
    invitee_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    inviter_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at       timestamptz NOT NULL DEFAULT now(),
    invitee_claimed  boolean NOT NULL DEFAULT false,
    inviter_claimed  boolean NOT NULL DEFAULT false,
    CHECK (invitee_id <> inviter_id)
);
CREATE INDEX IF NOT EXISTS idx_referrals_inviter ON public.referrals (inviter_id);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

-- A meghívott hívja: rögzíti a kapcsolatot és visszaadja a saját jutalmát
-- (egyszer). {"reward": 100} vagy {"reward": 0, "reason": "..."}.
CREATE OR REPLACE FUNCTION public.claim_referral(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_inviter uuid;
    v_created timestamptz;
    v_count integer;
    v_row public.referrals%ROWTYPE;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    SELECT id INTO v_inviter FROM public.profiles WHERE invite_code = upper(trim(coalesce(p_code, '')));
    IF v_inviter IS NULL THEN RETURN jsonb_build_object('reward', 0, 'reason', 'invalid_code'); END IF;
    IF v_inviter = v_uid THEN RETURN jsonb_build_object('reward', 0, 'reason', 'self'); END IF;

    SELECT * INTO v_row FROM public.referrals WHERE invitee_id = v_uid;
    IF NOT FOUND THEN
        SELECT created_at INTO v_created FROM auth.users WHERE id = v_uid;
        IF v_created IS NULL OR v_created < now() - interval '14 days' THEN
            RETURN jsonb_build_object('reward', 0, 'reason', 'not_new');
        END IF;
        SELECT count(*) INTO v_count FROM public.referrals WHERE inviter_id = v_inviter;
        IF v_count >= 20 THEN RETURN jsonb_build_object('reward', 0, 'reason', 'inviter_cap'); END IF;
        INSERT INTO public.referrals (invitee_id, inviter_id) VALUES (v_uid, v_inviter)
        ON CONFLICT (invitee_id) DO NOTHING;
        SELECT * INTO v_row FROM public.referrals WHERE invitee_id = v_uid;
    END IF;

    IF v_row.invitee_claimed THEN RETURN jsonb_build_object('reward', 0, 'reason', 'already'); END IF;
    UPDATE public.referrals SET invitee_claimed = true WHERE invitee_id = v_uid AND NOT invitee_claimed;
    IF NOT FOUND THEN RETURN jsonb_build_object('reward', 0, 'reason', 'already'); END IF;
    RETURN jsonb_build_object('reward', 100);
END;
$$;

-- A meghívó hívja (pl. betöltéskor): a még be nem váltott jutalmai.
CREATE OR REPLACE FUNCTION public.claim_inviter_rewards()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_n integer;
    v_total integer;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    WITH u AS (
        UPDATE public.referrals SET inviter_claimed = true
        WHERE inviter_id = v_uid AND NOT inviter_claimed RETURNING 1
    ) SELECT count(*) INTO v_n FROM u;
    SELECT count(*) INTO v_total FROM public.referrals WHERE inviter_id = v_uid;
    RETURN jsonb_build_object('new', v_n, 'reward', v_n * 100, 'total_invited', v_total);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_referral(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_referral(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.claim_inviter_rewards() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_inviter_rewards() FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_inviter_rewards() TO authenticated;
