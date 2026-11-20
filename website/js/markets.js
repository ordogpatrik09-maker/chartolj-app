/* Chartolj! – Markets page. Providers: Binance public API (crypto), Frankfurter/ECB (FX, daily).
   Everything else is a clearly labelled DEMO simulation. If a provider fails, its instruments fall back to a marked demo state. */
(function () {
  'use strict';
  const doc = document, cfg = window.CT_CONFIG || {}, P = cfg.providers || {};
  const WL_KEY = 'chartolj_site_watchlist';
  const grid = doc.getElementById('mk-grid'); if (!grid) return;
  const q = doc.getElementById('mk-q'), sortSel = doc.getElementById('mk-sort'), chipsBox = doc.getElementById('mk-chips');
  const overlay = doc.getElementById('mk-overlay'), modalBody = doc.getElementById('mk-modal-body');
  const t = (k, v) => CT.t(k, v);
  const CATS = ['all', 'watch', 'forex', 'stocks', 'indices', 'commodities', 'crypto', 'etf'];

  let defs = [], state = {}, cat = 'all', watch = [], lastFocus = null, detailChart = null, notices = new Set();
  try { watch = JSON.parse(localStorage.getItem(WL_KEY) || '[]'); } catch (e) { watch = []; }
  const saveWatch = () => { try { localStorage.setItem(WL_KEY, JSON.stringify(watch)); } catch (e) { /* ignore */ } };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  const getJSON = url => timeout(fetch(url, { credentials: 'omit' }).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }), 9000);
  const fmtP = (v, d) => CT.fmt(v, d);

  /* ----- providers ----- */
  async function loadCrypto() {
    const list = defs.filter(d => d.src === 'binance'); if (!list.length) return;
    try {
      const syms = encodeURIComponent(JSON.stringify(list.map(d => d.bn)));
      const tick = await getJSON(P.crypto + '/ticker/24hr?symbols=' + syms);
      const by = {}; tick.forEach(x => { by[x.symbol] = x; });
      const sparks = await Promise.all(list.map(d => getJSON(P.crypto + '/klines?symbol=' + d.bn + '&interval=1h&limit=24').then(k => k.map(c => +c[4])).catch(() => [])));
      list.forEach((d, i) => {
        const x = by[d.bn]; if (!x) { demo(d); return; }
        state[d.id] = { status: 'live', price: +x.lastPrice, chg: +x.priceChangePercent, spark: sparks[i], hi: +x.highPrice, lo: +x.lowPrice, vol: +x.quoteVolume, at: Date.now() };
      });
    } catch (e) { notices.add('crypto'); list.forEach(demo); }
  }
  async function loadFx() {
    const list = defs.filter(d => d.src === 'fx'); if (!list.length) return;
    try {
      const start = new Date(Date.now() - 38 * 864e5).toISOString().slice(0, 10);
      const j = await getJSON(P.fx + '/' + start + '..?from=EUR&to=USD,GBP,JPY,CHF,HUF,AUD');
      const days = Object.keys(j.rates).sort();
      const val = (day, pair) => { const r = j.rates[day]; const [b, qte] = pair.split('/'); const f = c => (c === 'EUR' ? 1 : r[c]); return f(qte) / f(b); };
      list.forEach(d => {
        const s = days.map(day => val(day, d.fx)).filter(Number.isFinite);
        if (s.length < 2) { demo(d); return; }
        const last = s[s.length - 1], prev = s[s.length - 2];
        state[d.id] = { status: 'daily', price: last, chg: (last / prev - 1) * 100, spark: s.slice(-30), hi: Math.max.apply(null, s), lo: Math.min.apply(null, s), date: days[days.length - 1], at: Date.now() };
      });
    } catch (e) { notices.add('fx'); list.forEach(demo); }
  }
  const hashSeed = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  function demo(d) {
    const c = CTCharts.simCandles(d.seed || hashSeed(d.id), 60, 100, 1.4, .02), cl = c.map(x => x.c);
    state[d.id] = { status: 'demo', price: cl[cl.length - 1], chg: (cl[cl.length - 1] / cl[cl.length - 2] - 1) * 100, spark: cl.slice(-30), hi: Math.max.apply(null, c.map(x => x.h)), lo: Math.min.apply(null, c.map(x => x.l)), candles: c, at: Date.now() };
  }

  /* ----- rendering ----- */
  function badge(s) {
    if (s.status === 'live') return '<span class="badge badge-live" data-tip="' + esc(t('market.src.binance')) + '">' + t('badge.live') + '</span>';
    if (s.status === 'daily') return '<span class="badge badge-delayed" data-tip="' + esc(t('market.src.fx')) + '">' + t('badge.daily') + '</span>';
    return '<span class="badge badge-sim" data-tip="' + esc(t('market.src.demo')) + '">' + t('badge.demo') + '</span>';
  }
  function priceHtml(d, s) { return fmtP(s.price, s.status === 'demo' ? 2 : d.dec) + (s.status === 'demo' ? ' <small style="font-size:.6em;color:var(--c-text-3)">idx</small>' : ''); }
  function filtered() {
    const term = q.value.trim().toLowerCase();
    let rows = defs.filter(d => state[d.id] && (cat === 'all' || (cat === 'watch' ? watch.includes(d.id) : d.cat === cat)) && (!term || d.name.toLowerCase().includes(term) || d.sym.toLowerCase().includes(term)));
    const s = sortSel.value;
    if (s === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
    else if (s === 'up') rows.sort((a, b) => state[b.id].chg - state[a.id].chg);
    else if (s === 'down') rows.sort((a, b) => state[a.id].chg - state[b.id].chg);
    return rows;
  }
  function render() {
    const rows = filtered();
    if (!rows.length) {
      const w = cat === 'watch' && !q.value;
      grid.innerHTML = '<div class="state-box"><h3>' + t(w ? 'market.watch.empty.t' : 'market.empty.t') + '</h3><p>' + t(w ? 'market.watch.empty.d' : 'market.empty.d') + '</p></div>'; return;
    }
    grid.innerHTML = rows.map(d => {
      const s = state[d.id], up = s.chg >= 0, on = watch.includes(d.id);
      return '<div class="mk-card" role="group" data-id="' + d.id + '" aria-label="' + esc(d.name) + '">' +
        '<div class="mk-top"><div><button type="button" class="mk-name mk-open">' + esc(d.name) + '</button><div class="mk-sym">' + esc(d.sym) + '</div></div>' +
        '<button class="star" data-star="' + d.id + '" aria-pressed="' + on + '" aria-label="' + esc(t(on ? 'market.unwatch' : 'market.watch')) + '"><svg viewBox="0 0 24 24"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg></button></div>' +
        '<div class="mk-mid"><div><div class="mk-price">' + priceHtml(d, s) + '</div><div class="mk-chg ' + (up ? 'up' : 'down') + '">' + (up ? '▲' : '▼') + ' ' + (up ? '+' : '') + CT.fmt(s.chg) + '%</div></div><svg class="mk-spark" data-spark="' + d.id + '" aria-hidden="true"></svg></div>' +
        '<div class="mk-foot">' + badge(s) + '<span class="mk-sym">' + t('market.cat.' + d.cat) + '</span></div></div>';
    }).join('');
    rows.forEach(d => { const sv = grid.querySelector('[data-spark="' + d.id + '"]'); if (sv) CTCharts.spark(sv, state[d.id].spark, state[d.id].chg >= 0); });
  }
  function renderChips() {
    chipsBox.innerHTML = CATS.map(c => '<button class="chip" aria-pressed="' + (c === cat) + '" data-cat="' + c + '">' + t('market.cat.' + c) + (c === 'watch' ? ' (' + watch.length + ')' : '') + '</button>').join('');
  }
  function renderNotice() {
    const n = doc.getElementById('mk-notice'); if (!n) return;
    const list = [...notices]; n.hidden = !list.length;
    if (list.length) n.querySelector('span').textContent = t('market.err.notice');
  }
  function skeleton() { grid.innerHTML = Array.from({ length: 9 }, () => '<div class="skeleton sk-card"></div>').join(''); }

  /* ----- detail modal ----- */
  async function openDetail(id, push) {
    const d = defs.find(x => x.id === id), s = state[id]; if (!d || !s) return;
    lastFocus = doc.activeElement;
    const up = s.chg >= 0;
    const tfs = d.src === 'binance' ? '<div class="toggles" role="group" aria-label="timeframe">' + ['15m', '1h', '4h', '1d'].map(x => '<button class="chip btn-sm" data-tf="' + x + '" aria-pressed="' + (x === '1h') + '">' + x.toUpperCase() + '</button>').join('') + '</div>' : '';
    const stat = (k, v) => '<div class="stat"><small>' + t(k) + '</small><b>' + v + '</b></div>';
    const dec = s.status === 'demo' ? 2 : d.dec;
    modalBody.innerHTML = '<div class="modal-head"><div><h2 id="mk-title" style="font-size:var(--fs-2xl)">' + esc(d.name) + '</h2><div class="mk-sym" style="margin-top:4px">' + esc(d.sym) + ' · ' + t('market.cat.' + d.cat) + '</div></div><button class="modal-close" data-close aria-label="' + esc(t('common.close')) + '">×</button></div>' +
      '<div class="modal-body"><div style="display:flex;gap:14px;align-items:baseline;flex-wrap:wrap"><span class="mk-price" style="font-size:var(--fs-3xl)">' + priceHtml(d, s) + '</span><span class="mk-chg ' + (up ? 'up' : 'down') + '">' + (up ? '+' : '') + CT.fmt(s.chg) + '%</span>' + badge(s) + '</div>' +
      tfs + '<div class="detail-chart"><canvas id="mk-detail-canvas" role="img" aria-label="' + esc(d.name) + '"></canvas></div>' +
      '<div class="stats">' + stat(s.status === 'demo' ? 'stat.hi' : (d.src === 'fx' ? 'stat.hi30' : 'stat.hi24'), fmtP(s.hi, dec)) + stat(s.status === 'demo' ? 'stat.lo' : (d.src === 'fx' ? 'stat.lo30' : 'stat.lo24'), fmtP(s.lo, dec)) + (s.vol ? stat('stat.vol24', CT.fmtInt(s.vol) + ' USDT') : '') + (s.date ? stat('stat.date', s.date) : '') + '</div>' +
      '<div class="notice ' + (s.status === 'demo' ? '' : 'info') + '"><span>' + t(s.status === 'demo' ? 'market.src.demo' : d.src === 'fx' ? 'market.src.fx' : 'market.src.binance') + (s.status === 'demo' ? ' ' + t('market.index') : '') + '</span></div>' +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center"><a class="btn btn-primary" href="' + esc(cfg.appUrl || 'app/index.html') + '">' + t('market.open') + '</a><span class="calc-note">' + t('risk.short') + '</span></div></div>';
    overlay.classList.add('open'); overlay.setAttribute('aria-hidden', 'false'); doc.body.style.overflow = 'hidden';
    if (push !== false) history.replaceState(null, '', '#' + id);
    const cv = doc.getElementById('mk-detail-canvas');
    detailChart = new CTCharts.Chart(cv, { mode: 'candles', ema: d.src !== 'fx', decimals: dec });
    const line = arr => arr.map(v => ({ o: v, h: v, l: v, c: v, v: 0 }));
    if (s.status === 'demo') detailChart.set(s.candles || CTCharts.simCandles(d.seed || hashSeed(d.id), 120, 100, 1.4, .02));
    else if (d.src === 'fx') { detailChart.o.mode = 'line'; detailChart.set(line(s.spark)); }
    else {
      const load = async iv => { try { const k = await getJSON(P.crypto + '/klines?symbol=' + d.bn + '&interval=' + iv + '&limit=150'); detailChart.set(k.map(c => ({ o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }))); } catch (e) { cv.parentElement.insertAdjacentHTML('beforeend', '<div class="state-box" style="position:absolute;inset:0;display:grid;place-items:center">' + t('common.error') + '</div>'); } };
      load('1h');
      modalBody.querySelectorAll('[data-tf]').forEach(b => b.addEventListener('click', () => { modalBody.querySelectorAll('[data-tf]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); load(b.dataset.tf); }));
    }
    const c = modalBody.querySelector('[data-close]'); if (c) c.focus();
  }
  function closeDetail() {
    overlay.classList.remove('open'); overlay.setAttribute('aria-hidden', 'true'); doc.body.style.overflow = '';
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  /* ----- events ----- */
  grid.addEventListener('click', e => {
    const st = e.target.closest('[data-star]');
    if (st) { e.stopPropagation(); const id = st.dataset.star; watch = watch.includes(id) ? watch.filter(x => x !== id) : watch.concat(id); saveWatch(); CT.toast(t(watch.includes(id) ? 'market.watch.added' : 'market.watch.removed'), 'ok'); renderChips(); render(); return; }
    const card = e.target.closest('.mk-card'); if (card) openDetail(card.dataset.id);
  });
  grid.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('mk-card')) { e.preventDefault(); openDetail(e.target.dataset.id); } });
  chipsBox.addEventListener('click', e => { const b = e.target.closest('[data-cat]'); if (!b) return; cat = b.dataset.cat; renderChips(); render(); });
  q.addEventListener('input', render); sortSel.addEventListener('change', render);
  overlay.addEventListener('click', e => { if (e.target === overlay || e.target.closest('[data-close]')) closeDetail(); });
  doc.addEventListener('keydown', e => { if (e.key === 'Escape' && overlay.classList.contains('open')) closeDetail(); });
  doc.addEventListener('ct:lang', () => { renderChips(); render(); renderNotice(); });

  /* ----- boot ----- */
  async function boot() {
    skeleton(); renderChips();
    try { defs = await getJSON('data/markets.json'); } catch (e) { grid.innerHTML = '<div class="state-box"><h3>' + t('common.error') + '</h3></div>'; return; }
    defs.filter(d => d.src === 'demo').forEach(demo);
    await Promise.all([loadCrypto(), loadFx()]);
    render(); renderNotice();
    const stamp = doc.getElementById('mk-updated'); if (stamp) stamp.textContent = t('market.updated', { time: new Date().toLocaleTimeString(CT.lang === 'hu' ? 'hu-HU' : CT.lang === 'de' ? 'de-DE' : 'en-GB') });
    if (location.hash.length > 1) openDetail(decodeURIComponent(location.hash.slice(1)), false);
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(async () => { if (doc.hidden || overlay.classList.contains('open')) return; notices.clear(); await loadCrypto(); render(); renderNotice(); }, 45000);
  }
  boot();
})();
