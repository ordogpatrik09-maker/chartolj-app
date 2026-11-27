// modal_console_error_sweep.js
//
// Kiegészíti a modal_numeric_safety_sweep.js és az overflow_sweep.js
// módszertanát egy olyan hibaosztállyal, amit egyik sem vizsgál közvetlenül:
// valódi böngésző console.error / uncaught exception / unhandled promise
// rejection, amíg MINDEN kalkulátor- és eszköz-modal (a _getToolModalIds()
// futásidejű, "ami ténylegesen onclick="openToolModal('xxx')"-ból épül fel"
// listájából — ugyanaz a lista, amit az app saját ESC-kezelője használ)
// kétszer egymás után meg- majd becsukódik (nyit->zár->nyit->zár), az
// alapértelmezett bemenetekkel. A duplikált nyitás azért fontos: egy olyan
// render-függvény, ami ismételt hívásnál append-el (törlés helyett) egy
// konténerbe, csak a második nyitásnál buknék le (pl. duplikált option-lista,
// duplikált id egy dinamikusan beszúrt elemen).
//
// A korábbi sweepek (modal_numeric_safety_sweep.js) csak a "calc"-szerű
// gombbal rendelkező modalokat tesztelik, és csak a window[fnName]()
// szinkron dobását fogják el try/catch-csel — nem veszi észre, ha maga az
// openToolModal()/a modal saját nyitási mellékhatása (pl. egy setTimeout-ös
// animáció, vagy egy addEventListener-ben történő hiba) dob konzolhibát.
// Ez a script MINDEN eszköz-modalt megnyit (beleértve a tisztán
// informatív/beállítás-jellegűeket is), és a valódi `console.error` /
// `pageerror` eseményeket figyeli, a tailwind|Supabase JS|ERR_TUNNEL zajt
// kiszűrve (ugyanaz a zajszűrés, mint amit a projektben a Playwright
// funkcionális teszteknél eddig is alkalmaztunk).
//
// Használat:  node modal_console_error_sweep.js
// Kilépési kód 0 = nincs talált konzolhiba, 1 = van (lásd "findings").
const { chromium } = require('playwright');
const path = require('path');

const INDEX_PATH = path.join(__dirname, 'index.html');
const INDEX_URL = 'file://' + INDEX_PATH;

const NOISE_RE = /tailwind|Supabase|ERR_TUNNEL|favicon/i;

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.on('dialog', d => d.dismiss().catch(() => {}));

    const findings = [];
    let currentModalId = null;
    let currentPhase = null;

    page.on('console', msg => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (NOISE_RE.test(text)) return;
        findings.push({ modalId: currentModalId, phase: currentPhase, type: 'console.error', text });
    });
    page.on('pageerror', err => {
        findings.push({ modalId: currentModalId, phase: currentPhase, type: 'pageerror', text: err.message });
    });

    await page.goto(INDEX_URL);
    await page.waitForTimeout(1200);

    const modalIds = await page.evaluate(() => {
        return [...new Set(
            Array.from(document.querySelectorAll('[onclick*="openToolModal("]'))
                .map(el => {
                    const m = el.getAttribute('onclick').match(/openToolModal\('([^']+)'\)/);
                    return m ? m[1] : null;
                })
                .filter(Boolean)
        )];
    });

    let tested = 0;
    for (const modalId of modalIds) {
        currentModalId = modalId;
        tested++;
        for (let round = 1; round <= 2; round++) {
            currentPhase = 'open#' + round;
            try {
                await page.evaluate((id) => { openToolModal(id); }, modalId);
            } catch (e) {
                findings.push({ modalId, phase: currentPhase, type: 'throw', text: e.message });
            }
            await page.waitForTimeout(25);

            // Duplikált-id ellenőrzés a modal konténerén belül, amíg nyitva van —
            // ez fogná meg, ha egy render-függvény ismételt nyitásnál append-elne
            // törlés helyett.
            const dupIds = await page.evaluate((id) => {
                const modal = document.getElementById(id);
                if (!modal) return null;
                const seen = {};
                modal.querySelectorAll('[id]').forEach(el => { seen[el.id] = (seen[el.id] || 0) + 1; });
                return Object.entries(seen).filter(([, c]) => c > 1);
            }, modalId);
            if (dupIds && dupIds.length) {
                findings.push({ modalId, phase: currentPhase, type: 'duplicate-id-in-modal', text: JSON.stringify(dupIds) });
            }

            currentPhase = 'close#' + round;
            try {
                await page.evaluate((id) => {
                    if (typeof closeToolModal === 'function') closeToolModal(id);
                    else document.getElementById(id).classList.add('hidden');
                }, modalId);
            } catch (e) {
                findings.push({ modalId, phase: currentPhase, type: 'throw', text: e.message });
            }
            await page.waitForTimeout(15);
        }
    }

    currentModalId = null;
    currentPhase = null;

    const ok = findings.length === 0;
    console.log(JSON.stringify({ ok, modalsTotal: modalIds.length, tested, findings }, null, 2));
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
