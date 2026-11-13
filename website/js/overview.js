/* Chartolj! website - home market overview (SIMULATED DEMO data) + academy quiz preview. */
(function () {
  'use strict';
  const T = (k, v) => (window.CT ? CT.t(k, v) : k);
  const grid = document.getElementById('mo-grid');
  function time() { const d = new Date(); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function fill() {
    if (!grid) return;
    const cards = [...grid.querySelectorAll('[data-mo]')];
    if (!window.CTCharts) { cards.forEach(c => { c.querySelector('[data-p]').textContent = T('mo.unavail'); c.removeAttribute('aria-busy'); }); return; }
    cards.forEach(c => {
      const seed = +c.dataset.seed, base = +c.dataset.base, dec = +c.dataset.dec;
      const s = CTCharts.simCandles(seed, 40, 100, 1.5, .02).map(x => x.c), k = base / 100;
      const last = s[s.length - 1] * k, ch = (s[s.length - 1] / s[s.length - 2] - 1) * 100, up = ch >= 0;
      c.querySelector('[data-p]').textContent = CT.fmt(last, dec);
      const pct = c.querySelector('[data-pct]'); pct.textContent = (up ? '+' : '−') + CT.fmt(Math.abs(ch)) + '%'; pct.className = 'num ' + (up ? 'up' : 'down');
      const ind = c.querySelector('[data-ind]'); ind.dataset.up = up ? '1' : '0'; ind.textContent = (up ? '▲ ' : '▼ ') + T(up ? 'mo.up' : 'mo.down'); ind.className = 'mo-ind ' + (up ? 'up' : 'down');
      CTCharts.spark(c.querySelector('[data-spark]'), s, up); c.removeAttribute('aria-busy');
    });
    asof();
  }
  function asof() { const el = document.getElementById('mo-asof'); if (el) el.textContent = T('mo.asof', { t: time() }); }
  function langRefresh() {
    if (!grid) return;
    grid.querySelectorAll('[data-mo]').forEach(c => {
      const ind = c.querySelector('[data-ind]'); if (ind.dataset.up) { const up = ind.dataset.up === '1'; ind.textContent = (up ? '▲ ' : '▼ ') + T(up ? 'mo.up' : 'mo.down'); }
    });
    fill();
  }
  /* quiz preview: one real multiple choice question, instant feedback */
  const q = document.getElementById('grq');
  if (q) {
    const fb = q.querySelector('.gr-fb'), opts = [...q.querySelectorAll('.gr-opt')];
    opts.forEach(o => o.addEventListener('click', () => {
      const ok = o.dataset.ok === '1';
      opts.forEach(x => { x.disabled = true; x.classList.toggle('ok', x.dataset.ok === '1'); });
      if (!ok) o.classList.add('no');
      fb.textContent = T(ok ? 'gr.ok' : 'gr.no'); fb.className = 'gr-fb ' + (ok ? 'up' : 'down');
      fb.dataset.state = ok ? 'ok' : 'no';
    }));
    document.addEventListener('ct:lang', () => { if (fb.dataset.state) fb.textContent = T(fb.dataset.state === 'ok' ? 'gr.ok' : 'gr.no'); });
  }
  document.addEventListener('ct:lang', langRefresh);
  /* brief loading state before values appear */
  if (grid) setTimeout(fill, 350);
})();
