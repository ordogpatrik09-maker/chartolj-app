// =====================================================================
// CHARTOLJ! — send-daily-reminders Edge Function
// =====================================================================
// Ez a funkció NEM a klienstől hívódik — egy Supabase Cron Job hívja
// időzítve (pl. minden nap egyszer), és mindenkinek, aki kérte a napi
// emlékeztetőt ÉS 24+ órája nem volt aktív, valódi push értesítést küld
// — ez az, amiért a korábbi, csak-böngészőben-működő Notification API
// megoldás nem volt elég: ha a user bezárta az appot, a régi megoldás
// néma maradt, ez viszont eléri akkor is.
//
// 30 napnál régebben inaktív userek: szándékosan NEM kapnak emlékeztetőt
// (ők már valószínűleg törölték/elfelejtették az appot — a végtelen
// pingelés csak irritálna és rontaná a push-engedély-megtartási arányt).
//
// TELEPÍTÉS:
//   1. supabase functions deploy send-daily-reminders
//      (ugyanazok a secretek kellenek neki, mint a send-push-nak — lásd
//      annak index.ts fájlját — mivel ugyanazt a sendPushToUser logikát
//      hívja újra, csak tömegesen.)
//   2. Supabase Dashboard → Database → Cron Jobs (vagy Integrations →
//      Cron) → Create a new cron job:
//        Name:     chartolj-daily-reminders
//        Schedule: 0 18 * * *     (minden nap 18:00 UTC — állítsd a
//                  magyar esti időhöz, nyáron UTC+2, télen UTC+1)
//        Type:     Edge Function (HTTP request)
//        Function: send-daily-reminders
//   Ha a Dashboardod még nem kínálja a natív Cron Jobs integrációt,
//   alternatívaként a `pg_cron` + `pg_net` Postgres extension-nel is
//   megoldható ugyanez SQL-ből (szólj, ha ezt az utat választod, külön
//   migrációt írok hozzá).
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY')!;
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@chartolj.hu';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const REMINDER_TEXTS = [
  'Egy napja nem gyakoroltál — folytasd, mielőtt megszakad a sorozatod! 🔥',
  'A piac ma is mozog — nézz be néhány percre a Chartolj!-ba. 📈',
  'A napi kihívásaid várnak — pár perc, és meglesz a mai XP. ⚡',
];

Deno.serve(async (_req: Request) => {
  const cutoff24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const cutoff30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const { data: users, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('push_reminders_enabled', true)
    .lt('last_active_at', cutoff24h)
    .gt('last_active_at', cutoff30d);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const text = REMINDER_TEXTS[new Date().getDate() % REMINDER_TEXTS.length];
  let sentTo = 0;

  for (const u of users ?? []) {
    const { data: subs } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth_key')
      .eq('user_id', u.id);

    if (!subs || subs.length === 0) continue;

    for (const sub of subs) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } },
          JSON.stringify({ title: 'Chartolj!', body: text, url: '/' })
        );
        sentTo++;
      } catch (err: any) {
        if (err?.statusCode === 404 || err?.statusCode === 410) {
          await supabaseAdmin.from('push_subscriptions').delete().eq('id', sub.id);
        }
      }
    }
  }

  return new Response(JSON.stringify({ eligibleUsers: (users ?? []).length, pushesSent: sentTo }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
