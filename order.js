#!/usr/bin/env node
/*
 * Desk IA — registra un ordine della "Tua sala".
 * Riceve i dati dal pulsante "Run workflow" di GitHub (variabili ASSET, POSIZIONE, QUOTA, NOTA)
 * e lo aggiunge a docs/data/orders.json. Il desk lo esegue alla prima chiusura successiva.
 * Soldi finti: nessun ordine reale viene mai inviato.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const FILE = path.join(__dirname, 'docs', 'data', 'orders.json');
const ASSETS = { BTC: 'BTC', BITCOIN: 'BTC', NDX: 'NDX', NASDAQ: 'NDX', 'NASDAQ-100': 'NDX', EURUSD: 'EURUSD', 'EUR/USD': 'EURUSD' };
const POS = { LONG: 1, SHORT: -1, FLAT: 0 };
const asset = ASSETS[String(process.env.ASSET || '').trim().toUpperCase()];
const pos = String(process.env.POSIZIONE || '').trim().toUpperCase();
const quota = parseInt(String(process.env.QUOTA || '100').replace('%', ''), 10);
const note = String(process.env.NOTA || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 140);
if (!asset) { console.error('ERRORE: asset non valido (usa BTC, NDX o EURUSD)'); process.exit(1); }
if (!(pos in POS)) { console.error('ERRORE: posizione non valida (usa LONG, SHORT o FLAT)'); process.exit(1); }
if (![25, 50, 75, 100].includes(quota)) { console.error('ERRORE: quota non valida (usa 25, 50, 75 o 100)'); process.exit(1); }
let orders = [];
try { orders = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (!Array.isArray(orders)) orders = []; } catch (e) { orders = []; }
const o = { id: Date.now().toString(36), ts: new Date().toISOString(), asset, pos, quota: pos === 'FLAT' ? 0 : quota, note };
orders.push(o);
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(orders, null, 1));
console.log(`Ordine registrato: ${asset} ${pos}${pos === 'FLAT' ? '' : ' ' + quota + '%'}${note ? ' · ' + note : ''}`);
