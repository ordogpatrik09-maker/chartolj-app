-- =====================================================================
-- 011_secure_progress_rpc.sql — szerver-oldali védelem a progress mezőkre
-- =====================================================================
-- MIÉRT KELL EZ (23. pont — "a kliens megbízhatatlan"):
-- A 002_rls.sql `progress_update_own` policy-ja eddig csak azt
-- ellenőrizte, hogy a user a SAJÁT sorát módosítja (auth.uid() =
-- user_id) — az ÉRTÉKET nem. Ez azt jelentette, hogy bárki a böngésző
-- konzoljából egyetlen paranccsal tetszőleges XP-t/coint/hearts-et
-- írhatott be magának:
--
--     sb.from('progress').update({mobile_coins: 999999}).eq('user_id', uid)
--
-- EZ A MIGRÁCIÓ ezt zárja le: a `progress` tábla közvetlen INSERT/UPDATE
-- jogát elveszi az authenticated szerepkörtől, és helyette egy
-- SECURITY DEFINER RPC-t (`save_cloud_progress`) ad, ami:
--   - XP-t és coint csak korlátozott, pozitív irányú lépésenkénti
--     delta-val enged nőni (anti-cheat felső korlát), XP sosem csökkenhet,
--   - hearts-et egy ésszerű [0, 10] sávba kényszeríti,
--   - a lista-jellegű mezőket (teljesített leckék, rangok, küldetések,
--     prémium leckék, témák) KIZÁRÓLAG BŐVÍTVE fogadja el (sosem lehet
--     meglévő elemet eltávolítani vele), és mentésenként maximum 20 ÚJ
--     elemet enged hozzáadni (hogy egy tömeges, hamis adat-befecskendezés
--     ne menjen át egyetlen hívással),
--   - a szabad-formátumú statisztika-mezőket (drill/replay/mistake
--     bank/tanulási napló) méretkorláttal engedi át (tárhely-visszaélés
--     elleni védelem), tartalmi validáció nélkül — ezek nem szűkös
--     erőforrások, csak gyakorlási statisztikák.
--
-- FONTOS, ŐSZINTE KORLÁT: ez NEM egy teljes játék-szabály motor
-- szerveroldali újraimplementálása (az megkövetelné az ÖSSZES lecke/
-- rang/küldetés definíció duplikálását adatbázis-oldalon is, ami a
-- specifikációd 39./44. pontja szerint NEM feladat most — "ne építs
-- újra feleslegesen, a meglévő rendszert kell stabilizálni"). Ez egy
-- ÉSSZERŰ, arányos védelem: a durva, azonnali visszaéléseket (pl.
-- egyetlen hívással 999999 coin) kizárja, a finomabb, játékon belüli
-- szabály-megkerülést (pl. egy lecke duplán "befejezettnek" jelölése,
-- ha az pontosan egy valódi XP-lépésnyi) nem 100%-ban zárja ki — ehhez
-- a teljes játék-logika szerverre költöztetése kellene, ami jelen
-- fázisban nem arányos ráfordítás egy oktató-app pontrendszeréhez,
-- ahol nincs valódi pénzügyi tét (a Premium/fizetés KÜLÖN, már
-- helyesen védett `subscriptions` táblában van).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Segédfüggvény: "csak bővíthető" lista-mezők biztonságos egyesítése.
-- A régi tömb MINDEN eleme megmarad, az új tömbből csak azok az elemek
-- kerülnek be, amik még nincsenek benne — mentésenként max p_max_growth
-- ÚJ elemig.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._progress_merge_append_only(
    p_old jsonb, p_incoming jsonb, p_max_growth integer
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
    v_old_arr jsonb := CASE WHEN jsonb_typeof(p_old) = 'array' THEN p_old ELSE '[]'::jsonb END;
    v_in_arr jsonb := CASE WHEN jsonb_typeof(p_incoming) = 'array' THEN p_incoming ELSE '[]'::jsonb END;
    v_result jsonb := v_old_arr;
    v_added integer := 0;
    v_elem jsonb;
BEGIN
    FOR v_elem IN SELECT value FROM jsonb_array_elements(v_in_arr) LOOP
        IF NOT (v_result @> jsonb_build_array(v_elem)) THEN
            IF v_added >= p_max_growth THEN
                EXIT; -- a maradék új elem a KÖVETKEZŐ mentésnél kerül be, nem vész el
            END IF;
            v_result := v_result || jsonb_build_array(v_elem);
            v_added := v_added + 1;
        END IF;
    END LOOP;
    RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------
-- A fő RPC. A kliens `saveCloudProgress()`-nek erre kell állnia
-- `sb.from('progress').update(...)` / `.insert(...)` helyett.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_cloud_progress(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_uid uuid := auth.uid();
    v_old public.progress%ROWTYPE;
    v_new_xp integer;
    v_new_coins integer;
    v_new_hearts integer;
    v_max_item_growth CONSTANT integer := 20;
    v_max_xp_delta CONSTANT integer := 2000;   -- bőséges, de véges felső korlát / mentés
    v_max_coin_delta CONSTANT integer := 2000;
    v_max_field_bytes CONSTANT integer := 200000; -- ~200 KB / szabad-formátumú mező
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'Nincs bejelentkezve';
    END IF;
    IF p_payload IS NULL OR jsonb_typeof(p_payload) != 'object' THEN
        RAISE EXCEPTION 'Érvénytelen payload';
    END IF;
    IF pg_column_size(p_payload) > 1000000 THEN
        RAISE EXCEPTION 'A payload túl nagy';
    END IF;

    SELECT * INTO v_old FROM public.progress WHERE user_id = v_uid FOR UPDATE;
    IF NOT FOUND THEN
        INSERT INTO public.progress (user_id) VALUES (v_uid);
        SELECT * INTO v_old FROM public.progress WHERE user_id = v_uid FOR UPDATE;
    END IF;

    -- XP: sosem csökkenhet, és egy mentés legfeljebb v_max_xp_delta-val növelheti.
    v_new_xp := COALESCE((p_payload->>'mobile_xp')::integer, v_old.mobile_xp);
    IF v_new_xp < v_old.mobile_xp THEN v_new_xp := v_old.mobile_xp; END IF;
    IF v_new_xp - v_old.mobile_xp > v_max_xp_delta THEN v_new_xp := v_old.mobile_xp + v_max_xp_delta; END IF;

    -- Coins: csökkenhet (vásárlás a boltban), de nem mehet 0 alá, és egy
    -- mentés legfeljebb v_max_coin_delta-val növelheti.
    v_new_coins := COALESCE((p_payload->>'mobile_coins')::integer, v_old.mobile_coins);
    IF v_new_coins < 0 THEN v_new_coins := 0; END IF;
    IF v_new_coins - v_old.mobile_coins > v_max_coin_delta THEN v_new_coins := v_old.mobile_coins + v_max_coin_delta; END IF;

    -- Hearts: ésszerű sávba kényszerítve (a kliens max 3-5 szívvel számol,
    -- de boosterek/ajándékok miatt hagyunk mozgásteret felfelé is).
    v_new_hearts := COALESCE((p_payload->>'mobile_hearts')::integer, v_old.mobile_hearts);
    IF v_new_hearts < 0 THEN v_new_hearts := 0; END IF;
    IF v_new_hearts > 10 THEN v_new_hearts := 10; END IF;

    -- Méret-ellenőrzés a szabad-formátumú mezőkre (tárhely-visszaélés ellen).
    IF pg_column_size(p_payload->'mobile_drill_stats') > v_max_field_bytes
        OR pg_column_size(p_payload->'mobile_replay_stats') > v_max_field_bytes
        OR pg_column_size(p_payload->'mobile_replay_journal') > v_max_field_bytes
        OR pg_column_size(p_payload->'mobile_mistake_bank') > v_max_field_bytes
        OR pg_column_size(p_payload->'mobile_learning_log') > v_max_field_bytes
    THEN
        RAISE EXCEPTION 'Egy statisztika-mező túl nagy';
    END IF;

    UPDATE public.progress SET
        mobile_xp = v_new_xp,
        mobile_coins = v_new_coins,
        mobile_hearts = v_new_hearts,
        mobile_hearts_regen_at = COALESCE((p_payload->>'mobile_hearts_regen_at')::bigint, v_old.mobile_hearts_regen_at),
        mobile_done_lessons = public._progress_merge_append_only(v_old.mobile_done_lessons, p_payload->'mobile_done_lessons', v_max_item_growth),
        mobile_what_if_done = public._progress_merge_append_only(v_old.mobile_what_if_done, p_payload->'mobile_what_if_done', v_max_item_growth),
        claimed_ranks = public._progress_merge_append_only(v_old.claimed_ranks, p_payload->'claimed_ranks', v_max_item_growth),
        claimed_missions = public._progress_merge_append_only(v_old.claimed_missions, p_payload->'claimed_missions', v_max_item_growth),
        opened_premium_lessons = public._progress_merge_append_only(v_old.opened_premium_lessons, p_payload->'opened_premium_lessons', v_max_item_growth),
        unlocked_chart_themes = public._progress_merge_append_only(v_old.unlocked_chart_themes, p_payload->'unlocked_chart_themes', v_max_item_growth),
        mobile_mistake_bank = COALESCE(p_payload->'mobile_mistake_bank', v_old.mobile_mistake_bank),
        mobile_drill_stats = COALESCE(p_payload->'mobile_drill_stats', v_old.mobile_drill_stats),
        mobile_replay_stats = COALESCE(p_payload->'mobile_replay_stats', v_old.mobile_replay_stats),
        mobile_replay_journal = COALESCE(p_payload->'mobile_replay_journal', v_old.mobile_replay_journal),
        mobile_learning_log = CASE
            WHEN p_payload ? 'mobile_learning_log' THEN p_payload->'mobile_learning_log'
            ELSE mobile_learning_log
        END,
        updated_at = now()
    WHERE user_id = v_uid;

    RETURN jsonb_build_object('ok', true, 'mobile_xp', v_new_xp, 'mobile_coins', v_new_coins, 'mobile_hearts', v_new_hearts);
END;
$$;

REVOKE ALL ON FUNCTION public.save_cloud_progress(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_cloud_progress(jsonb) TO authenticated;
REVOKE ALL ON FUNCTION public._progress_merge_append_only(jsonb, jsonb, integer) FROM PUBLIC;

-- ---------------------------------------------------------------------
-- A közvetlen INSERT/UPDATE elvétele a kliens elől — mostantól a
-- fenti RPC az EGYETLEN írási út a progress táblára (a SELECT és a
-- DELETE jogot szándékosan meghagyjuk: a user olvashatja és — a saját
-- kérésére — önkiszolgáló módon törölheti is a haladását).
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "progress_insert_own" ON public.progress;
DROP POLICY IF EXISTS "progress_update_own" ON public.progress;
REVOKE INSERT, UPDATE ON public.progress FROM authenticated;

-- MEGJEGYZÉS: a handle_new_chartolj_user() trigger (003_triggers.sql)
-- SECURITY DEFINER-ként fut, ezért a fenti REVOKE nem érinti az új
-- felhasználók automatikus progress-sor létrehozását regisztrációkor.
