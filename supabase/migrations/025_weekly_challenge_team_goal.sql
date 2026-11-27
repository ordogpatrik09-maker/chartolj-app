-- =====================================================================
-- 025_weekly_challenge_team_goal.sql — Heti kihívás + csapat heti cél (ÚJ, ADDITÍV)
-- =====================================================================
-- 1) Heti kihívás: minden felhasználó UGYANAZT a (hét-azonosítóból
--    determinisztikusan generált) Replay-grafikont kereskedi; az eredmény
--    (hozam %, folyamat-pontszám) egy heti ranglistára kerül. Hetente csak
--    az ELSŐ próbálkozás számít (ugyanazon a grafikonon a többi már
--    "emlékezetből" menne).
--    Megjegyzés: a hozamot a kliens számolja — egy oktatási szimulátornál ez
--    elfogadott kompromisszum; a szerver ésszerű tartományra korlátoz.
-- 2) Csapat heti cél: a saját + elfogadott barátok heti XP-gyarapodásának
--    összege egy közös célhoz mérve — a MEGLÉVŐ friendships és
--    xp_league_snapshots (015/016) táblákra épül, azokat nem módosítja
--    (csak a 016-ban is használt lusta pillanatkép-létrehozást végzi el).
-- Mindhárom RPC: GRANT authenticated + REVOKE PUBLIC/anon.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.weekly_challenge_results (
    user_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    week_key       text NOT NULL CHECK (week_key ~ '^[0-9]{4}-W[0-9]{2}$'),
    return_pct     numeric(8, 2) NOT NULL,
    process_score  integer,
    trades         integer NOT NULL DEFAULT 0,
    created_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, week_key)
);
CREATE INDEX IF NOT EXISTS idx_wcr_week_return ON public.weekly_challenge_results (week_key, return_pct DESC);

ALTER TABLE public.weekly_challenge_results ENABLE ROW LEVEL SECURITY;
-- Nincs policy: minden hozzáférés a lenti RPC-ken át.

CREATE OR REPLACE FUNCTION public.submit_weekly_challenge(
    p_week text, p_return numeric, p_process integer DEFAULT NULL, p_trades integer DEFAULT 0
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_cur text := to_char(now(), 'IYYY"-W"IW');
    v_prev text := to_char(now() - interval '7 days', 'IYYY"-W"IW');
    v_inserted boolean;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    IF p_week IS NULL OR p_week NOT IN (v_cur, v_prev) THEN RAISE EXCEPTION 'Lejárt vagy érvénytelen hét'; END IF;
    IF p_return IS NULL OR p_return = 'NaN'::numeric OR p_return < -100 OR p_return > 1000 THEN RAISE EXCEPTION 'Érvénytelen hozam'; END IF;
    IF p_process IS NOT NULL AND (p_process < 0 OR p_process > 100) THEN RAISE EXCEPTION 'Érvénytelen pontszám'; END IF;

    INSERT INTO public.weekly_challenge_results (user_id, week_key, return_pct, process_score, trades)
    VALUES (v_uid, p_week, round(p_return, 2), p_process, greatest(0, least(coalesce(p_trades, 0), 1000)))
    ON CONFLICT (user_id, week_key) DO NOTHING
    RETURNING true INTO v_inserted;

    RETURN jsonb_build_object('accepted', coalesce(v_inserted, false));
END;
$$;

CREATE OR REPLACE FUNCTION public.get_weekly_challenge_leaderboard(p_week text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_top jsonb;
    v_me jsonb;
    v_total integer;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    IF p_week IS NULL OR p_week !~ '^[0-9]{4}-W[0-9]{2}$' THEN RAISE EXCEPTION 'Érvénytelen hét'; END IF;

    WITH ranked AS (
        SELECT r.user_id, r.return_pct, r.process_score, r.trades,
               rank() OVER (ORDER BY r.return_pct DESC, r.process_score DESC NULLS LAST, r.created_at) AS rnk
        FROM public.weekly_challenge_results r
        WHERE r.week_key = p_week
    )
    SELECT
        coalesce((SELECT jsonb_agg(jsonb_build_object(
                    'rank', x.rnk, 'name', coalesce(p.display_name, 'Trader'), 'avatar', p.avatar_url,
                    'return_pct', x.return_pct, 'process', x.process_score, 'is_me', x.user_id = v_uid)
                  ORDER BY x.rnk)
                  FROM (SELECT * FROM ranked ORDER BY rnk LIMIT 20) x
                  LEFT JOIN public.profiles p ON p.id = x.user_id), '[]'::jsonb),
        (SELECT jsonb_build_object('rank', rnk, 'return_pct', return_pct, 'process', process_score) FROM ranked WHERE user_id = v_uid),
        (SELECT count(*) FROM ranked)
    INTO v_top, v_me, v_total;

    RETURN jsonb_build_object('week', p_week, 'top', v_top, 'me', v_me, 'participants', v_total);
END;
$$;

-- Csapat heti cél: saját + elfogadott barátok heti XP-gyarapodása.
-- Cél: tagonként 300 XP (min. 1 tag).
CREATE OR REPLACE FUNCTION public.get_team_weekly_goal()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_start date := date_trunc('week', now())::date;
    v_members jsonb;
    v_total integer;
    v_count integer;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;

    -- Lusta heti pillanatkép a csapattagoknak (ugyanaz a minta, mint a 016-ban).
    INSERT INTO public.xp_league_snapshots (user_id, period_type, period_start, xp_at_start)
    SELECT pr.user_id, 'weekly', v_start, coalesce(pr.mobile_xp, 0)
    FROM public.progress pr
    WHERE pr.user_id = v_uid
       OR pr.user_id IN (SELECT addressee_id FROM public.friendships WHERE requester_id = v_uid AND status = 'accepted'
                         UNION SELECT requester_id FROM public.friendships WHERE addressee_id = v_uid AND status = 'accepted')
    ON CONFLICT (user_id, period_type, period_start) DO NOTHING;

    WITH team AS (
        SELECT v_uid AS id
        UNION SELECT addressee_id FROM public.friendships WHERE requester_id = v_uid AND status = 'accepted'
        UNION SELECT requester_id FROM public.friendships WHERE addressee_id = v_uid AND status = 'accepted'
    ), gains AS (
        SELECT t.id, coalesce(p.display_name, 'Trader') AS name,
               greatest(coalesce(pr.mobile_xp, 0) - coalesce(s.xp_at_start, coalesce(pr.mobile_xp, 0)), 0) AS xp_week
        FROM team t
        LEFT JOIN public.profiles p ON p.id = t.id
        LEFT JOIN public.progress pr ON pr.user_id = t.id
        LEFT JOIN public.xp_league_snapshots s ON s.user_id = t.id AND s.period_type = 'weekly' AND s.period_start = v_start
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('name', name, 'xp_week', xp_week, 'is_me', id = v_uid) ORDER BY xp_week DESC), '[]'::jsonb),
           coalesce(sum(xp_week), 0), count(*)
    INTO v_members, v_total, v_count
    FROM gains;

    RETURN jsonb_build_object('week_start', v_start, 'members', v_members, 'total_xp', v_total,
                              'goal_xp', greatest(v_count, 1) * 300, 'member_count', v_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_weekly_challenge(text, numeric, integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.submit_weekly_challenge(text, numeric, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.submit_weekly_challenge(text, numeric, integer, integer) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_weekly_challenge_leaderboard(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_weekly_challenge_leaderboard(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_weekly_challenge_leaderboard(text) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.get_team_weekly_goal() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_team_weekly_goal() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_team_weekly_goal() TO authenticated;
