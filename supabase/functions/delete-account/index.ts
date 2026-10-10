// =====================================================================
// CHARTOLJ! — delete-account Edge Function
// =====================================================================
// EZ TELJESÍTI a GDPR/Google Play "teljes fiók törlése" követelményt:
// az app kliens-oldali kódja (anon key-jel) MÁR törli a progress sort,
// de az auth.users bejegyzést (email, jelszó-hash) csak ez a funkció
// tudja törölni, mert ahhoz a SERVICE ROLE kulcs kell, amit a kliens
// SOHA nem tárolhat biztonságosan.
//
// TELEPÍTÉS (a Supabase CLI-vel, egyszer):
//   1. supabase functions new delete-account
//      (majd cseréld le a generált index.ts-t erre a fájlra)
//   2. supabase functions deploy delete-account
//   3. Ellenőrizd, hogy a SUPABASE_SERVICE_ROLE_KEY és SUPABASE_URL
//      titkos környezeti változóként be van állítva a projektben
//      (ezek alapértelmezetten elérhetők minden Edge Function számára,
//      külön beállítás általában nem szükséges).
//
// HASZNÁLAT a chartolj_mobile.html-ben (confirmDeleteAccount függvény):
//   A kikommentezett blokkot aktiváld, és állítsd be:
//   const deleteAccountEdgeFunctionUrl =
//     'https://<A_TE_PROJECTED>.supabase.co/functions/v1/delete-account';
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req: Request) => {
  // CORS — engedjük az appból érkező hívást (állítsd szűkebbre, ha van saját domained)
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Hiányzó Authorization fejléc' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1) A HÍVÓ felhasználó azonosítása a SAJÁT tokenjéből (nem service role-lal!)
    //    Ez biztosítja, hogy valaki CSAK a SAJÁT fiókját törölheti.
    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();

    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Érvénytelen munkamenet' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 2) Innentől a SERVICE ROLE klienssel dolgozunk — ez tudja törölni
    //    az auth.users bejegyzést, amit az anon key sosem tehetne meg.
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Biztonsági háló: minden felhasználó-specifikus táblát itt is töröljük
    // (ha a kliens oldali törlés bármiért nem futott volna le előtte).
    // Megjegyzés: mivel minden tábla ON DELETE CASCADE-del hivatkozik az
    // auth.users-re, az admin.deleteUser() hívás önmagában is eltávolítaná
    // ezeket — ez a lépés csak extra biztosíték, ha a cascade bármiért
    // nem futna le (pl. régebbi séma-verzió).
    // FONTOS: ha új, felhasználó-specifikus tábla kerül a sémába (pl. egy
    // jövőbeli funkcióhoz), ide is fel kell venni — ez a lista NEM
    // automatikusan bővül az új migrációkkal együtt.
    await adminClient.from('progress').delete().eq('user_id', user.id);
    await adminClient.from('subscriptions').delete().eq('user_id', user.id);
    await adminClient.from('chart_analyses').delete().eq('user_id', user.id);
    await adminClient.from('ai_chat_usage').delete().eq('user_id', user.id);
    await adminClient.from('user_events').delete().eq('user_id', user.id);
    await adminClient.from('profiles').delete().eq('id', user.id).then(
      () => {}, // ha nincs profiles tábla vagy nincs sora, ez nem hiba
      () => {}
    );

    // 3) A TÉNYLEGES auth-fiók törlése (email, jelszó-hash, minden ami
    //    a Supabase Auth rendszerében a felhasználóhoz tartozik).
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(user.id);
    if (deleteErr) {
      console.error('auth.admin.deleteUser hiba:', deleteErr.message);
      return new Response(JSON.stringify({ error: 'A fiók törlése sikertelen. Próbáld újra.' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    console.error('delete-account váratlan hiba:', e instanceof Error ? e.message : String(e));
    return new Response(JSON.stringify({ error: 'A fiók törlése közben váratlan hiba történt. Próbáld újra.' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
