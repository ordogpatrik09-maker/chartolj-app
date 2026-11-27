// standalone_number_overflow_sweep.js
//
// Kiegészíti a modal_numeric_safety_sweep.js-t egy olyan lefedettségi réssel,
// amit az NEM vizsgál: az a sweep az önálló `<input type="number">` mezőket
// KIZÁRÓLAG 0-ra állítva teszteli (egyenként és egyszerre), és csak a
// TEXTAREA-s, több-soros mezőknél alkalmaz nagyságrendi (1e8/1e-8/-1/1e20/
// 1e-15) skálázást. Egy olyan kalkulátor, ami NEM textarea-t, hanem önálló
// számmezőket használ (pl. ABCD, Harmonic Pattern, Fibonacci Extension,
// Divergence Check, Chandelier Exit szorzó stb.), emiatt sosem kapott
// SZÉLSŐSÉGES (nem csak nulla) bemenetet ezen mezőkön keresztül az
// automatizált körökben — ezt korábban mindig kézzel, egyszer-használatos
// scripttel kellett pótolni (lásd pl. a "718454c" Fibonacci Extension vagy
// az "a83a9d0" Hír-gyertya Azonosító kört).
//
// Ez a script azt a rést tölti be: minden (nem SKIP-elt) modal ÖSSZES
// <input type="number"> mezőjét EGYENKÉNT extrém nagyságrendre állítja (a
// mező saját min/max korlátain belül maradva, ha van ilyen), lefuttatja a
// modal kalkuláló függvényét, majd megnézi, hogy a modal szövegében
// megjelenik-e Infinity/NaN/undefined/nyers tudományos jelölés.
//
// FONTOS, SZÁNDÉKOS SZŰRÉS: több kalkulátor már dokumentáltan tartalmaz egy
// bevett, biztonságos hibaüzenet-mintát, ami SZÓ SZERINT idézi az
// "Infinity/NaN eredményt" kifejezést (pl. "...a számítás a lebegőpontos
// tartományt túllépve Infinity/NaN eredményt adna. Adj meg reálisabb
// nagyságrendű...") — ez egy VÉDŐ hibaüzenet, nem egy tényleges szivárgás,
// de a nyers szöveg-egyezés (a "LEAK_RE" mintája) ezt is megtalálná. A
// SAFE_PHRASE_RE kifejezetten ezt az idiómát zárja ki a találatokból.
//
// Használat:  node standalone_number_overflow_sweep.js
// Kilépési kód 0 = nincs talált szivárgás/hiba, 1 = van (lásd "findings"/"errors").
const { chromium } = require('playwright');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.html');
const INDEX_URL = 'file://' + INDEX_PATH;

// Ugyanaz a kihagyás-lista, mint a modal_numeric_safety_sweep.js-ben —
// canvas-animációt/hosszú véletlenszám-szimulációt igénylő modalok és
// nem-kalkulátor modalok (lásd ott a részletes indoklást).
const SKIP_SUBSTR = [
    'monte', 'backtest', 'replay', 'pairs', 'leverage-backtest', 'strategy-builder',
    'chart-', 'drawing', 'admin', 'auth-modal', 'onboarding', 'badges', 'changelog',
    'settings-modal', 'portfoliocombiner', 'weightopt'
];

const LEAK_RE_SRC = '\\bInfinity\\b|-Infinity|\\bNaN\\b|\\bundefined\\b|\\[object Object\\]|[0-9]+(?:\\.[0-9]+)?[eE][+-][0-9]+';
// A dokumentáltan biztonságos, szándékos hibaüzenet-idióma — lásd a fenti
// fejléc-kommentet.
const SAFE_PHRASE_RE = /Infinity\/NaN eredmény/;

const SCALES = [1e15, -1e15, 1e100, -1e100, 1e308, -1e308];

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto(INDEX_URL);
    await page.waitForTimeout(1200);

    const modalIds = await page.evaluate(() => {
        return [...new Set([...document.documentElement.outerHTML.matchAll(/id="([a-zA-Z0-9-]*-modal)"/g)].map(m => m[1]))];
    });

    const findings = [];
    const errors = [];
    let tested = 0;

    for (const modalId of modalIds) {
        if (SKIP_SUBSTR.some(s => modalId.includes(s))) continue;

        const info = await page.evaluate((modalId) => {
            const modal = document.getElementById(modalId);
            if (!modal) return null;
            const buttons = [...modal.querySelectorAll('button[onclick]')];
            const candidates = buttons.filter(b => !/closeToolModal/.test(b.getAttribute('onclick')));
            if (candidates.length === 0) return { noButton: true };
            let btn = candidates.find(b => /^(calc|run|evaluate|compute)/i.test(b.getAttribute('onclick'))) || candidates[0];
            const onclick = btn.getAttribute('onclick');
            const fnMatch = onclick.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\(/);
            const fnName = fnMatch ? fnMatch[1] : null;
            const numberInputs = [...modal.querySelectorAll('input[type="number"]')].map(inp => ({ id: inp.id, value: inp.value, min: inp.min, max: inp.max })).filter(x => x.id);
            return { fnName, numberInputs };
        }, modalId);

        if (!info || info.noButton || !info.fnName || info.numberInputs.length === 0) continue;
        tested++;

        try {
            await page.evaluate((id) => { if (typeof openToolModal === 'function') openToolModal(id); }, modalId);
            await page.waitForTimeout(30);

            for (const inp of info.numberInputs) {
                const minNum = inp.min === '' ? -Infinity : parseFloat(inp.min);
                const maxNum = inp.max === '' ? Infinity : parseFloat(inp.max);
                for (const scale of SCALES) {
                    if (!(scale >= minNum && scale <= maxNum)) continue;
                    const result = await page.evaluate(({ modalId, fnName, id, val }) => {
                        const el = document.getElementById(id);
                        const orig = el.value;
                        el.value = String(val);
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        let threw = null;
                        try { window[fnName](); } catch (e) { threw = e.message; }
                        const modalEl = document.getElementById(modalId);
                        const text = modalEl ? modalEl.innerText : '';
                        el.value = orig;
                        el.dispatchEvent(new Event('input', { bubbles: true }));
                        el.dispatchEvent(new Event('change', { bubbles: true }));
                        return { threw, text };
                    }, { modalId, fnName: info.fnName, id: inp.id, val: scale });

                    if (result.threw) { errors.push({ modalId, fn: info.fnName, field: inp.id, scale, error: result.threw }); continue; }
                    const m = result.text.match(new RegExp('.{0,30}(' + LEAK_RE_SRC + ').{0,15}'));
                    if (m && !SAFE_PHRASE_RE.test(m[0])) { findings.push({ modalId, fn: info.fnName, field: inp.id, scale, snippet: m[0] }); }
                }
            }

            // visszaállítás (utolsó futtatás az eredeti értékekkel) + bezárás
            await page.evaluate((fn) => { try { window[fn](); } catch (e) {} }, info.fnName);
            await page.evaluate((id) => { if (typeof closeToolModal === 'function') closeToolModal(id); }, modalId);
        } catch (e) {
            errors.push({ modalId, fn: info.fnName, phase: 'outer', error: e.message });
        }
    }

    const ok = findings.length === 0 && errors.length === 0;
    console.log(JSON.stringify({ ok, modalsTotal: modalIds.length, tested, findingsCount: findings.length, findings, errorsCount: errors.length, errors }, null, 2));
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
