// =====================================================================
// stripe-checkout — Stripe Checkout Session létrehozása
// =====================================================================
// A kliens ezt hívja a "Havi"/"Éves" gombra kattintva (stripe módban).
// EZ A FÜGGVÉNY NEM ÁLLÍT BE PRÉMIUMOT — csak egy Stripe fizetési oldalra
// mutató URL-t ad vissza. A tényleges Prémium-aktiválás KIZÁRÓLAG a
// stripe-webhook függvényben történik, miután Stripe visszaigazolta a
// sikeres fizetést (lásd ott a részletes indoklást).
//
// KÖRNYEZETI VÁLTOZÓK:
//   STRIPE_SECRET_KEY        — MANUÁLISAN beállítandó Supabase secretként
//   STRIPE_PRICE_MONTHLY     — a Stripe Dashboard-on létrehozott havi Price ID
//   STRIPE_PRICE_YEARLY      — a Stripe Dashboard-on létrehozott éves Price ID
//   PUBLIC_APP_URL           — pl. 'https://chartolj.hu' (a sikeres/megszakított
//                              fizetés utáni visszairányításhoz)
//
// TELEPÍTÉS:
//   supabase secrets set STRIPE_SECRET_KEY='sk_live_...'
//   supabase secrets set STRIPE_PRICE_MONTHLY='price_...'
//   supabase secrets set STRIPE_PRICE_YEARLY='price_...'
//   supabase secrets set PUBLIC_APP_URL='https://chartolj.hu'
//   supabase functions deploy stripe-checkout
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') || 'https://YOUR-DOMAIN.example';

const PRICE_IDS: Record<string, string | undefined> = {
    monthly: Deno.env.get('STRIPE_PRICE_MONTHLY'),
    yearly: Deno.env.get('STRIPE_PRICE_YEARLY'),
};

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

    if (!STRIPE_SECRET_KEY) {
        return json({ error: 'A Stripe fizetés még nincs konfigurálva a szerveren (STRIPE_SECRET_KEY hiányzik).' }, 503);
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ error: 'Jelentkezz be a fizetéshez.' }, 401);

        const { plan } = await req.json();
        const priceId = PRICE_IDS[plan];
        if (!priceId) return json({ error: 'Érvénytelen vagy be nem állított csomag: ' + plan }, 400);

        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
        const { data: { user }, error: userErr } = await userClient.auth.getUser();
        if (userErr || !user) return json({ error: 'Érvénytelen munkamenet' }, 401);

        const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // Ha a felhasználónak már van Stripe Customer ID-je (korábbi vásárlásból),
        // azt használjuk újra, hogy egy Stripe alatt maradjon minden vásárlása.
        const { data: existingSub } = await adminClient
            .from('subscriptions')
            .select('stripe_customer_id')
            .eq('user_id', user.id)
            .maybeSingle();

        let customerId = existingSub?.stripe_customer_id;
        if (!customerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                metadata: { supabase_user_id: user.id },
            });
            customerId = customer.id;
            await adminClient.from('subscriptions').upsert(
                { user_id: user.id, stripe_customer_id: customerId },
                { onConflict: 'user_id' }
            );
        }

        const session = await stripe.checkout.sessions.create({
            customer: customerId,
            mode: 'subscription',
            line_items: [{ price: priceId, quantity: 1 }],
            // FONTOS: a redirect URL-ben lévő ?checkout=success paramétert a
            // kliens CSAK egy "sikeres fizetés, frissítsd a Prémium-státuszt"
            // jelzésként használja (refreshPremiumStatus() hívással) — a
            // TÉNYLEGES Prémium-aktiválás a stripe-webhook függvényben történik,
            // a Stripe által aláírt, hitelesített eseményből, nem ebből az URL-ből.
            success_url: `${PUBLIC_APP_URL}/?checkout=success&plan=${plan}`,
            cancel_url: `${PUBLIC_APP_URL}/?checkout=cancelled`,
            metadata: { supabase_user_id: user.id, plan },
            subscription_data: { metadata: { supabase_user_id: user.id, plan } },
        });

        return json({ url: session.url });
    } catch (e) {
        console.error('stripe-checkout váratlan hiba:', e instanceof Error ? e.message : String(e));
        return json({ error: 'A fizetési oldal létrehozása sikertelen. Próbáld újra.' }, 500);
    }
});
