-- =====================================================================
-- CHARTOLJ! — 017_push_reminder_fields
-- =====================================================================
-- A napi emlékeztető eddig csak a böngésző Notification API-ját
-- használta, ami CSAK akkor szólal meg, ha az app épp nyitva van a
-- háttérben — ez nem igazi retenciós eszköz. A valódi (zárt app esetén
-- is működő) push-hoz egy szerveroldali, időzített feladatnak (lásd a
-- send-daily-reminders Edge Function) kell tudnia:
--   1) ki kéri egyáltalán az emlékeztetőt (push_reminders_enabled)
--   2) mikor volt utoljára aktív (last_active_at) — hogy 24 óra után,
--      de ne örökké pingeljük az already-elvándorolt userek
-- =====================================================================

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS push_reminders_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_active_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.touch_last_active()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.profiles SET last_active_at = now() WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.set_push_reminder_enabled(p_enabled boolean)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.profiles SET push_reminders_enabled = p_enabled WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.touch_last_active() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_push_reminder_enabled(boolean) TO authenticated;

COMMIT;
