// =====================================================================
// CHARTOLJ! — weekly-digest Edge Function (heti összefoglaló e-mail)
// =====================================================================
// Csak azoknak megy, akik az appban KIFEJEZETTEN feliratkoztak
// (email_prefs.weekly_digest = true, lásd 028 migráció). Minden levélben
// egy kattintásos leiratkozó link van (?unsubscribe=<token>).
//
// TELEPÍTÉS:
//   1. Regisztrálj a resend.com-on (ingyenes: 3000 levél/hó), igazold a
//      küldő domaint, és hozz létre egy API-kulcsot.
//   2. supabase secrets set RESEND_API_KEY=re_xxx DIGEST_FROM="Chartolj! <hello@sajatdomain.hu>" APP_URL=https://ordogpatrik09-maker.github.io/chartolj-app/
//   3. supabase functions deploy weekly-digest --no-verify-jwt
//      (a --no-verify-jwt a leiratkozó link miatt kell; a küldést csak a
//      CRON_SECRET fejléccel lehet indítani)
//      supabase secrets set CRON_SECRET=<hosszú véletlen szöveg>
//   4. Cron (Dashboard → Integrations → Cron): vasárnap 17:00 UTC,
//      HTTP POST a függvényre, fejléc: x-cron-secret: <CRON_SECRET>
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const FROM = Deno.env.get('DIGEST_FROM') ?? 'Chartolj! <onboarding@resend.dev>';
const APP_URL = Deno.env.get('APP_URL') ?? 'https://ordogpatrik09-maker.github.io/chartolj-app/';
const CRON_SECRET = Deno.env.get('CRON_SECRET') ?? '';
const FN_URL = `${SUPABASE_URL}/functions/v1/weekly-digest`;

const admin = createClient(SUPABASE_URL, SERVICE_KEY);
const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);

  // 1) Leiratkozás (GET ?unsubscribe=token) — nyilvános, csak a tokenhez tartozó sort kapcsolja ki.
  const tok = url.searchParams.get('unsubscribe');
  if (tok !== null) {
    if (UUID_RE.test(tok)) await admin.from('email_prefs').update({ weekly_digest: false, updated_at: new Date().toISOString() }).eq('unsubscribe_token', tok);
    return new Response('<!doctype html><meta charset="utf-8"><p style="font-family:sans-serif">Leiratkoztál a heti összefoglalóról. Az appban bármikor visszakapcsolhatod.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // 2) Küldés — csak a cron hívhatja.
  if (!CRON_SECRET || req.headers.get('x-cron-secret') !== CRON_SECRET) return new Response('Forbidden', { status: 403 });
  if (!RESEND_API_KEY) return new Response(JSON.stringify({ error: 'RESEND_API_KEY hiányzik' }), { status: 500 });

  const since = new Date(Date.now() - 6.5 * 86400000).toISOString();
  const { data: prefs, error } = await admin.from('email_prefs').select('user_id, unsubscribe_token, last_sent_at').eq('weekly_digest', true);
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  let sent = 0, skipped = 0;
  const weekStart = (() => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); })();
  for (const p of prefs ?? []) {
    if (p.last_sent_at && p.last_sent_at > since) { skipped++; continue; } // hetente max. egy
    const { data: u } = await admin.auth.admin.getUserById(p.user_id);
    const email = u?.user?.email; if (!email) { skipped++; continue; }
    const [{ data: prof }, { data: prog }, { data: snap }, { data: trades }] = await Promise.all([
      admin.from('profiles').select('display_name').eq('id', p.user_id).maybeSingle(),
      admin.from('progress').select('mobile_xp, mobile_done_lessons, mobile_mistake_bank').eq('user_id', p.user_id).maybeSingle(),
      admin.from('xp_league_snapshots').select('xp_at_start').eq('user_id', p.user_id).eq('period_type', 'weekly').eq('period_start', weekStart).maybeSingle(),
      admin.from('sim_trades').select('pnl').eq('user_id', p.user_id).gte('closed_at', since),
    ]);
    const xp = prog?.mobile_xp ?? 0;
    const xpWeek = snap ? Math.max(0, xp - (snap.xp_at_start ?? xp)) : null;
    const lessons = Array.isArray(prog?.mobile_done_lessons) ? prog.mobile_done_lessons.length : 0;
    const mistakes = Array.isArray(prog?.mobile_mistake_bank) ? prog.mobile_mistake_bank.length : 0;
    const n = trades?.length ?? 0, net = (trades ?? []).reduce((a: number, t: any) => a + Number(t.pnl || 0), 0);
    const name = prof?.display_name ? esc(String(prof.display_name).split(' ')[0]) : '';
    // Tanári rész: ha a felhasználónak van osztálya (029/030), osztályonként
    // tagszám, a héten aktív tagok és a feladatok átlagos teljesítése.
    let teacherHtml = '';
    const { data: classes } = await admin.from('classes').select('id, name').eq('owner_id', p.user_id);
    for (const c of classes ?? []) {
      const { data: mem } = await admin.from('class_members').select('user_id').eq('class_id', c.id);
      const ids = (mem ?? []).map((m: any) => m.user_id);
      let active = 0, assignTxt = '';
      if (ids.length) {
        const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', ids).gte('last_active_at', since);
        active = count ?? 0;
        const { data: asg } = await admin.from('class_assignments').select('lesson_idx').eq('class_id', c.id);
        if (asg && asg.length) {
          const { data: prs } = await admin.from('progress').select('mobile_done_lessons').in('user_id', ids);
          let done = 0;
          for (const a of asg) for (const pr of prs ?? []) if (Array.isArray(pr.mobile_done_lessons) && pr.mobile_done_lessons.includes(a.lesson_idx)) done++;
          assignTxt = ` · feladatok: ${Math.round(done / (asg.length * ids.length) * 100)}% kész`;
        }
      }
      teacherHtml += `<li style="margin:4px 0">${esc(String(c.name))}: ${ids.length} tanuló, ${active} aktív a héten${assignTxt}</li>`;
    }
    if (teacherHtml) teacherHtml = `<div style="margin-top:18px;padding:12px;border:1px solid #1e293b;border-radius:12px"><div style="font-weight:700;color:#fbbf24;font-size:13px">🏫 Osztályaid</div><ul style="padding-left:18px;margin:6px 0 0;font-size:13px;color:#cbd5e1">${teacherHtml}</ul></div>`;
    const row = (k: string, v: string) => `<tr><td style="padding:6px 0;color:#94a3b8">${k}</td><td style="padding:6px 0;text-align:right;font-weight:700;color:#fff">${v}</td></tr>`;
    const html = `<div style="background:#05080f;padding:24px;font-family:Arial,sans-serif"><div style="max-width:480px;margin:auto;background:#0b1220;border:1px solid #1e293b;border-radius:16px;padding:24px;color:#e2e8f0">
      <div style="color:#22d3ee;font-weight:800;letter-spacing:1px;font-size:12px">CHARTOLJ! · HETI ÖSSZEFOGLALÓ</div>
      <h1 style="font-size:20px;margin:8px 0 16px">${name ? name + ', íme' : 'Íme'} a heted 📈</h1>
      <table style="width:100%;font-size:14px">${xpWeek !== null ? row('XP ezen a héten', `+${xpWeek}`) : ''}${row('Összes XP', String(xp))}${row('Kész leckék', String(lessons))}${row('Ismétlésre vár', String(mistakes))}${row('Szimulált kötések (7 nap)', n ? `${n} db · ${net >= 0 ? '+' : ''}$${net.toFixed(0)}` : '—')}</table>
      <p style="margin:18px 0 0;font-size:14px;color:#cbd5e1">${mistakes >= 3 ? `Kezdd a jövő hetet a ${mistakes} esedékes ismétléssel — ez rögzíti a legjobban a tudást.` : 'Egy új lecke naponta, és pár tudatos kötés a szimulátorban — így lesz a legtöbb fejlődés.'}</p>
      ${teacherHtml}
      <a href="${APP_URL}" style="display:inline-block;margin-top:18px;background:#22d3ee;color:#05080f;font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none">Folytatom</a>
      <p style="margin-top:24px;font-size:11px;color:#64748b">Szimulált, oktatási célú adatok — nem befektetési tanács. <a href="${FN_URL}?unsubscribe=${p.unsubscribe_token}" style="color:#64748b">Leiratkozás</a></p></div></div>`;
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: email, subject: 'A heted a Chartolj!-ban 📈', html,
        headers: { 'List-Unsubscribe': `<${FN_URL}?unsubscribe=${p.unsubscribe_token}>` } }),
    });
    if (r.ok) { sent++; await admin.from('email_prefs').update({ last_sent_at: new Date().toISOString() }).eq('user_id', p.user_id); }
    else skipped++;
  }
  return new Response(JSON.stringify({ subscribed: (prefs ?? []).length, sent, skipped }), { headers: { 'Content-Type': 'application/json' } });
});
