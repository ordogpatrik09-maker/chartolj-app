// aria_dialog_name_sweep.js
//
// Kiegészíti az axe_modal_sweep.js-t (ami csak a wcag2a/wcag2aa taghez
// tartozó axe-core szabályokat futtatja az openToolModal()-lal elérhető
// 216 kalkulátor-modalon) egy olyan hibaosztállyal, amit AZ NEM fog meg:
// a "aria-dialog-name" szabály (ARIA dialog/alertdialog csomópontoknak
// elérhető nevük kell legyen) a wcag2a/wcag2aa taggel NEM, csak a
// wcag21a/best-practice taggel aktiválódik axe-core 4.14-ben — ezért az
// a meglévő sweep soha nem futtatta ezt a szabályt. Egy szélesebb,
// 20-elemes mintavételes próba (minden 11. openToolModal-elérhető modal)
// kimutatta, hogy MINDEGYIK dialógusnak hiányzott az elérhető neve: a
// modal-gyökér `role="dialog" aria-modal="true"`-t kapott, de sem
// `aria-label`-t, sem `aria-labelledby`-t — screen reader felhasználó
// számára egy névtelen "dialog" nyílt meg, a tényleges eszköz/kalkulátor
// nevének bemondása nélkül.
//
// A javítás (lásd index.html git diffjét ennek a sweep-nek a bevezető
// commitjában) MINDEN role="dialog" elemhez (nem csak a 216 openToolModal-
// elérhetőhöz — a ~23 egyedi app-modalhoz és az onboarding-tour-overlay-hoz
// is, összesen 240 dialógus) hozzárendelt egy elérhető nevet:
//   - a 236 "normál" eszköz/kalkulátor-modalnál a modal saját, már létező
//     statikus <h3>/<h2> címsorához `id="<modal-id>-title"`-t rendelt, és
//     a gyökérre `aria-labelledby="<modal-id>-title"`-t tett;
//   - az onboarding-modalnál a MÁR LÉTEZŐ `id="onboarding-greeting"`
//     címsor-id-t használta fel (nem duplikált id);
//   - a 3 olyan dialógusnál, aminek NINCS statikus címsor-eleme a
//     markupban (auth-modal, certification-modal, onboarding-tour-overlay
//     — ezeknél a cím/tartalom futásidőben, JS-ből épül fel, vagy
//     lépésenként változik), egy rövid, STATIKUS `aria-label`-t kapott a
//     gyökér — szándékosan statikusat, nem egy futásidőben feltöltött
//     szöveg-elemre mutató aria-labelledby-t, hogy a név attól függetlenül
//     mindig jelen legyen, hogy a tartalom-feltöltő függvény lefutott-e
//     már, és hogy ez a sweep is force-show-val (a tényleges
//     nyitó-függvény meghívása NÉLKÜL) biztonságosan tesztelhesse őket.
//
// Mivel minden dialógus elérhető neve immár STATIKUS (nem egy futásidőben
// feltöltött szövegtől függ), ez a sweep nem a tényleges nyitó-függvényeket
// hívja modalonként (azok rendkívül heterogének: openToolModal, openAuthModal,
// openPremiumModal, startOnboardingTour, admin-jogosultsághoz kötött panelek
// stb.), hanem egyszerűen, egyenként láthatóvá teszi (`classList.remove
// ('hidden')`) MINDEN role="dialog" elemet, lefuttatja rajta kizárólag az
// "aria-dialog-name" axe-core szabályt, majd újra elrejti — ez pontosan azt
// teszteli, amit a szabály valójában vizsgál (a statikus DOM-struktúrán
// kiszámítható elérhető nevet), a nyitás-specifikus mellékhatások (pl. API-
// hívások, admin-jogosultság-ellenőrzés) kockázata nélkül.
//
// Új dialógus/modal hozzáadásakor: ha a modal `role="dialog"`-ot kap, vagy
// legyen neki statikus <h3>/<h2> címsora (és adjunk neki `id`-t +
// `aria-labelledby`-t a gyökérre), vagy — ha a tartalma futásidőben épül —
// kapjon statikus `aria-label`-t a gyökér.
//
// Használat:  node aria_dialog_name_sweep.js
// Kilépési kód 0 = minden role="dialog" elemnek van elérhető neve, 1 = van
// hiányzó (lásd "findings").
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.join(__dirname, 'index.html');
const INDEX_URL = 'file://' + INDEX_PATH;

function resolveAxeMinPath() {
    const candidates = [
        path.join(__dirname, 'node_modules', 'axe-core', 'axe.min.js'),
    ];
    for (const c of candidates) {
        if (fs.existsSync(c)) return c;
    }
    throw new Error(
        "axe-core nem található (" + candidates.join(', ') + "). " +
        "Futtasd előbb: npm install axe-core"
    );
}

(async () => {
    const axeSource = fs.readFileSync(resolveAxeMinPath(), 'utf-8');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('dialog', d => d.dismiss().catch(() => {}));

    await page.goto(INDEX_URL);
    await page.waitForTimeout(1200);
    await page.addScriptTag({ content: axeSource });

    const modalIds = await page.evaluate(() => {
        return [...new Set(
            Array.from(document.querySelectorAll('[role="dialog"]'))
                .map(el => el.id)
                .filter(Boolean)
        )];
    });

    const findings = [];
    let tested = 0;

    for (const modalId of modalIds) {
        const shown = await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (!el) return false;
            el.classList.remove('hidden');
            el.style.display = '';
            return true;
        }, modalId);
        if (!shown) {
            findings.push({ modalId, type: 'element-not-found' });
            continue;
        }
        tested++;

        let axeResult;
        try {
            axeResult = await page.evaluate(async (id) => {
                const node = document.getElementById(id);
                const res = await axe.run(node, { runOnly: { type: 'rule', values: ['aria-dialog-name'] } });
                return res.violations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    help: v.help,
                    nodes: v.nodes.map(n => n.target.join(' ')),
                }));
            }, modalId);
        } catch (e) {
            findings.push({ modalId, type: 'axe-run-throw', text: e.message });
            axeResult = [];
        }
        for (const v of axeResult) {
            findings.push({ modalId, type: 'axe-violation', ...v });
        }

        await page.evaluate((id) => {
            document.getElementById(id).classList.add('hidden');
        }, modalId);
    }

    const ok = findings.length === 0;
    console.log(JSON.stringify({ ok, modalsTotal: modalIds.length, tested, findings }, null, 2));
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
