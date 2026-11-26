-- =====================================================================
-- 023_error_log_retention_cap.sql — app_error_log méret-korlátozás
-- (ADDITÍV, csak a report_client_error() törzsét bővíti, a visszatérési
-- típus/payload-séma nem változik)
-- =====================================================================
-- A 020-ban leírt védelmi rétegek (dedup UNIQUE(message,page), mezőnkénti
-- hosszkorlát, affected_user_ids sapka) mind arra védenek, hogy EGY
-- adott hiba ne tudjon korlátlanul nőni. Nem védtek viszont az ellen,
-- hogy egy rosszindulatú (vagy hibás) kliens sok, EGYEDI üzenetű
-- "hibát" küldjön be — ez minden hívásnál ÚJ sort hozna létre, és a
-- tábla elvileg korlátlanul nőhetne. Ez eddig nem okozott problémát
-- (nincs ismert visszaélés), de mivel ez egy NYITOTT, anon-hívható
-- végpont, a hosszú távú méret-korlátozás alapvető higiénia.
--
-- MEGOLDÁS: pg_cron-t NEM igényel (az Supabase-en külön bekapcsolandó
-- extension lenne, ami egy plusz manuális lépés lenne a felhasználónak)
-- — helyette egy egyszerű, önfenntartó "safety valve"-et építünk
-- magába a report_client_error() függvénybe: minden beszúrás UTÁN, ha a
-- tábla mérete túllépi a 2000 sort, törli a legrégebben látott,
-- legritkábban előforduló 500 sort. Ez teljesen portábilis sima SQL,
-- semmilyen extra extension-t vagy Supabase-dashboard lépést nem kíván.
--
-- Ez a határérték nagyvonalú (2000 egyedi hiba/oldal-kombináció) —
-- a jelenlegi forgalom mellett ez valószínűleg sosem fog aktiválódni,
-- de a jövőre nézve bebiztosítja a táblát egy esetleges hiba-áradat
-- vagy visszaélés ellen anélkül, hogy bármilyen legitim admin-funkciót
-- (admin_get_error_log LIMIT 200-as olvasása) korlátozna.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.report_client_error(
    p_message text,
    p_stack text DEFAULT NULL,
    p_page text DEFAULT NULL,
    p_user_agent text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_message text;
    v_stack text;
    v_page text;
    v_user_agent text;
    v_caller_id uuid;
    v_row_count bigint;
BEGIN
    IF p_message IS NULL OR trim(p_message) = '' THEN
        RETURN; -- nincs mit naplózni, csendben kilépünk (nem hiba a hívónak)
    END IF;

    -- Kemény hosszkorlátok — lásd a 020-as migráció "KÖLTSÉG-MODELL" megjegyzését.
    v_message    := left(trim(p_message), 500);
    v_stack      := left(coalesce(p_stack, ''), 2000);
    v_page       := left(coalesce(nullif(trim(p_page), ''), '(ismeretlen)'), 200);
    v_user_agent := left(coalesce(p_user_agent, ''), 300);

    -- auth.uid() NULL vendég (anon) hívónál — ez szándékos, ők is
    -- jelezhetnek hibát, csak nem köthető felhasználói fiókhoz.
    v_caller_id := auth.uid();

    INSERT INTO public.app_error_log (message, stack, page, user_agent, affected_user_ids)
    VALUES (
        v_message, v_stack, v_page, v_user_agent,
        CASE WHEN v_caller_id IS NOT NULL THEN ARRAY[v_caller_id] ELSE '{}'::uuid[] END
    )
    ON CONFLICT ON CONSTRAINT app_error_log_message_page_key DO UPDATE SET
        last_seen_at = now(),
        occurrence_count = public.app_error_log.occurrence_count + 1,
        affected_user_ids = CASE
            WHEN v_caller_id IS NOT NULL
                 AND NOT (v_caller_id = ANY(public.app_error_log.affected_user_ids))
                 AND coalesce(array_length(public.app_error_log.affected_user_ids, 1), 0) < 20
            THEN array_append(public.app_error_log.affected_user_ids, v_caller_id)
            ELSE public.app_error_log.affected_user_ids
        END;

    -- ÚJ: méret-korlátozó "safety valve" — lásd fenti magyarázat.
    SELECT count(*) INTO v_row_count FROM public.app_error_log;
    IF v_row_count > 2000 THEN
        DELETE FROM public.app_error_log
        WHERE id IN (
            SELECT id FROM public.app_error_log
            ORDER BY last_seen_at ASC, occurrence_count ASC
            LIMIT 500
        );
    END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.report_client_error(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.report_client_error(text, text, text, text) TO anon, authenticated;
