/**
 * Ledgerbay static file server + offline-first multi-company sync API.
 * Run: node server.mjs
 *   PORT=3000 HOST=0.0.0.0 BILLSETU_SYNC_PASSCODE=... (optional)
 *
 * First run: set a passcode via env, CLI prompt, or http://127.0.0.1:PORT/setup (localhost only).
 * Passcode stored as scrypt hash + salt; compared with timingSafeEqual; 5 fails/min → 15 min lockout.
 */
import http from 'http';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import readline from 'readline';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.BILLSETU_DATA || path.join(__dirname, 'sync-data');
const STORE_PATH = path.join(DATA_DIR, 'store.json');
const AUTH_PATH = path.join(DATA_DIR, 'auth.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 20;
// App version reported by /health and /api/*. Read ONLY from the shipped build-config.js
// next to this file, so it can never drift from the app build (no hard-coded fallback).
function readAppBuildInfo() {
  try {
    const src = fs.readFileSync(path.join(__dirname, 'build-config.js'), 'utf8');
    const version = (src.match(/VERSION\s*:\s*["']([^"']+)["']/) || [])[1];
    const code = (src.match(/VERSION_CODE\s*:\s*(\d+)/) || [])[1];
    return { version: version || 'unknown', versionCode: code ? Number(code) : null };
  } catch (_) {
    console.warn('Warning: build-config.js not found next to server.mjs; version will show as "unknown".');
    return { version: 'unknown', versionCode: null };
  }
}
const APP_BUILD = readAppBuildInfo();
const VERSION = APP_BUILD.version;

/** Record-level collections inside each company. */
const COMPANY_COLLECTIONS = [
  'business', 'parties', 'items', 'invoices', 'purchases', 'expenses',
  'purchaseOrders', 'debitNotes', 'payments', 'recurringBills', 'godowns',
  'stockTransfers', 'staff', 'loyaltyLedger', 'customFieldDefs', 'activityLog',
  'bankAccounts',
  'accountsGroups', 'accountsLedgers', 'accountsVouchers', 'accountsCheques',
  'accountsOpeningBills', 'accountsMeta', 'counters'
];

const MIME_TYPES = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.mjs': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.webmanifest': 'application/manifest+json; charset=UTF-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.pdf': 'application/pdf',
  '.bat': 'text/plain; charset=UTF-8'
};

const BLOCKED_TOP = new Set(['node_modules', 'android', 'ios', '.git', 'uploads', 'tests', 'scripts', 'sync-data']);
const BLOCKED_FILES = new Set(['server.mjs', 'package.json', 'package-lock.json', 'capacitor.config.json', 'auth.json']);

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function atomicWrite(filePath, data) {
  ensureDirs();
  const tmp = filePath + '.tmp.' + process.pid + '.' + Date.now();
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, filePath);
}

function rotateBackup(sourcePath) {
  if (!fs.existsSync(sourcePath)) return;
  ensureDirs();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = path.join(BACKUP_DIR, `store-${stamp}.json`);
  try {
    fs.copyFileSync(sourcePath, dest);
  } catch (_) {
    return;
  }
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('store-') && f.endsWith('.json'))
    .map(f => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  files.slice(MAX_BACKUPS).forEach(({ f }) => {
    try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) {}
  });
}

function emptyStore() {
  return {
    version: 2,
    updatedAt: 0,
    registry: null,
    companies: {},
    years: {}
  };
}

function readStore() {
  ensureDirs();
  if (!fs.existsSync(STORE_PATH)) {
    const empty = emptyStore();
    atomicWrite(STORE_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }
  const store = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  if (!store.companies) store.companies = {};
  if (!store.years) store.years = {};
  if (ensureSeqs(store)) atomicWrite(STORE_PATH, JSON.stringify(store, null, 2));
  return store;
}

// 1.13.9 (L1b): server-assigned change sequence. Every stored record gets a monotonic
// sequence number when the server stores (or changes) it; pulls filter on that number,
// never on the client's clock. Old data files get sequences on load (oldest first).
function seqKeyCo(cid, collection, id) { return 'c/' + cid + '/' + collection + '/' + id; }
function seqKeyYear(id) { return 'y/' + id; }
function bumpSeq(store, key) {
  store.seq = (Number(store.seq) || 0) + 1;
  store.seqs[key] = store.seq;
}
function ensureSeqs(store) {
  let changed = false;
  if (!store.seqEpoch) { store.seqEpoch = crypto.randomBytes(8).toString('hex'); changed = true; }
  if (!store.seqs || typeof store.seqs !== 'object') { store.seqs = {}; changed = true; }
  store.seq = Number(store.seq) || 0;
  const missing = [];
  for (const [cid, co] of Object.entries(store.companies || {})) {
    for (const [collection, map] of Object.entries((co && co.collections) || {})) {
      for (const [id, rec] of Object.entries(map || {})) {
        const k = seqKeyCo(cid, collection, id);
        if (!store.seqs[k]) missing.push([tsOf(rec), k]);
      }
    }
  }
  for (const [id, rec] of Object.entries(store.years || {})) {
    const k = seqKeyYear(id);
    if (!store.seqs[k]) missing.push([tsOf(rec), k]);
  }
  missing.sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1));
  missing.forEach(([, k]) => bumpSeq(store, k));
  return changed || missing.length > 0;
}

function writeStore(store) {
  store.updatedAt = Date.now();
  rotateBackup(STORE_PATH);
  atomicWrite(STORE_PATH, JSON.stringify(store, null, 2));
}

function readAuth() {
  ensureDirs();
  if (!fs.existsSync(AUTH_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function writeAuth(auth) {
  atomicWrite(AUTH_PATH, JSON.stringify(auth, null, 2));
}

function scryptHash(passcode, saltBuf) {
  return crypto.scryptSync(String(passcode), saltBuf, 64, { N: 16384, r: 8, p: 1 });
}

function setPasscode(passcode) {
  const salt = crypto.randomBytes(16);
  const hash = scryptHash(passcode, salt);
  writeAuth({
    salt: salt.toString('hex'),
    hash: hash.toString('hex'),
    createdAt: Date.now(),
    version: 1
  });
}

function verifyPasscode(passcode) {
  const auth = readAuth();
  if (!auth || !auth.salt || !auth.hash) return false;
  const salt = Buffer.from(auth.salt, 'hex');
  const expected = Buffer.from(auth.hash, 'hex');
  const actual = scryptHash(passcode, salt);
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

/** Rate limit: 5 failures / 60s window → 15 min lockout per IP */
const failLog = new Map(); // ip -> { fails: number[], lockedUntil: number }

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function isLocked(ip) {
  const row = failLog.get(ip);
  if (!row) return false;
  if (row.lockedUntil && Date.now() < row.lockedUntil) return true;
  if (row.lockedUntil && Date.now() >= row.lockedUntil) {
    row.lockedUntil = 0;
    row.fails = [];
  }
  return false;
}

function recordFail(ip) {
  const now = Date.now();
  const row = failLog.get(ip) || { fails: [], lockedUntil: 0 };
  row.fails = row.fails.filter(t => now - t < 60_000);
  row.fails.push(now);
  if (row.fails.length >= 5) {
    row.lockedUntil = now + 15 * 60_000;
    row.fails = [];
  }
  failLog.set(ip, row);
  return row.lockedUntil;
}

function clearFails(ip) {
  failLog.delete(ip);
}

function tsOf(rec) {
  if (!rec) return 0;
  return Math.max(Number(rec.updatedAt) || 0, Number(rec.deletedAt) || 0);
}

function mergeRecord(collection, local, incoming) {
  if (!local) return incoming;
  if (!incoming) return local;
  if (collection === 'counters') {
    const lv = Number(local.value) || 0;
    const iv = Number(incoming.value) || 0;
    return {
      ... (iv >= lv ? incoming : local),
      value: Math.max(lv, iv),
      updatedAt: Math.max(tsOf(local), tsOf(incoming))
    };
  }
  if (collection === 'business' && isBlankProfile(incoming) && !isBlankProfile(local)) {
    // A just-installed device must never blank out the shared business profile.
    return local;
  }
  return tsOf(incoming) >= tsOf(local) ? incoming : local;
}

function isBlankProfile(b) {
  if (!b || typeof b !== 'object' || b.deletedAt) return !b || !b.deletedAt;
  return !String(b.name || '').trim() && !String(b.gstin || '').trim() && !String(b.upiId || '').trim() &&
    !String(b.phone || '').trim() && !String(b.address || '').trim();
}

function ensureCompany(store, companyId) {
  if (!store.companies[companyId]) {
    store.companies[companyId] = { updatedAt: 0, collections: {} };
  }
  const co = store.companies[companyId];
  if (!co.collections) co.collections = {};
  for (const c of COMPANY_COLLECTIONS) {
    if (!co.collections[c]) co.collections[c] = {};
  }
  return co;
}

function applyCompanyPush(store, companyId, push) {
  const changed = [];
  if (!companyId || !push) return changed;
  const co = ensureCompany(store, companyId);
  for (const [collection, map] of Object.entries(push)) {
    if (!COMPANY_COLLECTIONS.includes(collection) || !map || typeof map !== 'object') continue;
    if (!co.collections[collection]) co.collections[collection] = {};
    for (const [id, rec] of Object.entries(map)) {
      if (!rec || typeof rec !== 'object') continue;
      const sealed = { ...rec, id: rec.id || id, companyId };
      const prev = co.collections[collection][id];
      const next = mergeRecord(collection, prev, sealed);
      co.collections[collection][id] = next;
      if (next !== prev) {
        changed.push(`${companyId}/${collection}:${id}`);
        bumpSeq(store, seqKeyCo(companyId, collection, id));
      }
    }
  }
  co.updatedAt = Date.now();
  return changed;
}

function pullCompanySince(store, companyId, since, sinceSeq) {
  const sinceN = Number(since) || 0;
  const co = store.companies[companyId];
  if (!co) return {};
  const out = {};
  for (const collection of COMPANY_COLLECTIONS) {
    const map = co.collections[collection] || {};
    const slice = {};
    for (const [id, rec] of Object.entries(map)) {
      if (sinceSeq != null ? (store.seqs[seqKeyCo(companyId, collection, id)] || 0) > sinceSeq : tsOf(rec) > sinceN) slice[id] = rec;
    }
    if (Object.keys(slice).length) out[collection] = slice;
  }
  return out;
}

function mergeRegistry(store, incoming) {
  if (!incoming) return false;
  const sealed = { ...incoming, id: 'registry' };
  if (!store.registry || tsOf(sealed) >= tsOf(store.registry)) {
    store.registry = sealed;
    return true;
  }
  return false;
}

function mergeYears(store, yearsMap) {
  const changed = [];
  if (!yearsMap) return changed;
  for (const [id, rec] of Object.entries(yearsMap)) {
    if (!rec) continue;
    const sealed = { ...rec, id };
    const prev = store.years[id];
    const next = mergeRecord('years', prev, sealed);
    store.years[id] = next;
    if (next !== prev) {
      changed.push(`year:${id}`);
      bumpSeq(store, seqKeyYear(id));
    }
  }
  return changed;
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-BillSetu-Passcode');
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 60 * 1024 * 1024) {
        reject(new Error('Body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isLocalRequest(req) {
  const ip = clientIp(req);
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || ip === 'localhost';
}

function extractPasscode(req, body) {
  const hdr = req.headers['x-billsetu-passcode'] || '';
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const fromBody = body && (body.passcode || body.token);
  return String(hdr || auth || fromBody || '');
}

function lanAddresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const list of Object.values(nets || {})) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

const SETUP_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Ledgerbay Sync Setup</title>
<style>body{font-family:system-ui,sans-serif;max-width:420px;margin:48px auto;padding:0 16px}
input,button{font-size:16px;padding:10px;width:100%;box-sizing:border-box;margin:6px 0}
button{background:#0f766e;color:#fff;border:0;border-radius:8px;cursor:pointer}
.err{color:#b91c1c}</style></head>
<body>
<h1>Set sync passcode</h1>
<p>This page only works from this computer (localhost). Choose a passcode you will enter on phone and PC.</p>
<form id="f"><input type="password" id="p1" placeholder="Passcode (min 6)" required minlength="6">
<input type="password" id="p2" placeholder="Confirm passcode" required>
<button type="submit">Save passcode</button></form>
<p class="err" id="e"></p>
<script>
document.getElementById('f').onsubmit=async(ev)=>{
  ev.preventDefault();
  const a=document.getElementById('p1').value,b=document.getElementById('p2').value;
  if(a!==b){document.getElementById('e').textContent='Passcodes do not match';return;}
  const r=await fetch('/api/setup',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passcode:a})});
  const j=await r.json().catch(()=>({}));
  if(!r.ok){document.getElementById('e').textContent=j.error||'Failed';return;}
  location.href='/';
};
</script></body></html>`;

async function handleSync(req, res) {
  const ip = clientIp(req);
  if (!readAuth()) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Passcode not set. Open http://127.0.0.1:' + PORT + '/setup on the server PC.' }));
    return;
  }
  if (isLocked(ip)) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'Too many wrong passcodes. Try again in 15 minutes.', code: 'locked' }));
    return;
  }
  const raw = await readBody(req);
  const body = raw ? JSON.parse(raw) : {};
  const pass = extractPasscode(req, body);
  if (!verifyPasscode(pass)) {
    const until = recordFail(ip);
    const locked = until && until > Date.now();
    res.writeHead(locked ? 429 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: false,
      error: locked ? 'Too many wrong passcodes. Try again in 15 minutes.' : 'Wrong passcode.',
      code: locked ? 'locked' : 'unauthorized'
    }));
    return;
  }
  clearFails(ip);

  const store = readStore();
  const changed = [];
  if (body.registry) {
    if (mergeRegistry(store, body.registry.registry || body.registry)) changed.push('registry');
  }
  // Primary company push
  const companyId = body.companyId || (store.registry && store.registry.activeId) || 'co-main';
  changed.push(...applyCompanyPush(store, companyId, body.push || {}));
  // Other companies (full blob maps)
  if (body.otherCompanies && typeof body.otherCompanies === 'object') {
    for (const [cid, payload] of Object.entries(body.otherCompanies)) {
      if (payload && payload.push) changed.push(...applyCompanyPush(store, cid, payload.push));
    }
  }
  changed.push(...mergeYears(store, body.years || {}));
  writeStore(store);

  const pullCompanies = {};
  const ids = new Set([companyId, ...Object.keys(store.companies)]);
  if (Array.isArray(body.companyIds)) body.companyIds.forEach(id => ids.add(id));
  // Seq cursor (1.13.9+ clients). A cursor from another server/data file (epoch mismatch)
  // means one full pull. Clients without sinceSeq (1.13.8 and older) keep the old timestamp filter.
  let sinceSeq = null;
  if (body.sinceSeq != null) sinceSeq = body.seqEpoch === store.seqEpoch ? (Number(body.sinceSeq) || 0) : 0;
  for (const cid of ids) {
    const slice = pullCompanySince(store, cid, body.since || 0, sinceSeq);
    if (Object.keys(slice).length) pullCompanies[cid] = slice;
  }
  const yearsPull = {};
  const sinceN = Number(body.since) || 0;
  for (const [id, rec] of Object.entries(store.years || {})) {
    if (sinceSeq != null ? (store.seqs[seqKeyYear(id)] || 0) > sinceSeq : tsOf(rec) > sinceN) yearsPull[id] = rec;
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    ok: true,
    serverTime: Date.now(),
    cursor: store.seq,
    seqEpoch: store.seqEpoch,
    deviceId: body.deviceId || null,
    applied: changed.length,
    registry: store.registry,
    pull: pullCompanies[companyId] || {},
    pullCompanies,
    years: yearsPull,
    version: VERSION
  }));
}

const server = http.createServer(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/api/health' && req.method === 'GET') {
    const store = readStore();
    let count = 0;
    for (const co of Object.values(store.companies || {})) {
      for (const c of COMPANY_COLLECTIONS) count += Object.keys(co.collections?.[c] || {}).length;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      records: count,
      companies: Object.keys(store.companies || {}).length,
      passcodeSet: !!readAuth(),
      serverTime: Date.now(),
      version: VERSION,
      versionCode: APP_BUILD.versionCode
    }));
    return;
  }

  if (pathname === '/setup' && req.method === 'GET') {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Setup is only available from localhost on the server PC.');
      return;
    }
    if (readAuth() && url.searchParams.get('reset') !== '1') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
      res.end('<!doctype html><p>Passcode already set. Sync from the app. To reset, stop the server, delete sync-data/auth.json, and restart.</p>');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=UTF-8' });
    res.end(SETUP_HTML);
    return;
  }

  if (pathname === '/api/setup' && req.method === 'POST') {
    if (!isLocalRequest(req)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Setup only from localhost' }));
      return;
    }
    if (readAuth()) {
      res.writeHead(409, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: 'Passcode already set' }));
      return;
    }
    try {
      const body = JSON.parse(await readBody(req) || '{}');
      const pass = String(body.passcode || '');
      if (pass.length < 6) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Passcode must be at least 6 characters' }));
        return;
      }
      setPasscode(pass);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
    return;
  }

  if (pathname === '/api/reserve-number' && req.method === 'POST') {
    try {
      const ip = clientIp(req);
      if (!readAuth()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Passcode not set' }));
        return;
      }
      if (isLocked(ip)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'Too many wrong passcodes. Try again in 15 minutes.', code: 'locked' }));
        return;
      }
      const raw = await readBody(req);
      const body = raw ? JSON.parse(raw) : {};
      const pass = extractPasscode(req, body);
      if (!verifyPasscode(pass)) {
        const until = recordFail(ip);
        const locked = until && until > Date.now();
        res.writeHead(locked ? 429 : 401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: false,
          error: locked ? 'Too many wrong passcodes. Try again in 15 minutes.' : 'Wrong passcode.',
          code: locked ? 'locked' : 'unauthorized'
        }));
        return;
      }
      clearFails(ip);

      const seriesKey = String(body.seriesKey || '').trim();
      if (!seriesKey) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'seriesKey required' }));
        return;
      }
      const companyId = body.companyId || 'co-main';
      const hintNext = Math.max(1, Number(body.hintNext) || 1);
      const store = readStore();
      const co = ensureCompany(store, companyId);
      if (!co.collections.counters) co.collections.counters = {};
      const counterId = 'series:' + seriesKey;
      const prev = co.collections.counters[counterId] || { id: counterId, value: 0, updatedAt: 0 };
      const prevVal = Number(prev.value) || 0;
      // Atomic: take max(server counter, client hint) then assign that number and bump past it
      const assigned = Math.max(prevVal + 1, hintNext);
      const nextNumber = assigned + 1;
      co.collections.counters[counterId] = {
        id: counterId,
        value: assigned,
        seriesKey,
        updatedAt: Date.now(),
        lastDeviceId: body.deviceId || null
      };
      bumpSeq(store, seqKeyCo(companyId, 'counters', counterId));
      co.updatedAt = Date.now();
      writeStore(store);

      // Optional formatted number using client series style
      const pad = Math.max(1, Math.min(8, Number(body.padWidth) || 4));
      const prefix = String(body.prefix || '').trim();
      const sep = body.separator == null ? '-' : String(body.separator);
      const fyToken = body.fyToken || '';
      let fyPart = '';
      if (fyToken === '{FY}' || fyToken === '{FYYYY}' || fyToken === '{YY}') {
        const dateIso = body.dateIso || new Date().toISOString().slice(0, 10);
        const [y, m] = dateIso.split('-').map(Number);
        const start = (m >= 4) ? y : y - 1;
        const end = start + 1;
        const yyS = String(start).slice(-2);
        const yyE = String(end).slice(-2);
        if (fyToken === '{FY}') fyPart = `${yyS}-${yyE}`;
        else if (fyToken === '{FYYYY}') fyPart = `${start}-${yyE}`;
        else fyPart = yyS;
      }
      const parts = [];
      if (prefix) parts.push(prefix);
      if (fyPart) parts.push(fyPart);
      parts.push(String(assigned).padStart(pad, '0'));
      const formatted = parts.join(sep);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ok: true,
        seriesKey,
        number: assigned,
        nextNumber,
        formatted,
        serverTime: Date.now(),
        version: VERSION
      }));
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
    return;
  }

  if (pathname === '/api/sync' && req.method === 'POST') {
    try {
      await handleSync(req, res);
    } catch (err) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: String(err.message || err) }));
    }
    return;
  }

  let reqPath = pathname;
  if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
  const filePath = path.resolve(__dirname, '.' + path.normalize(reqPath));
  const rootWithSep = __dirname.endsWith(path.sep) ? __dirname : __dirname + path.sep;
  if (filePath !== __dirname && !filePath.startsWith(rootWithSep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  const rel = path.relative(__dirname, filePath);
  const top = rel.split(path.sep)[0];
  if (BLOCKED_TOP.has(top) || BLOCKED_FILES.has(path.basename(filePath)) || rel.startsWith('..')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500, { 'Content-Type': 'text/plain' });
      res.end(err.code === 'ENOENT' ? '404 Not Found' : `Server Error: ${err.code}`);
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(content);
  });
});

async function ensurePasscodeAtBoot() {
  ensureDirs();
  if (readAuth()) return;
  const fromEnv = process.env.BILLSETU_SYNC_PASSCODE || process.env.BILLSETU_SYNC_TOKEN;
  if (fromEnv && String(fromEnv).length >= 6) {
    setPasscode(String(fromEnv));
    console.log('Passcode set from environment.');
    return;
  }
  if (!process.stdin.isTTY) {
    console.log('No passcode yet. After start, open http://127.0.0.1:' + PORT + '/setup on this PC (localhost only).');
    return;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));
  console.log('First run — set a sync passcode (min 6 characters).');
  for (;;) {
    const a = await ask('Passcode: ');
    const b = await ask('Confirm: ');
    if (a.length < 6) { console.log('Too short.'); continue; }
    if (a !== b) { console.log('Mismatch.'); continue; }
    setPasscode(a);
    console.log('Passcode saved (hashed) in sync-data/auth.json');
    break;
  }
  rl.close();
}

await ensurePasscodeAtBoot();
readStore();
server.on('error', err => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`Error: port ${PORT} is already in use on ${HOST}. Another Ledgerbay server (or another app) is running.`);
    console.error(`Stop it, or start this one on a free port, e.g.  PORT=${PORT + 1} node server.mjs`);
  } else if (err && err.code === 'EACCES') {
    console.error(`Error: no permission to listen on port ${PORT}. Use a port above 1024, e.g.  PORT=3000 node server.mjs`);
  } else {
    console.error('Error: the sync server could not start:', err && err.message ? err.message : err);
  }
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  const lans = lanAddresses();
  console.log(`Ledgerbay ${VERSION} sync server on http://127.0.0.1:${PORT}`);
  if (lans.length) {
    console.log('On your phone enter:');
    lans.forEach(ip => console.log(`  http://${ip}:${PORT}`));
  } else {
    console.log(`Listening on ${HOST}:${PORT} (no LAN IPv4 detected)`);
  }
  console.log(`Passcode configured: ${readAuth() ? 'yes' : 'no — visit /setup from localhost'}`);
});
