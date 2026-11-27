-- =====================================================================
-- 031_class_leaderboard.sql — Osztályon belüli ranglista (ÚJ, ADDITÍV)
-- =====================================================================
-- Az osztály tagjai és tulajdonosa láthatja a tagok nevét, heti és
-- összes XP-jét (ugyanaz az adatkör, mint a meglévő barát-ranglistán).
-- A heti XP a meglévő xp_league_snapshots (016) heti pillanatképéből
-- számol; ha egy tagnak még nincs a heti pillanatképe, lustán létrehozza
-- (ugyanaz a minta, mint a 016/025-ben).
-- =====================================================================

CREATE OR REPLACE FUNCTION public.get_class_leaderboard(p_class uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_week date := date_trunc('week', now())::date;
    v_name text;
BEGIN
    IF v_uid IS NULL THEN RAISE EXCEPTION 'Nincs bejelentkezve'; END IF;
    SELECT c.name INTO v_name FROM public.classes c
    WHERE c.id = p_class AND (c.owner_id = v_uid OR EXISTS (SELECT 1 FROM public.class_members m WHERE m.class_id = c.id AND m.user_id = v_uid));
    IF v_name IS NULL THEN RAISE EXCEPTION 'Nincs jogosultság ehhez az osztályhoz' USING ERRCODE = '42501'; END IF;

    INSERT INTO public.xp_league_snapshots (user_id, period_type, period_start, xp_at_start)
    SELECT pr.user_id, 'weekly', v_week, coalesce(pr.mobile_xp, 0)
    FROM public.class_members m JOIN public.progress pr ON pr.user_id = m.user_id
    WHERE m.class_id = p_class
    ON CONFLICT (user_id, period_type, period_start) DO NOTHING;

    RETURN jsonb_build_object('name', v_name, 'rows', coalesce((
        SELECT jsonb_agg(x ORDER BY (x->>'xp_week')::int DESC, (x->>'xp')::int DESC) FROM (
            SELECT jsonb_build_object(
                'name', coalesce(p.display_name, 'Tanuló'),
                'xp', coalesce(pr.mobile_xp, 0),
                'xp_week', greatest(coalesce(pr.mobile_xp, 0) - coalesce(s.xp_at_start, coalesce(pr.mobile_xp, 0)), 0),
                'is_me', m.user_id = v_uid) AS x
            FROM public.class_members m
            LEFT JOIN public.profiles p ON p.id = m.user_id
            LEFT JOIN public.progress pr ON pr.user_id = m.user_id
            LEFT JOIN public.xp_league_snapshots s ON s.user_id = m.user_id AND s.period_type = 'weekly' AND s.period_start = v_week
            WHERE m.class_id = p_class) q), '[]'::jsonb));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_class_leaderboard(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_class_leaderboard(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_class_leaderboard(uuid) TO authenticated;
