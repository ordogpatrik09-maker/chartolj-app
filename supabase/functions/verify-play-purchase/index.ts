// =====================================================================
// verify-play-purchase — Google Play vásárlás szerveroldali ellenőrzése
// =====================================================================
// A kliens SOHA nem állíthatja be közvetlenül a saját Prémium-státuszát
// (lásd 004_subscription.sql megjegyzését). Ez a függvény az EGYETLEN
// hely, ahol a `subscriptions` tábla írásra kerül sikeres, valódi
// Google Play vásárlás esetén.
//
// KÖRNYEZETI VÁLTOZÓK (Supabase Dashboard → Edge Functions → Secrets):
//   SUPABASE_URL                 — automatikusan elérhető
//   SUPABASE_ANON_KEY             — automatikusan elérhető
//   SUPABASE_SERVICE_ROLE_KEY     — automatikusan elérhető
//   GOOGLE_SERVICE_ACCOUNT_JSON   — MANUÁLISAN beállítandó (lásd lent)
//   GOOGLE_PLAY_PACKAGE_NAME      — MANUÁLISAN beállítandó, pl.
//                                   'YOUR_GOOGLE_PLAY_PACKAGE_NAME'
//                                   (cseréld le a valódi Play Console
//                                   csomagnévre, NE találj ki egyet)
//
// GOOGLE CLOUD ELŐFELTÉTEL (egyszeri beállítás, a Play Console-hoz
// kapcsolt Google Cloud projektben):
//   1. Service Account létrehozása
//   2. Play Console → Felhasználók és jogosultságok → hívd meg a
//      Service Accountot "Pénzügyi adatok megtekintése" joggal
//   3. A Service Account JSON kulcsát mentsd Supabase secretként:
//      supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='<teljes JSON>'
//
// TELEPÍTÉS:
//   supabase functions deploy verify-play-purchase
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { GoogleAuth } from 'npm:google-auth-library@9';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const GOOGLE_SERVICE_ACCOUNT_JSON = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
const ANDROID_PACKAGE_NAME = Deno.env.get('GOOGLE_PLAY_PACKAGE_NAME') || 'YOUR_GOOGLE_PLAY_PACKAGE_NAME';

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

    if (ANDROID_PACKAGE_NAME === 'YOUR_GOOGLE_PLAY_PACKAGE_NAME' || !GOOGLE_SERVICE_ACCOUNT_JSON) {
        // Őszintén jelezzük, ha a szükséges konfiguráció még hiányzik —
        // NEM adunk hamis "sikeres" választ.
        return json({ valid: false, error: 'A szerver még nincs konfigurálva Google Play ellenőrzéshez (GOOGLE_PLAY_PACKAGE_NAME / GOOGLE_SERVICE_ACCOUNT_JSON hiányzik).' }, 503);
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ valid: false, error: 'Hiányzó Authorization fejléc' }, 401);

        const body = await req.json().catch(() => null);
        if (!body || typeof body !== 'object') return json({ valid: false, error: 'Érvénytelen kérés törzs' }, 400);
        const { purchaseToken, itemId, plan } = body;

        // 24. pont — INPUT VALIDATION: típus, hossz és formátum ellenőrzése,
        // mielőtt bármi kimenne a Google Play Developer API felé. Egy
        // túl hosszú vagy szabálytalan tokent/itemId-t itt elutasítunk,
        // ahelyett hogy felesleges külső hívást indítanánk vele.
        if (typeof purchaseToken !== 'string' || purchaseToken.length < 10 || purchaseToken.length > 4096) {
            return json({ valid: false, error: 'Hiányzó vagy érvénytelen purchaseToken' }, 400);
        }
        if (typeof itemId !== 'string' || itemId.length < 1 || itemId.length > 200 || !/^[a-zA-Z0-9._-]+$/.test(itemId)) {
            return json({ valid: false, error: 'Hiányzó vagy érvénytelen itemId' }, 400);
        }
        if (plan !== 'monthly' && plan !== 'yearly') return json({ valid: false, error: 'Érvénytelen csomag' }, 400);

        // 1) A hívó felhasználó azonosítása a SAJÁT tokenjéből.
        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
        const { data: { user }, error: userErr } = await userClient.auth.getUser();
        if (userErr || !user) return json({ valid: false, error: 'Érvénytelen munkamenet' }, 401);

        // 2) Google OAuth token a Service Accounttal.
        const credentials = JSON.parse(GOOGLE_SERVICE_ACCOUNT_JSON);
        const auth = new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/androidpublisher'] });
        const client = await auth.getClient();
        const accessToken = (await client.getAccessToken()).token;

        // 3) A vásárlás ellenőrzése a Google Play Developer API-n.
        const verifyUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/subscriptions/${itemId}/tokens/${purchaseToken}`;
        const googleResp = await fetch(verifyUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!googleResp.ok) {
            const errText = await googleResp.text();
            console.error('Google Play ellenőrzés sikertelen:', googleResp.status, errText);
            return json({ valid: false, error: 'Google ellenőrzés sikertelen' }, 400);
        }
        const purchase = await googleResp.json();

        // paymentState: 0 = várakozó, 1 = fizetve, 2 = próbaidőszak
        const isPaid = purchase.paymentState === 1 || purchase.paymentState === 2;
        if (!isPaid) return json({ valid: false, error: 'A vásárlás nincs kifizetve.' }, 400);

        const expiresAt = purchase.expiryTimeMillis ? new Date(Number(purchase.expiryTimeMillis)).toISOString() : null;

        // 4) subscriptions frissítése — SERVICE ROLE klienssel, ami megkerüli
        //    az RLS-t. Idempotens: ugyanaz a purchaseToken kétszer beküldve
        //    csak felülírja ugyanazt az állapotot, nem ad kétszer jutalmat
        //    (a kliens oldali coin/XP jutalom logikát is ehhez kell igazítani —
        //    lásd a chartolj_mobile.html grantPremiumFromCheckout megjegyzését).
        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
        const { error: upsertErr } = await adminClient.from('subscriptions').upsert({
            user_id: user.id,
            subscription_status: 'active',
            subscription_product_id: itemId,
            subscription_platform: 'playbilling',
            subscription_purchase_token: purchaseToken,
            expires_at: expiresAt,
        }, { onConflict: 'user_id' });
        if (upsertErr) {
            console.error('subscriptions upsert hiba (verify-play-purchase):', upsertErr.message);
            return json({ valid: false, error: 'A vásárlás mentése sikertelen. Próbáld újra.' }, 500);
        }

        // 5) Nyugtázás (acknowledge) a Google felé — enélkül 3 nap után
        //    Google automatikusan visszatéríti a vásárlást.
        const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${ANDROID_PACKAGE_NAME}/purchases/subscriptions/${itemId}/tokens/${purchaseToken}:acknowledge`;
        await fetch(ackUrl, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });

        return json({ valid: true });
    } catch (e) {
        console.error('verify-play-purchase váratlan hiba:', e instanceof Error ? e.message : String(e));
        return json({ valid: false, error: 'Váratlan szerverhiba történt a vásárlás ellenőrzése közben. Próbáld újra.' }, 500);
    }
});
