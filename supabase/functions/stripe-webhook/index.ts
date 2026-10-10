// =====================================================================
// stripe-webhook — EZ AZ EGYETLEN HELY, ahol Stripe-fizetésből valódi
// Prémium-jogosultság íródik a `subscriptions` táblába.
// =====================================================================
// KRITIKUS BIZTONSÁGI ELV: sem a checkout-success redirect URL, sem a
// kliens semmilyen állítása NEM elég a Prémium aktiválásához. Csak egy
// Stripe által KRIPTOGRÁFIAILAG ALÁÍRT webhook-esemény (amit ez a
// függvény a STRIPE_WEBHOOK_SECRET-tel ellenőriz) válthatja ki a
// `subscriptions` tábla írását. Így még ha valaki manuálisan átírná az
// URL-t `?checkout=success`-ra, vagy meghamisítana egy fetch-választ a
// böngészőjében, a szerveren semmi nem változna — a kliens a
// refreshPremiumStatus() hívásnál egyszerűen nem látna Prémiumot.
//
// KÖRNYEZETI VÁLTOZÓK:
//   STRIPE_SECRET_KEY      — ugyanaz, mint a többi Stripe függvénynél
//   STRIPE_WEBHOOK_SECRET  — a Stripe Dashboard → Webhooks → Signing secret
//                            (whsec_...), NEM ugyanaz, mint az API kulcs!
//
// STRIPE DASHBOARD BEÁLLÍTÁS (egyszeri):
//   1. Developers → Webhooks → Add endpoint
//   2. URL: https://<PROJECTED>.supabase.co/functions/v1/stripe-webhook
//   3. Figyelendő események:
//      - checkout.session.completed
//      - customer.subscription.updated
//      - customer.subscription.deleted
//      - invoice.payment_failed
//   4. A "Signing secret" értékét mentsd:
//      supabase secrets set STRIPE_WEBHOOK_SECRET='whsec_...'
//
// TELEPÍTÉS:
//   supabase functions deploy stripe-webhook --no-verify-jwt
//   (--no-verify-jwt szükséges, mert Stripe nem küld Supabase JWT-t —
//   a hitelesítést itt a Stripe-aláírás adja, nem a Supabase Auth.)
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY')!;
const STRIPE_WEBHOOK_SECRET = Deno.env.get('STRIPE_WEBHOOK_SECRET')!;

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function upsertSubscription(userId: string, patch: Record<string, unknown>) {
    const { error } = await adminClient.from('subscriptions').upsert(
        { user_id: userId, ...patch },
        { onConflict: 'user_id' }
    );
    if (error) console.error('subscriptions upsert hiba:', error.message);
}

async function findUserIdByCustomer(customerId: string): Promise<string | null> {
    const { data } = await adminClient
        .from('subscriptions')
        .select('user_id')
        .eq('stripe_customer_id', customerId)
        .maybeSingle();
    return data?.user_id || null;
}

Deno.serve(async (req: Request) => {
    if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const signature = req.headers.get('stripe-signature');
    if (!signature) return new Response('Hiányzó Stripe aláírás', { status: 400 });

    const body = await req.text();
    let event: Stripe.Event;
    try {
        // ITT történik a kriptográfiai ellenőrzés — ha ez elbukik, az esemény
        // NEM valódi Stripe-tól jön (vagy meghamisított), és eldobjuk.
        event = await stripe.webhooks.constructEventAsync(body, signature, STRIPE_WEBHOOK_SECRET);
    } catch (e) {
        console.error('Webhook aláírás-ellenőrzés sikertelen:', (e as Error).message);
        return new Response('Érvénytelen aláírás', { status: 400 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;
                const userId = session.metadata?.supabase_user_id;
                const plan = session.metadata?.plan;
                if (!userId) break;

                const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
                let expiresAt: string | null = null;
                if (subscriptionId) {
                    const sub = await stripe.subscriptions.retrieve(subscriptionId);
                    expiresAt = new Date(sub.current_period_end * 1000).toISOString();
                }

                await upsertSubscription(userId, {
                    subscription_status: 'active',
                    subscription_platform: 'stripe',
                    subscription_product_id: plan || null,
                    stripe_customer_id: typeof session.customer === 'string' ? session.customer : session.customer?.id,
                    stripe_subscription_id: subscriptionId || null,
                    expires_at: expiresAt,
                });
                break;
            }

            case 'customer.subscription.updated': {
                const sub = event.data.object as Stripe.Subscription;
                const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
                const userId = sub.metadata?.supabase_user_id || (await findUserIdByCustomer(customerId));
                if (!userId) break;

                // Stripe státusz -> a mi belső, spec szerinti státuszaink.
                let status = 'active';
                if (sub.status === 'past_due' || sub.status === 'unpaid') status = 'grace_period';
                else if (sub.status === 'canceled' || sub.status === 'incomplete_expired') status = 'cancelled';
                else if (sub.status !== 'active' && sub.status !== 'trialing') status = 'expired';

                await upsertSubscription(userId, {
                    subscription_status: status,
                    stripe_subscription_id: sub.id,
                    expires_at: new Date(sub.current_period_end * 1000).toISOString(),
                });
                break;
            }

            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer.id;
                const userId = sub.metadata?.supabase_user_id || (await findUserIdByCustomer(customerId));
                if (!userId) break;

                await upsertSubscription(userId, { subscription_status: 'cancelled' });
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
                if (!customerId) break;
                const userId = await findUserIdByCustomer(customerId);
                if (!userId) break;

                // Sikertelen díjbeszedés: türelmi időszak, NEM azonnali zárás —
                // a felhasználó még ~napokig hozzáfér, amíg Stripe újrapróbálja.
                await upsertSubscription(userId, { subscription_status: 'grace_period' });
                break;
            }

            default:
                // Egyéb eseménytípusokkal szándékosan nem foglalkozunk.
                break;
        }

        return new Response(JSON.stringify({ received: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (e) {
        console.error('Webhook feldolgozási hiba:', String(e));
        // 500-at adunk vissza, hogy Stripe automatikusan újrapróbálja később.
        return new Response('Feldolgozási hiba', { status: 500 });
    }
});
