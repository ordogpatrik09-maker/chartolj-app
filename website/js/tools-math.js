/* Chartolj! – pure calculation core (no DOM). Used by the website and by tests/tools.test.js.
   Every function validates input and returns { ok:false, error:'<i18n key>' } on invalid input. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CTMath = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const fin = (x) => typeof x === 'number' && Number.isFinite(x);
  const bad = (error) => ({ ok: false, error });

  /* Position size: units = (balance * risk%) / |entry - stop| */
  function positionSize({ balance, riskPct, entry, stop, leverage }) {
    if (![balance, riskPct, entry, stop].every(fin)) return bad('calc.err.number');
    if (balance <= 0) return bad('calc.err.balance');
    if (riskPct <= 0 || riskPct > 100) return bad('calc.err.riskpct');
    if (entry <= 0 || stop <= 0) return bad('calc.err.price');
    if (entry === stop) return bad('calc.err.same');
    const riskAmount = balance * riskPct / 100;
    const perUnit = Math.abs(entry - stop);
    const units = riskAmount / perUnit;
    const notional = units * entry;
    const lev = fin(leverage) && leverage > 0 ? leverage : 1;
    return { ok: true, riskAmount, perUnit, units, notional, margin: notional / lev, direction: stop < entry ? 'long' : 'short', notionalPctOfBalance: notional / balance * 100 };
  }

  /* Risk/Reward: R = |target - entry| / |entry - stop|; break-even win rate = 1 / (1 + R) */
  function riskReward({ entry, stop, target }) {
    if (![entry, stop, target].every(fin)) return bad('calc.err.number');
    if (entry <= 0 || stop <= 0 || target <= 0) return bad('calc.err.price');
    if (entry === stop) return bad('calc.err.same');
    const long = stop < entry;
    if (long && target <= entry) return bad('calc.err.targetlong');
    if (!long && target >= entry) return bad('calc.err.targetshort');
    const risk = Math.abs(entry - stop), reward = Math.abs(target - entry);
    const r = reward / risk;
    return { ok: true, risk, reward, ratio: r, breakEvenWinRate: 100 / (1 + r), direction: long ? 'long' : 'short' };
  }

  /* Kelly: f* = W - (1 - W) / R, W = win probability, R = avg win / avg loss */
  function kelly({ winRatePct, avgWin, avgLoss }) {
    if (![winRatePct, avgWin, avgLoss].every(fin)) return bad('calc.err.number');
    if (winRatePct <= 0 || winRatePct >= 100) return bad('calc.err.winrate');
    if (avgWin <= 0 || avgLoss <= 0) return bad('calc.err.avg');
    const w = winRatePct / 100, R = avgWin / avgLoss;
    const f = w - (1 - w) / R;
    const expectancy = w * avgWin - (1 - w) * avgLoss;
    return { ok: true, f, fPct: f * 100, halfPct: Math.max(f, 0) * 50, R, expectancy, hasEdge: f > 0 };
  }

  /* Drawdown recovery: required gain = 1 / (1 - d) - 1 */
  function drawdownRecovery({ drawdownPct }) {
    if (!fin(drawdownPct)) return bad('calc.err.number');
    if (drawdownPct <= 0 || drawdownPct >= 100) return bad('calc.err.dd');
    const d = drawdownPct / 100;
    return { ok: true, requiredGainPct: (1 / (1 - d) - 1) * 100 };
  }

  /* Indicator helpers used by the illustrative chart (standard definitions) */
  function ema(values, period) {
    const k = 2 / (period + 1); const out = []; let prev;
    values.forEach((v, i) => {
      if (i === 0) prev = v; else prev = v * k + prev * (1 - k);
      out.push(i < period - 1 ? null : prev);
    });
    return out;
  }
  function emaFull(values, period) { // no warm-up masking (needed for MACD)
    const k = 2 / (period + 1); const out = []; let prev;
    values.forEach((v, i) => { prev = i === 0 ? v : v * k + prev * (1 - k); out.push(prev); });
    return out;
  }
  function sma(values, period) {
    return values.map((_, i) => {
      if (i < period - 1) return null;
      let s = 0; for (let j = i - period + 1; j <= i; j++) s += values[j];
      return s / period;
    });
  }
  /* Wilder RSI */
  function rsi(closes, period = 14) {
    const out = new Array(closes.length).fill(null);
    if (closes.length <= period) return out;
    let gain = 0, loss = 0;
    for (let i = 1; i <= period; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) gain += d; else loss -= d; }
    let ag = gain / period, al = loss / period;
    out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = period + 1; i < closes.length; i++) {
      const d = closes[i] - closes[i - 1];
      ag = (ag * (period - 1) + Math.max(d, 0)) / period;
      al = (al * (period - 1) + Math.max(-d, 0)) / period;
      out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
    return out;
  }
  /* MACD(12,26,9) */
  function macd(closes, fast = 12, slow = 26, signal = 9) {
    const f = emaFull(closes, fast), s = emaFull(closes, slow);
    const line = closes.map((_, i) => f[i] - s[i]);
    const sig = emaFull(line, signal);
    return { line, signal: sig, hist: line.map((v, i) => v - sig[i]) };
  }
  function bollinger(closes, period = 20, mult = 2) {
    const mid = sma(closes, period);
    return closes.map((_, i) => {
      if (mid[i] == null) return null;
      let v = 0; for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
      const sd = Math.sqrt(v / period);
      return { mid: mid[i], up: mid[i] + mult * sd, lo: mid[i] - mult * sd };
    });
  }

  return { positionSize, riskReward, kelly, drawdownRecovery, ema, emaFull, sma, rsi, macd, bollinger };
});
