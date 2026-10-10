-- =====================================================================
-- 012_profiles_column_lockdown.sql — oszlop-szintű zár a profiles táblán
-- =====================================================================
-- MIÉRT KELL EZ:
-- A 002_rls.sql `profiles_update_own` policy-ja SOR-szinten helyes
-- (auth.uid() = id), de OSZLOP-szinten semmit nem korlátoz. Ha a
-- projekten valaha létezett egy régi `is_premium` oszlop a `profiles`
-- táblán (lásd 001_initial_schema.sql megjegyzése — szándékosan nem
-- lett törölve, nehogy adatot veszítsünk), azt egy normál bejelentkezett
-- user elméletileg a saját soránál fogva módosíthatná:
--
--     sb.from('profiles').update({ is_premium: true })
--
-- A kliens JELENLEG nem olvassa ezt az oszlopot (a Prémium-állapot
-- kizárólag a `subscriptions` táblából töltődik be — lásd
-- 004_subscription.sql), tehát ma nincs tényleges kihasználható hatása.
-- De ez "véletlenül biztonságos", nem SZÁNDÉKOSAN az — egy jövőbeli
-- kódváltoztatás, ami visszatérne erre az oszlopra, újra sebezhetővé
-- tenné a rendszert. Ezért itt, adatbázis-szinten, explicit módon is
-- lezárjuk: a kliens KIZÁRÓLAG a ténylegesen szükséges két mezőt
-- (display_name, avatar_url) módosíthatja — semmi mást, se most
-- meglévőt, se egy jövőbeli migrációban hozzáadott oszlopot.
-- =====================================================================

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (display_name, avatar_url) ON public.profiles TO authenticated;

-- MEGJEGYZÉS: ez a minta ("REVOKE ALL, majd GRANT csak a konkrét
-- oszlopokra") azt is jelenti, hogy ha a jövőben új, érzékeny oszlopot
-- adunk a profiles táblához (pl. egy belső admin-jelző), az
-- AUTOMATIKUSAN védett lesz — nem kell külön odafigyelni rá minden
-- egyes új oszlopnál.
