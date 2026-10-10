-- =====================================================================
-- 002_rls.sql — Row Level Security: profiles + progress
-- =====================================================================
-- Elv: minden felhasználó KIZÁRÓLAG a saját sorát láthatja/módosíthatja.
-- Idempotens: DROP POLICY IF EXISTS + CREATE POLICY mintát követ.
-- =====================================================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- PROFILES
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
CREATE POLICY "profiles_select_own"
    ON public.profiles FOR SELECT
    TO authenticated
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
    ON public.profiles FOR UPDATE
    TO authenticated
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Nincs kliens-oldali INSERT/DELETE policy: a profiles sor a
-- handle_new_chartolj_user() trigger által jön létre (003_triggers.sql),
-- a törlés pedig ON DELETE CASCADE-del automatikus, ha az auth.users
-- sor törlődik (lásd delete-account Edge Function).

-- ---------------------------------------------------------------------
-- PROGRESS
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "progress_select_own" ON public.progress;
CREATE POLICY "progress_select_own"
    ON public.progress FOR SELECT
    TO authenticated
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "progress_insert_own" ON public.progress;
CREATE POLICY "progress_insert_own"
    ON public.progress FOR INSERT
    TO authenticated
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "progress_update_own" ON public.progress;
CREATE POLICY "progress_update_own"
    ON public.progress FOR UPDATE
    TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Ez teszi lehetővé a kliens "Fiók és adatok törlése" önkiszolgáló
-- funkcióját (a haladás-adat azonnali törlését).
DROP POLICY IF EXISTS "progress_delete_own" ON public.progress;
CREATE POLICY "progress_delete_own"
    ON public.progress FOR DELETE
    TO authenticated
    USING (auth.uid() = user_id);
