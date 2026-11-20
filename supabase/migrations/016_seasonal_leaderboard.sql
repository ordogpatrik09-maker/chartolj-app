-- ============================================================================
-- Chartolj! — Szezonális ranglista (heti / havi XP liga)
-- ============================================================================
-- FUTTASD LE EGYBEN a Supabase projekted SQL Editorában (Dashboard → SQL
-- Editor → New query → illeszd be → Run). Az egész script egyetlen
-- tranzakcióban fut (BEGIN/COMMIT), tehát vagy teljesen lefut, vagy
-- semmi nem változik.
--
-- Mit csinál:
--   A meglévő globális/barátok ranglista (015_leaderboard_friends.sql)
--   a TELJES, élettartam alatt összegyűjtött XP-t rangsorolja — ez azt
--   jelenti, hogy egy régóta aktív felhasználó előnye GYAKORLATILAG
--   behozhatatlan egy most csatlakozó számára. A "szezonális liga" ehelyett
--   egy adott IDŐSZAKBAN (az aktuális hét vagy hónap) megszerzett XP-t
--   rangsorolja — ez időszak-váltáskor automatikusan "nullázódik" mindenki
--   számára, így folyamatosan újra versenyezhető marad.
--
--   Nincs szükség külön cron-jobra a "reset"-hez: egy "lusta pillanatkép"
--   (snapshot) mintát használunk — amikor egy ÚJ időszak első RPC-hívása
--   megtörténik (bárki felhasználó részéről), a függvény rögzíti MINDEN
--   akkor létező felhasználó aktuális (élettartam) XP-jét mint "időszak-
--   kezdő XP"-t; onnantól a liga-pontszám = jelenlegi XP − időszak-kezdő
--   XP. Ha valaki az időszak közben regisztrál, az ő pillanatképe az
--   ELSŐ híváskor rögzül (0 XP-vel indul az ő nézőpontjából), tehát ő is
--   azonnal versenyezhet.
--
--   Új tábla: public.xp_league_snapshots
--   Új RPC:   public.get_seasonal_leaderboard(period_type, limit)
--             period_type: 'weekly' (ISO hét, hétfőtől) vagy 'monthly'
-- ============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.xp_league_snapshots (
    user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    period_type  text NOT NULL CHECK (period_type IN ('weekly', 'monthly')),
    period_start date NOT NULL,
    xp_at_start  int  NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, period_type, period_start)
);

ALTER TABLE public.xp_league_snapshots ENABLE ROW LEVEL SECURITY;

-- Közvetlen SELECT csak a saját sorra — a liga maga a SECURITY DEFINER
-- RPC-n keresztül látja mindenki (nyilvánosan vállalható) nevét/XP-jét,
-- a nyers snapshot-táblát viszont nem kell közvetlenül olvashatóvá tenni.
DROP POLICY IF EXISTS "xp_league_snapshots_select_own" ON public.xp_league_snapshots;
CREATE POLICY "xp_league_snapshots_select_own" ON public.xp_league_snapshots
    FOR SELECT USING (auth.uid() = user_id);

-- (Nincs INSERT/UPDATE policy — a pillanatkép-sorokat kizárólag az alábbi
-- SECURITY DEFINER függvény hozza létre, szerveroldalon.)

CREATE OR REPLACE FUNCTION public.get_seasonal_leaderboard(p_period_type text DEFAULT 'weekly', p_limit int DEFAULT 50)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, period_xp int, period_start date, period_ends_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_period_start date;
    v_period_end   timestamptz;
BEGIN
    IF p_period_type NOT IN ('weekly', 'monthly') THEN
        RAISE EXCEPTION 'p_period_type csak ''weekly'' vagy ''monthly'' lehet';
    END IF;

    IF p_period_type = 'weekly' THEN
        v_period_start := date_trunc('week', now())::date;      -- ISO hét, hétfőtől
        v_period_end   := (date_trunc('week', now()) + interval '7 days');
    ELSE
        v_period_start := date_trunc('month', now())::date;
        v_period_end   := (date_trunc('month', now()) + interval '1 month');
    END IF;

    -- Lusta rollover: minden olyan felhasználóra, akinek még nincs
    -- pillanatképe az AKTUÁLIS időszakra, most rögzítjük a jelenlegi
    -- (élettartam) XP-jét mint időszak-kezdő értéket. Ez a hívás magától
    -- "nullázza" a ligát minden új hét/hónap első hívásakor.
    -- MEGJEGYZÉS: a RETURNS TABLE(...) kimeneti oszlopai (pl. "user_id")
    -- PL/pgSQL-ben azonos névtérben vannak a sima azonosítókkal, ezért az
    -- "ON CONFLICT (user_id, ...)" oszlop-listás forma kétértelmű lenne
    -- ("column reference is ambiguous") — ehelyett a PRIMARY KEY
    -- kényszer NEVÉVEL hivatkozunk rá, amivel ez a kétértelműség nem
    -- merülhet fel (ezt valódi PostgreSQL-futtatással derítettük ki és
    -- ellenőriztük a javítást is).
    INSERT INTO public.xp_league_snapshots (user_id, period_type, period_start, xp_at_start)
    SELECT pr.user_id, p_period_type, v_period_start, COALESCE(pr.mobile_xp, 0)
    FROM public.progress pr
    ON CONFLICT ON CONSTRAINT xp_league_snapshots_pkey DO NOTHING;

    RETURN QUERY
    SELECT p.id,
           COALESCE(p.display_name, 'Trader'),
           p.avatar_url,
           GREATEST(COALESCE(pr.mobile_xp, 0) - s.xp_at_start, 0) AS period_xp,
           v_period_start,
           v_period_end
    FROM public.xp_league_snapshots s
    JOIN public.profiles p ON p.id = s.user_id
    JOIN public.progress pr ON pr.user_id = s.user_id
    WHERE s.period_type = p_period_type AND s.period_start = v_period_start
    ORDER BY period_xp DESC
    LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_seasonal_leaderboard(text, int) TO authenticated;

COMMIT;

-- ============================================================================
-- ELLENŐRZÉS a futtatás után (opcionális):
--
--   SELECT proname FROM pg_proc WHERE proname = 'get_seasonal_leaderboard';
--   SELECT * FROM information_schema.columns WHERE table_name = 'xp_league_snapshots';
--
-- Kliens-oldali hívás (bejelentkezett session-ben):
--   const { data } = await sb.rpc('get_seasonal_leaderboard', { p_period_type: 'weekly', p_limit: 50 });
-- ============================================================================
