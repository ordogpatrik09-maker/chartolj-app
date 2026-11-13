/* Chartolj! website - "Próbáld ki" interactive scenario. Deterministic SIMULATED candles; not a prediction, not advice. */
(function () {
  'use strict';
  const N_HIST = 48, N_FUT = 14;
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  /* anchor paths (index -> level); the future part is scripted so each scenario teaches one idea */
  const SCN = [
    { id: 's1', seed: 11, noise: .35, pts: [[0, 100], [20, 106], [38, 113], [47, 109.6], [61, 119]] },
    { id: 's2', seed: 5, noise: .3, range: [100, 1.6, 47], pts: [[0, 100], [44, 100], [47, 104.2], [51, 102], [61, 97]] },
    { id: 's3', seed: 2, noise: .3, range: [100, 1.6, 61], pts: [[0, 100], [61, 100]] }
  ];
  function build(i) {
    const S = SCN[i % SCN.length], r = rng(S.seed), n = N_HIST + N_FUT, close = [];
    for (let k = 0; k < n; k++) {
      let v = S.pts[0][1];
      for (let j = 1; j < S.pts.length; j++) { const a = S.pts[j - 1], b = S.pts[j]; if (k >= a[0] && k <= b[0]) { v = a[1] + (b[1] - a[1]) * (k - a[0]) / (b[0] - a[0]); break; } }
      if (S.range && k < S.range[2]) v += Math.sin(k * 0.62 + S.seed) * S.range[1];
      else if (S.range) v += Math.sin(k * 0.62 + S.seed) * S.range[1] * .6;
      close.push(v + (r() - .5) * 2 * S.noise);
    }
    const c = [];
    for (let k = 0; k < n; k++) {
      const o = k ? close[k - 1] : close[0] - .2, cl = close[k], w = .25 + r() * .55;
      c.push({ o, c: cl, h: Math.max(o, cl) + r() * w, l: Math.min(o, cl) - r() * w });
    }
    let atr = 0; for (let k = N_HIST - 14; k < N_HIST; k++) atr += c[k].h - c[k].l; atr /= 14;
    return { id: S.id, c, atr, entry: c[N_HIST - 1].c };
  }
  /* returns { r, state: 'stop'|'target'|'open'|'none', at } measured in R (1R = 1 ATR) */
  function evalTrade(sc, side) {
    if (side === 'wait') return { r: 0, state: 'none', at: -1 };
    const d = side === 'long' ? 1 : -1, stop = sc.entry - d * sc.atr, tgt = sc.entry + d * 2 * sc.atr;
    for (let k = N_HIST; k < sc.c.length; k++) {
      const b = sc.c[k], hitS = d > 0 ? b.l <= stop : b.h >= stop, hitT = d > 0 ? b.h >= tgt : b.l <= tgt;
      if (hitS) return { r: -1, state: 'stop', at: k, stop, tgt };
      if (hitT) return { r: 2, state: 'target', at: k, stop, tgt };
    }
    const last = sc.c[sc.c.length - 1].c;
    return { r: d * (last - sc.entry) / sc.atr, state: 'open', at: sc.c.length - 1, stop, tgt };
  }
  window.CTScn = { SCN, build, evalTrade, count: SCN.length, N_HIST };

  const root = typeof document !== 'undefined' && document.getElementById('scn');
  if (!root) return;
  const cv = root.querySelector('#scn-canvas'), ctx = cv.getContext('2d');
  const out = root.querySelector('#scn-res'), nameEl = root.querySelector('#scn-name'), ctxEl = root.querySelector('#scn-ctx');
  const btns = [...root.querySelectorAll('[data-pick]')];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const T = (k, v) => (window.CT ? CT.t(k, v) : k);
  let idx = 0, sc = build(0), shown = N_HIST, pick = null, res = null, timer = null, W = 0, H = 0, dpr = 1;

  function size() {
    dpr = Math.min(2, devicePixelRatio || 1); const b = cv.getBoundingClientRect();
    W = b.width; H = b.height; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); draw();
  }
  function draw() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const n = N_HIST + N_FUT, padR = 46, padT = 14, padB = 14, cw = (W - padR) / n;
    let lo = Infinity, hi = -Infinity;
    sc.c.forEach(b => { lo = Math.min(lo, b.l); hi = Math.max(hi, b.h); });
    if (res && res.stop) { lo = Math.min(lo, res.stop, res.tgt); hi = Math.max(hi, res.stop, res.tgt); }
    const pad = (hi - lo) * .06; lo -= pad; hi += pad;
    const Y = v => padT + (hi - v) / (hi - lo) * (H - padT - padB);
    ctx.font = '11px "JetBrains Mono Variable", monospace'; ctx.textBaseline = 'middle';
    for (let g = 0; g < 5; g++) { const v = lo + (hi - lo) * g / 4, y = Y(v); ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.fillStyle = '#929BAA'; ctx.fillText(v.toFixed(1), W - padR + 6, y); }
    /* divider between history and the revealed future */
    if (shown > N_HIST) { const x = N_HIST * cw; ctx.setLineDash([3, 4]); ctx.strokeStyle = 'rgba(255,255,255,.18)'; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); ctx.setLineDash([]); }
    const levels = [];
    if (res && res.stop) { levels.push([sc.entry, '#F5F7FA', 'ENTRY'], [res.stop, '#FF3864', 'STOP'], [res.tgt, '#00F5A0', 'TARGET']); }
    levels.forEach(([v, col, lb]) => { const y = Y(v); ctx.strokeStyle = col; ctx.globalAlpha = .75; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W - padR, y); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.fillStyle = col; ctx.fillText(lb, 6, y - 8); });
    for (let k = 0; k < shown; k++) {
      const b = sc.c[k], x = k * cw + cw / 2, up = b.c >= b.o, col = up ? '#00F5A0' : '#FF3864', bw = Math.max(2, cw * .6);
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, Y(b.h)); ctx.lineTo(x, Y(b.l)); ctx.stroke();
      const y1 = Y(Math.max(b.o, b.c)), y2 = Y(Math.min(b.o, b.c)); ctx.fillRect(x - bw / 2, y1, bw, Math.max(1.5, y2 - y1));
    }
  }
  function fmtR(r) { return (r > 0 ? '+' : r < 0 ? '−' : '') + CT.fmt(Math.abs(r), 1) + 'R'; }
  function render() {
    nameEl.textContent = T('sc.' + sc.id + '.n'); ctxEl.textContent = T('sc.' + sc.id + '.ctx');
    if (!pick) { out.hidden = true; out.innerHTML = ''; return; }
    const stKey = { stop: 'sc.res.stop', target: 'sc.res.target', open: 'sc.res.open', none: 'sc.res.none' }[res.state];
    const cls = res.r > 0 ? 'up' : res.r < 0 ? 'down' : '';
    out.hidden = false;
    out.innerHTML = '<div class="scn-r1"><span class="scn-badge ' + cls + '">' + T(stKey) + '</span><b class="num ' + cls + '">' + fmtR(res.r) + '</b></div>' +
      '<h3>' + T('sc.why') + '</h3><p>' + T('sc.' + sc.id + '.' + pick) + '</p>' +
      '<h3>' + T('sc.risk.t') + '</h3><p>' + T('sc.risk.d') + '</p>';
  }
  function reveal() {
    clearInterval(timer);
    if (reduce) { shown = sc.c.length; draw(); render(); return; }
    shown = N_HIST; draw();
    timer = setInterval(() => { shown++; draw(); if (shown >= sc.c.length) { clearInterval(timer); render(); } }, 110);
  }
  function choose(side) {
    if (pick) return; pick = side; res = evalTrade(sc, side);
    btns.forEach(b => { b.setAttribute('aria-pressed', b.dataset.pick === side ? 'true' : 'false'); b.disabled = true; });
    out.hidden = true; reveal();
  }
  function reset(step) {
    clearInterval(timer); if (step) idx = (idx + 1) % SCN.length; sc = build(idx); shown = N_HIST; pick = null; res = null;
    btns.forEach(b => { b.disabled = false; b.setAttribute('aria-pressed', 'false'); });
    render(); draw();
  }
  btns.forEach(b => b.addEventListener('click', () => choose(b.dataset.pick)));
  root.querySelector('[data-scn-next]').addEventListener('click', () => reset(true));
  root.querySelector('[data-scn-again]').addEventListener('click', () => reset(false));
  document.addEventListener('ct:lang', render);
  addEventListener('resize', size);
  size(); render();
})();
