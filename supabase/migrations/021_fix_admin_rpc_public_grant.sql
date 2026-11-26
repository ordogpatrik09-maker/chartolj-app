-- =====================================================================
-- 021_fix_admin_rpc_public_grant.sql — Admin RPC-k PUBLIC-grant hiba
-- javítása (BIZTONSÁGI SZIGORÍTÁS, ADDITÍV, nem változtat semmilyen
-- séma/payload struktúrán)
-- =====================================================================
-- FELFEDEZETT HIBA (self-audit, helyi PostgreSQL-teszttel igazolva):
-- a 018_admin_stats.sql és 019_admin_user_lookup.sql is leírja, hogy
-- "GRANT EXECUTE ... TO authenticated; REVOKE EXECUTE ... FROM anon;
-- ezáltal csak bejelentkezett felhasználó hívhatja egyáltalán" — ez a
-- mondat PONTATLAN volt. PostgreSQL egy új függvényen ALAPÉRTELMEZETTEN
-- mindenkinek (a PUBLIC pszeudo-szerepkörnek) ad EXECUTE jogot, és egy
-- "REVOKE ... FROM anon" ÖNMAGÁBAN NEM vonja vissza a PUBLIC-on keresztül
-- kapott jogot — minden szerepkör (az anon is) hozzáfér mindenhez, amit
-- a PUBLIC kap, hacsak nincs KÜLÖN "REVOKE ... FROM PUBLIC" is.
--
-- Helyi teszttel igazoltam: has_function_privilege('anon', ...) IGAZ
-- volt mindkét függvényre a hiányzó PUBLIC-revoke miatt — vagyis az
-- anon szerepkör FORMÁLISAN meg tudta hívni a get_admin_app_stats()-ot
-- és az admin_lookup_user()-t.
--
-- MIÉRT NEM VOLT EZ VALÓDI ADATSZIVÁRGÁS: mindkét függvény TÖRZSE saját
-- maga is ellenőrzi a hívó email-címét (auth.jwt() ->> 'email') és
-- azonnal hibát dob, ha az nem admin — egy anon hívónak nincs email
-- claim-je, így ez az ág mindig lefutott volna, ADAT NÉLKÜL. Tehát a
-- tényleges admin-adat SOHA nem volt elérhető illetéktelen hívó számára
-- — ez egy védekezés-a-mélységben (defense in depth) hiba volt, nem egy
-- kihasznált vagy kihasználható adatszivárgás. Mindazonáltal helytelen
-- és javítandó, mert (a) a kódban lévő dokumentáció valótlant állított
-- a GRANT-szintű védelemről, és (b) egy jövőbeli, a belső ellenőrzést
-- véletlenül meggyengítő módosítás esetén ez lett volna az egyetlen
-- védelmi vonal.
--
-- JAVÍTÁS: explicit "REVOKE ... FROM PUBLIC" mindkét meglévő függvényre.
-- Ez PUSZTÁN jogosultság-szigorítás — nem módosít semmilyen függvény-
-- törzset, táblát vagy RPC-payloadot, ezért biztonságosan additív.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.get_admin_app_stats() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_lookup_user(text) FROM PUBLIC;

-- A korábbi "FROM anon" revoke-okat is megismételjük (idempotens,
-- ártalmatlan, ha már megtörtént) — csak a teljesség kedvéért, a PUBLIC-
-- revoke a ténylegesen hiányzó rész volt.
REVOKE EXECUTE ON FUNCTION public.get_admin_app_stats() FROM anon;
REVOKE EXECUTE ON FUNCTION public.admin_lookup_user(text) FROM anon;
