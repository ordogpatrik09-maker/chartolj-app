-- =====================================================================
-- 005_stripe.sql — Stripe-specifikus kiegészítés a subscriptions táblához
-- =====================================================================
-- A stripe_customer_id kell ahhoz, hogy a stripe-portal Edge Function
-- meg tudja nyitni a MEGFELELŐ felhasználó Stripe Billing Portal
-- munkamenetét, és hogy a stripe-webhook a bejövő Stripe eseményt vissza
-- tudja kötni a megfelelő Supabase felhasználóra.
-- =====================================================================

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS stripe_customer_id text,
    ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

-- Gyors kereséshez a webhookban (customer.id alapján).
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_customer
    ON public.subscriptions (stripe_customer_id)
    WHERE stripe_customer_id IS NOT NULL;

-- Az authenticated kliens ezt is csak OLVASHATJA — írási policy erre
-- sincs, ugyanaz a védelem érvényes, mint a többi subscriptions mezőre
-- (lásd 004_subscription.sql). Nincs teendő itt, a meglévő
-- "subscriptions_select_own" SELECT policy már lefedi ezt az oszlopot is.
