/* Motion layer: scroll progress, word-reveal headline, spotlight cards, tilt, parallax, magnetic buttons, sticky story, ticking demo chips.
   All effects are disabled with prefers-reduced-motion. Purely decorative: no content depends on it. */
(function () {
  'use strict';
  const doc = document, reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
  const raf = fn => requestAnimationFrame(fn);

  /* scroll progress bar */
  const bar = doc.createElement('div'); bar.className = 'scroll-progress'; bar.setAttribute('aria-hidden', 'true'); doc.body.appendChild(bar);
  let ticking = false;
  const onScroll = () => { if (ticking) return; ticking = true; raf(() => {
    const h = doc.documentElement.scrollHeight - innerHeight; bar.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, scrollY / h) : 0) + ')';
    if (!reduce) doc.querySelectorAll('[data-par]').forEach(el => { const r = el.getBoundingClientRect(); if (r.bottom < -200 || r.top > innerHeight + 200) return; el.style.setProperty('--py', ((r.top + r.height / 2 - innerHeight / 2) * parseFloat(el.dataset.par)).toFixed(1) + 'px'); });
    const bg = doc.getElementById('hero-bg'); if (bg && !reduce) bg.style.transform = 'translateY(' + Math.min(scrollY, 900) * .25 + 'px)';
    ticking = false; }); };
  addEventListener('scroll', onScroll, { passive: true }); onScroll();
  if (reduce) return;

  /* hero cursor glow + ticker speed-up on scroll */
  const hero = doc.querySelector('.hero-c');
  if (hero && fine) { const g = doc.createElement('div'); g.className = 'hero-glow'; g.setAttribute('aria-hidden', 'true'); hero.appendChild(g);
    hero.addEventListener('pointermove', e => { const r = hero.getBoundingClientRect(); g.style.setProperty('--gx', (e.clientX - r.left) + 'px'); g.style.setProperty('--gy', (e.clientY - r.top) + 'px'); }); }
  const tt = doc.querySelector('.ticker-track'); let lastY = scrollY, sp = 1;
  if (tt && tt.getAnimations) { addEventListener('scroll', () => { const d = Math.abs(scrollY - lastY); lastY = scrollY; sp = Math.min(4, 1 + d / 40); tt.getAnimations().forEach(a => a.playbackRate = sp); }, { passive: true });
    setInterval(() => { if (sp > 1) { sp = Math.max(1, sp - .25); tt.getAnimations().forEach(a => a.playbackRate = sp); } }, 120); }

  /* word-by-word headline reveal */
  function splitHero() {
    const h = doc.querySelector('.hero-c h1 > span'); if (!h || h.dataset.split === h.textContent) return;
    const txt = h.textContent; h.setAttribute('aria-label', txt);
    h.innerHTML = txt.split(' ').map((w, i) => '<span class="w" aria-hidden="true" style="--i:' + i + '">' + w + '</span>').join(' '); h.dataset.split = txt;
  }
  splitHero(); addEventListener('ct:lang', () => setTimeout(splitHero, 30));

  /* stagger children of grids */
  doc.querySelectorAll('.grid, .steps, .catgrid, .facts').forEach(g => [...g.children].forEach((c, i) => c.style.transitionDelay = (i * 80) + 'ms'));

  if (fine) {
    /* spotlight + tilt */
    doc.querySelectorAll('.card, .step, .catcard, .panel, .story-step').forEach(el => {
      el.classList.add('spot');
      el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', (e.clientX - r.left) + 'px'); el.style.setProperty('--my', (e.clientY - r.top) + 'px'); });
    });
    doc.querySelectorAll('.prodcard, .browser').forEach(el => {
      el.addEventListener('pointermove', e => { const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5; el.style.transform = 'perspective(1100px) rotateX(' + (-y * 5).toFixed(2) + 'deg) rotateY(' + (x * 6).toFixed(2) + 'deg) translateY(-4px)'; });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
    /* magnetic primary buttons */
    doc.querySelectorAll('.hero-c .btn, .cta-band .btn, .sticky-cta').forEach(b => {
      b.addEventListener('pointermove', e => { const r = b.getBoundingClientRect(); b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * .15).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * .25).toFixed(1) + 'px)'; });
      b.addEventListener('pointerleave', () => { b.style.transform = ''; });
    });
  }

  /* sticky story: switch phone screen by the step nearest to the viewport centre */
  const steps = [...doc.querySelectorAll('.story-step')], imgs = [...doc.querySelectorAll('.story-phone img')];
  if (steps.length && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(es => es.forEach(e => { if (!e.isIntersecting) return; const i = +e.target.dataset.step;
      steps.forEach(s => s.classList.toggle('on', +s.dataset.step === i)); imgs.forEach(m => m.classList.toggle('on', +m.dataset.scr === i)); }), { rootMargin: '-45% 0px -45% 0px' });
    steps.forEach(s => io.observe(s));
  }

  /* ticking DEMO chips (simulated random walk, clearly labelled DEMO in the markup) */
  const bal = doc.getElementById('chip-bal'), pnl = doc.getElementById('chip-pnl');
  if (bal && pnl) { let v = 0, b0 = 100000;
    setInterval(() => { if (doc.hidden) return; v += (Math.random() - .46) * .12; b0 = 100000 * (1 + v / 100 * .1);
      bal.textContent = '$' + Math.round(b0).toLocaleString((window.CT && CT.lang === 'en') ? 'en-US' : 'hu-HU'); pnl.textContent = (v >= 0 ? '+' : '') + v.toFixed(2).replace('.', (window.CT && CT.lang === 'en') ? '.' : ',') + '%'; pnl.className = 'num ' + (v >= 0 ? 'up' : 'down'); }, 1600); }
})();
