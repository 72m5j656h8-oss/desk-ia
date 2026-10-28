#!/usr/bin/env node
/* Desk IA — kill switch: STATO=ON mette tutte le sale in liquidità, STATO=OFF le riattiva. */
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, 'docs', 'data', 'control.json');
const stato = String(process.env.STATO || '').trim().toUpperCase();
if (!['ON', 'OFF'].includes(stato)) { console.error('ERRORE: STATO deve essere ON oppure OFF'); process.exit(1); }
const reason = String(process.env.MOTIVO || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 140);
let c = {}; try { c = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { c = {}; }
c = stato === 'ON' ? { kill: true, since: new Date().toISOString().slice(0, 10), reason } : { kill: false, since: null, reason: '', lastOff: new Date().toISOString().slice(0, 10) };
fs.mkdirSync(path.dirname(FILE), { recursive: true });
fs.writeFileSync(FILE, JSON.stringify(c, null, 1));
console.log(stato === 'ON' ? 'Kill switch ATTIVATO' + (reason ? ': ' + reason : '') : 'Kill switch disattivato');
