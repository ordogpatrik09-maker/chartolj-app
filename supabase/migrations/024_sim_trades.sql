-- =====================================================================
-- 024_sim_trades.sql — Lezárt szimulált kötések tartós mentése (ÚJ, ADDITÍV)
-- =====================================================================
-- Eddig a szimulátor lezárt kötései (tradeHistory) csak a böngésző
-- memóriájában éltek: újratöltéskor elvesztek, és dátum sem volt rajtuk,
-- így heti elemzés nem volt lehetséges. Ez a migráció egy ÚJ táblát és két
-- ÚJ RPC-t ad hozzá — meglévő táblához/RPC-hez NEM nyúl.
--
-- Biztonság:
--  - RLS bekapcsolva, csak SAJÁT sorok olvashatók; írás KIZÁRÓLAG a
--    record_sim_trade() RPC-n át (validált mezők, korlátos hossz/érték,
--    napi darabszám-korlát), közvetlen INSERT/UPDATE/DELETE policy nincs.
--  - Mindkét RPC: GRANT authenticated + REVOKE PUBLIC/anon (lásd 021/022 —
--    a PUBLIC-revoke nélkül az anon is hívhatná).
--  - ON DELETE CASCADE az auth.users-re: fióktörléskor a kötések is törlődnek.
--  - Idempotens: (user_id, client_id) egyedi — hálózati újrapróbálás nem
--    duplikál.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.sim_trades (
    id          bigserial PRIMARY KEY,
    user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    client_id   text NOT NULL,
    closed_at   timestamptz NOT NULL DEFAULT now(),
    asset       text NOT NULL,
    side        text NOT NULL CHECK (side IN ('long', 'short')),
    pnl         numeric(18, 2) NOT NULL,
    reason      text,
    note        text,
    CONSTRAINT sim_trades_user_client_key UNIQUE (user_id, client_id)
);

CREATE INDEX IF NOT EXISTS idx_sim_trades_user_closed ON public.sim_trades (user_id, closed_at DESC);

ALTER TABLE public.sim_trades ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sim_trades_select_own ON public.sim_trades;
CREATE POLICY sim_trades_select_own ON public.sim_trades
    FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Egy lezárt kötés mentése. A zárás időpontját a SZERVER adja (now()),
-- így a kliens nem tud "régebbi" heti statisztikát hamisítani.
CREATE OR REPLACE FUNCTION public.record_sim_trade(
    p_client_id text,
    p_asset text,
    p_side text,
    p_pnl numeric,
    p_reason text DEFAULT NULL,
    p_note text DEFAULT NULL
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_today_count integer;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Nincs bejelentkezve';
    END IF;
    IF p_client_id IS NULL OR length(trim(p_client_id)) = 0 OR length(p_client_id) > 64 THEN
        RAISE EXCEPTION 'Érvénytelen kötés-azonosító';
    END IF;
    IF p_asset IS NULL OR length(trim(p_asset)) = 0 OR length(p_asset) > 32 THEN
        RAISE EXCEPTION 'Érvénytelen eszköz';
    END IF;
    IF p_side IS NULL OR p_side NOT IN ('long', 'short') THEN
        RAISE EXCEPTION 'Érvénytelen irány';
    END IF;
    -- numeric-ben nincs Infinity; a NaN-t és a képtelen nagyságrendet kiszűrjük.
    IF p_pnl IS NULL OR p_pnl = 'NaN'::numeric OR abs(p_pnl) > 1000000000 THEN
        RAISE EXCEPTION 'Érvénytelen eredmény';
    END IF;

    SELECT count(*) INTO v_today_count
    FROM public.sim_trades
    WHERE user_id = v_uid AND closed_at > now() - interval '24 hours';
    IF v_today_count >= 1000 THEN
        RETURN false; -- napi korlát: csendben nem mentünk tovább
    END IF;

    INSERT INTO public.sim_trades (user_id, client_id, asset, side, pnl, reason, note)
    VALUES (v_uid, left(p_client_id, 64), left(trim(p_asset), 32), p_side, round(p_pnl, 2),
            left(p_reason, 120), left(p_note, 500))
    ON CONFLICT ON CONSTRAINT sim_trades_user_client_key DO NOTHING;
    RETURN true;
END;
$$;

-- A saját lezárt kötések az elmúlt p_days napból (max. 90 nap, max. 2000 db).
CREATE OR REPLACE FUNCTION public.get_my_sim_trades(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_days integer := greatest(1, least(coalesce(p_days, 30), 90));
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Nincs bejelentkezve';
    END IF;
    RETURN coalesce((
        SELECT jsonb_agg(jsonb_build_object(
                   'id', t.client_id, 'closed_at', t.closed_at, 'asset', t.asset,
                   'side', t.side, 'pnl', t.pnl, 'reason', t.reason, 'note', t.note)
                 ORDER BY t.closed_at DESC)
        FROM (
            SELECT * FROM public.sim_trades
            WHERE user_id = v_uid AND closed_at > now() - make_interval(days => v_days)
            ORDER BY closed_at DESC
            LIMIT 2000
        ) t
    ), '[]'::jsonb);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_sim_trade(text, text, text, numeric, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_sim_trade(text, text, text, numeric, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_sim_trade(text, text, text, numeric, text, text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_my_sim_trades(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_sim_trades(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_sim_trades(integer) TO authenticated;
