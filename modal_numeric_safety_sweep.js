// modal_numeric_safety_sweep.js
//
// Automatizált, Playwright-Chromium alapú "DOM-fuzzer" sweep, ami MINDEN
// kalkulátor-modalt a valós felhasználói útvonalon nyit meg (openToolModal(),
// hogy a lazy-render lépések is lefussanak, ahogy élesben is), majd szélsőséges
// — de egyedileg a mező saját validációján átmenő — bemeneteket próbál ki, és
// a kalkuláció eredmény-DOM-ját átvizsgálja a korábbi minőségjavítási körökben
// (lásd pl. a "cf32031", "b792129", "3bb299b" és "25fa066" commit-okat)
// ismételten kézzel felfedezett hibaosztályok után:
//   - nyers tudományos jelölés  (pl. "1.085e+22", "1.5e-8")
//   - "NaN" / "undefined" / "[object Object]" szivárgás
//   - "Infinity" / "-Infinity" szivárgás (osztás nullával — ezt a korábbi
//     sweepek kifejezetten NEM vizsgálták, ez itt egy új, kiegészítő eset)
//
// MIÉRT ÉRDEMES EZT MEGTARTANI ÉS ÚJRAFUTTATNI:
// Az eddigi köröket mindig egy újonnan, kézzel megírt, egyszer-használatos
// Playwright script végezte el, ami drága (új kódot kell írni és átgondolni
// minden egyes alkalommal) és NEM RÉSZE a "kötelező" full_regression.js
// gyors, böngésző nélküli ellenőrzésének. Ez a script egy ÁLLANDÓ,
// újrafelhasználható verzió ugyanannak a módszertannak — egy jövőbeli kör
// (vagy egy új kalkulátor hozzáadása után) egyszerűen lefuttathatja
// `node modal_numeric_safety_sweep.js`-sel ahelyett, hogy a sweepet
// nulláról kéne újraírni. NEM helyettesíti a full_regression.js-t (az
// gyors és mindig kötelező); ez egy lassabb, mélyebb, numerikus-biztonsági
// kiegészítő ellenőrzés, amit új/módosított kalkulátor után érdemes
// lefuttatni.
//
// Használat:  node modal_numeric_safety_sweep.js
// Kilépési kód 0 = nincs talált szivárgás/hiba, 1 = van (lásd "findings"/"errors").
//
// Szándékosan kihagyott modalok: canvas-animációt/hosszú véletlenszám-
// szimulációt igénylő modalok (Monte Carlo, Backtest, Replay, Pairs,
// Strategy Builder, Leverage Backtest stb.) és nem-kalkulátor modalok
// (Admin, Auth, Onboarding, Badges, Changelog, Settings) — ugyanazzal az
// indoklással, mint a korábbi kézi sweepeknél (lásd cf32031 commit).
const { chromium } = require('playwright');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.html');
const INDEX_URL = 'file://' + INDEX_PATH;

const SKIP_SUBSTR = [
    'monte', 'backtest', 'replay', 'pairs', 'leverage-backtest', 'strategy-builder',
    'chart-', 'drawing', 'admin', 'auth-modal', 'onboarding', 'badges', 'changelog',
    'settings-modal', 'portfoliocombiner', 'weightopt'
];

const LEAK_RE_SRC = '\\bInfinity\\b|-Infinity|\\bNaN\\b|\\bundefined\\b|\\[object Object\\]|[0-9]+(?:\\.[0-9]+)?[eE][+-][0-9]+';
const LEAK_RE = new RegExp(LEAK_RE_SRC);

function magnitudeVariants(firstRow) {
    // Ugyanaz az 5 skálázási forgatókönyv, mint a korábbi kézi sweepeknél:
    // nagyon nagy / nagyon kicsi / negatív nagyságrend, a mező saját
    // validációján (ha van) jellemzően átmenő, de szélsőséges érték.
    const nums = firstRow.split(',').map(s => parseFloat(s));
    if (nums.some(n => Number.isNaN(n))) return [];
    const scales = [1e8, 1e-8, -1, 1e20, 1e-15];
    return scales.map(s => nums.map(n => (n * s)).join(','));
}

// Egyetlen, a böngészőben futó, ADAT-vezérelt mutáló+ellenőrző függvény —
// nincs stringből-újra-Function-ba konvertálás, csak sima paraméterátadás.
async function applyAndCheck(page, modalId, fnName, action) {
    return page.evaluate(({ modalId, fnName, action }) => {
        const setVal = (id, val) => {
            const el = document.getElementById(id);
            if (!el) return;
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
        };
        const snapshot = (action.ids || []).map(id => {
            const el = document.getElementById(id);
            return el ? el.value : null;
        });
        if (action.type === 'zero-single') {
            setVal(action.ids[0], '0');
        } else if (action.type === 'zero-all') {
            action.ids.forEach(id => setVal(id, '0'));
        } else if (action.type === 'textarea') {
            setVal(action.ids[0], action.value);
        }
        // 'default' -> no mutation, just run

        let threw = null;
        try { window[fnName](); } catch (e) { threw = e.message; }
        const modalEl = document.getElementById(modalId);
        const text = modalEl ? modalEl.innerText : '';

        // restore
        (action.ids || []).forEach((id, i) => { if (snapshot[i] !== null) setVal(id, snapshot[i]); });

        return { threw, text };
    }, { modalId, fnName, action });
}

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
            const textareas = [...modal.querySelectorAll('textarea')].map(t => ({ id: t.id, value: t.value })).filter(x => x.id);
            const numberInputs = [...modal.querySelectorAll('input[type="number"]')].map(inp => ({ id: inp.id, value: inp.value, min: inp.min, max: inp.max })).filter(x => x.id);
            return { fnName, textareas, numberInputs };
        }, modalId);

        if (!info || info.noButton || !info.fnName) continue;
        tested++;

        try {
            await page.evaluate((id) => { if (typeof openToolModal === 'function') openToolModal(id); }, modalId);
            await page.waitForTimeout(30);

            const check = async (phase, action) => {
                const result = await applyAndCheck(page, modalId, info.fnName, action);
                if (result.threw) { errors.push({ modalId, fn: info.fnName, phase, error: result.threw }); return; }
                const m = result.text.match(new RegExp('.{0,30}(' + LEAK_RE_SRC + ').{0,15}'));
                if (m) { findings.push({ modalId, fn: info.fnName, phase, snippet: m[0] }); }
            };

            // 1) default sanity run
            await check('default', { type: 'default', ids: [] });

            // 2) each numeric input -> 0, one at a time (where legal)
            for (const inp of info.numberInputs) {
                const minNum = inp.min === '' ? -Infinity : parseFloat(inp.min);
                const maxNum = inp.max === '' ? Infinity : parseFloat(inp.max);
                if (!(0 >= minNum && 0 <= maxNum) || inp.value === '0' || inp.value === '') continue;
                await check('zero:' + inp.id, { type: 'zero-single', ids: [inp.id] });
            }

            // 3) all numeric inputs -> 0 simultaneously (where legal for each)
            const zeroables = info.numberInputs.filter(inp => {
                const minNum = inp.min === '' ? -Infinity : parseFloat(inp.min);
                const maxNum = inp.max === '' ? Infinity : parseFloat(inp.max);
                return 0 >= minNum && 0 <= maxNum;
            });
            if (zeroables.length >= 2) {
                await check('all-zero', { type: 'zero-all', ids: zeroables.map(z => z.id) });
            }

            // 4) textarea: flat sequence (std dev == 0) + magnitude scaling
            for (const ta of info.textareas) {
                if (!ta.value || (ta.value.indexOf(',') === -1 && ta.value.indexOf('\n') === -1)) continue;
                const lines = ta.value.split('\n').filter(l => l.trim());
                if (lines.length === 0) continue;
                const firstRow = lines[0].trim();
                const flatValue = Array.from({ length: Math.max(lines.length, 5) }, () => firstRow).join('\n');
                await check('flat:' + ta.id, { type: 'textarea', ids: [ta.id], value: flatValue });

                for (const variant of magnitudeVariants(firstRow)) {
                    const scaledValue = Array.from({ length: Math.max(lines.length, 2) }, () => variant).join('\n');
                    await check('scale:' + ta.id, { type: 'textarea', ids: [ta.id], value: scaledValue });
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
    console.log(JSON.stringify({ ok, modalsTotal: modalIds.length, tested, findings, errors }, null, 2));
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
