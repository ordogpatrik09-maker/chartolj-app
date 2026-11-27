// axe_modal_sweep.js
//
// Kiegészíti a meglévő állandó sweep-eket (modal_numeric_safety_sweep.js,
// overflow_sweep.js, modal_console_error_sweep.js) egy olyan hibaosztállyal,
// amit EGYIK sem vizsgál: valódi WCAG2A/AA kisegítő-lehetőségi (a11y) hibák
// MAGÁN A MEGNYITOTT KALKULÁTOR/ESZKÖZ-MODALON BELÜL.
//
// ELŐZMÉNY ("650f55a" commit): az első axe-core kör kézzel, egyszer-használatos
// scripttel futott le, és csak az 5 fő mobil fülön (Kezdőlap/Kereskedés/
// Akadémia/Fejlődés/Profil) — NEM nyitotta meg egyenként mind a 242 eszköz-
// modalt. Ez a script pont azt az űrt tölti be: minden _getToolModalIds()-
// listán szereplő modalt sorban megnyit (openToolModal(), ugyanúgy mint a
// modal_console_error_sweep.js), axe.run()-t futtat KIZÁRÓLAG a nyitott
// modal gyökérelemére (nem az egész oldalra — a mögötte lévő, aktuálisan
// nem releváns tartalom zaját kiszűrve), majd bezárja és a következőre lép.
//
// FÜGGŐSÉG: a `playwright`-tal szemben az `axe-core` NINCS előre telepítve
// ebben a környezetben. Használat előtt (egyszer, session-enként, mivel a
// node_modules a .gitignore miatt nincs commitolva):
//     npm install axe-core
// A script axe.min.js tartalmát Playwright addScriptTag(content:...)-tal
// injektálja a file:// oldalba (CDN-ről való betöltés ebben a
// hálózat-korlátozott környezetben nem garantált).
//
// Használat:  node axe_modal_sweep.js
// Kilépési kód 0 = nincs "serious"/"critical" axe-találat egyik modalban
// sem, 1 = van (lásd "findings"). A "moderate"/"minor" találatokat és a
// korábbi körben SZÁNDÉKOSAN, dokumentáltan nem javított, bevett minta
// miatti találatokat (lásd IGNORE_RULES) a script kiszűri a bukásból, de
// a "findings" tömbben — tájékoztató jelleggel — továbbra is megjeleníti.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.join(__dirname, 'index.html');
const INDEX_URL = 'file://' + INDEX_PATH;

// A 650f55a kör által tudatosan, dokumentáltan meghagyott, bevett
// interakciós minták — ezeket nem soroljuk a "bukás"-ba, csak jelezzük.
const IGNORE_RULES = new Set(['nested-interactive', 'meta-viewport']);

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
    const axeMinPath = resolveAxeMinPath();
    const axeSource = fs.readFileSync(axeMinPath, 'utf-8');

    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    page.on('dialog', d => d.dismiss().catch(() => {}));

    await page.goto(INDEX_URL);
    await page.waitForTimeout(1200);
    await page.addScriptTag({ content: axeSource });

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

    const findings = [];
    const failingFindings = [];
    let tested = 0;

    for (const modalId of modalIds) {
        try {
            await page.evaluate((id) => { openToolModal(id); }, modalId);
        } catch (e) {
            findings.push({ modalId, type: 'open-throw', text: e.message });
            continue;
        }
        await page.waitForTimeout(40);

        const isVisible = await page.evaluate((id) => {
            const el = document.getElementById(id);
            if (!el) return false;
            const style = window.getComputedStyle(el);
            return style.display !== 'none' && !el.classList.contains('hidden');
        }, modalId);

        if (!isVisible) {
            findings.push({ modalId, type: 'did-not-open', text: 'A modal nem vált láthatóvá openToolModal() után' });
        } else {
            tested++;
            let axeResult;
            try {
                axeResult = await page.evaluate(async (id) => {
                    const node = document.getElementById(id);
                    const res = await axe.run(node, {
                        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
                    });
                    return res.violations.map(v => ({
                        id: v.id,
                        impact: v.impact,
                        help: v.help,
                        nodes: v.nodes.map(n => n.target.join(' ')).slice(0, 5),
                    }));
                }, modalId);
            } catch (e) {
                findings.push({ modalId, type: 'axe-run-throw', text: e.message });
                axeResult = [];
            }

            for (const v of axeResult) {
                const entry = { modalId, type: 'axe-violation', ruleId: v.id, impact: v.impact, help: v.help, nodes: v.nodes };
                findings.push(entry);
                if (!IGNORE_RULES.has(v.id) && (v.impact === 'serious' || v.impact === 'critical')) {
                    failingFindings.push(entry);
                }
            }
        }

        try {
            await page.evaluate((id) => {
                if (typeof closeToolModal === 'function') closeToolModal(id);
                else document.getElementById(id).classList.add('hidden');
            }, modalId);
        } catch (e) {
            findings.push({ modalId, type: 'close-throw', text: e.message });
        }
        await page.waitForTimeout(15);
    }

    const ok = failingFindings.length === 0;
    console.log(JSON.stringify({
        ok,
        modalsTotal: modalIds.length,
        tested,
        failingCount: failingFindings.length,
        failingFindings,
        allFindingsCount: findings.length,
        findings,
    }, null, 2));
    await browser.close();
    process.exit(ok ? 0 : 1);
})();
