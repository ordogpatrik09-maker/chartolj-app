// overflow_sweep.js
// Kiegészíti a modal_numeric_safety_sweep.js módszertanát egy olyan
// hibaosztállyal, amit az NEM vizsgál: vízszintes DOM-túlcsordulás
// (horizontalis scroll / a szöveg kilóg a konténeréből) a modal
// eredmény-területén, szélsőséges (de a mező saját validációján átmenő)
// bemenet esetén, mobil (420px) viewporton. Ugyanazt az openToolModal()
// útvonalat és ugyanazokat a nagyságrend-variánsokat használja, mint a
// numerikus-biztonsági sweep, de scrollWidth/clientWidth összehasonlítást
// végez a modal eredmény-blokkjain textContent-regex helyett.
//
// Használat:  node overflow_sweep.js
// Kilépési kód 0 = nincs talált vízszintes túlcsordulás/hiba, 1 = van
// (lásd "findings"/"errors"). Új/módosított kalkulátor hozzáadása után
// érdemes lefuttatni, ugyanúgy, mint a modal_numeric_safety_sweep.js-t.
const { chromium } = require('playwright');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.html');
const INDEX_URL = 'file://' + INDEX_PATH;

const SKIP_SUBSTR = [
    'monte', 'backtest', 'replay', 'pairs', 'leverage-backtest', 'strategy-builder',
    'chart-', 'drawing', 'admin', 'auth-modal', 'onboarding', 'badges', 'changelog',
    'settings-modal', 'portfoliocombiner', 'weightopt'
];

function magnitudeVariants(firstRow) {
    const nums = firstRow.split(',').map(s => parseFloat(s));
    if (nums.some(n => Number.isNaN(n))) return [];
    const scales = [1e8, 1e-8, -1, 1e20, 1e-15];
    return scales.map(s => nums.map(n => (n * s)).join(','));
}

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
        if (action.type === 'zero-single') setVal(action.ids[0], '0');
        else if (action.type === 'zero-all') action.ids.forEach(id => setVal(id, '0'));
        else if (action.type === 'textarea') setVal(action.ids[0], action.value);

        let threw = null;
        try { window[fnName](); } catch (e) { threw = e.message; }

        // overflow scan: any element inside the modal whose content overflows
        // its own box horizontally (scrollWidth meaningfully > clientWidth),
        // restricted to elements that actually show text (leaf-ish nodes),
        // to avoid flagging intentional horizontal-scroll containers.
        const modalEl = document.getElementById(modalId);
        const overflowing = [];
        if (modalEl) {
            const all = modalEl.querySelectorAll('*');
            for (const el of all) {
                const style = window.getComputedStyle(el);
                if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue; // intentional scroller
                if (el.children.length > 2) continue; // focus on leaf-ish result rows, not big wrappers
                const sw = el.scrollWidth, cw = el.clientWidth;
                if (cw > 0 && sw - cw > 8) {
                    overflowing.push({
                        tag: el.tagName, id: el.id || null, cls: (el.className || '').toString().slice(0, 60),
                        scrollWidth: sw, clientWidth: cw, text: (el.textContent || '').trim().slice(0, 80)
                    });
                }
            }
        }

        (action.ids || []).forEach((id, i) => { if (snapshot[i] !== null) setVal(id, snapshot[i]); });
        return { threw, overflowing };
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
                if (result.overflowing && result.overflowing.length) {
                    findings.push({ modalId, fn: info.fnName, phase, overflowing: result.overflowing.slice(0, 3) });
                }
            };

            await check('default', { type: 'default', ids: [] });

            for (const inp of info.numberInputs) {
                const minNum = inp.min === '' ? -Infinity : parseFloat(inp.min);
                const maxNum = inp.max === '' ? Infinity : parseFloat(inp.max);
                if (!(0 >= minNum && 0 <= maxNum) || inp.value === '0' || inp.value === '') continue;
                await check('zero:' + inp.id, { type: 'zero-single', ids: [inp.id] });
            }

            const zeroables = info.numberInputs.filter(inp => {
                const minNum = inp.min === '' ? -Infinity : parseFloat(inp.min);
                const maxNum = inp.max === '' ? Infinity : parseFloat(inp.max);
                return 0 >= minNum && 0 <= maxNum;
            });
            if (zeroables.length >= 2) {
                await check('all-zero', { type: 'zero-all', ids: zeroables.map(z => z.id) });
            }

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

            await page.evaluate((fn) => { try { window[fn](); } catch (e) {} }, info.fnName);
            await page.evaluate((id) => { if (typeof closeToolModal === 'function') closeToolModal(id); }, modalId);
        } catch (e) {
            errors.push({ modalId, fn: info.fnName, phase: 'outer', error: e.message });
        }
    }

    const ok = findings.length === 0 && errors.length === 0;
    console.log(JSON.stringify({ ok, modalsTotal: modalIds.length, tested, findingsCount: findings.length, findings, errors }, null, 2));
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
