-- =====================================================================
-- 020_app_error_log.sql — Production kliensoldali hibanapló (ÚJ, ADDITÍV)
-- =====================================================================
-- CÉL: eddig egyetlen módon sem szerzett tudomást a fejlesztő arról, ha
-- egy éles felhasználónál JS-hiba dobódott — csak akkor, ha a
-- felhasználó panaszkodott. Ez a migráció egy minimális, önhosztolt
-- "crash reporting" csatornát ad: a kliens window.onerror/
-- unhandledrejection eseményeit egy DEDUPLIKÁLT táblába gyűjti (azonos
-- üzenet+oldal kombináció NEM új sort kap, csak egy számlálót növel),
-- hogy egyetlen, sokszor ismétlődő hiba ne tudja elárasztani a táblát,
-- és az admin egy pillantással lássa, melyik hiba a leggyakoribb.
--
-- BIZTONSÁGI/KÖLTSÉG-MODELL:
-- - A report_client_error() hívható VENDÉGKÉNT is (anon), hiszen egy
--   guest-módban futó felhasználónál is dobódhat JS-hiba, amiről tudni
--   kell. Emiatt itt NINCS admin-email-ellenőrzés (ez egy nyitott
--   "ingress" végpont, ahogy minden crash-reporting szolgáltatásnál).
-- - Védekezés a visszaéléssel/túlterheléssel szemben TÖBB RÉTEGBEN:
--   1) a kliens (index.html) oldalon egy session-enkénti kemény limit
--      (MAX_CLIENT_ERROR_REPORTS_PER_SESSION) és in-memory dedup fut —
--      ez NEM biztonsági garancia, csak jóhiszemű kliens esetén segít;
--   2) a message/stack/page/user_agent mezők itt, a függvény törzsében
--      is kemény hosszkorlátra vannak vágva (substring), így egyetlen
--      hívás sem tud tetszőlegesen nagy sort beszúrni;
--   3) a táblán lévő UNIQUE(message, page) megszorítás miatt ugyanaz a
--      hiba sosem hoz létre új sort, csak egy integer számlálót növel —
--      ismételt hívások tárhely-költsége gyakorlatilag nulla;
--   4) az affected_user_ids tömb legfeljebb 20 egyedi felhasználói id-t
--      tárol hibánként (utána nem bővül tovább) — nem korlátlan.
-- - A admin_get_error_log() OLVASÓ függvény viszont ugyanazzal a
--   szerveroldali admin-email-ellenőrzéssel védett, mint a 018/019-es
--   migrációk RPC-i — ugyanaz a minta, külön karbantartott admin-lista.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.app_error_log (
    id                  bigserial PRIMARY KEY,
    message             text NOT NULL,
    stack               text,
    page                text NOT NULL DEFAULT '(ismeretlen)',
    user_agent          text,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    occurrence_count    integer NOT NULL DEFAULT 1,
    affected_user_ids   uuid[] NOT NULL DEFAULT '{}',
    CONSTRAINT app_error_log_message_page_key UNIQUE (message, page)
);

CREATE INDEX IF NOT EXISTS app_error_log_last_seen_idx ON public.app_error_log (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS app_error_log_occurrence_idx ON public.app_error_log (occurrence_count DESC);

ALTER TABLE public.app_error_log ENABLE ROW LEVEL SECURITY;
-- Direkt tábla-hozzáférés SENKINEK sincs megengedve (sem anon, sem
-- authenticated) — minden írás/olvasás KIZÁRÓLAG a lenti, SECURITY
-- DEFINER RPC-ken keresztül történik, amik saját maguk kényszerítik ki
-- a (jelen esetben: "bárki írhat, csak admin olvashat") szabályt. Mivel
-- nincs egyetlen GRANT/POLICY sem a táblán közvetlenül, az RLS
-- bekapcsolása önmagában már letiltja a közvetlen hozzáférést minden
-- nem-superuser szerepkörnek.

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
BEGIN
    IF p_message IS NULL OR trim(p_message) = '' THEN
        RETURN; -- nincs mit naplózni, csendben kilépünk (nem hiba a hívónak)
    END IF;

    -- Kemény hosszkorlátok — lásd a fenti "KÖLTSÉG-MODELL" megjegyzést.
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
        -- csak akkor bővítjük a tömböt, ha van bejelentkezett hívó ÉS még
        -- nincs benne ÉS nem lépte túl a 20-as sapkát.
        affected_user_ids = CASE
            WHEN v_caller_id IS NOT NULL
                 AND NOT (v_caller_id = ANY(public.app_error_log.affected_user_ids))
                 AND array_length(public.app_error_log.affected_user_ids, 1) IS DISTINCT FROM 20
                 AND coalesce(array_length(public.app_error_log.affected_user_ids, 1), 0) < 20
            THEN array_append(public.app_error_log.affected_user_ids, v_caller_id)
            ELSE public.app_error_log.affected_user_ids
        END;
END;
$$;

-- Vendég (anon) ÉS bejelentkezett felhasználó is hívhatja — ez egy
-- nyitott hibabejelentő "ingress", szándékosan, lásd fenti megjegyzés.
GRANT EXECUTE ON FUNCTION public.report_client_error(text, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_error_log(p_limit int DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_email text;
    v_result jsonb;
BEGIN
    v_caller_email := lower(coalesce(auth.jwt() ->> 'email', ''));
    IF v_caller_email IS NULL OR v_caller_email = '' OR v_caller_email NOT IN (
        'patrik66@gmail.com'
    ) THEN
        RAISE EXCEPTION 'Nincs jogosultság ehhez a művelethez.' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_agg(row_to_json(t)) INTO v_result
    FROM (
        SELECT id, message, stack, page, user_agent, first_seen_at, last_seen_at,
               occurrence_count, coalesce(array_length(affected_user_ids, 1), 0) AS affected_user_count
        FROM public.app_error_log
        ORDER BY last_seen_at DESC
        LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
    ) t;

    RETURN coalesce(v_result, '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_error_log(int) TO authenticated;
-- FONTOS (lásd a 021_fix_admin_rpc_public_grant.sql megjegyzését is):
-- PostgreSQL ALAPÉRTELMEZETTEN mindenkinek (a PUBLIC pszeudo-szerepkörnek)
-- ad EXECUTE jogot egy új függvényen — a "REVOKE ... FROM anon" ÖNMAGÁBAN
-- NEM elég, mert minden szerepkör (így az anon is) örökli a PUBLIC-on
-- keresztül kapott jogokat, hacsak explicit REVOKE FROM PUBLIC nem
-- történik. Enélkül az anon technikailag ("has_function_privilege"
-- szerint) hívhatná a függvényt — a tényleges adatvédelmet itt is a
-- függvény TÖRZSÉBEN lévő admin-email-ellenőrzés adja, de a
-- hozzáférés-korlátozást a GRANT/REVOKE szinten is helyesen kell
-- kikényszeríteni, nem csak a dokumentációban állítani.
REVOKE EXECUTE ON FUNCTION public.admin_get_error_log(int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_get_error_log(int) FROM anon;
