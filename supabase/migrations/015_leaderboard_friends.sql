-- ============================================================================
-- Chartolj! — Valódi (több-felhasználós) Ranglista + Barátok backend
-- ============================================================================
-- FUTTASD LE EGYBEN a Supabase projekted SQL Editorában (Dashboard → SQL
-- Editor → New query → illeszd be → Run). Az egész script egyetlen
-- tranzakcióban fut (BEGIN/COMMIT), tehát vagy teljesen lefut, vagy
-- semmi nem változik.
--
-- Mit csinál:
--  1) Hozzáad egy `invite_code` oszlopot a meglévő `profiles` táblához.
--  2) Létrehoz egy `friendships` táblát (ki kivel "barát").
--  3) 4 RPC függvényt hoz létre, amiket a kliens kód (az app) hív:
--       - get_or_create_invite_code()     → saját meghívókód lekérése/generálása
--       - send_friend_request_by_code(code) → barát hozzáadása kód alapján
--       - remove_friend(friend_id)          → barát eltávolítása
--       - get_global_leaderboard(limit)     → TOP N játékos XP szerint
--       - get_friends_leaderboard()         → saját barátok + én, XP szerint
--  4) Minden függvény SECURITY DEFINER, azaz a meglévő `profiles`/`progress`
--     táblák RLS-szabályait NEM kell lazítanod — a függvények csak a
--     ténylegesen szükséges, nyilvánosan is vállalható mezőket (név, kép,
--     XP) adják ki, semmi mást (email, fiók-adat stb. nem szivárog ki).
--
-- Feltételezés: már létezik a `public.profiles(id uuid pk, display_name
-- text, avatar_url text, ...)` és `public.progress(user_id uuid, mobile_xp
-- int, ...)` tábla (ezeket az app már használja) — ha más néven/más
-- oszlopnévvel vannak nálad, szólj és módosítom a scriptet.
-- ============================================================================

BEGIN;

-- 1) Meghívókód oszlop a profiles táblához
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS invite_code text UNIQUE;

-- 2) Barátságok tábla
CREATE TABLE IF NOT EXISTS public.friendships (
    requester_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    addressee_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status       text NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted')),
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
);

ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "friendships_select_own" ON public.friendships;
CREATE POLICY "friendships_select_own" ON public.friendships
    FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

DROP POLICY IF EXISTS "friendships_delete_own" ON public.friendships;
CREATE POLICY "friendships_delete_own" ON public.friendships
    FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- (Beszúrás/módosítás csak a SECURITY DEFINER függvényeken keresztül megy,
-- hogy a meghívókód-feloldás és a validáció egy helyen, szerveroldalon
-- történjen — ezért nincs külön INSERT/UPDATE policy a táblán.)

-- 3a) Saját meghívókód lekérése — ha még nincs, legenerál egy egyedit
CREATE OR REPLACE FUNCTION public.get_or_create_invite_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_code text;
    v_tries int := 0;
BEGIN
    SELECT invite_code INTO v_code FROM public.profiles WHERE id = auth.uid();
    IF v_code IS NOT NULL THEN
        RETURN v_code;
    END IF;

    LOOP
        v_code := 'CHRT-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
        BEGIN
            UPDATE public.profiles SET invite_code = v_code WHERE id = auth.uid();
            RETURN v_code;
        EXCEPTION WHEN unique_violation THEN
            v_tries := v_tries + 1;
            IF v_tries > 10 THEN
                RAISE EXCEPTION 'Nem sikerült egyedi meghívókódot generálni.';
            END IF;
        END;
    END LOOP;
END;
$$;

-- 3b) Barát hozzáadása meghívókód alapján — MVP: azonnal "accepted" (nincs
-- még külön elfogadás-UI az appban), kölcsönös, és nem adhatsz hozzá
-- magadhoz vagy ugyanazt duplán.
CREATE OR REPLACE FUNCTION public.send_friend_request_by_code(p_code text)
RETURNS TABLE(friend_id uuid, friend_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_target_id uuid;
    v_target_name text;
BEGIN
    SELECT id, display_name INTO v_target_id, v_target_name
    FROM public.profiles WHERE invite_code = upper(trim(p_code));

    IF v_target_id IS NULL THEN
        RAISE EXCEPTION 'Nincs ilyen meghívókód.';
    END IF;
    IF v_target_id = auth.uid() THEN
        RAISE EXCEPTION 'Saját magadat nem adhatod hozzá.';
    END IF;

    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (auth.uid(), v_target_id, 'accepted')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING;

    INSERT INTO public.friendships (requester_id, addressee_id, status)
    VALUES (v_target_id, auth.uid(), 'accepted')
    ON CONFLICT (requester_id, addressee_id) DO NOTHING;

    RETURN QUERY SELECT v_target_id, v_target_name;
END;
$$;

-- 3c) Barát eltávolítása (mindkét irányú kapcsolat törlése)
CREATE OR REPLACE FUNCTION public.remove_friend(p_friend_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    DELETE FROM public.friendships
    WHERE (requester_id = auth.uid() AND addressee_id = p_friend_id)
       OR (requester_id = p_friend_id AND addressee_id = auth.uid());
END;
$$;

-- 3d) Globális ranglista — TOP N felhasználó XP szerint. Csak a nyilvánosan
-- vállalható mezőket adja ki (id, név, avatar, XP) — semmi mást a
-- profiles/progress tábla többi oszlopából.
CREATE OR REPLACE FUNCTION public.get_global_leaderboard(p_limit int DEFAULT 50)
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, xp int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id, COALESCE(p.display_name, 'Trader'), p.avatar_url, COALESCE(pr.mobile_xp, 0)
    FROM public.profiles p
    JOIN public.progress pr ON pr.user_id = p.id
    ORDER BY COALESCE(pr.mobile_xp, 0) DESC
    LIMIT GREATEST(p_limit, 1);
$$;

-- 3e) Barátok ranglistája — a hívó saját barátai (+ önmaga), XP szerint
CREATE OR REPLACE FUNCTION public.get_friends_leaderboard()
RETURNS TABLE(user_id uuid, display_name text, avatar_url text, xp int)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT p.id, COALESCE(p.display_name, 'Trader'), p.avatar_url, COALESCE(pr.mobile_xp, 0)
    FROM public.profiles p
    JOIN public.progress pr ON pr.user_id = p.id
    WHERE p.id = auth.uid()
       OR p.id IN (
            SELECT addressee_id FROM public.friendships WHERE requester_id = auth.uid() AND status = 'accepted'
            UNION
            SELECT requester_id FROM public.friendships WHERE addressee_id = auth.uid() AND status = 'accepted'
       )
    ORDER BY COALESCE(pr.mobile_xp, 0) DESC;
$$;

-- Jogosultságok: a négy RPC-t és a táblát csak bejelentkezett (authenticated)
-- felhasználók hívhatják/olvashatják.
GRANT EXECUTE ON FUNCTION public.get_or_create_invite_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_friend_request_by_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_friend(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_global_leaderboard(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_friends_leaderboard() TO authenticated;

COMMIT;

-- ============================================================================
-- ELLENŐRZÉS a futtatás után (opcionális, SQL Editorban kipróbálható egy
-- bejelentkezett session kontextusában nem megy, de a táblák/függvények
-- létét így ellenőrizheted):
--
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('get_or_create_invite_code','send_friend_request_by_code',
--      'remove_friend','get_global_leaderboard','get_friends_leaderboard');
--
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name = 'profiles' AND column_name = 'invite_code';
-- ============================================================================
