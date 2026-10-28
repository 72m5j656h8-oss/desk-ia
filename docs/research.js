(function () {
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
// reparto machine learning: regressione logistica riaddestrata ogni mese solo sul passato
for (const [h, ls] of [[5, true], [5, false], [1, true]])
  VARIANTS.push({ id: `ml-${h}-${ls ? 'ls' : 'l'}`, fam: 'ml', h, ls, name: `ML ${h === 1 ? '1 giorno' : h + ' giorni'} ${ls ? 'long+short' : 'solo long'}` });
// trader adattivi: ogni mese provano piccole variazioni dei propri parametri e tengono la migliore
// solo se vince sia sul periodo di allenamento sia sugli ultimi 3 mesi, che non hanno usato per allenarsi
for (const [base, ls] of [['ma', true], ['ma', false], ['don', true], ['don', false], ['mr', true]])
  VARIANTS.push({ id: `ad-${base}-${ls ? 'ls' : 'l'}`, fam: 'adapt', base, ls,
    name: { ma: 'Medie adattive', don: 'Rottura adattiva', mr: 'Eccessi adattivi' }[base] + (base === 'mr' ? '' : ls ? ' long+short' : ' solo long') });
const BENCH = { id: 'bench', fam: 'bench', name: 'Benchmark' };
const FLAT = { id: 'flat', fam: 'flat', name: 'Tutto in liquidità (kill switch)' };
const BY_ID = Object.fromEntries([...VARIANTS, BENCH, FLAT].map(v => [v.id, v]));

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
  if (v.fam === 'flat') return pos;
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
  if (v.fam === 'ml') return mlPositions(v, c).pos;
  if (v.fam === 'adapt') throw new Error('le strategie adattive si calcolano in buildLab');
  throw new Error('famiglia sconosciuta ' + v.fam);
}

/* ---------- machine learning ----------
   Caratteristiche calcolate con i prezzi fino al giorno t compreso:
   rendimento 1/5/20 giorni, volatilità a 20 giorni, distanza dalle medie 50 e 200,
   RSI 14, regime di volatilità (20 su 100 giorni).
   Obiettivo: il prezzo tra h giorni sarà più alto di oggi?
   Il modello si riaddestra ogni ML.retrain giorni usando SOLO esempi il cui esito era già noto. */
const ML = { window: 1000, retrain: 21, lambda: 1, warm: 260, up: 0.55, down: 0.45 };
const FEAT_NAMES = ['rend. 1g', 'rend. 5g', 'rend. 20g', 'volatilità 20g', 'distanza media 50', 'distanza media 200', 'RSI 14', 'regime volatilità'];
function mlFeatures(c) {
  const n = c.length, F = new Array(n).fill(null), s50 = sma(c, 50), s200 = sma(c, 200);
  const r = c.map((x, i) => (i ? x / c[i - 1] - 1 : 0));
  for (let t = 200; t < n; t++) {
    let a = 0, b = 0; for (let k = t - 19; k <= t; k++) { a += r[k]; b += r[k] * r[k]; }
    const v20 = Math.sqrt(Math.max(0, b / 20 - (a / 20) ** 2));
    let a2 = 0, b2 = 0; for (let k = t - 99; k <= t; k++) { a2 += r[k]; b2 += r[k] * r[k]; }
    const v100 = Math.sqrt(Math.max(0, b2 / 100 - (a2 / 100) ** 2)) || 1e-9;
    let g = 0, l = 0; for (let k = t - 13; k <= t; k++) { if (r[k] > 0) g += r[k]; else l -= r[k]; }
    const rsi = l + g > 0 ? g / (g + l) : 0.5;
    F[t] = [r[t], c[t] / c[t - 5] - 1, c[t] / c[t - 20] - 1, v20, c[t] / s50[t] - 1, c[t] / s200[t] - 1, rsi - 0.5, v20 / v100 - 1];
  }
  return F;
}
function solve(A, b) {             // Gauss con pivot parziale
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let i = 0; i < n; i++) {
    let p = i; for (let k = i + 1; k < n; k++) if (Math.abs(M[k][i]) > Math.abs(M[p][i])) p = k;
    [M[i], M[p]] = [M[p], M[i]];
    const d = M[i][i] || 1e-12;
    for (let k = i + 1; k < n; k++) { const f = M[k][i] / d; for (let j = i; j <= n; j++) M[k][j] -= f * M[i][j]; }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) { let sm = M[i][n]; for (let j = i + 1; j < n; j++) sm -= M[i][j] * x[j]; x[i] = sm / (M[i][i] || 1e-12); }
  return x;
}
function fitLogit(X, y, lambda) {   // regressione logistica con penalità L2 (Newton)
  const d = X[0].length; let w = new Array(d).fill(0);
  for (let it = 0; it < 8; it++) {
    const g = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < X.length; i++) {
      const x = X[i]; let z = 0; for (let j = 0; j < d; j++) z += w[j] * x[j];
      const p = 1 / (1 + Math.exp(-z)), e = p - y[i], s = p * (1 - p);
      for (let j = 0; j < d; j++) { g[j] += e * x[j]; for (let k = j; k < d; k++) H[j][k] += s * x[j] * x[k]; }
    }
    for (let j = 0; j < d; j++) { for (let k = 0; k < j; k++) H[j][k] = H[k][j]; if (j) { H[j][j] += lambda; g[j] += lambda * w[j]; } }
    const step = solve(H, g); let mx = 0;
    w = w.map((v, j) => { mx = Math.max(mx, Math.abs(step[j])); return v - step[j]; });
    if (mx < 1e-6) break;
  }
  return w;
}
const mlCache = new Map();
function mlPositions(v, c) {
  const key = v.id + ':' + c.length + ':' + c[c.length - 1] + ':' + c[0];
  if (mlCache.has(key)) return mlCache.get(key);
  const n = c.length, F = mlFeatures(c), pos = new Array(n).fill(0), prob = new Array(n).fill(null);
  let w = null, mu = null, sd = null, last = -1e9, hits = 0, tot = 0, p0 = 0;
  for (let t = ML.warm + v.h; t < n; t++) {
    if (t - last >= ML.retrain) {
      // esempi s con esito noto al giorno t: s + h <= t
      const X = [], y = [];
      for (let s = Math.max(200, t - v.h - ML.window); s <= t - v.h; s++) if (F[s]) { X.push(F[s]); y.push(c[s + v.h] > c[s] ? 1 : 0); }
      if (X.length >= 150) {
        const d = X[0].length; mu = new Array(d).fill(0); sd = new Array(d).fill(0);
        for (const x of X) for (let j = 0; j < d; j++) mu[j] += x[j] / X.length;
        for (const x of X) for (let j = 0; j < d; j++) sd[j] += (x[j] - mu[j]) ** 2 / X.length;
        sd = sd.map(q => Math.sqrt(q) || 1);
        w = fitLogit(X.map(x => [1, ...x.map((q, j) => (q - mu[j]) / sd[j])]), y, ML.lambda);
        last = t;
      }
    }
    if (!w || !F[t]) continue;
    const z = w[0] + F[t].reduce((a, q, j) => a + w[j + 1] * (q - mu[j]) / sd[j], 0), p = 1 / (1 + Math.exp(-z));
    prob[t] = p;
    // isteresi: entra oltre le soglie, esce quando la probabilità torna dalla parte opposta di 0,5
    if (p0 === 0) p0 = p > ML.up ? 1 : (v.ls && p < ML.down) ? -1 : 0;
    else if (p0 === 1 && p < 0.5) p0 = (v.ls && p < ML.down) ? -1 : 0;
    else if (p0 === -1 && p > 0.5) p0 = p > ML.up ? 1 : 0;
    pos[t] = p0;
    // accuratezza fuori campione: la previsione di t viene verificata quando l'esito è noto
    if (t + v.h < n) { tot++; if ((p > 0.5) === (c[t + v.h] > c[t])) hits++; }
  }
  const out = { pos, prob, accuracy: tot ? hits / tot : null, tested: tot, weights: w ? w.slice(1).map((q, j) => ({ f: FEAT_NAMES[j], w: Math.round(q * 1000) / 1000 })) : [] };
  mlCache.set(key, out);
  return out;
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
  for (const v of [...VARIANTS, BENCH, FLAT]) {
    if (v.fam === 'adapt') continue;
    pos[v.id] = positions(v, c, A.bench);
    const p = pos[v.id];
    rets[v.id] = returns(A, dates, c, t => p[t]);
  }
  const adapt = {};
  for (const v of VARIANTS) if (v.fam === 'adapt') {
    const res = adaptive(v, A, dates, c);
    pos[v.id] = res.pos; rets[v.id] = returns(A, dates, c, t => res.pos[t]); adapt[v.id] = { hist: res.hist, cur: res.cur, label: res.label, tests: res.tests };
  }
  return { key: assetKey, A, dates, c, pos, rets, adapt };
}

/* ---------- trader adattivi ----------
   Ogni 21 giorni di borsa il trader prova i "vicini" dei suoi parametri (es. media 20/50 -> 15/50, 25/50, 20/40, 20/60).
   Allenamento: i 2 anni che finiscono 3 mesi fa. Prova: gli ultimi 3 mesi, che non ha usato per scegliere.
   Cambia solo se il vicino batte i parametri attuali in allenamento (Sharpe +0,1) E non fa peggio nella prova.
   Ogni decisione usa solo prezzi già passati: la stessa cosa si può rifare sul passato senza barare. */
const GRID = {
  ma: { dims: [[5, 10, 15, 20, 25, 30, 40, 50], [20, 30, 40, 50, 60, 80, 100, 120, 150, 200]], start: [20, 50], make: (p, ls) => ({ fam: 'ma', f: p[0], s: p[1], ls }), ok: p => p[0] < p[1], label: p => `${p[0]}/${p[1]}` },
  don: { dims: [[10, 15, 20, 30, 40, 55, 70, 85, 100, 120]], start: [55], make: (p, ls) => ({ fam: 'don', n: p[0], ls }), ok: () => true, label: p => `${p[0]} giorni` },
  mr: { dims: [[5, 10, 15, 20, 30, 40], [1, 1.5, 2, 2.5]], start: [20, 2], make: p => ({ fam: 'mr', w: p[0], z: p[1], ls: true }), ok: () => true, label: p => `${p[0]} giorni, ${String(p[1]).replace('.', ',')}σ` },
};
const AD = { every: 21, train: 504, hold: 63, margin: 0.1 };
const gridCache = new Map();
function adaptive(v, A, dates, c) {
  const G = GRID[v.base], n = c.length;
  const ckey = A.short + ':' + v.base + ':' + v.ls + ':' + n + ':' + c[n - 1];
  let cache = gridCache.get(ckey);
  if (!cache) { cache = new Map(); gridCache.set(ckey, cache); }
  const series = p => {                       // rendimenti e somme cumulate per un set di parametri
    const k = p.join(',');
    if (!cache.has(k)) {
      const pp = positions(G.make(p, v.ls), c, A.bench), rr = returns(A, dates, c, t => pp[t]);
      const S1 = new Float64Array(n + 1), S2 = new Float64Array(n + 1);
      for (let t = 0; t < n; t++) { S1[t + 1] = S1[t] + rr[t]; S2[t + 1] = S2[t] + rr[t] * rr[t]; }
      cache.set(k, { pos: pp, S1, S2 });
    }
    return cache.get(k);
  };
  const ppy = n / Math.max(0.5, (dms(dates[n - 1]) - dms(dates[0])) / (365 * DAY));
  const sharpe = (sr, a, b) => {              // rendimenti con indice in (a, b]
    const m = b - a; if (m < 20) return 0;
    const mu = (sr.S1[b + 1] - sr.S1[a + 1]) / m, q = (sr.S2[b + 1] - sr.S2[a + 1]) / m, sd = Math.sqrt(Math.max(0, q - mu * mu));
    return sd > 1e-12 ? mu / sd * Math.sqrt(ppy) : 0;
  };
  const idx = G.start.map((x, d) => G.dims[d].indexOf(x));
  const pOf = ix => ix.map((i, d) => G.dims[d][i]);
  const pos = new Array(n).fill(0), hist = [];
  let cur = idx.slice(), curSeries = series(pOf(cur)), tests = 0;
  const first = 200 + AD.train + AD.hold;
  hist.push({ d: dates[Math.min(first, n - 1)], p: G.label(pOf(cur)), why: 'Parametri di partenza.' });
  let next = first;
  for (let t = 0; t < n; t++) {
    if (t >= next) {
      next = t + AD.every; tests++;
      const tr0 = t - AD.hold - AD.train, tr1 = t - AD.hold, ho0 = t - AD.hold, ho1 = t;
      const curTr = sharpe(curSeries, tr0, tr1), curHo = sharpe(curSeries, ho0, ho1);
      let best = null;
      for (let d = 0; d < cur.length; d++) for (const step of [-1, 1]) {
        const nb = cur.slice(); nb[d] += step;
        if (nb[d] < 0 || nb[d] >= G.dims[d].length || !G.ok(pOf(nb))) continue;
        const sr = series(pOf(nb)), sTr = sharpe(sr, tr0, tr1), sHo = sharpe(sr, ho0, ho1);
        if (sTr > curTr + AD.margin && sHo >= curHo && (!best || sTr > best.sTr)) best = { nb, sr, sTr, sHo };
      }
      if (best) {
        hist.push({ d: dates[t], p: G.label(pOf(best.nb)), from: G.label(pOf(cur)), why: `Allenamento: Sharpe ${best.sTr.toFixed(2).replace('.', ',')} contro ${curTr.toFixed(2).replace('.', ',')}. Ultimi 3 mesi: ${best.sHo.toFixed(2).replace('.', ',')} contro ${curHo.toFixed(2).replace('.', ',')}.` });
        cur = best.nb; curSeries = best.sr;
      }
    }
    pos[t] = curSeries.pos[t];
  }
  return { pos, hist, cur: G.label(pOf(cur)), label: G.label(pOf(cur)), tests };
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

const API = { ASSETS, VARIANTS, BENCH, FLAT, sma, BY_ID, RULES, mlPositions, ML, buildLab, pick, walkForward, scheduleReturns, stats, changes, idxOnOrBefore, addDays, dms, returns, positions, r4 };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
else if (typeof window !== 'undefined') window.Research = API;

})();
