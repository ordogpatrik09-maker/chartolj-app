/* Chartolj! – lightweight canvas chart engine (candles / line, EMA, Bollinger, RSI, MACD, volume)
   + sparkline helper. Data passed in is either real (Binance klines) or clearly labelled simulated. */
(function () {
  'use strict';
  const C = { up: '#00F5A0', down: '#A0AAB8', grid: 'rgba(255,255,255,.055)', text: '#66727F', ema: '#B58CFF', ema2: '#A0AAB8', bb: 'rgba(245,247,250,.85)', bbFill: 'rgba(0,245,160,.07)', macd: '#A0AAB8', sig: '#F5F7FA', rsi: '#A55CFF' };

  const fp = (v, d) => (window.CT && CT.fmt ? CT.fmt(v, d) : v.toFixed(d));
  function rng(seed) { // mulberry32
    let a = seed >>> 0;
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  /* Deterministic simulated candles (index-based, NOT a real instrument) */
  function simCandles(seed, n, start, vol, drift) {
    const r = rng(seed); const out = []; let p = start || 100;
    let regime = 0;
    for (let i = 0; i < n; i++) {
      if (i % 28 === 0) regime = (r() - .5) * 2;
      const o = p;
      const mv = ((r() - .5) * (vol || 1.6) + (drift || 0) + regime * .12);
      const c = Math.max(1, o + mv);
      const hi = Math.max(o, c) + r() * (vol || 1.6) * .55;
      const lo = Math.min(o, c) - r() * (vol || 1.6) * .55;
      out.push({ o, h: hi, l: Math.max(.5, lo), c, v: 40 + r() * 100 + Math.abs(mv) * 30 });
      p = c;
    }
    return out;
  }

  function Chart(canvas, opts) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.o = Object.assign({ mode: 'candles', ema: false, bb: false, rsi: false, macd: false, vol: false, decimals: 2, pad: 8 }, opts || {});
    this.data = []; this.w = 0; this.h = 0;
    const self = this;
    if (typeof ResizeObserver !== 'undefined') { this.ro = new ResizeObserver(() => self.resize()); this.ro.observe(canvas.parentElement || canvas); }
    this.resize();
  }
  Chart.prototype.resize = function () {
    const p = this.cv.parentElement || this.cv; const r = p.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = Math.max(10, Math.floor(r.width)); this.h = Math.max(10, Math.floor(r.height));
    this.cv.width = this.w * dpr; this.cv.height = this.h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  };
  Chart.prototype.set = function (data) { this.data = data; this.draw(); };
  Chart.prototype.opt = function (k, v) { this.o[k] = v; this.draw(); };

  Chart.prototype.draw = function () {
    const ctx = this.ctx, W = this.w, H = this.h, d = this.data, o = this.o;
    ctx.clearRect(0, 0, W, H);
    if (!d.length) return;
    const M = window.CTMath;
    const closes = d.map(x => x.c);
    ctx.font = '10px "JetBrains Mono", monospace';
    const axisW = Math.max(52, Math.ceil(Math.max(ctx.measureText(fp(Math.max.apply(null, d.slice(-120).map(x => x.h)), o.decimals)).width, ctx.measureText(fp(Math.min.apply(null, d.slice(-120).map(x => x.l)), o.decimals)).width)) + 16), padT = 10, padB = 6;
    const subs = [o.vol && 'vol', o.rsi && 'rsi', o.macd && 'macd'].filter(Boolean);
    const subH = subs.length ? Math.min(70, Math.floor((H - padT - padB) * (subs.length === 1 ? .26 : .22))) : 0;
    const mainH = H - padT - padB - subH * subs.length - (subs.length ? 6 * subs.length : 0);
    const plotW = W - axisW;
    const visible = Math.max(20, Math.min(d.length, Math.floor(plotW / 7)));
    const start = d.length - visible;
    const slice = d.slice(start);
    const step = plotW / visible, bw = Math.max(1.5, step * .66);

    // overlays
    const ema20 = o.ema ? M.ema(closes, 20) : null, ema50 = o.ema ? M.ema(closes, 50) : null;
    const bb = o.bb ? M.bollinger(closes, 20, 2) : null;
    let lo = Infinity, hi = -Infinity;
    slice.forEach((c, i) => { lo = Math.min(lo, c.l); hi = Math.max(hi, c.h); if (bb && bb[start + i]) { lo = Math.min(lo, bb[start + i].lo); hi = Math.max(hi, bb[start + i].up); } });
    const padP = (hi - lo) * .06 || 1; lo -= padP; hi += padP;
    const y = v => padT + (hi - v) / (hi - lo) * mainH;
    const x = i => i * step + step / 2;

    // grid + axis
    ctx.font = '10px "JetBrains Mono", monospace'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.text; ctx.strokeStyle = C.grid; ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const v = lo + (hi - lo) * g / 4, yy = Math.round(y(v)) + .5;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(plotW, yy); ctx.stroke();
      ctx.fillText(fp(v, o.decimals), plotW + 6, yy);
    }
    // bollinger
    if (bb) {
      ctx.beginPath();
      slice.forEach((_, i) => { const b = bb[start + i]; if (!b) return; ctx[i === 0 || !bb[start + i - 1] ? 'moveTo' : 'lineTo'](x(i), y(b.up)); });
      for (let i = slice.length - 1; i >= 0; i--) { const b = bb[start + i]; if (b) ctx.lineTo(x(i), y(b.lo)); }
      ctx.closePath(); ctx.fillStyle = C.bbFill; ctx.fill();
      ['up', 'lo', 'mid'].forEach(k => { ctx.beginPath(); let s = false; slice.forEach((_, i) => { const b = bb[start + i]; if (!b) return; ctx[s ? 'lineTo' : 'moveTo'](x(i), y(b[k])); s = true; }); ctx.strokeStyle = k === 'mid' ? 'rgba(245,247,250,.4)' : C.bb; ctx.lineWidth = 1; ctx.stroke(); });
    }
    // series
    if (o.mode === 'line') {
      ctx.beginPath(); slice.forEach((c, i) => ctx[i ? 'lineTo' : 'moveTo'](x(i), y(c.c)));
      const up = slice[slice.length - 1].c >= slice[0].c; ctx.strokeStyle = up ? C.up : C.down; ctx.lineWidth = 1.8; ctx.stroke();
      ctx.lineTo(x(slice.length - 1), padT + mainH); ctx.lineTo(x(0), padT + mainH); ctx.closePath();
      const g = ctx.createLinearGradient(0, padT, 0, padT + mainH); g.addColorStop(0, up ? 'rgba(0,245,160,.22)' : 'rgba(160,170,184,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fill();
    } else {
      slice.forEach((c, i) => {
        const col = c.c >= c.o ? C.up : C.down; ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(Math.round(x(i)) + .5, y(c.h)); ctx.lineTo(Math.round(x(i)) + .5, y(c.l)); ctx.stroke();
        const top = y(Math.max(c.o, c.c)), hh = Math.max(1, Math.abs(y(c.o) - y(c.c)));
        ctx.fillRect(x(i) - bw / 2, top, bw, hh);
      });
    }
    // EMAs
    [[ema20, C.ema], [ema50, C.ema2]].forEach(([arr, col]) => {
      if (!arr) return; ctx.beginPath(); let s = false;
      slice.forEach((_, i) => { const v = arr[start + i]; if (v == null) return; ctx[s ? 'lineTo' : 'moveTo'](x(i), y(v)); s = true; });
      ctx.strokeStyle = col; ctx.lineWidth = 1.3; ctx.stroke();
    });
    // last price tag
    const last = slice[slice.length - 1].c, ly = Math.round(y(last)) + .5, lc = last >= slice[slice.length - 1].o ? C.up : C.down;
    ctx.setLineDash([3, 3]); ctx.strokeStyle = lc; ctx.globalAlpha = .6; ctx.beginPath(); ctx.moveTo(0, ly); ctx.lineTo(plotW, ly); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = lc; ctx.fillRect(plotW + 1, ly - 9, axisW - 2, 18); ctx.fillStyle = '#04110c'; ctx.font = 'bold 10px "JetBrains Mono", monospace'; ctx.fillText(fp(last, o.decimals), plotW + 5, ly);

    // sub panels
    let top = padT + mainH + 6;
    const label = (t, yy) => { ctx.font = 'bold 9px "JetBrains Mono", monospace'; ctx.fillStyle = C.text; ctx.textBaseline = 'top'; ctx.fillText(t, 4, yy + 2); ctx.textBaseline = 'middle'; };
    subs.forEach(kind => {
      ctx.strokeStyle = C.grid; ctx.lineWidth = 1; ctx.strokeRect(.5, top + .5, plotW - 1, subH - 1);
      if (kind === 'vol') {
        const mx = Math.max.apply(null, slice.map(c => c.v || 0)) || 1;
        slice.forEach((c, i) => { ctx.fillStyle = c.c >= c.o ? 'rgba(0,245,160,.45)' : 'rgba(160,170,184,.45)'; const hh = (c.v || 0) / mx * (subH - 6); ctx.fillRect(x(i) - bw / 2, top + subH - hh - 2, bw, hh); });
        label('VOL', top);
      } else if (kind === 'rsi') {
        const r = M.rsi(closes, 14); const ry = v => top + (100 - v) / 100 * subH;
        ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.setLineDash([2, 3]); [30, 70].forEach(l => { ctx.beginPath(); ctx.moveTo(0, ry(l)); ctx.lineTo(plotW, ry(l)); ctx.stroke(); }); ctx.setLineDash([]);
        ctx.beginPath(); let s = false; slice.forEach((_, i) => { const v = r[start + i]; if (v == null) return; ctx[s ? 'lineTo' : 'moveTo'](x(i), ry(v)); s = true; }); ctx.strokeStyle = C.rsi; ctx.lineWidth = 1.4; ctx.stroke();
        const lv = r[r.length - 1]; label('RSI 14' + (lv != null ? '  ' + fp(lv, 1) : ''), top);
      } else if (kind === 'macd') {
        const m = M.macd(closes); const vals = slice.map((_, i) => [m.line[start + i], m.signal[start + i], m.hist[start + i]]);
        const ext = Math.max.apply(null, vals.flat().map(Math.abs)) || 1; const my = v => top + subH / 2 - v / ext * (subH / 2 - 4);
        vals.forEach((v, i) => { ctx.fillStyle = v[2] >= 0 ? 'rgba(0,245,160,.5)' : 'rgba(160,170,184,.5)'; const y0 = my(0), y1 = my(v[2]); ctx.fillRect(x(i) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0))); });
        [[0, C.macd], [1, C.sig]].forEach(([k, col]) => { ctx.beginPath(); vals.forEach((v, i) => ctx[i ? 'lineTo' : 'moveTo'](x(i), my(v[k]))); ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.stroke(); });
        label('MACD 12·26·9', top);
      }
      top += subH + 6;
    });
  };

  /* Sparkline into an <svg>. values: number[] */
  function spark(svg, values, up) {
    const w = 96, h = 34; if (!values || values.length < 2) { svg.innerHTML = ''; return; }
    const mn = Math.min.apply(null, values), mx = Math.max.apply(null, values), rg = (mx - mn) || 1;
    const pts = values.map((v, i) => [i / (values.length - 1) * w, h - 3 - (v - mn) / rg * (h - 6)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('');
    const col = up ? C.up : C.down;
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.innerHTML = '<path d="' + d + 'L' + w + ' ' + h + 'L0 ' + h + 'Z" fill="' + col + '" opacity=".12"/><path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>';
  }

  window.CTCharts = { Chart, simCandles, spark, rng };
})();
