/* Run: node tests/tools.test.js
   Expected values are hand-calculated (worked below), not produced by the code under test. */
const assert = require('node:assert/strict');
const M = require('../js/tools-math.js');
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok  -', name); };

t('position size: 10 000 balance, 1% risk, entry 100, stop 95 -> 100 risk / 5 = 20 units', () => {
  const r = M.positionSize({ balance: 10000, riskPct: 1, entry: 100, stop: 95 });
  assert.equal(r.ok, true); near(r.riskAmount, 100); near(r.units, 20); near(r.notional, 2000); assert.equal(r.direction, 'long');
});
t('position size: short (stop above entry), leverage 5 -> margin = notional / 5', () => {
  const r = M.positionSize({ balance: 5000, riskPct: 2, entry: 50, stop: 52, leverage: 5 });
  near(r.riskAmount, 100); near(r.units, 50); near(r.notional, 2500); near(r.margin, 500); assert.equal(r.direction, 'short');
});
t('position size: rejects zero distance, bad risk, negative balance, NaN', () => {
  assert.equal(M.positionSize({ balance: 1000, riskPct: 1, entry: 10, stop: 10 }).error, 'calc.err.same');
  assert.equal(M.positionSize({ balance: 1000, riskPct: 0, entry: 10, stop: 9 }).error, 'calc.err.riskpct');
  assert.equal(M.positionSize({ balance: -1, riskPct: 1, entry: 10, stop: 9 }).error, 'calc.err.balance');
  assert.equal(M.positionSize({ balance: NaN, riskPct: 1, entry: 10, stop: 9 }).error, 'calc.err.number');
});
t('risk/reward: entry 100, stop 95, target 115 -> 15 / 5 = 3R, break-even win rate 25%', () => {
  const r = M.riskReward({ entry: 100, stop: 95, target: 115 });
  near(r.ratio, 3); near(r.breakEvenWinRate, 25);
});
t('risk/reward: 1R -> break-even 50%; short trade validated', () => {
  near(M.riskReward({ entry: 100, stop: 95, target: 105 }).breakEvenWinRate, 50);
  const s = M.riskReward({ entry: 100, stop: 104, target: 88 }); near(s.ratio, 3); assert.equal(s.direction, 'short');
  assert.equal(M.riskReward({ entry: 100, stop: 95, target: 99 }).error, 'calc.err.targetlong');
});
t('kelly: W=60%, R=1.5 -> 0.6 - 0.4/1.5 = 0.33333 ; expectancy 0.6*150-0.4*100 = 50', () => {
  const k = M.kelly({ winRatePct: 60, avgWin: 150, avgLoss: 100 });
  near(k.f, 0.6 - 0.4 / 1.5); near(k.fPct, 33.3333333333, 1e-6); near(k.expectancy, 50); near(k.halfPct, 16.6666666667, 1e-6);
});
t('kelly: negative edge -> f < 0, hasEdge false, half-Kelly floored at 0', () => {
  const k = M.kelly({ winRatePct: 40, avgWin: 100, avgLoss: 100 });
  near(k.f, 0.4 - 0.6); assert.equal(k.hasEdge, false); near(k.halfPct, 0);
});
t('drawdown recovery: 20% -> 25% ; 50% -> 100% ; 90% -> 900%', () => {
  near(M.drawdownRecovery({ drawdownPct: 20 }).requiredGainPct, 25);
  near(M.drawdownRecovery({ drawdownPct: 50 }).requiredGainPct, 100);
  near(M.drawdownRecovery({ drawdownPct: 90 }).requiredGainPct, 900, 1e-9);
  assert.equal(M.drawdownRecovery({ drawdownPct: 100 }).error, 'calc.err.dd');
});
t('RSI (Wilder 14): strictly rising series -> 100 ; strictly falling -> 0', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i);
  const dn = Array.from({ length: 30 }, (_, i) => 100 - i);
  near(M.rsi(up)[29], 100); near(M.rsi(dn)[29], 0);
});
t('RSI: textbook example (Wilder / StockCharts closes) first value ~ 70.53', () => {
  const c = [44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.2820];
  // StockCharts "RSI" worksheet: first RSI(14) = 70.53 for the first 15 closes
  near(M.rsi(c, 14)[14], 70.53, 0.05);
});
t('SMA / EMA basics', () => {
  assert.deepEqual(M.sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = M.emaFull([10, 10, 10, 10], 3); e.forEach(v => near(v, 10));
});
t('MACD: constant series -> zero line/hist', () => {
  const m = M.macd(Array(60).fill(50)); near(m.line[59], 0); near(m.hist[59], 0);
});
t('Bollinger: constant series -> bands collapse to mid', () => {
  const b = M.bollinger(Array(25).fill(10), 20)[24]; near(b.up, 10); near(b.lo, 10);
});
console.log(`\n${n} test groups passed`);
