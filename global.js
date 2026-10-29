'use strict';
/*
 * Desk IA — il fondo globale: 17 mercati, tre strategie classiche dei fondi sistematici, rischio controllato.
 * Regole fisse decise prima di guardare i risultati: nessun parametro viene adattato al passato.
 * Soldi finti: $30.000 dal giorno di avvio, prezzi veri.
 */
const P = require('./docs/portfolio.js');
const UNI = require('./universe.js');
const r2 = x => Math.round(x * 100) / 100, r4 = x => Math.round(x * 1e4) / 1e4;
const CAP = 30000, BT_FROM = '2005-01-03';
const CLS = { az: 'Azioni', ob: 'Obbligazioni', mp: 'Materie prime', fx: 'Valute', cr: 'Crypto' };

function runGlobal(state, control, today) {
  const U = UNI.loadUniverse();
  if (!U.SPY || !U.IEF) return { S: state, view: null, events: ['fondo globale: dati insufficienti'] };
  const D = P.align(U, '2003-01-01'), e = D.cal.length - 1, last = D.cal[e];
  const S = state || { launch: last, capital: CAP, kill: [] };
  const events = [];
  // kill switch: dal giorno in cui è acceso il fondo resta in liquidità (che rende come i BOT)
  const k = S.kill.length ? S.kill[S.kill.length - 1] : null;
  if (control && control.kill && !(k && k.on)) { S.kill.push({ d: last, on: true }); events.push('kill switch: fondo globale in liquidità'); }
  if (!(control && control.kill) && k && k.on) { S.kill.push({ d: last, on: false }); events.push('kill switch spento: il fondo globale riprende'); }
  const killedAt = t => { let on = false; for (const x of S.kill) if (x.d <= D.cal[t]) on = x.on; return on; };
  const li = Math.max(0, D.cal.findIndex(d => d >= S.launch));
  const policy = t => (killedAt(t) ? {} : P.targetWeights(D, t, 'multi'));
  const live = P.simulate(D, 'multi', li, { fixed: policy });
  const b6040 = P.simulate(D, null, li, { fixed: P.bench6040(D) }), bSpy = P.simulate(D, null, li, { fixed: () => ({ SPY: 1 }) });
  const curve = []; let a = CAP, b = CAP, c = CAP;
  for (let t = li; t <= e; t++) { if (t > li) { a *= 1 + live.ret[t]; b *= 1 + b6040.ret[t]; c *= 1 + bSpy.ret[t]; } curve.push([D.cal[t], r2(a), r2(b), r2(c)]); }

  // operazioni dal vivo: ogni ribilanciamento con le variazioni di peso sopra l'1%
  const trades = [];
  for (let t = li; t <= e; t++) {
    const w = live.W[t], pw = t > li ? live.W[t - 1] : {};
    if (!w || w === pw) continue;
    const ch = [];
    for (const key of new Set([...Object.keys(w), ...Object.keys(pw || {})])) { const x = w[key] || 0, y = (pw && pw[key]) || 0; if (Math.abs(x - y) >= 0.01) ch.push([key, r4(y), r4(x)]); }
    if (ch.length) trades.push({ d: D.cal[t], changes: ch.sort((p, q) => Math.abs(q[2] - q[1]) - Math.abs(p[2] - p[1])) });
  }
  const W = (live.W[e] && Object.keys(live.W[e]).length) || killedAt(e) ? live.W[e] || {} : P.targetWeights(D, e, 'multi');
  const sinceReb = (() => { let t = e; while (t > li && live.W[t] === live.W[t - 1]) t--; return e - t; })();

  // mercati: peso di oggi, trend, volatilità, ultimo mese
  const markets = D.keys.map(key => {
    const p = D.P[key], m = D.meta[key], ok = D.first[key] >= 0 && e - D.first[key] >= P.CFG.minHist;
    let sd = 0, q = 0; for (let i = e - 59; i <= e; i++) { sd += D.R[key][i]; q += D.R[key][i] ** 2; }
    const vol = Math.sqrt(Math.max(0, q / 60 - (sd / 60) ** 2) * 252);
    return { key, name: m.name, cls: m.cls, w: r4(W[key] || 0), trend: ok ? r4(P.trendSig(p, e)) : null, vol: r4(vol), m1: p[e - 21] ? r4(p[e] / p[e - 21] - 1) : null, y1: p[e - 252] ? r4(p[e] / p[e - 252] - 1) : null };
  }).sort((x, y) => Math.abs(y.w) - Math.abs(x.w));
  const byCls = {}; for (const m of markets) { byCls[m.cls] = byCls[m.cls] || { long: 0, short: 0 }; if (m.w > 0) byCls[m.cls].long += m.w; else byCls[m.cls].short -= m.w; }
  for (const x in byCls) { byCls[x].long = r4(byCls[x].long); byCls[x].short = r4(byCls[x].short); }

  // rischio delle posizioni di oggi sugli ultimi 250 giorni veri
  const pnl = []; for (let t = e - 249; t <= e; t++) { let x = 0; for (const key in W) x += W[key] * D.R[key][t]; pnl.push(x); }
  const srt = pnl.slice().sort((p, q) => p - q), var95 = -srt[Math.floor(0.05 * srt.length)], es = -srt.slice(0, Math.floor(0.05 * srt.length)).reduce((p, q) => p + q, 0) / Math.floor(0.05 * srt.length);
  const m_ = pnl.reduce((p, q) => p + q, 0) / pnl.length, volNow = Math.sqrt(pnl.reduce((p, q) => p + (q - m_) ** 2, 0) / pnl.length * 252);
  const gross = Object.values(W).reduce((p, q) => p + Math.abs(q), 0), net = Object.values(W).reduce((p, q) => p + q, 0);
  const liveEq = curve[curve.length - 1][1];

  // ricerca: le strategie su tutta la storia (dal 2005) contro 60/40 e S&P 500
  const s0 = Math.max(1, D.cal.findIndex(d => d >= BT_FROM)), mid = Math.floor((s0 + e) / 2);
  const runs = { multi: P.simulate(D, 'multi', s0).ret, rp: P.simulate(D, 'rp', s0).ret, trend: P.simulate(D, 'trend', s0).ret, trendL: P.simulate(D, 'trendL', s0).ret,
    b6040: P.simulate(D, null, s0, { fixed: P.bench6040(D) }).ret, spy: P.simulate(D, null, s0, { fixed: () => ({ SPY: 1 }) }).ret };
  const st = (r, s, x) => { const z = P.stats(r, D.cal, s, x, D.rf); return { ret: r4(z.ret), cagr: r4(z.cagr), vol: r4(z.vol), sharpe: r2(z.sharpe), maxDD: r4(z.maxDD) }; };
  const names = { ...Object.fromEntries(Object.entries(P.MODES).map(([k_, v]) => [k_, v.name])), b6040: '60% azioni USA, 40% titoli di Stato', spy: 'S&P 500 compra e tieni' };
  const research = Object.keys(runs).map(id => ({ id, name: names[id], desc: P.MODES[id] ? P.MODES[id].desc : null, all: st(runs[id], s0, e), h1: st(runs[id], s0, mid), h2: st(runs[id], mid, e) }));
  const years = {};
  for (let t = s0 + 1; t <= e; t++) { const y = D.cal[t].slice(0, 4); years[y] = years[y] || [1, 1, 1]; years[y][0] *= 1 + runs.multi[t]; years[y][1] *= 1 + runs.b6040[t]; years[y][2] *= 1 + runs.spy[t]; }
  const crises = [['Crisi finanziaria 2008', '2007-10-09', '2009-03-09'], ['Crisi dell\'euro 2011', '2011-04-29', '2011-10-03'], ['Covid 2020', '2020-02-19', '2020-03-23'], ['Inflazione e tassi 2022', '2022-01-03', '2022-10-12'], ['Vendite di fine 2018', '2018-09-20', '2018-12-24']].map(([n, f, t]) => {
    const i = D.cal.findIndex(d => d >= f), j = D.cal.findIndex(d => d >= t); if (i < s0 || j < 0) return null;
    const g = r => { let x = 1; for (let k_ = i + 1; k_ <= j; k_++) x *= 1 + r[k_]; return r4(x - 1); };
    return { name: n, from: f, to: t, multi: g(runs.multi), b6040: g(runs.b6040), spy: g(runs.spy) };
  }).filter(Boolean);
  const bt = []; let x1 = 1, x2 = 1, x3 = 1;
  for (let t = s0; t <= e; t++) { if (t > s0) { x1 *= 1 + runs.multi[t]; x2 *= 1 + runs.b6040[t]; x3 *= 1 + runs.spy[t]; } if ((t - s0) % 5 === 0 || t === e) bt.push([D.cal[t], r4(x1), r4(x2), r4(x3)]); }

  return {
    S, events,
    view: {
      launch: S.launch, capital: CAP, asOf: last, equity: liveEq, ret: r4(liveEq / CAP - 1), bench: r4(curve[curve.length - 1][2] / CAP - 1), spy: r4(curve[curve.length - 1][3] / CAP - 1),
      days: e - li, curve, kill: killedAt(e), nextRebalance: Math.max(0, P.CFG.rebalance - sinceReb),
      markets, byCls, cls: CLS, risk: { gross: r4(gross), net: r4(net), vol: r4(volNow), var95: r2(var95 * liveEq), es95: r2(es * liveEq), target: P.CFG.target, maxW: P.CFG.maxW, grossMax: P.CFG.gross },
      trades: trades.slice(-12).reverse(), research, years: Object.entries(years).map(([y, v]) => [y, r4(v[0] - 1), r4(v[1] - 1), r4(v[2] - 1)]), crises, bt, btFrom: D.cal[s0],
      cash: r4(D.rf[e] * 252), n: markets.filter(m => m.trend != null).length,
    },
  };
}
module.exports = { runGlobal };
