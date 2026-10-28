'use strict';
/*
 * Desk IA — l'organizzazione del fondo.
 * Agenti, messaggi della sala, regime macro, rischio e report per gli investitori.
 * Tutto è calcolato dai dati veri di questo giro: nessun numero inventato.
 * Questa parte DESCRIVE il fondo; le operazioni le decidono solo le regole del desk.
 */
const R = require('./docs/research.js');

const r2 = x => Math.round(x * 100) / 100, r4 = x => Math.round(x * 1e4) / 1e4;
const pct = (x, d = 1) => (x >= 0 ? '+' : '') + (x * 100).toFixed(d).replace('.', ',') + '%';
const usd = x => '$' + Number(x).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pp = (x, d = 1) => (x * 100).toFixed(d).replace('.', ',') + '%';
const clamp = x => Math.max(0, Math.min(100, Math.round(x)));
const posTxt = p => (p > 0 ? 'LONG' : p < 0 ? 'SHORT' : 'FLAT');

const NOMI = ['Noa', 'Alba', 'Marco', 'Amara', 'Ines', 'Pablo', 'Martina', 'Aitana', 'Claudia', 'Mara', 'Luca', 'Chiara', 'Tommaso', 'Giada', 'Ettore', 'Bianca', 'Riccardo', 'Nina', 'Filippo', 'Viola', 'Matteo', 'Irene', 'Samuele', 'Greta', 'Leonardo', 'Sofia', 'Andrea', 'Elisa', 'Gabriele', 'Arianna'];
const COGNOMI = ['Singh', 'Serra', 'Galli', 'Ortega', 'Vitale', 'Molina', 'Navarro', 'Torres', 'Cano', 'Rubio', 'Lopez', 'Fontana', 'Ricci', 'Moretti', 'Barbieri', 'Lombardi', 'Gatti', 'Costa', 'Mancini', 'Rinaldi', 'Caruso', 'Ferraro', 'Colombo', 'Leone', 'Longo', 'Gentile', 'Martini', 'Villa', 'Marchetti', 'Sala'];
function hash(s) { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const traderName = id => { const h = hash(id); return NOMI[h % NOMI.length] + ' ' + COGNOMI[(h >>> 8) % COGNOMI.length]; };

// lo staff fisso del fondo
const STAFF = {
  cio: { name: 'Giulia Ferri', role: 'Direttrice degli investimenti', dept: 'Direzione' },
  risk: { name: 'Marco De Luca', role: 'Risk manager', dept: 'Rischio' },
  macro: { name: 'Elena Russo', role: 'Analista macro', dept: 'Macro' },
  ml: { name: 'Davide Conti', role: 'Ingegnere machine learning', dept: 'Ricerca' },
  BTC: { name: 'Luca Marino', role: 'Analista quantitativo · Bitcoin', dept: 'Analisi' },
  NDX: { name: 'Sara Greco', role: 'Analista quantitativa · Nasdaq-100', dept: 'Analisi' },
  EURUSD: { name: 'Paolo Bruno', role: 'Analista quantitativo · Euro/Dollaro', dept: 'Analisi' },
};
const LIMITS = { gross: 1.5, netAsset: 1.0, var95: 0.05, ddKill: 0.12 };

function indicators(L) {
  const c = L.c, n = c.length - 1, s50 = R.sma(c, 50), s200 = R.sma(c, 200);
  const r = c.map((x, i) => (i ? x / c[i - 1] - 1 : 0));
  let g = 0, l = 0; for (let k = n - 13; k <= n; k++) { if (r[k] > 0) g += r[k]; else l -= r[k]; }
  const vol = k => { let a = 0, b = 0; for (let j = k - 19; j <= k; j++) { a += r[j]; b += r[j] * r[j]; } return Math.sqrt(Math.max(0, b / 20 - (a / 20) ** 2)); };
  const v = vol(n), hist = []; for (let k = n - 250; k <= n; k++) if (k > 20) hist.push(vol(k));
  const pctile = hist.length ? hist.filter(x => x <= v).length / hist.length : 0.5;
  return { price: c[n], above50: c[n] > s50[n], above200: c[n] > s200[n], d200: c[n] / s200[n] - 1, rsi: (l + g) > 0 ? 100 * g / (g + l) : 50, vol: v, volPct: pctile, r20: c[n] / c[n - 20] - 1 };
}

function buildFund({ view, labs, control, eventsBy, prevFeed }) {
  const keys = Object.keys(view.assets), today = new Date().toISOString().slice(0, 10);
  const A = view.assets, ind = {}, ml = {};
  for (const k of keys) {
    const L = labs[k]; ind[k] = indicators(L);
    // reparto ML: probabilità di oggi e precisione fuori campione negli ultimi 12 mesi, contro la frequenza di base
    const v = R.BY_ID['ml-5-ls'], m = R.mlPositions(v, L.c), n = L.c.length - 1;
    let hits = 0, tot = 0, ups = 0;
    for (let t = Math.max(0, n - 260); t + 5 <= n; t++) if (m.prob[t] != null) { tot++; const up = L.c[t + 5] > L.c[t]; if (up) ups++; if ((m.prob[t] > 0.5) === up) hits++; }
    ml[k] = { prob: m.prob[n] == null ? null : r4(m.prob[n]), acc: tot ? r4(hits / tot) : null, base: tot ? r4(Math.max(ups, tot - ups) / tot) : null, accAll: m.accuracy == null ? null : r4(m.accuracy), weights: m.weights };
  }

  /* ---------- regime macro (solo informativo) ---------- */
  const sig = [];
  if (ind.NDX) sig.push({ ok: ind.NDX.above200, txt: `Nasdaq ${ind.NDX.above200 ? 'sopra' : 'sotto'} la media 200 (${pct(ind.NDX.d200)})` });
  if (ind.BTC) sig.push({ ok: ind.BTC.above200, txt: `Bitcoin ${ind.BTC.above200 ? 'sopra' : 'sotto'} la media 200 (${pct(ind.BTC.d200)})` });
  if (ind.NDX) sig.push({ ok: ind.NDX.volPct < 0.7, txt: `volatilità del Nasdaq al ${Math.round(ind.NDX.volPct * 100)}° percentile dell'anno` });
  const score = sig.filter(s => s.ok).length;
  const regime = { label: score >= 2 ? 'RISK-ON' : score === 1 ? 'NEUTRO' : 'RISK-OFF', score, of: sig.length, signals: sig.map(s => s.txt),
    dollar: ind.EURUSD ? (ind.EURUSD.above200 ? 'dollaro debole (euro sopra la media 200)' : 'dollaro forte (euro sotto la media 200)') : null };

  /* ---------- rischio ---------- */
  const nav = keys.reduce((s, k) => s + A[k].live.equity, 0);
  const expo = Object.fromEntries(keys.map(k => [k, A[k].position * A[k].lev * A[k].live.equity]));
  const gross = keys.reduce((s, k) => s + Math.abs(expo[k]), 0) / nav, net = keys.reduce((s, k) => s + expo[k], 0) / nav;
  // VaR storico a 1 giorno: le posizioni di oggi applicate agli ultimi 250 giorni di mercato
  const maps = Object.fromEntries(keys.map(k => { const L = labs[k], m = new Map(); for (let i = 1; i < L.c.length; i++) m.set(L.dates[i], L.c[i] / L.c[i - 1] - 1); return [k, m]; }));
  const allDays = [...new Set(keys.flatMap(k => labs[k].dates.slice(-260)))].sort().slice(-250);
  const pnl = allDays.map(d => keys.reduce((s, k) => s + expo[k] * (maps[k].get(d) || 0), 0)).sort((a, b) => a - b);
  const q = Math.floor(0.05 * pnl.length), var95 = pnl.length ? -pnl[q] : 0;
  const es95 = q > 0 ? -pnl.slice(0, q).reduce((a, b) => a + b, 0) / q : var95;
  const curve = view.total.curve; let peak = curve.length ? curve[0][1] : nav, dd = 0;
  for (const x of curve) { peak = Math.max(peak, x[1]); dd = Math.max(dd, 1 - x[1] / peak); }
  const ddNow = curve.length ? 1 - curve[curve.length - 1][1] / Math.max(...curve.map(x => x[1])) : 0;
  const breaches = [];
  if (gross > LIMITS.gross) breaches.push(`esposizione lorda ${pct(gross, 0)} oltre il limite di ${pct(LIMITS.gross, 0)}`);
  for (const k of keys) if (Math.abs(expo[k]) / nav > LIMITS.netAsset) breaches.push(`${A[k].short} oltre il ${pct(LIMITS.netAsset, 0)} del patrimonio`);
  if (var95 / nav > LIMITS.var95) breaches.push(`VaR 95% al ${pct(var95 / nav)} del patrimonio`);
  if (ddNow > LIMITS.ddKill) breaches.push(`perdita dal massimo ${pct(-ddNow)}: valutare il kill switch`);
  const risk = { nav: r2(nav), gross: r4(gross), net: r4(net), var95: r2(var95), es95: r2(es95), varPct: r4(var95 / nav), maxDD: r4(dd), ddNow: r4(ddNow),
    expo: Object.fromEntries(keys.map(k => [k, r4(expo[k] / nav)])), limits: LIMITS, breaches, kill: !!control.kill, killSince: control.since || null, killReason: control.reason || null };

  /* ---------- report per gli investitori ---------- */
  const cap = view.total.capital, months = [];
  const byMonth = new Map(); for (const x of curve) byMonth.set(x[0].slice(0, 7), x);
  let prev = [null, cap, cap];
  for (const [m, x] of byMonth) { months.push([m, r4(x[1] / prev[1] - 1), r4(x[2] / prev[2] - 1)]); prev = x; }
  const last = curve.length ? curve[curve.length - 1] : [null, cap, cap];
  const report = { nav: r2(last[1]), bench: r2(last[2]), ret: r4(last[1] / cap - 1), benchRet: r4(last[2] / cap - 1), excess: r4((last[1] - last[2]) / cap),
    attribution: Object.fromEntries(keys.map(k => [k, r2(A[k].live.equity - A[k].capital)])), months, days: Math.max(0, curve.length - 1) };

  /* ---------- trader: ogni strategia della ricerca su ogni mercato ---------- */
  const traders = [];
  for (const k of keys) {
    const a = A[k], L = labs[k], n = L.c.length - 1;
    for (const b of a.research.board) {
      const champ = a.champion.id === b.id;
      traders.push({ id: b.id + '@' + k, name: traderName(b.id + k), asset: k, short: a.short, strat: b.name, ret2y: b.ret, sharpe: b.sharpe, maxDD: b.maxDD, fwd: b.fwd,
        pos: L.pos[b.id][n], status: champ ? 'in campo' : b.ok ? 'attivo' : 'panchina',
        ml: b.id.startsWith('ml-'), auto: b.id.startsWith('ad-'), adapt: a.research.adapt && a.research.adapt[b.id] || null });
    }
  }
  traders.sort((x, y) => (y.fwd - x.fwd) || (y.sharpe - x.sharpe));

  /* ---------- agenti ---------- */
  const anyValid = keys.filter(k => A[k].research.wf && A[k].research.wf.valid).length;
  const agents = [];
  const add = (id, o) => agents.push({ id, ...STAFF[id], ...o });
  add('cio', { asset: null, stats: { energia: 70, stress: clamp(ddNow * 600 + (risk.kill ? 60 : 0)), fiducia: clamp(20 + 25 * anyValid), focus: 80 },
    status: risk.kill ? 'Kill switch attivo' : anyValid ? 'Campione promosso' : 'Segue il benchmark',
    report: risk.kill ? `Kill switch attivo dal ${risk.killSince || 'oggi'}: tutte le sale in liquidità finché non lo disattiviamo.` : `Nessuna sala ha un metodo valido fuori campione${anyValid ? ' tranne ' + anyValid : ''}: restiamo sul benchmark. Prossima revisione il ${A[keys[0]].nextReview}.` });
  add('risk', { asset: null, stats: { energia: 75, stress: clamp(100 * risk.varPct / LIMITS.var95), fiducia: breaches.length ? 40 : 85, focus: 90 },
    status: breaches.length ? 'Limiti superati' : 'Limiti rispettati',
    report: `Esposizione lorda ${pp(gross, 0)}, netta ${pct(net, 0)}. VaR 95% a 1 giorno ${usd(var95)} (${pp(risk.varPct)} del patrimonio), perdita media nei giorni peggiori ${usd(es95)}. Perdita dal massimo ${pct(-ddNow)}.${breaches.length ? ' Attenzione: ' + breaches.join('; ') + '.' : ' Tutti i limiti rispettati.'}` });
  add('macro', { asset: null, stats: { energia: 70, stress: clamp(ind.NDX ? ind.NDX.volPct * 100 : 50), fiducia: clamp(40 + 15 * Math.abs(score - 1.5)), focus: 75 },
    status: 'Regime ' + regime.label,
    report: `Regime ${regime.label} (${score} segnali su ${sig.length}): ${regime.signals.join('; ')}. ${regime.dollar ? regime.dollar.charAt(0).toUpperCase() + regime.dollar.slice(1) + '.' : ''} È solo una lettura: le operazioni le decidono le regole delle sale.` });
  const mlTxt = keys.map(k => ml[k].acc == null ? `${A[k].short}: dati insufficienti` : `${A[k].short} ${pp(ml[k].acc, 0)} (base ${pp(ml[k].base, 0)})`).join(', ');
  const beats = keys.filter(k => ml[k].acc != null && ml[k].acc > ml[k].base + 0.02).length;
  add('ml', { asset: null, stats: { energia: 80, stress: 30, fiducia: clamp(25 + 25 * beats), focus: 85 },
    status: beats ? 'Un modello batte il caso' : 'Nessun vantaggio trovato',
    report: `Precisione fuori campione negli ultimi 12 mesi del modello a 5 giorni: ${mlTxt}. La "base" è la precisione di chi dice sempre la direzione più frequente: un modello serve solo se la supera. Riaddestro i modelli ogni mese usando solo il passato.` });
  for (const k of keys) {
    const I = ind[k], m = ml[k];
    add(k, { asset: k, stats: { energia: 70, stress: clamp(I.volPct * 100), fiducia: clamp(50 + 30 * (I.above200 ? 1 : -1) * Math.min(1, Math.abs(I.d200) * 5)), focus: 80 },
      status: I.above200 ? 'Tendenza positiva' : 'Tendenza negativa',
      report: `${A[k].name}: ${I.above50 ? 'sopra' : 'sotto'} la media 50 e ${I.above200 ? 'sopra' : 'sotto'} la media 200 (${pct(I.d200)}). RSI 14 a ${Math.round(I.rsi)}${I.rsi > 70 ? ', ipercomprato' : I.rsi < 30 ? ', ipervenduto' : ''}. Volatilità al ${Math.round(I.volPct * 100)}° percentile dell'anno. Ultimo mese ${pct(I.r20)}.${m.prob != null ? ` Il modello ML stima un rialzo a 5 giorni al ${Math.round(m.prob * 100)}%, ma vale quanto una moneta finché non batte la base.` : ''}` });
  }

  /* ---------- oggi in breve: due righe in italiano semplice ---------- */
  const brief = [];
  brief.push(`Il fondo vale ${usd(report.nav)}: ${pct(report.ret, 2)} da quando è partito. Comprare e tenere avrebbe fatto ${pct(report.benchRet, 2)}.`);
  brief.push(keys.map(k => `${A[k].short} ${posTxt(A[k].position)}`).join(' · ') + (risk.kill ? ' — kill switch attivo, tutto in liquidità.' : '.'));
  const valid = keys.filter(k => A[k].research.wf && A[k].research.wf.valid);
  brief.push(valid.length ? `Metodo di ricerca valido su ${valid.map(k => A[k].short).join(', ')}: lì opera il campione.` : `Nessuna strategia ha ancora superato la verifica: le sale copiano il mercato (o restano in liquidità sull'euro). Prossima revisione il ${new Date(A[keys[0]].nextReview + 'T12:00:00Z').toLocaleDateString('it-IT', { day: 'numeric', month: 'long', year: 'numeric' })}.`);
  const improved = traders.filter(t => t.adapt && t.adapt.hist.length && t.adapt.hist[0].from && t.adapt.hist[0].d >= A[t.asset].last.d);
  if (improved.length) brief.push(`${improved.length} trader automatic${improved.length > 1 ? 'i hanno' : 'o ha'} cambiato i propri parametri oggi.`);
  const myNav = view.me ? Object.values(view.me.assets).reduce((s, x) => s + x.equity, 0) : null;
  if (myNav != null) brief.push(`La tua sala vale ${usd(myNav)} (${pct(myNav / cap - 1, 2)}).`);

  /* ---------- la sala: messaggi del giorno ---------- */
  const lastDay = keys.map(k => A[k].last.d).sort().pop();
  const msgs = [];
  const say = (who, dept, text, tag) => msgs.push({ d: lastDay, at: today, who, dept, text, tag: tag || dept });
  for (const k of keys) say(STAFF[k].name, 'Analisi', agents.find(a => a.id === k).report);
  say(STAFF.macro.name, 'Macro', agents.find(a => a.id === 'macro').report);
  say(STAFF.ml.name, 'Ricerca', agents.find(a => a.id === 'ml').report);
  say(STAFF.risk.name, 'Rischi', agents.find(a => a.id === 'risk').report);
  for (const k of keys) {
    const L = labs[k], n = L.c.length - 1;
    const moved = traders.filter(t => t.asset === k && L.pos[t.id.split('@')[0]][n] !== L.pos[t.id.split('@')[0]][n - 1]);
    for (const t of moved.slice(0, 4)) say(t.name, 'Operazioni', `${A[k].short}: la mia strategia "${t.strat}" passa a ${posTxt(t.pos)} alla chiusura del ${A[k].last.d}. Sono ${t.status === 'in campo' ? 'il campione, quindi è un ordine vero della sala' : 'in prova, quindi è un\'operazione simulata della ricerca'}.`, 'Operazioni');
    const inPos = traders.filter(t => t.asset === k && t.pos !== 0).length, bench = traders.filter(t => t.asset === k && t.status === 'panchina').length;
    say(STAFF[k].name, 'Operazioni', `${A[k].short}: ${inPos} trader su ${traders.filter(t => t.asset === k).length} in posizione nella ricerca, ${bench} in panchina. La sala resta ${posTxt(A[k].position)} con "${A[k].champion.name === 'Benchmark' ? A[k].benchName : A[k].champion.name}".`, 'Operazioni');
    for (const t of traders.filter(t => t.asset === k && t.adapt && t.adapt.hist.length && t.adapt.hist[0].from && t.adapt.hist[0].d >= A[k].last.d))
      say(t.name, 'Ricerca', `${A[k].short}: mi sono migliorato. "${t.strat}" passa da ${t.adapt.hist[0].from} a ${t.adapt.hist[0].p}. ${t.adapt.hist[0].why} Ho controllato anche gli ultimi 3 mesi, che non avevo usato per scegliere.`, 'Ricerca');
    for (const e of eventsBy[k] || []) say(STAFF.cio.name, 'Comitato', `${A[k].short}: ${e}. ${A[k].champion.why}`, 'Comitato');
  }
  say(STAFF.cio.name, 'Comitato', agents.find(a => a.id === 'cio').report, 'Comitato');

  // il diario della sala: i messaggi di oggi sostituiscono quelli dello stesso giorno di mercato
  const feed = [...msgs, ...(Array.isArray(prevFeed) ? prevFeed : []).filter(m => m.d !== lastDay)].slice(0, 400);
  return { fund: { brief, regime, risk, report, traders, agents, ml, ind: Object.fromEntries(keys.map(k => [k, { ...ind[k], rsi: Math.round(ind[k].rsi), volPct: r4(ind[k].volPct), d200: r4(ind[k].d200), r20: r4(ind[k].r20), vol: r4(ind[k].vol) }])) }, feed };
}

module.exports = { buildFund, STAFF, LIMITS };
