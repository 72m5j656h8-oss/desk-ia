// Sala DAX — rottura del range Asia con continuazione (Conto Zero DAX v1.0)
// Prezzi: Dukascopy, DAX (DEU.IDX/EUR) minuto per minuto, notte compresa. Soldi finti.
// Regole (identiche allo script Pine "Conto Zero DAX v1.0"):
// 1. Range Asia = massimo e minimo 00:00-08:00 ora italiana (almeno 60 candele M5 su 96)
// 2. Dalle 08:00: prima chiusura M5 sopra il massimo Asia = LONG, se il minimo Asia
//    non e' stato preso prima. SHORT = specchio.
// 3. Stop = meta' del range -/+ 10 punti. Target = RR 1:2.
// 4. Un trade al giorno, chiusura alle 22:00 se non tocca stop o target.
// 5. Costo 2 punti a trade, rischio 0,5% del conto.
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'docs', 'data', 'dax', 'dax.json');
const RULES = { buf: 10, rr: 2, cost: 2, riskPct: 0.5, minAsia: 60, startHour: 8, endHour: 22 };
const HISTORY_FROM = '2022-01-01';
const LIVE_START = '2026-11-11';
const LIVE_CAPITAL = 10000;

// ---------- ora italiana ----------
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const hourCache = new Map();
function rome(ts) {
  const hk = Math.floor(ts / 3600000);
  let base = hourCache.get(hk);
  if (!base) {
    const p = {};
    for (const x of fmt.formatToParts(new Date(hk * 3600000))) p[x.type] = x.value;
    base = { date: `${p.year}-${p.month}-${p.day}`, h: Number(p.hour) % 24 };
    hourCache.set(hk, base);
  }
  return { date: base.date, h: base.h, m: Math.floor((ts % 3600000) / 60000) };
}
function todayRome() { return rome(Date.now()).date; }

// ---------- prezzi ----------
async function fetchM1(fromIso, toIso) {
  const mod = await import('dukascopy-node');
  const getHistoricalRates = mod.getHistoricalRates || (mod.default && mod.default.getHistoricalRates);
  const out = [];
  let a = new Date(fromIso + 'T00:00:00Z');
  const end = new Date(toIso + 'T00:00:00Z');
  while (a < end) {
    const b = new Date(Math.min(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + 1, 1), end.getTime()));
    let rows = [];
    for (let k = 0; k < 3; k++) {
      try {
        rows = await getHistoricalRates({
          instrument: 'deuidxeur', dates: { from: a, to: b }, timeframe: 'm1',
          priceType: 'bid', format: 'json', volumes: false,
          batchSize: 10, pauseBetweenBatchesMs: 500, retryCount: 3,
        });
        break;
      } catch (e) {
        console.log(`  errore ${a.toISOString().slice(0, 10)}: ${e.message} (tentativo ${k + 1})`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
    for (const r of rows) out.push([r.timestamp, r.open, r.high, r.low, r.close]);
    console.log(`  ${a.toISOString().slice(0, 7)}: ${rows.length} minuti`);
    a = b;
  }
  out.sort((x, y) => x[0] - y[0]);
  return out;
}

// ---------- strategia ----------
function lowerBound(arr, ts) {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid][0] < ts) lo = mid + 1; else hi = mid; }
  return lo;
}

function runDays(m1, fromDate, toDate) {
  // candele M5 raggruppate per giorno italiano
  const days = new Map();
  let cur = null;
  for (const [ts, o, h, l, c] of m1) {
    const t5 = Math.floor(ts / 300000) * 300000;
    if (!cur || cur.t !== t5) {
      if (cur) push(cur);
      cur = { t: t5, o, h, l, c };
    } else {
      if (h > cur.h) cur.h = h;
      if (l < cur.l) cur.l = l;
      cur.c = c;
    }
  }
  if (cur) push(cur);
  function push(b) {
    const r = rome(b.t);
    if (!days.has(r.date)) days.set(r.date, []);
    b.hr = r.h; days.get(r.date).push(b);
  }

  const trades = [];
  for (const [date, bars] of [...days.entries()].sort()) {
    if (date < fromDate || date > toDate) continue;
    const asia = bars.filter(b => b.hr < RULES.startHour);
    if (asia.length < RULES.minAsia) continue;
    const aH = Math.max(...asia.map(b => b.h));
    const aL = Math.min(...asia.map(b => b.l));
    const mid = (aH + aL) / 2;
    const day = bars.filter(b => b.hr >= RULES.startHour && b.hr < RULES.endHour);
    if (!day.length) continue;
    const tEnd = day[day.length - 1].t + 300000;
    let takenH = false, takenL = false;
    for (const b of day) {
      if (b.h > aH) takenH = true;
      if (b.l < aL) takenL = true;
      let side = 0;
      if (b.c > aH && !takenL) side = 1;
      else if (b.c < aL && !takenH) side = -1;
      if (!side) continue;
      const e = b.c;
      const stop = side === 1 ? mid - RULES.buf : mid + RULES.buf;
      const risk = (e - stop) * side;
      if (risk <= 0) break;
      const tgt = e + side * RULES.rr * risk;
      const tIn = b.t + 300000;
      let i = lowerBound(m1, tIn);
      let res = null, exitPx = null, exitTs = null;
      for (; i < m1.length && m1[i][0] < tEnd; i++) {
        const [ts, , h, l, c] = m1[i];
        const hitS = side === 1 ? l <= stop : h >= stop;
        const hitT = side === 1 ? h >= tgt : l <= tgt;
        if (hitS) { res = 'stop'; exitPx = stop; exitTs = ts; break; }
        if (hitT) { res = 'target'; exitPx = tgt; exitTs = ts; break; }
        exitPx = c; exitTs = ts;
      }
      if (exitPx === null) break;
      if (!res) res = '22:00';
      const R = (exitPx - e) * side / risk - RULES.cost / risk;
      const rt = rome(tIn), rx = rome(exitTs + 60000);
      const hm = r => `${String(r.h).padStart(2, '0')}:${String(r.m).padStart(2, '0')}`;
      trades.push({
        d: date, side: side === 1 ? 'LONG' : 'SHORT', in: hm(rt), out: hm(rx),
        aH: +aH.toFixed(1), aL: +aL.toFixed(1), entry: +e.toFixed(1), stop: +stop.toFixed(1), tgt: +tgt.toFixed(1),
        exit: +exitPx.toFixed(1), res, risk: +risk.toFixed(1), R: +R.toFixed(2),
      });
      break; // un trade al giorno
    }
  }
  return trades;
}

function stats(list) {
  const n = list.length;
  if (!n) return { n: 0, R: 0, pf: 0, win: 0, ret: 0, dd: 0 };
  let gp = 0, gl = 0, eq = 1, pk = 1, dd = 0;
  for (const t of list) {
    if (t.R > 0) gp += t.R; else gl -= t.R;
    eq *= 1 + RULES.riskPct / 100 * t.R; pk = Math.max(pk, eq); dd = Math.max(dd, 1 - eq / pk);
  }
  return {
    n, R: +(gp - gl).toFixed(1), pf: gl ? +(gp / gl).toFixed(2) : null,
    win: +(list.filter(t => t.R > 0).length / n * 100).toFixed(1),
    ret: +((eq - 1) * 100).toFixed(1), dd: +(dd * 100).toFixed(1),
  };
}

async function main() {
  let state = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : null;
  const today = todayRome();
  const lastDone = state ? state.lastDay : null;
  // si elaborano solo giornate concluse (fino a ieri)
  const y = new Date(today + 'T12:00:00Z'); y.setUTCDate(y.getUTCDate() - 1);
  const toDate = y.toISOString().slice(0, 10);
  const fromDate = lastDone ? nextDay(lastDone) : HISTORY_FROM;
  if (fromDate > toDate) { console.log('Niente di nuovo da elaborare.'); return; }

  const fetchFrom = prevDay(prevDay(fromDate));
  const fetchTo = today;
  console.log(`Scarico DAX M1 da ${fetchFrom} a ${fetchTo}...`);
  const m1 = await fetchM1(fetchFrom, fetchTo);
  console.log(`Minuti scaricati: ${m1.length}`);
  if (!m1.length) throw new Error('Nessun dato da Dukascopy: riprova piu tardi.');

  const newTrades = runDays(m1, fromDate, toDate);
  const trades = (state ? state.trades : []).concat(newTrades);

  const years = {};
  for (const t of trades) (years[t.d.slice(0, 4)] ||= []).push(t);
  const byYear = Object.fromEntries(Object.entries(years).map(([k, v]) => [k, stats(v)]));

  const live = trades.filter(t => t.d >= LIVE_START);
  let eq = LIVE_CAPITAL;
  for (const t of live) eq *= 1 + RULES.riskPct / 100 * t.R;

  state = {
    name: 'Sala DAX', strategy: 'Conto Zero DAX v1.0 — rottura range Asia',
    rules: RULES, liveStart: LIVE_START, capital: LIVE_CAPITAL,
    updated: new Date().toISOString(), lastDay: toDate,
    equity: +eq.toFixed(2), live: stats(live), all: stats(trades), byYear,
    trades,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(state));
  console.log(`Nuovi trade: ${newTrades.length}. Per anno:`);
  for (const [k, v] of Object.entries(byYear)) console.log(`  ${k}: ${v.n} trade, ${v.R}R, PF ${v.pf}, win ${v.win}%, ${v.ret}% (DD ${v.dd}%)`);
  console.log(`Sala dal ${LIVE_START}: ${live.length} trade, conto ${eq.toFixed(2)} EUR`);
}

if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { runDays, stats };

function nextDay(d) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); }
function prevDay(d) { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); }
