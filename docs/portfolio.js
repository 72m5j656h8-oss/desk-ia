/*
 * Desk IA — motore del portafoglio globale (gira sia su GitHub sia nel browser).
 * Metodi classici dei fondi sistematici, con pochi numeri fissati in anticipo (niente ottimizzazione sul passato):
 *  - parità di rischio: ogni mercato pesa in base a quanto oscilla, così nessuno domina il rischio;
 *  - trend su tanti mercati (time-series momentum): long se il mercato sale da 1, 3, 6 e 12 mesi, short se scende;
 *  - obiettivo di volatilità: il portafoglio intero viene scalato per oscillare circa il 10% l'anno.
 * Le decisioni usano solo prezzi già chiusi e valgono dal giorno dopo. Costi, finanziamento della leva e degli short inclusi.
 */
(function (root) {
'use strict';
const DAY = 864e5, Y = 252;
const CFG = { volWin: 60, covWin: 126, target: 0.10, gross: 2.0, rebalance: 5, lookbacks: [21, 63, 126, 252], spread: 0.005, shortFee: 0.01, minHist: 260, maxW: 0.35 };

// allinea tutto al calendario della borsa USA (Bitcoin viene letto ai giorni di borsa)
function align(U, start) {
  const cal = U.SPY.bars.map(b => b[0]).filter(d => !start || d >= start);
  const all = Object.keys(U), keys = all.filter(k => !U[k].rate), rk = all.find(k => U[k].rate);
  const P = {}, first = {};
  for (const k of all) {
    const m = U[k].bars; let j = 0, last = null; const p = new Array(cal.length).fill(null);
    for (let t = 0; t < cal.length; t++) { while (j < m.length && m[j][0] <= cal[t]) { last = m[j][1]; j++; } p[t] = last; }
    P[k] = p; first[k] = p.findIndex(x => x != null);
  }
  const R = {};
  for (const k of keys) { const p = P[k]; R[k] = p.map((x, t) => (t && x != null && p[t - 1] != null ? x / p[t - 1] - 1 : 0)); }
  // tasso giornaliero della liquidità (BOT USA a 3 mesi); senza dati si assume zero
  const rf = cal.map((d, t) => (rk && P[rk][t] != null ? P[rk][t] / 100 / Y : 0));
  return { cal, keys, P, R, first, rf, meta: Object.fromEntries(keys.map(k => [k, U[k]])) };
}

function stdev(a, s, e) { let m = 0, q = 0, n = e - s; if (n < 2) return 0; for (let i = s; i < e; i++) { m += a[i]; q += a[i] * a[i]; } m /= n; return Math.sqrt(Math.max(0, q / n - m * m)); }

// segnale di trend tra -1 e +1: media dei segni dei rendimenti a 1, 3, 6, 12 mesi
function trendSig(p, t) { let s = 0, n = 0; for (const L of CFG.lookbacks) if (t - L >= 0 && p[t - L] != null) { s += Math.sign(p[t] / p[t - L] - 1); n++; } return n === CFG.lookbacks.length ? s / n : 0; }

// pesi obiettivo al giorno t (con le chiusure fino a t compresa)
const MODES = {
  multi: { name: 'Multi-strategia', short: 'il fondo', desc: 'Un terzo in ciascuna delle tre strategie qui sotto: diversifica anche tra i metodi.' },
  rp: { name: 'Parità di rischio', desc: 'Sempre investito in tutti i mercati; chi oscilla di più pesa di meno.' },
  trend: { name: 'Trend long/short', desc: 'Long sui mercati che salgono, short su quelli che scendono (come i fondi CTA).' },
  trendL: { name: 'Trend solo long', desc: 'Compra solo i mercati in salita, gli altri restano in liquidità.' },
};
function targetWeights(D, t, mode, universe) {
  if (mode === 'multi') {
    const out = {};
    for (const m of ['rp', 'trend', 'trendL']) { const w = targetWeights(D, t, m, universe); for (const k in w) out[k] = (out[k] || 0) + w[k] / 3; }
    for (const k in out) if (Math.abs(out[k]) < 1e-4) delete out[k];
    return out;
  }
  const ks = (universe || D.keys).filter(k => D.first[k] >= 0 && t - D.first[k] >= CFG.minHist);
  if (!ks.length) return {};
  const vol = {}, raw = {};
  for (const k of ks) vol[k] = Math.max(1e-4, stdev(D.R[k], t - CFG.volWin + 1, t + 1) * Math.sqrt(Y));
  for (const k of ks) {
    const inv = 1 / vol[k];
    if (mode === 'rp') raw[k] = inv;
    else if (mode === 'trend') raw[k] = inv * trendSig(D.P[k], t);
    else if (mode === 'trendL') raw[k] = inv * Math.max(0, trendSig(D.P[k], t));
    else if (mode === 'rpTrend') raw[k] = inv * (trendSig(D.P[k], t) > -0.5 ? 1 : 0);   // parità di rischio, ma esce dai mercati in forte discesa
  }
  // obiettivo di volatilità con la covarianza degli ultimi 6 mesi
  const act = ks.filter(k => raw[k] !== 0);
  if (!act.length) return {};
  const s = t - CFG.covWin + 1;
  const port = []; for (let i = s; i <= t; i++) { let x = 0; for (const k of act) x += raw[k] * D.R[k][i]; port.push(x); }
  const pv = stdev(port, 0, port.length) * Math.sqrt(Y);
  let k_ = pv > 0 ? CFG.target / pv : 0;
  const w = {}; let g = 0;
  for (const k of act) { w[k] = raw[k] * k_; }
  // un solo mercato non può superare il 35% del capitale (Bitcoin, per esempio)
  for (const k of act) w[k] = Math.max(-CFG.maxW, Math.min(CFG.maxW, w[k]));
  for (const k of act) g += Math.abs(w[k]);
  if (g > CFG.gross) for (const k of act) w[k] *= CFG.gross / g;
  return w;
}

// simulazione: ribilancia ogni 5 giorni di borsa, rendimento dal giorno dopo la decisione
function simulate(D, mode, from, opts) {
  opts = opts || {};
  const n = D.cal.length, ret = new Array(n).fill(0), W = new Array(n).fill(null);
  let w = {}, since = -1;
  const startT = Math.max(1, from || 0);
  for (let t = startT; t < n; t++) {
    // rendimento di oggi con i pesi decisi ieri
    let r = 0, lng = 0, sh = 0;
    for (const k in w) { r += w[k] * D.R[k][t]; if (w[k] > 0) lng += w[k]; else sh -= w[k]; }
    // la liquidità non investita rende come i BOT; la leva costa BOT + 0,5%; gli short pagano l'1% l'anno di prestito titoli
    const cash = 1 - lng, rf = opts.noCash ? 0 : D.rf[t - 1];
    r += cash >= 0 ? cash * rf : cash * (rf + CFG.spread / Y);
    r -= sh * CFG.shortFee / Y;
    ret[t] = r;
    // nuova decisione alla chiusura di oggi
    if (since < 0 || t - since >= CFG.rebalance) {
      const nw = opts.fixed ? opts.fixed(t) : targetWeights(D, t, mode, opts.universe);
      let cost = 0; const all = new Set([...Object.keys(w), ...Object.keys(nw)]);
      for (const k of all) cost += Math.abs((nw[k] || 0) - (w[k] || 0)) * D.meta[k].cost;
      ret[t] -= cost; w = nw; since = t;
    }
    W[t] = w;
  }
  return { ret, W };
}

// Sharpe calcolato sul rendimento in più rispetto alla liquidità (BOT), come si fa nei fondi
function stats(ret, cal, s, e, rf) {
  let eq = 1, pk = 1, dd = 0, m = 0, q = 0, n = 0;
  for (let t = s + 1; t <= e; t++) { const x = ret[t] - (rf ? rf[t - 1] : 0); eq *= 1 + ret[t]; pk = Math.max(pk, eq); dd = Math.max(dd, 1 - eq / pk); m += x; q += x * x; n++; }
  const mu = n ? m / n : 0, sd = n ? Math.sqrt(Math.max(0, q / n - mu * mu)) : 0;
  const yrs = Math.max(1e-9, (Date.parse(cal[e]) - Date.parse(cal[s])) / (365.25 * DAY));
  return { ret: eq - 1, cagr: Math.pow(eq, 1 / yrs) - 1, vol: sd * Math.sqrt(Y), sharpe: sd > 0 ? mu / sd * Math.sqrt(Y) : 0, maxDD: dd, n };
}

// benchmark: 60% azioni USA e 40% titoli di Stato 7-10 anni, ribilanciato ogni mese
function bench6040(D) { return t => (D.first.IEF >= 0 && t >= D.first.IEF ? { SPY: 0.6, IEF: 0.4 } : { SPY: 1 }); }

const api = { CFG, MODES, align, simulate, stats, targetWeights, trendSig, bench6040 };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Portfolio = api;
})(typeof window !== 'undefined' ? window : globalThis);
