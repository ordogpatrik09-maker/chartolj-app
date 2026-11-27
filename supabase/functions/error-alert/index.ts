// =====================================================================
// CHARTOLJ! — error-alert Edge Function (hibariasztás az adminnak)
// =====================================================================
// Óránként fut (cron). Ha az elmúlt órában ÚJ hiba jelent meg az
// app_error_log-ban (020), vagy egy hiba legalább 20-szor előfordult,
// e-mailt küld az adminnak a legfontosabbakkal. Ha nincs ilyen, nem küld.
//
// TELEPÍTÉS (a weekly-digest-tel közös Resend-kulcsot használja):
//   supabase secrets set ALERT_EMAIL=patrik66@gmail.com
//   supabase functions deploy error-alert --no-verify-jwt
//   Cron: óránként (0 * * * *), HTTP POST, fejléc: x-cron-secret: <CRON_SECRET>
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('DIGEST_FROM') ?? 'Chartolj! <onboarding@resend.dev>';
const TO = Deno.env.get('ALERT_EMAIL') ?? '';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const esc = (s: string) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

Deno.serve(async (req: Request) => {
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('Forbidden', { status: 403 });
  if (!RESEND_API_KEY || !TO) return new Response(JSON.stringify({ error: 'RESEND_API_KEY / ALERT_EMAIL hiányzik' }), { status: 500 });
  const hourAgo = new Date(Date.now() - 3600000).toISOString();
  const { data: fresh } = await admin.from('app_error_log').select('message, page, occurrence_count, first_seen_at, last_seen_at')
    .gte('first_seen_at', hourAgo).order('occurrence_count', { ascending: false }).limit(10);
  const { data: hot } = await admin.from('app_error_log').select('message, page, occurrence_count, first_seen_at, last_seen_at')
    .gte('last_seen_at', hourAgo).gte('occurrence_count', 20).order('occurrence_count', { ascending: false }).limit(10);
  const all = [...(fresh ?? []), ...(hot ?? []).filter(h => !(fresh ?? []).some(f => f.message === h.message && f.page === h.page))];
  if (!all.length) return new Response(JSON.stringify({ alerted: false }), { headers: { 'Content-Type': 'application/json' } });
  const rows = all.map(e => `<li style="margin-bottom:10px"><b>${esc(e.message).slice(0, 300)}</b><br><span style="color:#64748b">${esc(e.page)} · ${e.occurrence_count}× · utoljára ${esc(e.last_seen_at)}</span></li>`).join('');
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: TO, subject: `⚠️ Chartolj! — ${all.length} hiba az elmúlt órában`,
      html: `<div style="font-family:Arial,sans-serif"><p>Új vagy gyakori kliensoldali hibák (részletek az admin panel hibanaplójában):</p><ul>${rows}</ul></div>` }),
  });
  return new Response(JSON.stringify({ alerted: r.ok, count: all.length }), { headers: { 'Content-Type': 'application/json' } });
});
