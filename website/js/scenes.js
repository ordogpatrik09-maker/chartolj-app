/* Cinematic scenes: dotted globe, scroll-lit statement lines, bar reveal. Decorative only; respects prefers-reduced-motion. */
(function () {
  'use strict';
  const doc = document, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /* bars + lit lines */
  const sc = doc.querySelector('.scene-bars'), lines = [...doc.querySelectorAll('#litlines p')], bars = sc ? [...sc.querySelectorAll('.bars i')] : [];
  if (sc && reduce) lines.forEach(l => l.classList.add('on'));
  else if (sc) {
    const upd = () => { const r = sc.getBoundingClientRect(), total = r.height - innerHeight; const p = Math.max(0, Math.min(1, -r.top / total));
      const idx = p < .12 ? -1 : p < .38 ? 0 : p < .62 ? 1 : 2;
      lines.forEach((l, i) => { l.classList.toggle('on', i === idx); l.classList.toggle('past', i < idx); });
      const n = bars.length; bars.forEach((b, i) => { const wave = (Math.sin(i * .9 + p * 7) * .5 + .5) * .35; const grow = Math.max(0, Math.min(1, (p * 1.25 - (i / n) * .35) * 1.6)); b.style.transform = 'scaleY(' + (grow * (.65 + wave)).toFixed(3) + ')'; }); };
    addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); upd();
  }

  /* hero terminal: simulated candles (DEMO), mouse-tilt depth */
  const hc = doc.getElementById('hx-chart');
  if (hc) {
    const x = hc.getContext('2d'); let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const N = 54, cs = []; let pr = 100; for (let i = 0; i < N; i++) { const o = pr, c = o + (rnd() - .44) * 3.2 + .12, h = Math.max(o, c) + rnd() * 1.6, l = Math.min(o, c) - rnd() * 1.6; cs.push([o, h, l, c]); pr = c; }
    let shown = reduce ? N : 0, W = 0, H = 0, vis = true, t0 = 0, bal = 10000;
    const fit = () => { const d = Math.min(devicePixelRatio || 1, 2), r = hc.getBoundingClientRect(); W = r.width; H = r.height; hc.width = W * d; hc.height = H * d; x.setTransform(d, 0, 0, d, 0, 0); };
    const render = () => {
      x.clearRect(0, 0, W, H); const hi = Math.max(...cs.map(c => c[1])), lo = Math.min(...cs.map(c => c[2])), pad = 18, py = v => pad + (hi - v) / (hi - lo) * (H - pad * 2), bw = W / N;
      x.strokeStyle = 'rgba(255,255,255,.05)'; x.lineWidth = 1; for (let g = 1; g < 5; g++) { const y = H / 5 * g; x.beginPath(); x.moveTo(0, y); x.lineTo(W, y); x.stroke(); }
      const n = Math.floor(shown);
      for (let i = 0; i < n; i++) { const [o, h, l, c] = cs[i], up = c >= o, cx = i * bw + bw / 2; x.strokeStyle = x.fillStyle = up ? '#00F5A0' : '#FF3864'; x.beginPath(); x.moveTo(cx, py(h)); x.lineTo(cx, py(l)); x.stroke(); x.fillRect(cx - bw * .3, Math.min(py(o), py(c)), bw * .6, Math.max(2, Math.abs(py(o) - py(c)))); }
      const last = cs[Math.max(0, n - 1)][3]; const pe = doc.querySelector('.tf-p'); if (pe) pe.textContent = (last * 3095).toFixed(2).replace('.', ',');
      const pn = doc.getElementById('fc-pnl'), bl = doc.getElementById('fc-bal'); const pl = (last - 100) * 12; if (pn) { pn.textContent = (pl >= 0 ? '+' : '') + pl.toFixed(2).replace('.', ','); pn.className = 'num ' + (pl >= 0 ? 'up' : 'down'); } if (bl) bl.textContent = (bal + pl).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    };
    fit(); addEventListener('resize', () => { fit(); render(); });
    new IntersectionObserver(e => { vis = e[0].isIntersecting; }, { threshold: .05 }).observe(hc);
    (function loop(ts) { if (vis && !reduce) { if (shown < N) shown = Math.min(N, shown + .45); else { const k = cs[N - 1]; k[3] += (rnd() - .5) * .08; k[1] = Math.max(k[1], k[3]); k[2] = Math.min(k[2], k[3]); } render(); } requestAnimationFrame(loop); })(); render();
    const term = doc.getElementById('term');
    if (term && !reduce && matchMedia('(min-width: 980px)').matches) { const st = term.parentElement; st.addEventListener('pointermove', e => { const r = st.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - .5, py2 = (e.clientY - r.top) / r.height - .5; term.style.transform = 'rotateY(' + (-9 + px * 8) + 'deg) rotateX(' + (5 - py2 * 6) + 'deg)'; }); st.addEventListener('pointerleave', () => { term.style.transform = ''; }); }
  }
  /* dotted globe */
  const cv = doc.getElementById('globe'); if (!cv) return;
  const ctx = cv.getContext('2d'); let W = 0, rot = 0, vis = false, pts = [];
  const N = 16000, ga = Math.PI * (3 - Math.sqrt(5));
  const land = (la, lo) => Math.sin(lo * 2.1 + 1) * Math.cos(la * 3) + Math.sin(lo * 4.3 - la * 2) * .5 + Math.cos(lo * 7 + la * 5) * .3 > -.1;
  for (let i = 0; i < N; i++) { const y = 1 - 2 * (i + .5) / N, r = Math.sqrt(1 - y * y), th = i * ga, la = Math.asin(y), lo = th % (2 * Math.PI) - Math.PI; if (land(la, lo)) pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
  function size() { const d = Math.min(devicePixelRatio || 1, 2), r = cv.getBoundingClientRect(); W = Math.round(r.width * d); cv.width = W; cv.height = W; }
  function draw() {
    ctx.clearRect(0, 0, W, W); const R = W * .38, cx = W / 2, cy = W * .43, c = Math.cos(rot), s = Math.sin(rot);
    const g = ctx.createRadialGradient(cx, cy, R * .95, cx, cy, R * 1.05); g.addColorStop(0, 'rgba(127,0,255,0)'); g.addColorStop(.93, 'rgba(127,0,255,.35)'); g.addColorStop(.965, 'rgba(168,85,247,.7)'); g.addColorStop(1, 'rgba(127,0,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, 7); ctx.fill();
    ctx.fillStyle = '#04060a'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    for (const p of pts) { const x = p[0] * c + p[2] * s, z = -p[0] * s + p[2] * c; if (z < -.05) continue; const lit = Math.max(0, (-x * .45 + p[1] * .5 + z * .6)); const a = .18 + .82 * Math.min(1, lit + .1);
      ctx.fillStyle = 'rgba(' + (127 - lit * 127 | 0) + ',' + (110 + lit * 135 | 0) + ',' + (255 - lit * 95 | 0) + ',' + a.toFixed(2) + ')'; ctx.fillRect(cx + x * R, cy - p[1] * R, W / 900 * (.8 + z), W / 900 * (.8 + z)); }
  }
  size(); addEventListener('resize', size);
  new IntersectionObserver(e => { vis = e[0].isIntersecting; }, { rootMargin: '100px' }).observe(cv);
  (function loop() { if (vis) { if (!reduce) rot += .0028; draw(); } requestAnimationFrame(loop); })(); draw();
})();
