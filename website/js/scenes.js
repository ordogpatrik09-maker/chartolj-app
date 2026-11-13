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
  /* dotted globe */
  const cv = doc.getElementById('globe'); if (!cv) return;
  const ctx = cv.getContext('2d'); let W = 0, rot = 0, vis = false, pts = [];
  const N = 16000, ga = Math.PI * (3 - Math.sqrt(5));
  const land = (la, lo) => Math.sin(lo * 2.1 + 1) * Math.cos(la * 3) + Math.sin(lo * 4.3 - la * 2) * .5 + Math.cos(lo * 7 + la * 5) * .3 > -.1;
  for (let i = 0; i < N; i++) { const y = 1 - 2 * (i + .5) / N, r = Math.sqrt(1 - y * y), th = i * ga, la = Math.asin(y), lo = th % (2 * Math.PI) - Math.PI; if (land(la, lo)) pts.push([Math.cos(th) * r, y, Math.sin(th) * r]); }
  function size() { const d = Math.min(devicePixelRatio || 1, 2), r = cv.getBoundingClientRect(); W = Math.round(r.width * d); cv.width = W; cv.height = W; }
  function draw() {
    ctx.clearRect(0, 0, W, W); const R = W * .38, cx = W / 2, cy = W * .43, c = Math.cos(rot), s = Math.sin(rot);
    const g = ctx.createRadialGradient(cx, cy, R * .95, cx, cy, R * 1.05); g.addColorStop(0, 'rgba(47,107,255,0)'); g.addColorStop(.93, 'rgba(47,107,255,.35)'); g.addColorStop(.965, 'rgba(127,176,255,.7)'); g.addColorStop(1, 'rgba(47,107,255,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R * 1.05, 0, 7); ctx.fill();
    ctx.fillStyle = '#04060a'; ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
    for (const p of pts) { const x = p[0] * c + p[2] * s, z = -p[0] * s + p[2] * c; if (z < -.05) continue; const lit = Math.max(0, (-x * .45 + p[1] * .5 + z * .6)); const a = .18 + .82 * Math.min(1, lit + .1);
      ctx.fillStyle = 'rgba(' + (127 + lit * 54 | 0) + ',' + (lit * 140 | 0) + ',' + (255) + ',' + a.toFixed(2) + ')'; ctx.fillRect(cx + x * R, cy - p[1] * R, W / 900 * (.8 + z), W / 900 * (.8 + z)); }
  }
  size(); addEventListener('resize', size);
  new IntersectionObserver(e => { vis = e[0].isIntersecting; }, { rootMargin: '100px' }).observe(cv);
  (function loop() { if (vis) { if (!reduce) rot += .0028; draw(); } requestAnimationFrame(loop); })(); draw();
})();

/* spotlight hover on bento tiles */
(function () {
  document.querySelectorAll('[data-spot]').forEach(function (el) {
    el.addEventListener('pointermove', function (e) { var r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
  });
})();
