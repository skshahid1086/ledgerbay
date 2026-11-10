'use strict';

const fs = require('fs');
const path = require('path');

async function waitForWindow(getWindow, ms = 8000) {
  const wait = (t) => new Promise((r) => setTimeout(r, t));
  const start = Date.now();
  while (Date.now() - start < ms) {
    const w = getWindow();
    if (w && !w.isDestroyed()) return w;
    await wait(100);
  }
  throw new Error('No main window');
}

async function unlockBooks(win) {
  return win.webContents.executeJavaScript(`
    (async function () {
      const salt = 'smoke-salt';
      const password = 'smoke-test-pass';
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password));
      const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('billsetu_lock_v1', JSON.stringify({ salt, hash }));
      sessionStorage.setItem('billsetu_open', '1');
      sessionStorage.setItem('billsetu_actor', JSON.stringify({ id: 'owner', name: 'Owner', role: 'ADMIN' }));
      if (typeof enterApp !== 'function') return { ok: false, err: 'enterApp missing' };
      enterApp();
      return {
        ok: true,
        booksOpen: document.body.classList.contains('books-open'),
        biz: State.business && State.business.name,
        inv: (State.invoices || []).length,
        origin: location.origin
      };
    })()
  `);
}

async function shot(win, shotDir, name) {
  const prefix = process.env.BILLSETU_SHOT_PREFIX || '';
  if (prefix && !name.startsWith(prefix)) name = prefix + name;
  const img = await win.webContents.capturePage();
  const dest = path.join(shotDir, name);
  fs.writeFileSync(dest, img.toPNG());
  console.log('[smoke] screenshot', dest, fs.statSync(dest).size);
  return dest;
}

async function runSmokeTest({ app, getMainWindow, shotDir }) {
  fs.mkdirSync(shotDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  console.log('[smoke] userData=', app.getPath('userData'));
  const mainWindow = await waitForWindow(getMainWindow);
  await wait(1500);
  console.log('[smoke] title=', mainWindow.getTitle());

  const unlocked = await unlockBooks(mainWindow);
  console.log('[smoke] unlock=', JSON.stringify(unlocked));
  if (!unlocked || !unlocked.ok || !unlocked.booksOpen) throw new Error('Auth unlock failed: ' + JSON.stringify(unlocked));
  await wait(800);

  // Store builds open a company setup wizard when business name is empty
  await mainWindow.webContents.executeJavaScript(`
    (function () {
      try {
        if (!State.business) State.business = {};
        if (!String(State.business.name || '').trim()) {
          State.business.name = 'Demo Test Shop';
          State.business.tradeName = 'Demo Test Shop';
          State.business.stateCode = '27';
          State.business.stateName = 'Maharashtra';
          if (typeof saveToStorage === 'function') saveToStorage();
        }
        const wiz = document.getElementById('company-setup-modal') || document.getElementById('view-company-setup');
        if (wiz) { wiz.classList.add('d-none'); wiz.style.display = 'none'; }
        document.querySelectorAll('.modal.show, .modal.open').forEach(m => {
          m.classList.remove('show', 'open');
          m.style.display = 'none';
        });
        if (typeof closeCompanySetupWizard === 'function') closeCompanySetupWizard();
        if (typeof renderDashboard === 'function') renderDashboard();
      } catch (e) { return String(e); }
      return 'ok';
    })()
  `);
  await wait(400);

  await shot(mainWindow, shotDir, '01-dashboard.png');

  const dashOk = await mainWindow.webContents.executeJavaScript(`
    !!(document.getElementById('view-dashboard') && document.body.classList.contains('books-open')
      && document.getElementById('btn-new-invoice-top'))
  `);
  console.log('[smoke] dashboard DOM=', dashOk);
  if (!dashOk) throw new Error('Dashboard not found');

  const seeded = await mainWindow.webContents.executeJavaScript(`
    (function () {
      try {
        if (!State.parties) State.parties = [];
        if (!State.items) State.items = [];
        if (!State.invoices) State.invoices = [];
        if (!State.business) State.business = {};
        if (!State.business.name) State.business.name = 'Demo Test Shop';
        if (!State.parties.some(p => p.id === 'party-smoke-1')) {
          State.parties.push({
            id: 'party-smoke-1', name: 'Smoke Customer', phone: '9999999999',
            gstin: '', state: 'West Bengal', balance: 0,
            createdAt: Date.now(), updatedAt: Date.now()
          });
        }
        if (!State.items.some(i => i.id === 'item-smoke-1')) {
          State.items.push({
            id: 'item-smoke-1', name: 'Test Chair', sku: 'CHAIR-1',
            hsn: '9401', sellingPrice: 1000, rate: 1000, gstRate: 18, stock: 10, unit: 'pcs',
            createdAt: Date.now(), updatedAt: Date.now()
          });
        }
        if (typeof saveToStorage === 'function') saveToStorage();
        return { ok: true, parties: State.parties.length, items: State.items.length, biz: State.business.name };
      } catch (e) {
        return { ok: false, err: String(e) };
      }
    })()
  `);
  console.log('[smoke] seed=', JSON.stringify(seeded));

  const created = await mainWindow.webContents.executeJavaScript(`
    (function () {
      try {
        const party = State.parties.find(p => p.id === 'party-smoke-1') || State.parties[0];
        const item = State.items.find(i => i.id === 'item-smoke-1') || State.items[0];
        const rate = Number(item.sellingPrice || item.rate || 1000);
        const inv = {
          id: 'inv-smoke-1',
          docType: 'TAX_INVOICE',
          invoiceNo: 'SMOKE-001',
          date: new Date().toISOString().slice(0, 10),
          dueDate: new Date().toISOString().slice(0, 10),
          partyId: party.id,
          partyName: party.name,
          items: [{
            itemId: item.id, description: item.name, hsn: item.hsn || '', qty: 1,
            rate: rate, gstRate: item.gstRate || 18, amount: rate,
            unit: item.unit || 'pcs'
          }],
          taxableTotal: rate,
          cgstTotal: Math.round(rate * 0.09 * 100) / 100,
          sgstTotal: Math.round(rate * 0.09 * 100) / 100,
          igstTotal: 0,
          grandTotal: Math.round(rate * 1.18 * 100) / 100,
          amountReceived: 0,
          balanceDue: Math.round(rate * 1.18 * 100) / 100,
          notes: 'Smoke test bill',
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        State.invoices = (State.invoices || []).filter(x => x.id !== 'inv-smoke-1' && x.invoiceNo !== 'SMOKE-001');
        State.invoices.unshift(inv);
        if (typeof saveToStorage === 'function') saveToStorage();
        if (typeof renderDashboard === 'function') renderDashboard();
        const raw = localStorage.getItem('billsetu_data_v1') || '';
        return {
          ok: true,
          count: State.invoices.length,
          no: inv.invoiceNo,
          lsHasSmoke: raw.includes('SMOKE-001'),
          dataLen: raw.length
        };
      } catch (e) {
        return { ok: false, err: String(e && e.stack || e) };
      }
    })()
  `);
  console.log('[smoke] create bill=', JSON.stringify(created));
  if (!created || !created.ok || !created.lsHasSmoke) throw new Error('Bill create failed: ' + JSON.stringify(created));

  await wait(800);
  await shot(mainWindow, shotDir, '02-after-bill.png');

  const lsBefore = await mainWindow.webContents.executeJavaScript(`
    ({
      data: (localStorage.getItem('billsetu_data_v1') || '').length,
      hasSmoke: (localStorage.getItem('billsetu_data_v1') || '').includes('SMOKE-001'),
      origin: location.origin,
      href: location.href
    })
  `);
  console.log('[smoke] localStorage before relaunch=', JSON.stringify(lsBefore));

  const printPrep = await mainWindow.webContents.executeJavaScript(`
    (function () {
      try {
        const inv = (State.invoices || []).find(x => x.invoiceNo === 'SMOKE-001') || State.invoices[0];
        if (!inv) return { ok: false, err: 'no inv' };
        State.activeInvoiceForPrint = inv;
        let html = null;
        if (typeof renderInvoiceTemplate === 'function') html = renderInvoiceTemplate(inv, 'SIMPLE');
        else if (typeof generateStandardA4Invoice === 'function') html = generateStandardA4Invoice(inv);
        const root = document.getElementById('print-root') || document.createElement('div');
        root.id = 'print-root';
        if (!root.parentNode) document.body.appendChild(root);
        root.innerHTML = html || ('<div style="width:210mm;min-height:297mm;padding:12mm;font-family:sans-serif"><h1>Tax Invoice</h1><p>' + inv.invoiceNo + '</p></div>');
        document.body.classList.add('is-printing');
        if (typeof applyInvoicePrintPageStyle === 'function') applyInvoicePrintPageStyle('a4');
        return { ok: true, inv: inv.invoiceNo, htmlLen: (root.innerHTML || '').length };
      } catch (e) {
        return { ok: false, err: String(e && e.stack || e) };
      }
    })()
  `);
  console.log('[smoke] print prep=', JSON.stringify(printPrep));
  await wait(1000);

  const pdfPath = path.join(shotDir, (process.env.BILLSETU_SHOT_PREFIX || '') + 'invoice-smoke.pdf');
  const pdfBuf = await mainWindow.webContents.printToPDF({
    landscape: false,
    pageSize: 'A4',
    printBackground: true,
    margins: { marginType: 'default' }
  });
  fs.writeFileSync(pdfPath, pdfBuf);
  const pdfHead = pdfBuf.slice(0, Math.min(pdfBuf.length, 80000)).toString('latin1');
  const media = pdfHead.match(/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/);
  console.log('[smoke] pdf bytes=', pdfBuf.length, 'path=', pdfPath);
  console.log('[smoke] MediaBox=', media && media.slice(1));

  await shot(mainWindow, shotDir, '03-print-view.png');

  fs.writeFileSync(path.join(shotDir, 'smoke-round1.json'), JSON.stringify({
    origin: lsBefore.origin, dataLen: lsBefore.data, hasSmoke: lsBefore.hasSmoke, invoiceNo: 'SMOKE-001',
    mediaBox: media && media.slice(1)
  }, null, 2));

  console.log('[smoke] ROUND1_OK');
  app.exit(0);
}

async function runPersistSmoke({ app, getMainWindow, shotDir }) {
  fs.mkdirSync(shotDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mainWindow = await waitForWindow(getMainWindow);
  await wait(1500);
  const unlocked = await unlockBooks(mainWindow);
  console.log('[smoke] unlock=', JSON.stringify(unlocked));
  await wait(500);
  const check = await mainWindow.webContents.executeJavaScript(`
    (function () {
      const inv = (State.invoices || []).find(x => x.invoiceNo === 'SMOKE-001');
      const raw = localStorage.getItem('billsetu_data_v1') || '';
      return {
        origin: location.origin,
        hasInv: !!inv,
        invCount: (State.invoices || []).length,
        dataLen: raw.length,
        lsHasSmoke: raw.includes('SMOKE-001'),
        biz: State.business && State.business.name,
        booksOpen: document.body.classList.contains('books-open')
      };
    })()
  `);
  console.log('[smoke] persist check=', JSON.stringify(check));
  await shot(mainWindow, shotDir, '04-after-relaunch.png');
  fs.writeFileSync(path.join(shotDir, 'smoke-round2.json'), JSON.stringify(check, null, 2));
  if (!check.hasInv || !check.lsHasSmoke) throw new Error('SMOKE-001 missing after relaunch');
  console.log('[smoke] ROUND2_OK');
  app.exit(0);
}

module.exports = { runSmokeTest, runPersistSmoke };
