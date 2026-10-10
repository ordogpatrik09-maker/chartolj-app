// =====================================================================
// stripe-portal — Stripe Billing Portal munkamenet nyitása
// =====================================================================
// Ide navigálunk, amikor a felhasználó az "Előfizetés kezelése" gombra
// kattint (stripe módban) — itt tudja lemondani vagy módosítani a
// fizetési módját, MAGÁN a Stripe felületén (nem nekünk kell ezt a UI-t
// megépítenünk).
//
// KÖRNYEZETI VÁLTOZÓK: ugyanazok, mint a stripe-checkout-nál.
//
// TELEPÍTÉS:
//   supabase functions deploy stripe-portal
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY');
const PUBLIC_APP_URL = Deno.env.get('PUBLIC_APP_URL') || 'https://YOUR-DOMAIN.example';

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
        return json({ error: 'A Stripe fizetés még nincs konfigurálva a szerveren.' }, 503);
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ error: 'Jelentkezz be.' }, 401);

        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
        const { data: { user }, error: userErr } = await userClient.auth.getUser();
        if (userErr || !user) return json({ error: 'Érvénytelen munkamenet' }, 401);

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { data: sub, error: subErr } = await adminClient
            .from('subscriptions')
            .select('stripe_customer_id')
            .eq('user_id', user.id)
            .maybeSingle();

        if (subErr || !sub?.stripe_customer_id) {
            return json({ error: 'Nem található Stripe-előfizetés ehhez a fiókhoz.' }, 404);
        }

        const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: sub.stripe_customer_id,
            return_url: `${PUBLIC_APP_URL}/`,
        });

        return json({ url: portalSession.url });
    } catch (e) {
        console.error('stripe-portal váratlan hiba:', e instanceof Error ? e.message : String(e));
        return json({ error: 'Az előfizetés-kezelő megnyitása sikertelen. Próbáld újra.' }, 500);
    }
});
