'use strict';
/*
 * Desk IA v2 — Reparto ricerca.
 * Tutto si ricalcola dai prezzi giornalieri: nessuno stato nascosto, stessi conti nel passato e dal vivo.
 *
 * Regola dei tempi: la posizione decisa con la chiusura del giorno t vale per il movimento
 * da t a t+1. Nessuna decisione usa prezzi futuri.
 */

/* ---------- gli asset ---------- */
const ASSETS = {
  BTC: { name: 'Bitcoin', short: 'BTC', capital: 10000, lev: 1, cost: 0.0015, finShort: 0.05, finAny: 0, bench: 'long',
    benchName: 'Compro e tengo Bitcoin' },
  NDX: { name: 'Nasdaq-100', short: 'NASDAQ', capital: 10000, lev: 1, cost: 0.0005, finShort: 0.05, finAny: 0, bench: 'long',
    benchName: 'Compro e tengo Nasdaq-100' },
  EURUSD: { name: 'Euro/Dollaro', short: 'EUR/USD', capital: 10000, lev: 3, cost: 0.0001, finShort: 0, finAny: 0.01, bench: 'cash',
    benchName: 'Liquidità (0%)' },
};

/* ---------- le 18 strategie candidate ---------- */
const VARIANTS = [];
for (const [f, s] of [[10, 30], [20, 50], [50, 200]]) for (const ls of [true, false])
  VARIANTS.push({ id: `ma-${f}-${s}-${ls ? 'ls' : 'l'}`, fam: 'ma', f, s, ls, name: `Medie ${f}/${s} ${ls ? 'long+short' : 'solo long'}` });
for (const n of [20, 55, 100]) for (const ls of [true, false])
  VARIANTS.push({ id: `don-${n}-${ls ? 'ls' : 'l'}`, fam: 'don', n, ls, name: `Rottura ${n} giorni ${ls ? 'long+short' : 'solo long'}` });
for (const [w, z] of [[10, 1.5], [10, 2], [20, 1.5], [20, 2]])
  VARIANTS.push({ id: `mr-${w}-${z}`, fam: 'mr', w, z, ls: true, name: `Eccessi ${w} giorni oltre ${String(z).replace('.', ',')}σ` });
for (const ls of [false, true])
  VARIANTS.push({ id: `t200-${ls ? 'ls' : 'l'}`, fam: 't200', ls, name: `Filtro media 200 ${ls ? 'long+short' : 'solo long'}` });
const BENCH = { id: 'bench', fam: 'bench', name: 'Benchmark' };
const BY_ID = Object.fromEntries([...VARIANTS, BENCH].map(v => [v.id, v]));

/* ---------- regole del reparto ricerca ---------- */
const RULES = {
  trailingDays: 730,      // la ricerca giudica le strategie sugli ultimi 2 anni
  reviewDays: 91,         // revisione del campione ogni 3 mesi
  sharpeMargin: 0.2,      // la sfidante deve battere il benchmark anche nel rapporto rischio/rendimento, con margine
  minTrades: 4,           // almeno 4 cambi di posizione nei 2 anni
  demoteDays: 20,         // dopo almeno 20 giorni di borsa dal vivo...
  demoteGap: 0.05,        // ...se il campione fa peggio del benchmark di oltre 5 punti, torna il benchmark
};

/* ---------- utility ---------- */
const DAY = 864e5;
const dms = d => Date.parse(d + 'T00:00:00Z');
const addDays = (d, n) => new Date(dms(d) + n * DAY).toISOString().slice(0, 10);
const r4 = x => Math.round(x * 1e4) / 1e4;

function sma(c, n) {
  const out = new Array(c.length).fill(null); let s = 0;
  for (let i = 0; i < c.length; i++) { s += c[i]; if (i >= n) s -= c[i - n]; if (i >= n - 1) out[i] = s / n; }
  return out;
}

/* ---------- posizioni: pos[t] in {-1, 0, 1}, decisa con la chiusura di t ---------- */
function positions(v, c, benchKind) {
  const n = c.length, pos = new Array(n).fill(0);
  if (v.fam === 'bench') { if (benchKind === 'long') pos.fill(1); return pos; }
  if (v.fam === 'ma' || v.fam === 't200') {
    const fast = v.fam === 'ma' ? sma(c, v.f) : c, slow = sma(c, v.fam === 'ma' ? v.s : 200);
    for (let t = 0; t < n; t++) { if (slow[t] == null || fast[t] == null) continue; pos[t] = fast[t] > slow[t] ? 1 : v.ls ? -1 : 0; }
    return pos;
  }
  if (v.fam === 'don') {
    const m = Math.max(5, Math.round(v.n / 2)); let p = 0;
    for (let t = v.n; t < n; t++) {
      let hi = -Infinity, lo = Infinity, hx = -Infinity, lx = Infinity;
      for (let k = t - v.n; k < t; k++) { if (c[k] > hi) hi = c[k]; if (c[k] < lo) lo = c[k]; }
      for (let k = t - m; k < t; k++) { if (c[k] > hx) hx = c[k]; if (c[k] < lx) lx = c[k]; }
      if (p === 1 && c[t] < lx) p = 0;
      else if (p === -1 && c[t] > hx) p = 0;
      if (p !== 1 && c[t] > hi) p = 1;
      else if (p !== -1 && v.ls && c[t] < lo) p = -1;
      pos[t] = p;
    }
    return pos;
  }
  if (v.fam === 'mr') {
    let p = 0;
    for (let t = v.w; t < n; t++) {
      let s = 0, q = 0;
      for (let k = t - v.w + 1; k <= t; k++) s += c[k];
      const m = s / v.w;
      for (let k = t - v.w + 1; k <= t; k++) q += (c[k] - m) ** 2;
      const sd = Math.sqrt(q / v.w) || 1e-12, z = (c[t] - m) / sd;
      if (p === 1 && c[t] >= m) p = 0; else if (p === -1 && c[t] <= m) p = 0;
      if (p === 0 && z < -v.z) p = 1; else if (p === 0 && z > v.z) p = -1;
      pos[t] = p;
    }
    return pos;
  }
  throw new Error('famiglia sconosciuta ' + v.fam);
}

/* ---------- rendimenti con costi: ret[t] = movimento da t-1 a t con la posizione decisa a t-1 ----------
   prevPos[t] = posizione in essere prima della decisione di t (serve per il costo del cambio) */
function returns(A, dates, c, posAt, startIdx = 1, initialPos = 0) {
  const out = new Array(c.length).fill(0);
  let held = initialPos;                                     // posizione tenuta tra t-1 e t
  for (let t = startIdx; t < c.length; t++) {
    const decided = posAt(t - 1);                            // decisa alla chiusura di t-1
    const change = Math.abs(decided - held);
    const days = (dms(dates[t]) - dms(dates[t - 1])) / DAY;
    let r = A.lev * decided * (c[t] / c[t - 1] - 1);
    r -= A.cost * A.lev * change;
    if (decided < 0) r -= A.finShort * A.lev * days / 365;
    if (decided !== 0) r -= A.finAny * A.lev * days / 365;
    out[t] = r; held = decided;
  }
  return out;
}

function stats(rets, dates, from, to) {      // rendimenti di (from, to]
  let eq = 1, peak = 1, dd = 0, s = 0, q = 0, n = 0;
  for (let t = from + 1; t <= to; t++) { eq *= 1 + rets[t]; peak = Math.max(peak, eq); dd = Math.max(dd, 1 - eq / peak); s += rets[t]; q += rets[t] * rets[t]; n++; }
  if (n < 2) return { ret: 0, sharpe: 0, maxDD: 0, n };
  const m = s / n, sd = Math.sqrt(Math.max(0, q / n - m * m));
  const years = (dms(dates[to]) - dms(dates[from])) / (365 * DAY), ppy = n / Math.max(years, 1e-6);
  return { ret: eq - 1, sharpe: sd > 1e-12 ? (m / sd) * Math.sqrt(ppy) : 0, maxDD: dd, n, cagr: years > 0.2 ? Math.pow(eq, 1 / years) - 1 : null };
}
const changes = (pos, from, to) => { let k = 0; for (let t = Math.max(1, from + 1); t <= to; t++) if (pos[t] !== pos[t - 1]) k++; return k; };
const idxOnOrBefore = (dates, d) => { let lo = 0, hi = dates.length - 1, a = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { a = m; lo = m + 1; } else hi = m - 1; } return a; };

/* ---------- laboratorio di un asset ---------- */
function buildLab(assetKey, bars) {
  const A = ASSETS[assetKey];
  const dates = bars.map(b => b[0]), c = bars.map(b => b[4]);
  const pos = {}, rets = {};
  for (const v of [...VARIANTS, BENCH]) {
    pos[v.id] = positions(v, c, A.bench);
    const p = pos[v.id];
    rets[v.id] = returns(A, dates, c, t => p[t]);
  }
  return { key: assetKey, A, dates, c, pos, rets };
}

// la scelta del reparto ricerca alla data di indice i (usa solo dati fino a i)
function pick(L, i) {
  const from = idxOnOrBefore(L.dates, addDays(L.dates[i], -RULES.trailingDays));
  if (from < 0 || i - from < 100) return { id: 'bench', why: 'storico troppo corto' };
  const b = stats(L.rets.bench, L.dates, from, i);
  let best = null;
  const board = [];
  for (const v of VARIANTS) {
    const s = stats(L.rets[v.id], L.dates, from, i), tr = changes(L.pos[v.id], from, i);
    const ok = s.ret > b.ret && s.sharpe > b.sharpe + RULES.sharpeMargin && tr >= RULES.minTrades;
    board.push({ id: v.id, ret: r4(s.ret), sharpe: r4(s.sharpe), maxDD: r4(s.maxDD), trades: tr, ok });
    if (ok && (!best || s.sharpe > best.s.sharpe)) best = { v, s };
  }
  board.sort((x, y) => y.sharpe - x.sharpe);
  return best ? { id: best.v.id, why: `Sharpe ${best.s.sharpe.toFixed(2)} contro ${b.sharpe.toFixed(2)} del benchmark negli ultimi 2 anni`, board, bench: { ret: r4(b.ret), sharpe: r4(b.sharpe) } }
    : { id: 'bench', why: 'nessuna strategia ha battuto il benchmark con margine negli ultimi 2 anni', board, bench: { ret: r4(b.ret), sharpe: r4(b.sharpe) } };
}

// rendimenti di un "programma" di campioni: schedule = [{i: indice da cui vale, id}]
function scheduleReturns(L, schedule, startIdx) {
  const posAt = t => { let id = 'bench'; for (const s of schedule) if (s.i <= t) id = s.id; return L.pos[id][t]; };
  return returns(L.A, L.dates, L.c, posAt, startIdx + 1, 0);
}

// verifica fuori campione del METODO di scelta, fino all'indice end (incluso)
function walkForward(L, end) {
  const first = idxOnOrBefore(L.dates, addDays(L.dates[0], RULES.trailingDays));
  if (first < 0 || first >= end - 30) return null;
  const schedule = [], quarters = [];
  let i = first;
  while (i <= end) {
    const p = pick(L, i); schedule.push({ i, id: p.id, d: L.dates[i] });
    const next = idxOnOrBefore(L.dates, addDays(L.dates[i], RULES.reviewDays));
    i = next > i ? next : i + 1;
  }
  const rets = scheduleReturns(L, schedule, first);
  // la verifica parte da "first": ogni decisione usa solo il passato
  for (let k = 0; k < schedule.length; k++) {
    const a = schedule[k].i, b = Math.min(end, k + 1 < schedule.length ? schedule[k + 1].i : end);
    if (b <= a) continue;
    const s = stats(rets, L.dates, a, b), bb = stats(L.rets.bench, L.dates, a, b);
    quarters.push({ d: L.dates[a], id: schedule[k].id, ret: r4(s.ret), bench: r4(bb.ret) });
  }
  const s = stats(rets, L.dates, first, end), b = stats(L.rets.bench, L.dates, first, end);
  const beaten = quarters.filter(q => q.ret > q.bench).length;
  const valid = A_valid(L.A, s, b);
  // curva settimanale per il grafico
  const curve = []; let e = 1, eb = 1;
  for (let t = first + 1; t <= end; t++) { e *= 1 + rets[t]; eb *= 1 + L.rets.bench[t]; if ((t - first) % 5 === 0 || t === end) curve.push([L.dates[t], r4(e), r4(eb)]); }
  return { from: L.dates[first], to: L.dates[end], ret: r4(s.ret), sharpe: r4(s.sharpe), maxDD: r4(s.maxDD), cagr: s.cagr == null ? null : r4(s.cagr),
    bench: { ret: r4(b.ret), sharpe: r4(b.sharpe), maxDD: r4(b.maxDD), cagr: b.cagr == null ? null : r4(b.cagr) },
    quarters: quarters.length, beaten, valid, curve, picks: quarters.slice(-8) };
}
function A_valid(A, s, b) {
  if (A.bench === 'cash') return s.ret > 0 && s.sharpe > 0.3;
  return s.ret > b.ret && s.sharpe > b.sharpe;
}

module.exports = { ASSETS, VARIANTS, BENCH, BY_ID, RULES, buildLab, pick, walkForward, scheduleReturns, stats, changes, idxOnOrBefore, addDays, dms, returns, positions, r4 };
