// Böngészős füstteszt a CI-hoz: betölti az appot PC-s és mobil nézetben,
// végigkattintja a fő füleket és néhány új funkciót, és hibával áll le,
// ha bármilyen nem kezelt JS-hiba (pageerror) történt.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const url = 'file://' + path.resolve(__dirname, 'index.html');
  const b = await chromium.launch(); const errs = [];
  for (const vp of [{ width: 1440, height: 900 }, { width: 390, height: 844, isMobile: true, hasTouch: true }]) {
    const p = await b.newPage({ viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch });
    p.on('pageerror', e => errs.push(`[${vp.width}] ${e.message}`));
    await p.goto(url); await p.waitForTimeout(1500);
    await p.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      if (typeof closeAuthModal === 'function') closeAuthModal();
      if (window.innerWidth < 1024 && typeof switchMobileTab === 'function') {
        for (const t of ['home', 'academy', 'progress', 'profile', 'trade']) { switchMobileTab(t); await wait(150); }
      }
      startChartTasks(); await wait(100); miniQuizClose();
      startMicroLesson(0); await wait(100); miniQuizClose();
      openRiskShieldSettings(); await wait(50); closeShieldModal();
      openIosInstallGuide(); await wait(50); miniQuizClose();
    });
    await p.close();
  }
  await b.close();
  if (errs.length) { console.error('JS-hibák:\n' + errs.join('\n')); process.exit(1); }
  console.log('Füstteszt OK (PC + mobil, 0 JS-hiba).');
})();
