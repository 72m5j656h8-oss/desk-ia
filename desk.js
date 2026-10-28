#!/usr/bin/env node
/*
 * Desk IA v2 — giro giornaliero.
 * 1. Aggiorna i prezzi giornalieri di Bitcoin, Nasdaq-100 ed Euro/Dollaro (con fonti di riserva).
 * 2. Il reparto ricerca di ogni asset valuta le 18 strategie; alla revisione trimestrale sceglie il campione.
 * 3. Controlla le retrocessioni e scrive docs/data/desk.json (decisioni) e docs/data/view.json (dashboard).
 * Soldi finti: nessun ordine reale viene mai inviato.
 *
 * Variabili per i test: DESK_MOCK=<file json url->risposta>, DESK_TODAY=YYYY-MM-DD.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const R = require('./docs/research.js');

const ROOT = __dirname, DATA = path.join(ROOT, 'docs', 'data'), PRICES = path.join(DATA, 'prices');
const TODAY = process.env.DESK_TODAY || new Date().toISOString().slice(0, 10);   // si usano solo giorni chiusi (< oggi)
const START = { BTC: '2015-07-20', NDX: '2012-01-01', EURUSD: '2012-01-01' };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const writeJson = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
const log = m => console.log(m);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const r2 = x => Math.round(x * 100) / 100, r4 = R.r4;

/* ---------- rete ---------- */
async function get(url, kind) {
  if (process.env.DESK_MOCK) {
    const m = readJson(process.env.DESK_MOCK, {});
    const key = Object.keys(m).find(k => url.startsWith(k));
    if (!key) throw new Error('nessuna risposta per ' + url.slice(0, 80));
    if (m[key] === 404) return null;
    return m[key];
  }
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (desk-ia)', Accept: kind === 'text' ? 'text/csv,text/plain,*/*' : 'application/json' } });
      if (r.status === 404) return null;
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return kind === 'text' ? await r.text() : await r.json();
    } catch (e) { if (i === 3) throw e; await sleep(1500 * i); }
  }
}

/* ---------- fonti: ognuna ritorna [[data, o, h, l, c], ...] ---------- */
const bar = (d, o, h, l, c) => { c = +c; o = +o > 0 ? +o : c; h = +h > 0 ? +h : Math.max(o, c); l = +l > 0 ? +l : Math.min(o, c); return [d, o, Math.max(h, o, c), Math.min(l, o, c), c]; };
const iso = ms => new Date(ms).toISOString().slice(0, 10);

async function coinbase(product, from) {
  const out = []; let t = R.dms(from); const end = R.dms(TODAY);
  while (t < end) {
    const to = Math.min(end, t + 299 * 864e5);
    const rows = await get(`https://api.exchange.coinbase.com/products/${product}/candles?granularity=86400&start=${new Date(t).toISOString()}&end=${new Date(to).toISOString()}`);
    for (const r of rows || []) if (r && r[4] > 0) out.push(bar(iso(r[0] * 1000), r[3], r[2], r[1], r[4]));
    t = to + 864e5; if (!process.env.DESK_MOCK) await sleep(300);
  }
  return out;
}
async function yahoo(sym, from) {
  const p1 = Math.floor(R.dms(from) / 1000), p2 = Math.floor(R.dms(TODAY) / 1000) + 86400;
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=history`);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error('risposta Yahoo vuota');
  const q = res.indicators.quote[0], off = (res.meta && res.meta.gmtoffset) || 0, out = [];
  res.timestamp.forEach((ts, i) => { if (q.close[i] > 0) out.push(bar(iso((ts + off) * 1000), q.open[i], q.high[i], q.low[i], q.close[i])); });
  return out;
}
async function stooq(sym, from) {
  const txt = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, 'text');
  if (!txt || !/^Date,/i.test(txt.trim())) throw new Error('risposta Stooq non valida');
  const out = [];
  for (const line of txt.trim().split(/\r?\n/).slice(1)) { const f = line.split(','); if (f[0] >= from && +f[4] > 0) out.push(bar(f[0], f[1], f[2], f[3], f[4])); }
  return out;
}
async function frankfurter(from) {
  let j = null;
  for (const base of ['https://api.frankfurter.app', 'https://api.frankfurter.dev/v1']) {
    try { j = await get(`${base}/${from}..${TODAY}?from=EUR&to=USD`); if (j && j.rates) break; } catch (e) { j = null; }
  }
  if (!j || !j.rates) throw new Error('risposta Frankfurter vuota');
  return Object.entries(j.rates).map(([d, r]) => bar(d, r.USD, r.USD, r.USD, r.USD));
}
const SOURCES = {
  BTC: [['Coinbase', f => coinbase('BTC-USD', f)], ['Yahoo', f => yahoo('BTC-USD', f)]],
  NDX: [['Yahoo', f => yahoo('^NDX', f)], ['Stooq', f => stooq('^ndx', f)]],
  EURUSD: [['Yahoo', f => yahoo('EURUSD=X', f)], ['Stooq', f => stooq('eurusd', f)], ['BCE (Frankfurter)', f => frankfurter(f)]],
};

function clean(rows) {
  const m = new Map();
  for (const b of rows) if (b && /^\d{4}-\d{2}-\d{2}$/.test(b[0]) && b[0] < TODAY && b.slice(1).every(x => x > 0 && isFinite(x))) m.set(b[0], b.map((x, i) => (i ? +(+x).toPrecision(8) : x)));
  return [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

async function updatePrices(key) {
  const file = path.join(PRICES, key + '.json'), old = readJson(file, null);
  const have = old && old.bars && old.bars.length > 300 ? old.bars : null;
  const from = have ? R.addDays(have[have.length - 1][0], -10) : START[key];
  const errors = [];
  for (const [name, fn] of SOURCES[key]) {
    try {
      const rows = clean(await fn(from));
      if (!rows.length) throw new Error('nessun dato');
      if (!have && rows.length < 500) throw new Error('storico troppo corto (' + rows.length + ' giorni)');
      if (have) {
        // controllo di coerenza sui giorni in comune: fonti diverse non devono dare prezzi diversi
        const byD = new Map(have.map(b => [b[0], b[4]]));
        const overlap = rows.filter(b => byD.has(b[0]));
        const bad = overlap.filter(b => Math.abs(b[4] / byD.get(b[0]) - 1) > 0.02);
        if (overlap.length && bad.length > overlap.length / 3) throw new Error('prezzi incoerenti con lo storico salvato');
        const m = new Map(have.map(b => [b[0], b])); rows.forEach(b => m.set(b[0], b));
        const bars = [...m.values()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
        writeJson(file, { key, source: name, updated: TODAY, bars });
        return { bars, source: name, added: bars.length - have.length };
      }
      writeJson(file, { key, source: name, updated: TODAY, bars: rows });
      return { bars: rows, source: name, added: rows.length };
    } catch (e) { errors.push(name + ': ' + e.message); }
  }
  if (have) { log(`  ${key}: prezzi non aggiornati (${errors.join(' · ')}), uso lo storico salvato`); return { bars: have, source: (old.source || '?') + ' (non aggiornato)', added: 0, warn: errors.join(' · ') }; }
  throw new Error(`${key}: nessuna fonte disponibile (${errors.join(' · ')})`);
}

/* ---------- desk di un asset ---------- */
const nameOf = id => (id === 'bench' ? 'Benchmark' : R.BY_ID[id] ? R.BY_ID[id].name : id);

function runAsset(key, bars, st, control) {
  const L = R.buildLab(key, bars), A = L.A, end = L.dates.length - 1, today = L.dates[end];
  const S = st || { launch: today, log: [], nextReview: today };
  const events = [];
  const champ = () => (S.log.length ? S.log[S.log.length - 1] : null);
  const kill = !!(control && control.kill);

  // kill switch: tutto in liquidità finché non viene disattivato (le revisioni aspettano)
  if (kill && S.log.length) {
    const c = champ();
    if (c.id !== 'flat') {
      S.log.push({ d: today, id: 'flat', kind: 'kill switch', prev: c.id, why: `Kill switch attivato${control.reason ? ' (' + control.reason + ')' : ''}: la sala chiude le posizioni e resta in liquidità.` });
      events.push('kill switch: tutto in liquidità');
    }
    return { S, L, view: viewAsset(L, S), events };
  }
  if (!kill && S.log.length && champ().id === 'flat') {
    const c = champ(), back = c.prev || 'bench';
    S.log.push({ d: today, id: back, kind: 'riattivazione', why: `Kill switch disattivato: la sala torna a operare con "${nameOf(back)}".` });
    events.push('kill switch disattivato');
  }

  // revisione trimestrale (alla prima esecuzione: avvio)
  if (!S.log.length || today >= S.nextReview) {
    const wf = R.walkForward(L, end), p = R.pick(L, end);
    const chosen = wf && wf.valid ? p.id : 'bench';
    let why;
    if (!wf) why = 'Storico insufficiente per la verifica: resta il benchmark.';
    else if (!wf.valid) why = `Il metodo di scelta, verificato fuori campione dal ${wf.from}, non ha battuto il benchmark (${pct(wf.ret)} contro ${pct(wf.bench.ret)}): resta il benchmark.`;
    else if (chosen === 'bench') why = `Metodo valido fuori campione, ma oggi nessuna strategia batte il benchmark negli ultimi 2 anni: resta il benchmark.`;
    else why = `Promossa "${nameOf(chosen)}": ${p.why}. Il metodo di scelta ha battuto il benchmark fuori campione dal ${wf.from} (${pct(wf.ret)} contro ${pct(wf.bench.ret)}).`;
    const prev = champ();
    S.log.push({ d: today, id: chosen, kind: S.log.length ? 'revisione' : 'avvio', why, challenger: p.id, wf: wf ? { from: wf.from, ret: wf.ret, bench: wf.bench.ret, sharpe: wf.sharpe, benchSharpe: wf.bench.sharpe, valid: wf.valid, beaten: wf.beaten, quarters: wf.quarters } : null });
    S.nextReview = R.addDays(today, R.RULES.reviewDays);
    events.push(prev && prev.id === chosen ? `revisione: confermato ${nameOf(chosen)}` : `nuovo campione: ${nameOf(chosen)}`);
  } else {
    // retrocessione: il campione fa peggio del benchmark dal vivo
    const c = champ();
    if (c.id !== 'bench' && c.id !== 'flat') {
      const a = R.idxOnOrBefore(L.dates, c.d);
      if (end - a >= R.RULES.demoteDays) {
        const sched = S.log.map(x => ({ i: R.idxOnOrBefore(L.dates, x.d), id: x.id }));
        const rets = R.scheduleReturns(L, sched, R.idxOnOrBefore(L.dates, S.launch));
        const mine = R.stats(rets, L.dates, a, end).ret, bench = R.stats(L.rets.bench, L.dates, a, end).ret;
        if (mine - bench < -R.RULES.demoteGap) {
          S.log.push({ d: today, id: 'bench', kind: 'retrocessione', why: `Dal ${c.d} "${nameOf(c.id)}" ha fatto ${pct(mine)} contro ${pct(bench)} del benchmark: retrocessa, si torna al benchmark fino alla prossima revisione.` });
          events.push('retrocessione: torna il benchmark');
        }
      }
    }
  }
  return { S, L, view: viewAsset(L, S), events };
}
const pct = x => (x >= 0 ? '+' : '') + (x * 100).toFixed(2).replace('.', ',') + '%';

function viewAsset(L, S) {
  const A = L.A, end = L.dates.length - 1, li = Math.max(0, R.idxOnOrBefore(L.dates, S.launch));
  const sched = S.log.map(x => ({ i: R.idxOnOrBefore(L.dates, x.d), id: x.id }));
  const posAt = t => { let id = 'bench'; for (const s of sched) if (s.i <= t) id = s.id; return { id, p: L.pos[id][t] }; };
  const rets = R.scheduleReturns(L, sched, li);
  // curve dal vivo
  const curve = []; let e = A.capital, eb = A.capital * (A.bench === 'long' ? 1 - A.cost : 1);
  curve.push([L.dates[li], r2(A.capital), r2(eb)]);
  for (let t = li + 1; t <= end; t++) { e *= 1 + rets[t]; eb *= 1 + L.rets.bench[t]; curve.push([L.dates[t], r2(e), r2(eb)]); }
  const live = R.stats(rets, L.dates, li, end);
  // operazioni: ogni cambio di posizione dal vivo
  const trades = []; let held = 0, entry = null;
  for (let t = li; t <= end; t++) {
    const { id, p } = posAt(t);
    if (p !== held) {
      const res = held && entry ? held * (L.c[t] / entry - 1) * A.lev - 2 * A.cost * A.lev : null;
      const switched = sched.some(s => s.i === t) && t > li;
      trades.push({ d: L.dates[t], from: held, to: p, price: L.c[t], by: nameOf(id), res: res == null ? null : r4(res),
        why: switched ? `Cambio di campione: ora opera con "${nameOf(id)}".` : t === li ? `Avvio del desk con "${nameOf(id)}".` : `Segnale di "${nameOf(id)}".` });
      held = p; entry = p ? L.c[t] : null;
    }
  }
  // reparto ricerca oggi
  const today = R.pick(L, end), wf = R.walkForward(L, end);
  const fwd = Object.fromEntries([...R.VARIANTS, R.BENCH].map(v => [v.id, r4(R.stats(L.rets[v.id], L.dates, li, end).ret)]));
  const board = (today.board || []).map(b => ({ ...b, name: nameOf(b.id), fwd: fwd[b.id] }));
  const c = S.log[S.log.length - 1];
  const now = posAt(end);
  return {
    key: L.key, name: A.name, short: A.short, capital: A.capital, lev: A.lev, cost: A.cost, benchName: A.benchName, benchKind: A.bench,
    last: { d: L.dates[end], c: L.c[end], chg: end > 0 ? r4(L.c[end] / L.c[end - 1] - 1) : 0 },
    prices: L.dates.slice(-90).map((d, i) => [d, L.c[L.dates.length - 90 + i]]).filter(x => x[1] != null),
    champion: { id: c.id, name: nameOf(c.id), since: c.d, kind: c.kind, why: c.why },
    position: now.p, nextReview: S.nextReview, launch: S.launch,
    live: { ret: r4(live.ret), bench: r4(curve[curve.length - 1][2] / A.capital - 1), maxDD: r4(live.maxDD), sharpe: live.n > 30 ? r4(live.sharpe) : null, days: end - li, equity: curve[curve.length - 1][1], benchEquity: curve[curve.length - 1][2] },
    curve: curve.length > 400 ? curve.filter((x, i) => i % 2 === 0 || i === curve.length - 1) : curve,
    trades: trades.slice(-25).reverse(),
    research: { asOf: L.dates[end], pick: today.id, pickName: nameOf(today.id), pickWhy: today.why, bench: today.bench || null, board, fwdBench: fwd.bench,
      wf: wf ? { from: wf.from, ret: wf.ret, sharpe: wf.sharpe, maxDD: wf.maxDD, cagr: wf.cagr, bench: wf.bench, quarters: wf.quarters, beaten: wf.beaten, valid: wf.valid, curve: wf.curve, picks: wf.picks.map(p => ({ ...p, name: nameOf(p.id) })) } : null,
      tested: R.VARIANTS.length, history: L.dates[0],
      adapt: Object.fromEntries(Object.entries(L.adapt || {}).map(([id, x]) => [id, { cur: x.cur, tests: x.tests, changes: x.hist.length - 1, hist: x.hist.slice(-12).reverse() }])) },
    log: S.log.slice(-10).reverse(),
  };
}

/* ---------- la tua sala: ordini manuali ---------- */
// un giorno "chiude" a quest'ora UTC: l'ordine viene eseguito alla prima chiusura dopo l'ordine
const CLOSE_H = { BTC: 24, NDX: 20, EURUSD: 21 };
function meAsset(key, bars, launch, orders) {
  const L = R.buildLab(key, bars), A = L.A, end = L.dates.length - 1, li = Math.max(0, R.idxOnOrBefore(L.dates, launch));
  const mine = orders.filter(o => o.asset === key).sort((a, b) => (a.ts < b.ts ? -1 : 1));
  const done = [];
  const out = mine.map(o => {
    const ts = Date.parse(o.ts);
    let t = -1;
    for (let k = li; k <= end; k++) if (R.dms(L.dates[k]) + CLOSE_H[key] * 3600e3 > ts) { t = k; break; }
    const target = o.pos === 'LONG' ? o.quota / 100 : o.pos === 'SHORT' ? -o.quota / 100 : 0;
    if (t >= 0) done.push({ i: t, target });
    return { ...o, status: t >= 0 ? 'eseguito' : 'in attesa', d: t >= 0 ? L.dates[t] : null, price: t >= 0 ? L.c[t] : null };
  });
  const posAt = t => { let p = 0; for (const x of done) if (x.i <= t) p = x.target; return p; };
  const rets = R.returns(A, L.dates, L.c, posAt, li + 1, 0);
  const curve = []; let e = A.capital; curve.push([L.dates[li], r2(e)]);
  for (let t = li + 1; t <= end; t++) { e *= 1 + rets[t]; curve.push([L.dates[t], r2(e)]); }
  return { key, short: A.short, pos: posAt(end), equity: r2(e), ret: r4(e / A.capital - 1), curve, orders: out };
}
function combine(curvesByKey) {           // somma giorno per giorno, usando l'ultimo valore noto di ogni asset
  const keys = Object.keys(curvesByKey), days = [...new Set(keys.flatMap(k => curvesByKey[k].map(x => x[0])))].sort();
  const idx = Object.fromEntries(keys.map(k => [k, new Map(curvesByKey[k].map(x => [x[0], x]))])), last = {}, out = [];
  for (const d of days) {
    for (const k of keys) { const x = idx[k].get(d); if (x) last[k] = x; }
    if (keys.every(k => last[k])) out.push([d, ...[1, 2].map(j => r2(keys.reduce((s, k) => s + (last[k][j] ?? 0), 0)))]);
  }
  return out;
}

/* ---------- giro ---------- */
(async () => {
  const state = readJson(path.join(DATA, 'desk.json'), { v: 1, runs: 0, assets: {} });
  const view = { v: 1, generatedAt: new Date().toISOString(), assets: {}, sources: {} };
  const lines = [], meIn = {};
  const orders = readJson(path.join(DATA, 'orders.json'), []);
  const control = readJson(path.join(DATA, 'control.json'), { kill: false });
  const labs = {}, eventsBy = {};
  for (const key of Object.keys(R.ASSETS)) {
    let p;
    try { p = await updatePrices(key); }
    catch (e) { view.sources[key] = { error: e.message }; lines.push(`${key}: SALTATO · ${e.message}`); continue; }
    view.sources[key] = { source: p.source, bars: p.bars.length, from: p.bars[0][0], to: p.bars[p.bars.length - 1][0], warn: p.warn || null };
    const { S, L, view: v, events } = runAsset(key, p.bars, state.assets[key], control);
    state.assets[key] = S; view.assets[key] = v; labs[key] = L; eventsBy[key] = events;
    meIn[key] = { bars: p.bars, launch: S.launch };
    lines.push(`${key}: ${p.source}, ${p.bars.length} giorni (+${p.added}) · campione ${v.champion.name} · posizione ${v.position > 0 ? 'LONG' : v.position < 0 ? 'SHORT' : 'FLAT'} · dal vivo ${pct(v.live.ret)} vs ${pct(v.live.bench)}` + (events.length ? ' · ' + events.join(', ') : ''));
  }
  // totale del fondo, giorno per giorno (gli asset hanno calendari diversi: si usa l'ultimo valore noto)
  const days = [...new Set(Object.values(view.assets).flatMap(a => a.curve.map(x => x[0])))].sort();
  const lastV = {}, total = [];
  for (const d of days) {
    for (const a of Object.values(view.assets)) { const x = a.curve.find(y => y[0] === d); if (x) lastV[a.key] = x; }
    const ks = Object.keys(view.assets); if (ks.every(k => lastV[k])) total.push([d, r2(ks.reduce((s, k) => s + lastV[k][1], 0)), r2(ks.reduce((s, k) => s + lastV[k][2], 0))]);
  }
  if (!Object.keys(view.assets).length) throw new Error('nessun asset disponibile: ' + lines.join(' | '));
  view.total = { capital: Object.values(view.assets).reduce((s, a) => s + a.capital, 0), curve: total };
  const me = Object.fromEntries(Object.entries(meIn).map(([k, x]) => [k, meAsset(k, x.bars, x.launch, Array.isArray(orders) ? orders : [])]));
  view.me = {
    assets: Object.fromEntries(Object.entries(me).map(([k, m]) => [k, { short: m.short, pos: m.pos, equity: m.equity, ret: m.ret }])),
    curve: combine(Object.fromEntries(Object.entries(me).map(([k, m]) => [k, m.curve]))).map(x => [x[0], x[1]]),
    orders: Object.values(me).flatMap(m => m.orders).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 40),
  };
  state.runs++; state.lastRun = new Date().toISOString(); view.runs = state.runs; view.lastRun = state.lastRun;
  view.rules = R.RULES;
  view.names = Object.fromEntries([...R.VARIANTS, R.BENCH, R.FLAT].map(v => [v.id, v.name]));
  // l'organizzazione del fondo: agenti, sala, rischio, report (solo descrittiva, non cambia le operazioni)
  const F = require('./fund.js');
  const prevFeed = readJson(path.join(DATA, 'feed.json'), []);
  const out = F.buildFund({ view, labs, control, eventsBy, prevFeed });
  view.fund = out.fund;
  writeJson(path.join(DATA, 'feed.json'), out.feed);
  view.feed = out.feed.slice(0, 120);
  writeJson(path.join(DATA, 'desk.json'), state);
  writeJson(path.join(DATA, 'view.json'), view);
  lines.forEach(l => log(l));
})().catch(e => { console.error('ERRORE: ' + e.message); process.exit(1); });
