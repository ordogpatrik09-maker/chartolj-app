/* Chartolj! website – shared behaviour: i18n, navigation, reveal, counters, hero terminal, calculators */
(function () {
  'use strict';
  const doc = document, root = doc.documentElement;
  const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LOC = { hu: 'hu-HU', en: 'en-GB', de: 'de-DE' };
  const KEY = 'chartolj_site_lang';

  /* ---------- i18n ---------- */
  const CT = window.CT = {
    lang: 'hu',
    t(key, vars) {
      const L = window.CT_LOCALES || {};
      let s = (L[CT.lang] && L[CT.lang][key]) ?? (L.hu && L.hu[key]) ?? key;
      if (vars) Object.keys(vars).forEach(k => { s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), vars[k]); });
      return s;
    },
    fmt(n, d = 2) { return Number.isFinite(n) ? new Intl.NumberFormat(LOC[CT.lang], { minimumFractionDigits: d, maximumFractionDigits: d }).format(n) : '–'; },
    fmtInt(n) { return CT.fmt(n, 0); },
    setLang(l, silent) {
      if (!['hu', 'en', 'de'].includes(l)) l = 'hu';
      CT.lang = l; root.lang = l;
      try { localStorage.setItem(KEY, l); } catch (e) { /* storage may be blocked */ }
      CT.apply();
      doc.querySelectorAll('.lang-menu button').forEach(b => b.setAttribute('aria-checked', b.dataset.lang === l ? 'true' : 'false'));
      const cur = doc.querySelector('.lang > button .cur'); if (cur) cur.textContent = l.toUpperCase();
      if (!silent) doc.dispatchEvent(new CustomEvent('ct:lang', { detail: l }));
    },
    apply() {
      doc.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = CT.t(el.dataset.i18n, el.dataset.i18nVars ? JSON.parse(el.dataset.i18nVars) : undefined); });
      doc.querySelectorAll('[data-i18n-attr]').forEach(el => {
        el.dataset.i18nAttr.split(';').forEach(pair => { const [a, k] = pair.split(':'); if (a && k) el.setAttribute(a.trim(), CT.t(k.trim())); });
      });
      const p = root.dataset.page;
      if (p) {
        doc.title = CT.t('meta.' + p + '.title');
        const m = doc.querySelector('meta[name="description"]'); if (m) m.content = CT.t('meta.' + p + '.desc');
        ['og:title', 'og:description'].forEach(pr => { const e = doc.querySelector('meta[property="' + pr + '"]'); if (e) e.content = CT.t('meta.' + p + (pr === 'og:title' ? '.title' : '.desc')); });
      }
    },
    toast(msg, type) {
      let box = doc.querySelector('.toasts'); if (!box) { box = doc.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); doc.body.appendChild(box); }
      const t = doc.createElement('div'); t.className = 'toast ' + (type || ''); t.textContent = msg; box.appendChild(t);
      setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 320); }, 3200);
    }
  };

  function initLang() {
    let l = 'hu';
    try { l = localStorage.getItem(KEY) || 'hu'; } catch (e) { /* ignore */ }
    CT.setLang(l, true);
    const wrap = doc.querySelector('.lang'); if (!wrap) return;
    const btn = wrap.querySelector('button');
    btn.addEventListener('click', e => { e.stopPropagation(); const o = wrap.classList.toggle('open'); btn.setAttribute('aria-expanded', o); });
    doc.addEventListener('click', () => { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); });
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') { wrap.classList.remove('open'); btn.setAttribute('aria-expanded', 'false'); } });
    wrap.querySelectorAll('.lang-menu button').forEach(b => b.addEventListener('click', () => { CT.setLang(b.dataset.lang); wrap.classList.remove('open'); }));
  }

  /* ---------- Navigation ---------- */
  function initNav() {
    const nav = doc.querySelector('.nav'); if (!nav) return;
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 8);
    onScroll(); window.addEventListener('scroll', onScroll, { passive: true });
    const burger = doc.querySelector('.burger'), drawer = doc.querySelector('.drawer');
    if (!burger || !drawer) return;
    const set = open => { drawer.classList.toggle('open', open); burger.setAttribute('aria-expanded', open); doc.body.style.overflow = open ? 'hidden' : ''; };
    burger.addEventListener('click', () => set(!drawer.classList.contains('open')));
    drawer.querySelectorAll('a').forEach(a => a.addEventListener('click', () => set(false)));
    doc.addEventListener('keydown', e => { if (e.key === 'Escape') set(false); });
    window.matchMedia('(min-width: 981px)').addEventListener('change', e => { if (e.matches) set(false); });
  }

  /* ---------- Reveal + counters ---------- */
  function initReveal() {
    const els = doc.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window) || reduce) { els.forEach(e => e.classList.add('in')); }
    else {
      const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
      els.forEach(e => io.observe(e));
    }
    const cs = doc.querySelectorAll('[data-count]');
    const run = el => {
      const to = +el.dataset.count; if (reduce) { el.textContent = CT.fmtInt(to); return; }
      const t0 = performance.now(), dur = 1100;
      (function f(now) { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = CT.fmtInt(Math.round(to * e)); if (p < 1) requestAnimationFrame(f); })(t0);
    };
    if ('IntersectionObserver' in window) {
      const io2 = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { run(e.target); io2.unobserve(e.target); } }), { threshold: .5 });
      cs.forEach(c => io2.observe(c));
    } else cs.forEach(run);
  }

  /* ---------- Hero terminal (simulated data, labelled) ---------- */
  function initHero() {
    const cv = doc.getElementById('hero-chart'); if (!cv || !window.CTCharts) return;
    const R = CTCharts.rng(20260611);
    const chart = new CTCharts.Chart(cv, { ema: true, rsi: true, macd: true, decimals: 2 });
    let data = CTCharts.simCandles(7, 140, 100, 1.5, .03);
    chart.set(data);
    const priceEl = doc.getElementById('hero-price'), chgEl = doc.getElementById('hero-chg');
    function paint() {
      const last = data[data.length - 1], first = data[data.length - 40] || data[0];
      const chg = (last.c / first.c - 1) * 100;
      if (priceEl) priceEl.textContent = CT.fmt(last.c);
      doc.querySelectorAll('[data-hero-price]').forEach(e => { e.textContent = CT.fmt(last.c); });
      if (chgEl) { chgEl.textContent = (chg >= 0 ? '+' : '') + CT.fmt(chg) + '%'; chgEl.className = 'num ' + (chg >= 0 ? 'up' : 'down'); }
      doc.querySelectorAll('[data-wl]').forEach((el, i) => {
        const v = Math.sin(performance.now() / 6000 + i * 1.7) * 1.4 + (i % 2 ? .35 : -.15);
        el.textContent = (v >= 0 ? '+' : '') + CT.fmt(v) + '%'; el.className = 'num ' + (v >= 0 ? 'up' : 'down');
      });
    }
    paint();
    // timeframe buttons only re-seed the simulation
    doc.querySelectorAll('#hero-tfs button').forEach(b => b.addEventListener('click', () => {
      doc.querySelectorAll('#hero-tfs button').forEach(x => x.classList.remove('active')); b.classList.add('active');
      data = CTCharts.simCandles(+b.dataset.seed, 140, 100, +b.dataset.vol, .03); chart.set(data); paint();
    }));
    if (reduce || !('IntersectionObserver' in window)) return;
    let vis = true; new IntersectionObserver(e => { vis = e[0].isIntersecting; }).observe(cv);
    let tick = 0;
    setInterval(() => {
      if (!vis || doc.hidden) return;
      tick++;
      const last = data[data.length - 1];
      if (tick % 6 === 0) { // new candle
        const o = last.c, c = Math.max(1, o + (R() - .5) * 1.6), v = 40 + R() * 90;
        data.push({ o, h: Math.max(o, c) + R() * .5, l: Math.min(o, c) - R() * .5, c, v }); if (data.length > 300) data.shift();
      } else {
        last.c = Math.max(1, last.c + (R() - .5) * .5); last.h = Math.max(last.h, last.c); last.l = Math.min(last.l, last.c);
      }
      chart.set(data); paint();
    }, 650);
  }

  /* ---------- Platform showcase chart ---------- */
  function initShowcase() {
    const cv = doc.getElementById('showcase-chart'); if (!cv) return;
    const chart = new CTCharts.Chart(cv, { ema: true, decimals: 2 });
    const seeds = { m15: [31, 1.0], h1: [57, 1.6], d1: [88, 2.8] };
    const set = k => { chart.set(CTCharts.simCandles(seeds[k][0], 160, 100, seeds[k][1], .02)); };
    set('h1');
    doc.querySelectorAll('[data-ind]').forEach(b => b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); chart.opt(b.dataset.ind, on); }));
    doc.querySelectorAll('[data-tf]').forEach(b => b.addEventListener('click', () => { doc.querySelectorAll('[data-tf]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); set(b.dataset.tf); }));
    doc.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => { doc.querySelectorAll('[data-mode]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); chart.opt('mode', b.dataset.mode); }));
  }

  /* ---------- Simulated sparklines in illustrative panels ---------- */
  function initSticky() {
    const b = doc.querySelector('.sticky-cta'); if (!b) return;
    const on = () => b.classList.toggle('show', window.scrollY > 700); on(); window.addEventListener('scroll', on, { passive: true });
  }
  function initProd() {
    const root = doc.getElementById('prod'); if (!root) return;
    root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach(x => { x.classList.toggle('active', x === b); x.setAttribute('aria-selected', x === b); });
      root.querySelectorAll('.pane').forEach(p => p.classList.toggle('active', p.dataset.pane === b.dataset.tab));
    }));
  }
  function initHeroBg() {
    const cv = doc.getElementById('hero-bg'); if (!cv || !window.CTCharts) return;
    const ctx = cv.getContext('2d'), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; let w, h, t = 0;
    const lines = [0, 1, 2].map(i => CTCharts.simCandles(11 + i * 17, 120, 100, 1.2, .02).map(x => x.c));
    function size() { const r = cv.getBoundingClientRect(), d = Math.min(devicePixelRatio || 1, 2); w = cv.width = r.width * d; h = cv.height = r.height * d; }
    function draw() {
      ctx.clearRect(0, 0, w, h); const cols = ['rgba(0,245,160,.55)', 'rgba(127,0,255,.55)', 'rgba(110,193,255,.35)'];
      lines.forEach((ln, k) => { const mn = Math.min(...ln), mx = Math.max(...ln); ctx.beginPath(); ctx.lineWidth = 2 * (w / 1400 + .5); ctx.strokeStyle = cols[k];
        ln.forEach((v, i) => { const x = (i / (ln.length - 1)) * w, y = h * (.2 + .5 * (1 - (v - mn) / (mx - mn))) + k * h * .05 + Math.sin(t / 60 + i / 9 + k) * 6; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke(); });
      t++; if (!reduce) requestAnimationFrame(draw);
    }
    size(); draw(); addEventListener('resize', () => { size(); if (reduce) draw(); });
  }
  function initSimSparks() {
    doc.querySelectorAll('[data-sim-spark]').forEach(svg => {
      const seed = +svg.dataset.simSpark, c = CTCharts.simCandles(seed, 40, 100, 1.5, .02).map(x => x.c);
      const up = c[c.length - 1] >= c[0]; CTCharts.spark(svg, c, up);
      const pct = svg.closest('[data-row]') && svg.closest('[data-row]').querySelector('[data-pct]');
      if (pct) { const v = (c[c.length - 1] / c[c.length - 2] - 1) * 100; pct.textContent = (v >= 0 ? '+' : '') + CT.fmt(v) + '%'; pct.className = 'num ' + (v >= 0 ? 'up' : 'down'); }
    });
  }

  /* ---------- Calculators (shared by home + tools page) ---------- */
  const calcs = {
    pos: {
      read: f => ({ balance: +f.balance, riskPct: +f.riskPct, entry: +f.entry, stop: +f.stop, leverage: +f.leverage || 1 }),
      run: CTMath => CTMath.positionSize,
      draw(r) {
        return { big: CT.fmt(r.units, 4), bigLbl: 'calc.pos.units', rows: [['calc.pos.risk', CT.fmt(r.riskAmount)], ['calc.pos.dist', CT.fmt(r.perUnit, 4)], ['calc.pos.notional', CT.fmt(r.notional)], ['calc.pos.pct', CT.fmt(r.notionalPctOfBalance) + '%'], ['calc.pos.margin', CT.fmt(r.margin)], ['calc.pos.dir', CT.t('calc.dir.' + r.direction)]], bar: null };
      }
    },
    rr: {
      read: f => ({ entry: +f.entry, stop: +f.stop, target: +f.target }),
      run: M => M.riskReward,
      draw(r) {
        const tot = r.risk + r.reward;
        return { big: '1 : ' + CT.fmt(r.ratio), bigLbl: 'calc.rr.ratio', rows: [['calc.rr.risk', CT.fmt(r.risk, 4)], ['calc.rr.reward', CT.fmt(r.reward, 4)], ['calc.rr.be', CT.fmt(r.breakEvenWinRate) + '%'], ['calc.pos.dir', CT.t('calc.dir.' + r.direction)]], bar: [r.risk / tot * 100, r.reward / tot * 100] };
      }
    },
    kelly: {
      read: f => ({ winRatePct: +f.winRatePct, avgWin: +f.avgWin, avgLoss: +f.avgLoss }),
      run: M => M.kelly,
      draw(r) {
        return { big: CT.fmt(Math.max(r.fPct, 0)) + '%', bigLbl: 'calc.kelly.full', rows: [['calc.kelly.half', CT.fmt(r.halfPct) + '%'], ['calc.kelly.R', CT.fmt(r.R)], ['calc.kelly.exp', CT.fmt(r.expectancy)], ['calc.kelly.edge', CT.t(r.hasEdge ? 'calc.kelly.yes' : 'calc.kelly.no')]], bar: null, note: r.hasEdge ? null : 'calc.kelly.noedge' };
      }
    },
    dd: {
      read: f => ({ drawdownPct: +f.drawdownPct }),
      run: M => M.drawdownRecovery,
      draw(r, inp) {
        const rows = [10, 20, 30, 50, 70].map(d => [CT.t('calc.dd.at', { d }), '+' + CT.fmt(CTMath.drawdownRecovery({ drawdownPct: d }).requiredGainPct) + '%']);
        return { big: '+' + CT.fmt(r.requiredGainPct) + '%', bigLbl: 'calc.dd.need', rows, bar: null };
      }
    }
  };
  function mountCalc(el) {
    const type = el.dataset.calc, def = calcs[type]; if (!def) return;
    const out = el.querySelector('.calc-out'), inputs = [...el.querySelectorAll('input[name]')];
    function update() {
      const f = {}; inputs.forEach(i => { f[i.name] = i.value.replace(',', '.'); i.removeAttribute('aria-invalid'); });
      const res = def.run(window.CTMath)(def.read(f));
      if (!res.ok) {
        out.innerHTML = '<div class="lbl">' + CT.t('calc.result') + '</div><div class="notice danger" role="alert">' + CT.t(res.error) + '</div>';
        inputs.forEach(i => { if (i.value === '' || !Number.isFinite(+i.value.replace(',', '.'))) i.setAttribute('aria-invalid', 'true'); });
        return;
      }
      const d = def.draw(res, f);
      let h = '<div class="lbl">' + CT.t(d.bigLbl) + '</div><div class="big">' + d.big + '</div>';
      if (d.bar) h += '<div class="bar-track" aria-hidden="true"><i style="width:' + d.bar[0] + '%;background:var(--c-red)"></i><i style="width:' + d.bar[1] + '%;background:var(--c-green)"></i></div>';
      d.rows.forEach(r => { h += '<div class="row"><span>' + (r[0].indexOf('calc.') === 0 ? CT.t(r[0]) : r[0]) + '</span><span class="num">' + r[1] + '</span></div>'; });
      if (d.note) h += '<div class="notice">' + CT.t(d.note) + '</div>';
      out.innerHTML = h;
    }
    inputs.forEach(i => i.addEventListener('input', update));
    doc.addEventListener('ct:lang', update);
    update();
  }
  function initCalcs() { doc.querySelectorAll('[data-calc]').forEach(mountCalc); }

  /* ---------- Tools directory ---------- */
  function initTools() {
    const host = doc.getElementById('tool-dir'); if (!host) return;
    const list = doc.getElementById('tool-list'), q = doc.getElementById('tool-q'), cnt = doc.getElementById('tool-count');
    const cards = [...doc.querySelectorAll('.cat-card')];
    let cat = 'all', data = [];
    const app = (window.CT_CONFIG && CT_CONFIG.appUrl) || 'app/index.html';
    function render() {
      const term = q.value.trim().toLowerCase();
      const rows = data.filter(t => (cat === 'all' || t.cat === cat) && (!term || t.name.toLowerCase().includes(term)));
      cnt.textContent = CT.t('tools.count', { n: rows.length, total: data.length });
      if (!rows.length) { list.innerHTML = '<div class="state-box" style="grid-column:1/-1"><h3>' + CT.t('tools.empty.t') + '</h3><p>' + CT.t('tools.empty.d') + '</p></div>'; return; }
      list.innerHTML = rows.map(t => '<a class="tool-item" href="' + app + '" lang="hu"><span>' + t.name.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</span><small lang="' + CT.lang + '">' + CT.t('tools.cat.' + t.cat) + '</small></a>').join('');
    }
    cards.forEach(c => c.addEventListener('click', () => { cat = cat === c.dataset.cat ? 'all' : c.dataset.cat; cards.forEach(x => x.setAttribute('aria-pressed', x.dataset.cat === cat)); render(); }));
    q.addEventListener('input', render); doc.addEventListener('ct:lang', render);
    fetch('data/tools.json').then(r => r.json()).then(j => { data = j; render(); }).catch(() => { list.innerHTML = '<div class="state-box"><h3>' + CT.t('common.error') + '</h3></div>'; });
  }

  /* ---------- Premium pricing (backend-configured, never hardcoded) ---------- */
  function initPricing() {
    const els = doc.querySelectorAll('[data-price]'); if (!els.length) return;
    const cfg = window.CT_CONFIG || {};
    const show = p => {
      els.forEach(el => {
        const v = p && p[el.dataset.price];
        el.innerHTML = Number.isFinite(v) ? CT.fmtInt(v) + ' <small>' + (p.currency || 'HUF') + (el.dataset.price === 'monthly' ? CT.t('pricing.permonth') : CT.t('pricing.peryear')) + '</small>' : '<small>' + CT.t('pricing.soon') + '</small>';
      });
    };
    let p = cfg.pricing; show(p);
    doc.addEventListener('ct:lang', () => show(p));
    if (cfg.pricingEndpoint) fetch(cfg.pricingEndpoint, { credentials: 'omit' }).then(r => { if (!r.ok) throw 0; return r.json(); }).then(j => { p = j; show(p); }).catch(() => { /* keep "coming soon" */ });
  }

  /* ---------- Contact (mailto – no backend inbox exists yet) ---------- */
  function initContact() {
    const f = doc.getElementById('contact-form'); if (!f) return;
    const to = (window.CT_CONFIG && CT_CONFIG.contactEmail) || '';
    const warn = doc.getElementById('contact-warn'); if (warn) warn.hidden = !!to;
    f.addEventListener('submit', e => {
      e.preventDefault(); let ok = true;
      f.querySelectorAll('[required]').forEach(i => {
        const err = f.querySelector('[data-err-for="' + i.name + '"]'); const bad = !i.value.trim() || (i.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.value));
        i.setAttribute('aria-invalid', bad); if (err) err.textContent = bad ? CT.t('contact.err') : ''; if (bad) ok = false;
      });
      if (!ok) return;
      if (!to) { CT.toast(CT.t('contact.noaddr'), 'err'); return; }
      const subj = encodeURIComponent('[Chartolj!] ' + f.subject.value.trim());
      const body = encodeURIComponent(f.message.value.trim() + '\n\n— ' + f.name.value.trim() + ' <' + f.email.value.trim() + '>');
      location.href = 'mailto:' + to + '?subject=' + subj + '&body=' + body; CT.toast(CT.t('contact.opened'), 'ok');
    });
  }

  /* ---------- Cookie / local data page ---------- */
  function initPrivacyControls() {
    const b = doc.getElementById('clear-local'); if (!b) return;
    b.addEventListener('click', () => {
      try { ['chartolj_site_lang', 'chartolj_site_watchlist'].forEach(k => localStorage.removeItem(k)); } catch (e) { /* ignore */ }
      CT.toast(CT.t('cookies.cleared'), 'ok');
    });
  }

  doc.addEventListener('DOMContentLoaded', () => {
    root.classList.remove('no-js');
    // wire app links to config
    const app = (window.CT_CONFIG && CT_CONFIG.appUrl) || 'app/index.html';
    doc.querySelectorAll('[data-app]').forEach(a => { a.href = app; });
    initLang(); initNav(); initReveal(); initHero(); initProd(); initSticky(); initHeroBg(); initShowcase(); initSimSparks(); initCalcs(); initTools(); initPricing(); initContact(); initPrivacyControls();
  });
})();
