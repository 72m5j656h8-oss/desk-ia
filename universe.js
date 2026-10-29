#!/usr/bin/env node
/*
 * Desk IA — l'universo del portafoglio globale.
 * Scarica e aggiorna i prezzi giornalieri di tanti mercati (azioni, obbligazioni, materie prime, valute, crypto).
 * Per gli ETF si usa il prezzo "adjusted" (dividendi e cedole reinvestiti): è il rendimento vero di chi li possiede.
 * Uso: node universe.js   (oppure require('./universe.js').updateUniverse())
 */
'use strict';
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, 'docs', 'data', 'universe');
const TODAY = process.env.DESK_TODAY || new Date().toISOString().slice(0, 10);

// classe: az = azioni, ob = obbligazioni, mp = materie prime, fx = valute, cr = crypto
const UNIVERSE = [
  { key: 'SPY', name: 'Azioni USA (S&P 500)', cls: 'az', y: 'SPY', s: 'spy.us', cost: 0.0005 },
  { key: 'QQQ', name: 'Nasdaq-100', cls: 'az', y: 'QQQ', s: 'qqq.us', cost: 0.0005 },
  { key: 'IWM', name: 'Piccole aziende USA', cls: 'az', y: 'IWM', s: 'iwm.us', cost: 0.0005 },
  { key: 'EFA', name: 'Azioni Europa, Giappone e Australia', cls: 'az', y: 'EFA', s: 'efa.us', cost: 0.0005 },
  { key: 'EEM', name: 'Azioni paesi emergenti', cls: 'az', y: 'EEM', s: 'eem.us', cost: 0.0008 },
  { key: 'VNQ', name: 'Immobiliare USA', cls: 'az', y: 'VNQ', s: 'vnq.us', cost: 0.0008 },
  { key: 'TLT', name: 'Titoli di Stato USA 20+ anni', cls: 'ob', y: 'TLT', s: 'tlt.us', cost: 0.0005 },
  { key: 'IEF', name: 'Titoli di Stato USA 7-10 anni', cls: 'ob', y: 'IEF', s: 'ief.us', cost: 0.0005 },
  { key: 'LQD', name: 'Obbligazioni aziendali USA', cls: 'ob', y: 'LQD', s: 'lqd.us', cost: 0.0008 },
  { key: 'TIP', name: 'Titoli USA legati all\'inflazione', cls: 'ob', y: 'TIP', s: 'tip.us', cost: 0.0008 },
  { key: 'GLD', name: 'Oro', cls: 'mp', y: 'GLD', s: 'gld.us', cost: 0.0005 },
  { key: 'SLV', name: 'Argento', cls: 'mp', y: 'SLV', s: 'slv.us', cost: 0.0008 },
  { key: 'USO', name: 'Petrolio', cls: 'mp', y: 'USO', s: 'uso.us', cost: 0.0008 },
  { key: 'DBC', name: 'Paniere materie prime', cls: 'mp', y: 'DBC', s: 'dbc.us', cost: 0.0008 },
  { key: 'UUP', name: 'Dollaro USA', cls: 'fx', y: 'UUP', s: 'uup.us', cost: 0.0008 },
  { key: 'FXE', name: 'Euro', cls: 'fx', y: 'FXE', s: 'fxe.us', cost: 0.0008 },
  { key: 'FXY', name: 'Yen giapponese', cls: 'fx', y: 'FXY', s: 'fxy.us', cost: 0.0008 },
  { key: 'BTC', name: 'Bitcoin', cls: 'cr', y: 'BTC-USD', s: null, cost: 0.0015 },
  // non si compra: è il tasso dei BOT USA a 3 mesi (in %), usato per la liquidità e per il costo della leva
  { key: 'IRX', name: 'Tasso BOT USA 3 mesi', cls: 'tasso', y: '^IRX', s: null, cost: 0, rate: true },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function get(url, text) {
  for (let i = 1; i <= 3; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (desk-ia)' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return text ? await r.text() : await r.json();
    } catch (e) { if (i === 3) throw e; await sleep(1500 * i); }
  }
}
// Yahoo con tutta la storia a volte omette l'ultimo giorno: si scarica anche l'ultimo mese e si uniscono
async function yahoo(sym) {
  const full = await yahooRange(sym, 0), p1 = Math.floor(Date.parse(TODAY + 'T00:00:00Z') / 1000) - 40 * 86400;
  let recent = []; try { recent = await yahooRange(sym, p1); } catch (e) { recent = []; }
  const m = new Map(full); for (const [d, c] of recent) m.set(d, c);
  return [...m.entries()];
}
async function yahooRange(sym, p1) {
  const p2 = Math.floor(Date.parse(TODAY + 'T00:00:00Z') / 1000) + 86400;
  const j = await get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?period1=${p1}&period2=${p2}&interval=1d&events=div,split`);
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res || !res.timestamp) throw new Error('risposta Yahoo vuota');
  const q = res.indicators.quote[0], adj = res.indicators.adjclose && res.indicators.adjclose[0] && res.indicators.adjclose[0].adjclose;
  const off = (res.meta && res.meta.gmtoffset) || 0, out = [];
  res.timestamp.forEach((ts, i) => { const c = adj && adj[i] > 0 ? adj[i] : q.close[i]; if (c > 0 || (c === 0 && sym === '^IRX')) out.push([new Date((ts + off) * 1000).toISOString().slice(0, 10), +c.toPrecision(8)]); });
  return out;
}
async function stooq(sym) {
  const txt = await get(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, true);
  if (!txt || !/^Date,/i.test(txt.trim())) throw new Error('risposta Stooq non valida');
  return txt.trim().split(/\r?\n/).slice(1).map(l => l.split(',')).filter(f => +f[4] > 0).map(f => [f[0], +(+f[4]).toPrecision(8)]);
}
function clean(rows) {
  const m = new Map();
  for (const [d, c] of rows) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && d < TODAY && c >= 0 && isFinite(c)) m.set(d, c);
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
}
const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return null; } };

async function updateOne(u) {
  const file = path.join(DIR, u.key + '.json'), old = read(file);
  const errs = [];
  for (const [name, fn] of [['Yahoo', () => yahoo(u.y)], ...(u.s ? [['Stooq', () => stooq(u.s)]] : [])]) {
    try {
      const rows = clean(await fn());
      if (rows.length < 500) throw new Error('storico troppo corto');
      // Yahoo ricalcola tutto lo storico "adjusted" a ogni dividendo: si sostituisce l'intera serie,
      // ma solo se è coerente con quella salvata negli ultimi giorni (rendimenti uguali)
      if (!u.rate && old && old.bars && old.bars.length > 500) {
        const m = new Map(old.bars), last = rows.slice(-30).filter(r => m.has(r[0]));
        let bad = 0; for (let i = 1; i < last.length; i++) { const a = last[i][1] / last[i - 1][1], b = m.get(last[i][0]) / m.get(last[i - 1][0]); if (Math.abs(a - b) > 0.01) bad++; }
        if (last.length > 5 && bad > last.length / 3) throw new Error('prezzi incoerenti con lo storico salvato');
      }
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ key: u.key, source: name, updated: TODAY, bars: rows }));
      return { key: u.key, ok: true, source: name, n: rows.length, from: rows[0][0], to: rows[rows.length - 1][0] };
    } catch (e) { errs.push(name + ': ' + e.message); }
  }
  return { key: u.key, ok: !!(old && old.bars), source: old ? (old.source || '?') + ' (non aggiornato)' : null, warn: errs.join(' · '), n: old && old.bars ? old.bars.length : 0 };
}
async function updateUniverse() {
  const out = [];
  for (const u of UNIVERSE) { out.push(await updateOne(u)); await sleep(400); }
  return out;
}
function loadUniverse() {
  const o = {};
  for (const u of UNIVERSE) { const j = read(path.join(DIR, u.key + '.json')); if (j && j.bars && j.bars.length > 500) o[u.key] = { ...u, bars: j.bars, source: j.source }; }
  return o;
}
module.exports = { UNIVERSE, updateUniverse, loadUniverse };
if (require.main === module) updateUniverse().then(r => r.forEach(x => console.log(x.key, x.ok ? 'ok' : 'ERRORE', x.source || '', x.n, x.from || '', x.to || '', x.warn || ''))).catch(e => { console.error(e); process.exit(1); });
