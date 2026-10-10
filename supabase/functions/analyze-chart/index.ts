// =====================================================================
// analyze-chart — Saját chart AI-elemzése (Claude vision)
// =====================================================================
// A felhasználó feltölt egy KÉPET a saját (bármelyik brókeres/chartos
// appból származó) grafikonjáról. Ez a függvény egy valódi, vision-
// képes Claude-hívással elemzi: milyen alakzatot lát, mennyire biztos
// benne, és mit tanulhat belőle — a Chartolj! saját 62 alakzatos
// adatbázisával összekötve (STRATEGY_LESSON_MAP), hogy a válasz
// egyenesen egy konkrét leckéhez tudjon linkelni a kliensben.
//
// BIZTONSÁG ÉS KORLÁTOK:
//   - A kép SOHA nem kerül tárolásra — csak a kérés idejére, memóriában
//     létezik, az Anthropic API-hívás paramétereként.
//   - Csak az EREDMÉNY (felismert minta neve, magyarázat) kerül a
//     `chart_analyses` táblába, service role kulccsal — a kliens nem
//     tud hamis elemzést beszúrni a saját előzményébe.
//   - NAPI LIMIT: ingyenes felhasználóknak 3 elemzés/nap, Prémiumnak
//     korlátlan — ez szerveroldalon van kikényszerítve, nem a
//     kliensben (amit meg lehetne kerülni).
//   - Méret- és formátum-validáció: max 5 MB, csak JPEG/PNG/WebP.
//   - Ez NEM ad kereskedési tanácsot — a rendszerprompt kifejezetten
//     tiltja a "vedd meg / add el" jellegű ajánlásokat, csak oktatási
//     jellegű mintafelismerést és magyarázatot ad.
//
// KÖRNYEZETI VÁLTOZÓK:
//   ANTHROPIC_API_KEY — ugyanaz, mint az ai-chat függvénynél
//
// TELEPÍTÉS:
//   supabase functions deploy analyze-chart
// =====================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const FREE_DAILY_LIMIT = 3;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Ugyanaz a 62 alakzat, ugyanazokkal az id-kkal, mint a kliens
// DRILL_PATTERN_POOL-ja (chartolj_mobile.html) — enélkül a válaszban
// szereplő pattern_id nem tudna megbízhatóan lecke-linkre fordulni.
// HA A KLIENSBEN BŐVÍTED A MINTALISTÁT, EZT A LISTÁT IS FRISSÍTSD.
const KNOWN_PATTERNS: Record<string, string> = {
    headshoulders: 'Fej-váll forduló', doubletop: 'Dupla csúcs (Double Top)', doublebottom: 'Dupla alj (Double Bottom)',
    bullflag: 'Bullish Zászló', triangle: 'Emelkedő Háromszög', supportresist: 'Támasz/Ellenállás Törés',
    cupandhandle: 'Csésze-fül (Cup & Handle)', risingwedge: 'Emelkedő Ék (Rising Wedge)', bearflag: 'Bearish Zászló',
    rectangle: 'Téglalap Konszolidáció', fallingwedge: 'Csökkenő Ék (Falling Wedge)', symmtriangle: 'Szimmetrikus Háromszög',
    doji: 'Doji', pinbar: 'Pin Bar', bullish_engulfing: 'Bullish Engulfing', bearish_engulfing: 'Bearish Engulfing',
    three_white_soldiers: 'Three White Soldiers', three_black_crows: 'Three Black Crows', harami_bullish: 'Bullish Harami',
    harami_bearish: 'Bearish Harami', morning_star: 'Morning Star', evening_star: 'Evening Star',
    marubozu_bull: 'Bullish Marubozu', marubozu_bear: 'Bearish Marubozu', inside_bar: 'Inside Bar',
    rejection_wick: 'Elutasító Kanóc (Rejection Wick)', hammer: 'Hammer', shooting_star: 'Shooting Star',
    tweezer_top: 'Tweezer Top', tweezer_bottom: 'Tweezer Bottom', abandoned_baby: 'Abandoned Baby', kicker: 'Kicker',
    three_line_strike: 'Three Line Strike', dragonfly_doji: 'Dragonfly Doji', gravestone_doji: 'Gravestone Doji',
    spinning_top: 'Spinning Top', belt_hold_bull: 'Bullish Belt Hold', belt_hold_bear: 'Bearish Belt Hold',
    harami_cross: 'Harami Cross', matching_low: 'Matching Low', matching_high: 'Matching High',
    separating_lines_bull: 'Separating Lines', stick_sandwich: 'Stick Sandwich', concealing_baby_swallow: 'Concealing Baby Swallow',
    ladder_bottom: 'Ladder Bottom', tri_star: 'Tri-Star', upside_gap_two_crows: 'Upside Gap Two Crows',
    homing_pigeon: 'Homing Pigeon', kicking: 'Kicking', deliberation: 'Deliberation', advance_block: 'Advance Block',
    unique_three_river_bottom: 'Unique Three River Bottom', meeting_lines: 'Meeting Lines', rickshaw_man: 'Rickshaw Man',
    three_outside_up: 'Three Outside Up', three_outside_down: 'Three Outside Down', two_crows: 'Two Crows',
    ladder_top: 'Ladder Top', breakaway: 'Breakaway', upside_tasuki_gap: 'Upside Tasuki Gap',
    downside_tasuki_gap: 'Downside Tasuki Gap', upside_side_by_side_white_lines: 'Upside Side-by-Side White Lines',
};

const SYSTEM_PROMPT = `Te a Chartolj! alkalmazás beépített chart-elemző asszisztense vagy. A felhasználó feltölt egy képet a SAJÁT kereskedési grafikonjáról (bármelyik brókertől vagy chart-appból származhat).

A FELADATOD:
1. Azonosítsd, van-e a képen felismerhető, klasszikus chart- vagy gyertyaalakzat az alábbi listából. Ha több is látszik, a LEGDOMINÁNSABBAT/legfrissebbet válaszd.
2. Ha semmi a listából nem illik rá egyértelműen, mondd ezt őszintén — NE erőltess rá egy mintát.
3. Magyarázd el egyszerű, magyar nyelven, MIÉRT ez az alakzat, mire kell figyelni, és mi a tanulási pont.
4. SOHA ne adj konkrét "vedd meg" / "add el" / "nyiss pozíciót" tanácsot, célárat vagy stop-loss szintet a KÉP alapján — ez nem valós idejű, egyedi befektetési tanácsadás, hanem oktatási mintafelismerés.
5. Ha a kép nem is trading chart (pl. egy szelfi, egy random fotó), mondd ezt egyértelműen, és kérj egy valódi chart-képernyőképet.

ISMERT ALAKZATOK (pattern_id: Név):
${Object.entries(KNOWN_PATTERNS).map(([id, name]) => `- "${id}": ${name}`).join('\n')}

VÁLASZOLJ KIZÁRÓLAG az alábbi JSON formátumban, más szöveg nélkül:
{
  "pattern_id": "<a fenti listából pontosan egy id, vagy null ha nincs egyértelmű találat>",
  "pattern_name": "<a felismert alakzat magyar neve, vagy null>",
  "confidence": "magas" | "közepes" | "alacsony",
  "summary": "<1-2 mondatos, tömör összegzés>",
  "full_analysis": "<3-6 mondatos, részletes, oktató jellegű magyarázat: miért ez az alakzat, mire érdemes figyelni, mi a tanulási pont>",
  "is_valid_chart": true | false
}`;

function json(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
}

Deno.serve(async (req: Request) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });

    if (!ANTHROPIC_API_KEY) {
        return json({ error: 'Az AI chart-elemzés jelenleg nincs konfigurálva a szerveren.' }, 503);
    }

    try {
        const authHeader = req.headers.get('Authorization');
        if (!authHeader) return json({ error: 'Jelentkezz be az elemzéshez.' }, 401);

        const { imageBase64, mediaType } = await req.json();
        if (!imageBase64 || !mediaType) return json({ error: 'Hiányzó kép.' }, 400);
        if (!ALLOWED_MEDIA_TYPES.includes(mediaType)) {
            return json({ error: 'Nem támogatott képformátum. Csak JPEG, PNG vagy WebP.' }, 400);
        }
        // Base64 méret ~4/3-szorosa a bináris méretnek — durva, biztonságos becslés.
        const approxBytes = imageBase64.length * 0.75;
        if (approxBytes > MAX_IMAGE_BYTES) {
            return json({ error: 'A kép túl nagy (max. 5 MB).' }, 400);
        }

        // 1) Felhasználó azonosítása
        const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { global: { headers: { Authorization: authHeader } } });
        const { data: { user }, error: userErr } = await userClient.auth.getUser();
        if (userErr || !user) return json({ error: 'Érvénytelen munkamenet' }, 401);

        const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

        // 2) Prémium-státusz + napi limit ellenőrzése — SZERVEROLDALON, nem bízva a kliensben.
        const { data: sub } = await adminClient
            .from('subscriptions')
            .select('subscription_status, expires_at')
            .eq('user_id', user.id)
            .maybeSingle();
        const notExpired = !sub?.expires_at || new Date(sub.expires_at).getTime() > Date.now();
        const isPremium = !!(sub && (sub.subscription_status === 'active' || sub.subscription_status === 'grace_period') && notExpired);

        if (!isPremium) {
            const since = new Date();
            since.setHours(0, 0, 0, 0);
            const { count, error: countErr } = await adminClient
                .from('chart_analyses')
                .select('id', { count: 'exact', head: true })
                .eq('user_id', user.id)
                .gte('created_at', since.toISOString());
            if (countErr) {
                console.error('chart_analyses count hiba:', countErr.message);
                return json({ error: 'A használati limit ellenőrzése sikertelen. Próbáld újra.' }, 500);
            }
            if ((count || 0) >= FREE_DAILY_LIMIT) {
                return json({
                    error: `Elérted a napi ${FREE_DAILY_LIMIT} ingyenes elemzési limitet. Prémiummal korlátlan az AI Chart Elemző.`,
                    limitReached: true,
                }, 429);
            }
        }

        // 3) A tényleges Claude vision-hívás
        const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': ANTHROPIC_API_KEY,
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: 'claude-sonnet-4-6',
                max_tokens: 600,
                system: SYSTEM_PROMPT,
                messages: [{
                    role: 'user',
                    content: [
                        { type: 'image', source: { type: 'base64', media_type: mediaType, data: imageBase64 } },
                        { type: 'text', text: 'Elemezd ezt a chart-képet a rendszerprompt utasításai szerint.' },
                    ],
                }],
            }),
        });

        if (!anthropicResp.ok) {
            const errText = await anthropicResp.text();
            console.error('Anthropic API hiba (analyze-chart):', anthropicResp.status, errText);
            return json({ error: 'Az AI elemzés jelenleg nem érhető el.' }, 502);
        }

        const aiData = await anthropicResp.json();
        const textBlock = (aiData.content || []).find((b: { type: string }) => b.type === 'text');
        if (!textBlock) return json({ error: 'Üres AI válasz.' }, 502);

        // 4) A modell válaszának parse-olása — óvatosan, mert bár JSON-t kértünk,
        //    egy LLM occasionally extra szöveget tehet köré.
        let parsed;
        try {
            const jsonMatch = textBlock.text.match(/\{[\s\S]*\}/);
            parsed = JSON.parse(jsonMatch ? jsonMatch[0] : textBlock.text);
        } catch {
            return json({ error: 'Az AI válasza nem volt értelmezhető formátumú. Próbáld újra.' }, 502);
        }

        // Validáljuk, hogy a pattern_id valóban a mi ismert listánkból való-e —
        // ha a modell kitalálna egy nem létező id-t, itt null-ra állítjuk, hogy
        // a kliens ne próbáljon egy nem létező leckére linkelni.
        if (parsed.pattern_id && !KNOWN_PATTERNS[parsed.pattern_id]) {
            parsed.pattern_id = null;
        }

        // 5) Eredmény mentése (SOHA a kép, csak az elemzés szövege) — service role-lal,
        //    hogy a kliens ne tudjon hamis bejegyzést beszúrni.
        await adminClient.from('chart_analyses').insert({
            user_id: user.id,
            detected_pattern_id: parsed.pattern_id || null,
            detected_pattern_name: parsed.pattern_name || null,
            confidence: parsed.confidence || null,
            summary: parsed.summary || '',
            full_analysis: parsed.full_analysis || '',
        });

        return json({ ...parsed, isPremium });
    } catch (e) {
        console.error('analyze-chart váratlan hiba:', e instanceof Error ? e.message : String(e));
        return json({ error: 'Váratlan szerverhiba történt. Próbáld újra.' }, 500);
    }
});
