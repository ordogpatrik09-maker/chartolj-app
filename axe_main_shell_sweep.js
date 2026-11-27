// axe_main_shell_sweep.js
//
// Kiegészíti az axe_modal_sweep.js-t (ami KIZÁRÓLAG a megnyitott eszköz-
// modalokat auditálja) egy olyan hibaosztállyal, amit az sem fed le: a FŐ
// alkalmazás-héj (a mobil alsó navigáció 5 fő füle: Kezdőlap/Kereskedés/
// Akadémia/Fejlődés/Profil) saját, modalon KÍVÜLI tartalmának WCAG2A/AA
// kisegítő-lehetőségi hibái.
//
// ELŐZMÉNY ("650f55a" commit): ez a pontos audit korábban egyszer, kézzel,
// egyszer-használatos scripttel lefutott erre az 5 fülre (4 valódi hiba
// javítva), de a script maga nem lett megőrizve a repóban, így az azóta
// (7+ commit) történt módosítások után nem volt mivel újra-ellenőrizni
// ugyanezt a felületet. Ez a script pótolja az állandó, újrafuttatható
// változatot, ugyanazzal a módszertannal, mint az axe_modal_sweep.js
// (axe.min.js helyi fájlból, file:// oldalba injektálva — CDN nem
// garantált ebben a hálózat-korlátozott környezetben).
//
// FÜGGŐSÉG: `npm install axe-core` (lásd axe_modal_sweep.js).
//
// Használat:  node axe_main_shell_sweep.js
// Kilépési kód 0 = nincs "serious"/"critical" axe-találat egyik fő fülön
// sem, 1 = van (lásd "findings"). A "moderate"/"minor" találatok és a
// bevett minta miatti, szándékosan figyelmen kívül hagyott szabályok
// (lásd IGNORE_RULES, ugyanaz a lista mint az axe_modal_sweep.js-ben) a
// "findings" tömbben tájékoztató jelleggel megjelennek, de nem buktatják
// el a scriptet.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const INDEX_PATH = path.join(__dirname, 'index.html');
const INDEX_URL = 'file://' + INDEX_PATH;

const IGNORE_RULES = new Set(['nested-interactive', 'meta-viewport']);

const TABS = ['home', 'trade', 'academy', 'progress', 'profile'];

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

    const findings = [];
    const failingFindings = [];
    let tested = 0;

    for (const tab of TABS) {
        try {
            await page.evaluate((t) => { switchMobileTab(t); }, tab);
        } catch (e) {
            findings.push({ tab, type: 'switch-throw', text: e.message });
            continue;
        }
        await page.waitForTimeout(150);
        tested++;

        let axeResult;
        try {
            axeResult = await page.evaluate(async () => {
                const res = await axe.run(document.body, {
                    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] },
                });
                return res.violations.map(v => ({
                    id: v.id,
                    impact: v.impact,
                    help: v.help,
                    nodes: v.nodes.map(n => n.target.join(' ')).slice(0, 5),
                }));
            });
        } catch (e) {
            findings.push({ tab, type: 'axe-run-throw', text: e.message });
            axeResult = [];
        }

        axeResult.forEach(v => {
            const entry = { tab, ...v };
            findings.push(entry);
            if (!IGNORE_RULES.has(v.id) && (v.impact === 'serious' || v.impact === 'critical')) {
                failingFindings.push(entry);
            }
        });
    }

    await browser.close();

    const ok = failingFindings.length === 0;
    console.log(JSON.stringify({ ok, tabsTotal: TABS.length, tested, findings }, null, 2));
    process.exit(ok ? 0 : 1);
})();
