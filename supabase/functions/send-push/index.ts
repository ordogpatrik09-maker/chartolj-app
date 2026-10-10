// =====================================================================
// CHARTOLJ! — send-push Edge Function
// =====================================================================
// Egy adott userhez tartozó ÖSSZES feliratkozott eszközre (push_subscriptions
// tábla) valódi Web Push értesítést küld — ez eljut a felhasználóhoz
// AKKOR IS, ha az app/böngészőtab be van zárva (ez a lényegi különbség a
// kliens-oldali `Notification` API-hoz képest, ami csak nyitott lapnál
// szólal meg).
//
// Ez a funkció BELSŐ, szerver-szerver hívásra készült (pl. a
// send-daily-reminders cron-függvény hívja), NEM a kliens appból. Ezért
// nem a user JWT-jét várja, hanem egy megosztott titkot (x-internal-secret
// header), amit csak a te Supabase Edge Function környezeted ismer.
//
// TELEPÍTÉS (egyszer, a Supabase CLI-vel):
//   1. supabase functions deploy send-push
//   2. Állítsd be az alábbi 4 titkot a projekt Settings → Edge Functions →
//      Secrets alatt (vagy `supabase secrets set NÉV=érték`):
//        VAPID_PUBLIC_KEY   — lásd lent, hogyan generáld
//        VAPID_PRIVATE_KEY
//        VAPID_SUBJECT      — pl. mailto:te@chartolj.hu
//        PUSH_INTERNAL_SECRET — egy általad kitalált, hosszú random string
//
// VAPID kulcspár generálása (egyszer, a saját gépeden, Node-dal):
//   npx web-push generate-vapid-keys
// Ez ad egy Public Key-t (ezt a kliens HTML-be is be kell írni, lásd a
// chartolj_trading_terminal_mobile.html PUSH_VAPID_PUBLIC_KEY konstansát)
// és egy Private Key-t (ez csak ide, a szerverre kerül, SOHA a kliensbe).
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@chartolj.hu';
const PUSH_INTERNAL_SECRET = Deno.env.get('PUSH_INTERNAL_SECRET')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export async function sendPushToUser(userId: string, title: string, body: string, url = '/') {
  const { data: subs, error } = await supabaseAdmin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth_key')
    .eq('user_id', userId);

  if (error || !subs || subs.length === 0) return { sent: 0, removed: 0 };

  let sent = 0;
  let removed = 0;

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth_key },
        },
        JSON.stringify({ title, body, url })
      );
      sent++;
    } catch (err: any) {
      // 404/410 = a feliratkozás lejárt vagy a user visszavonta — töröljük,
      // hogy ne próbálkozzunk vele újra feleslegesen.
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        removed++;
      }
    }
  }

  return { sent, removed };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  if (req.headers.get('x-internal-secret') !== PUSH_INTERNAL_SECRET) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: corsHeaders });
  }

  try {
    const { user_id, title, body, url } = await req.json();
    if (!user_id || !title || !body) {
      return new Response(JSON.stringify({ error: 'user_id, title, body kötelező' }), { status: 400, headers: corsHeaders });
    }
    const result = await sendPushToUser(user_id, title, body, url);
    return new Response(JSON.stringify(result), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: corsHeaders });
  }
});
