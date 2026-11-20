/* Chartolj! website - holiday decorations: snowfall, string lights, flying sleigh. Purely decorative (aria-hidden). */
(function () {
  'use strict';
  var reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var KEY = 'ct_snow';
  function on() { try { return localStorage.getItem(KEY) !== '0'; } catch (e) { return true; } }
  function setOn(v) { try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {} }

  /* ---------- string lights under the header ---------- */
  function lights() {
    var h = document.querySelector('header.nav'); if (!h || h.querySelector('.garland')) return;
    var W = Math.max(320, innerWidth), seg = 84, n = Math.ceil(W / seg), cols = ['#ff3b4a', '#ffd25e', '#3ddc84', '#58b7ff', '#ff8fd1'];
    var svg = '<svg class="garland" aria-hidden="true" width="100%" height="46" viewBox="0 0 ' + W + ' 46" preserveAspectRatio="none">', d = 'M0,2', bulbs = '';
    for (var i = 0; i < n; i++) {
      var x0 = i * seg, x1 = x0 + seg; d += ' Q' + (x0 + seg / 2) + ',26 ' + x1 + ',2';
      for (var k = 1; k <= 2; k++) {
        var t = k / 3, x = x0 + seg * t, y = 2 * (1 - t) * (1 - t) * 0 + 2 * 2 * (1 - t) * t * 26 / 2 * 1 + 2 * (1 - t) * (1 - t) + 2 * t * t; y = (1 - t) * (1 - t) * 2 + 2 * (1 - t) * t * 26 + t * t * 2;
        var c = cols[(i * 2 + k) % cols.length];
        bulbs += '<g class="bulb" style="animation-delay:' + (((i * 2 + k) % 5) * -0.55).toFixed(2) + 's"><rect x="' + (x - 1.5) + '" y="' + (y - 1) + '" width="3" height="5" fill="#223"/><ellipse cx="' + x + '" cy="' + (y + 9) + '" rx="4.2" ry="6" fill="' + c + '"/></g>';
      }
    }
    svg += '<path d="' + d + '" fill="none" stroke="#0b1a12" stroke-width="1.6"/>' + bulbs + '</svg>';
    var w = document.createElement('div'); w.className = 'garland-wrap'; w.setAttribute('aria-hidden', 'true'); w.innerHTML = svg; h.appendChild(w);
  }

  /* ---------- snow ---------- */
  var cv, cx, flakes = [], raf = 0, W = 0, H = 0;
  function snowInit() {
    cv = document.createElement('canvas'); cv.className = 'snow'; cv.setAttribute('aria-hidden', 'true'); document.body.appendChild(cv); cx = cv.getContext('2d');
    function size() { W = cv.width = innerWidth; H = cv.height = innerHeight; var n = Math.round(Math.min(150, W / 11)); while (flakes.length < n) flakes.push(mk(true)); flakes.length = n; }
    function mk(any) { return { x: Math.random() * W, y: any ? Math.random() * H : -8, r: .8 + Math.random() * 2.6, v: .35 + Math.random() * 1.1, s: Math.random() * 6.28, a: .35 + Math.random() * .55 }; }
    addEventListener('resize', size); size();
    function tick() {
      cx.clearRect(0, 0, W, H);
      for (var i = 0; i < flakes.length; i++) {
        var f = flakes[i]; f.y += f.v; f.s += .012; f.x += Math.sin(f.s) * .5;
        if (f.y > H + 6) { flakes[i] = mk(false); flakes[i].x = Math.random() * W; continue; }
        cx.globalAlpha = f.a; cx.fillStyle = '#8fb8dc'; cx.shadowColor = 'rgba(255,255,255,.9)'; cx.shadowBlur = 3; cx.beginPath(); cx.arc(f.x, f.y, f.r, 0, 6.283); cx.fill();
      }
      raf = requestAnimationFrame(tick);
    }
    snowInit.start = function () { if (!raf) tick(); cv.style.display = ''; };
    snowInit.stop = function () { cancelAnimationFrame(raf); raf = 0; cx.clearRect(0, 0, W, H); cv.style.display = 'none'; };
    document.addEventListener('visibilitychange', function () { if (document.hidden) { cancelAnimationFrame(raf); raf = 0; } else if (on() && !reduce) snowInit.start(); });
  }

  /* ---------- sleigh ---------- */
  var SLEIGH = '<svg viewBox="0 0 560 130" aria-hidden="true"><defs><g id="rd"><ellipse cx="30" cy="62" rx="24" ry="12" fill="#8b5a3c"/><path d="M48 56 L62 36 L72 38 L66 56Z" fill="#8b5a3c"/><circle cx="73" cy="34" r="8" fill="#8b5a3c"/><circle class="nose" cx="81" cy="36" r="3" fill="#e5384a"/><path d="M71 28 L66 12 M68 20 L60 16 M74 27 L80 10 M77 18 L85 15" stroke="#d9c59a" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M12 70 L4 94 M22 72 L18 98 M40 72 L46 96 M50 68 L60 90" stroke="#6e4630" stroke-width="3.2" stroke-linecap="round"/></g></defs>'
    + '<use href="#rd" x="300" y="6"/><use href="#rd" x="226" y="12"/><use href="#rd" x="152" y="6"/>'
    + '<path d="M150 70 L120 74 M224 76 L170 72" stroke="#f6c65b" stroke-width="1.6" fill="none"/>'
    + '<g transform="translate(6,22)"><path d="M10 52 Q10 92 60 92 L140 92 Q150 92 146 76 L150 50 Z" fill="#d62839" stroke="#8d1522" stroke-width="2"/><path d="M0 100 Q40 104 130 100 Q150 98 154 80" stroke="#f6c65b" stroke-width="4" fill="none" stroke-linecap="round"/><path d="M30 96 L30 104 M110 96 L110 104" stroke="#f6c65b" stroke-width="3"/>'
    + '<circle cx="92" cy="38" r="18" fill="#d62839"/><circle cx="92" cy="22" r="11" fill="#ffe3c8"/><path d="M82 26 Q92 46 102 26 Q92 34 82 26Z" fill="#fff"/><path d="M80 18 Q92 -6 106 14 L104 20 Q92 12 82 22Z" fill="#d62839"/><circle cx="108" cy="12" r="4.5" fill="#fff"/><rect x="80" y="17" width="26" height="6" rx="3" fill="#fff"/>'
    + '<rect x="110" y="40" width="30" height="34" rx="4" fill="#2fbf71" stroke="#1d7a47" stroke-width="2"/></g></svg>';
  function fly() {
    if (reduce || !on() || document.hidden) return;
    var el = document.createElement('div'); el.className = 'sleigh'; el.setAttribute('aria-hidden', 'true'); el.innerHTML = SLEIGH;
    el.style.top = (14 + Math.random() * 22).toFixed(0) + 'vh'; document.body.appendChild(el);
    el.addEventListener('animationend', function () { el.remove(); });
  }

  /* ---------- toggle ---------- */
  function toggle() {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'snow-toggle'; var lb = (window.CT && CT.t) ? CT.t('xmas.snow') : 'Snow';
    b.setAttribute('aria-label', lb); b.title = lb; b.setAttribute('aria-pressed', on() ? 'true' : 'false'); b.textContent = '❄';
    b.addEventListener('click', function () { var v = !on(); setOn(v); b.setAttribute('aria-pressed', v ? 'true' : 'false'); if (v) snowInit.start(); else snowInit.stop(); });
    document.body.appendChild(b);
  }

  function boot() {
    lights(); snowInit(); toggle();
    if (!reduce && on()) { snowInit.start(); setTimeout(fly, 2500); setInterval(fly, 32000); }
    else snowInit.stop();
    var rt; addEventListener('resize', function () { clearTimeout(rt); rt = setTimeout(function () { var g = document.querySelector('.garland-wrap'); if (g) g.remove(); lights(); }, 250); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
