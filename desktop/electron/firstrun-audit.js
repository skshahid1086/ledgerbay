'use strict';

const fs = require('fs');
const path = require('path');

// Private names that must never show in a store build (old demo shop, owner names, ...).
// Kept out of source: pass them via LB_AUDIT_LEAK_WORDS ("a|b|c") or a JSON array file
// named by LB_AUDIT_LEAK_FILE. Generic legacy branding is always checked.
function loadLeakWords() {
  const words = ['BillSetu'];
  if (process.env.LB_AUDIT_LEAK_WORDS) words.push(...process.env.LB_AUDIT_LEAK_WORDS.split('|'));
  try {
    if (process.env.LB_AUDIT_LEAK_FILE) words.push(...JSON.parse(fs.readFileSync(process.env.LB_AUDIT_LEAK_FILE, 'utf8')));
  } catch (_) {}
  return [...new Set(words.map((w) => String(w).trim()).filter(Boolean))];
}
const LEAK_WORDS = loadLeakWords();

async function waitForWindow(getWindow, ms = 12000) {
  const wait = (t) => new Promise((r) => setTimeout(r, t));
  const start = Date.now();
  while (Date.now() - start < ms) {
    const w = getWindow();
    if (w && !w.isDestroyed()) return w;
    await wait(100);
  }
  throw new Error('No main window');
}

async function shot(win, shotDir, name) {
  const dest = path.join(shotDir, name);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(dest, img.toPNG());
  console.log('[firstrun] shot', dest, fs.statSync(dest).size);
  return dest;
}

async function evalJson(win, expr) {
  return win.webContents.executeJavaScript(`(async () => (${expr}))()`);
}

async function runFirstrunAudit({ app, getMainWindow, shotDir }) {
  fs.mkdirSync(shotDir, { recursive: true });
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const findings = [];
  const note = (s) => { findings.push(s); console.log('[firstrun]', s); };

  console.log('[firstrun] userData=', app.getPath('userData'));
  const win = await waitForWindow(getMainWindow);
  await wait(1800);
  note('title=' + win.getTitle());

  // 01 — auth gate (true first screen before any unlock)
  await shot(win, shotDir, 'firstrun-01-auth-gate.png');
  const authDom = await evalJson(win, `{
    authVisible: !!document.getElementById('auth-gate') && !document.getElementById('auth-gate').classList.contains('d-none'),
    bodyBooks: document.body.classList.contains('books-open'),
    title: document.title,
    hasBillSetuInTitle: /billsetu/i.test(document.title),
    setupOpen: !!document.getElementById('modal-company-setup')?.classList.contains('open')
  }`);
  note('authDom=' + JSON.stringify(authDom));
  if (authDom.hasBillSetuInTitle) note('ISSUE: document.title still mentions BillSetu');

  // Unlock only (password gate) — required to see in-app first-run; does NOT seed business/parties
  await win.webContents.executeJavaScript(`
    (async function () {
      const salt = 'firstrun-salt';
      const password = 'firstrun-pass';
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + ':' + password));
      const hash = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('billsetu_lock_v1', JSON.stringify({ salt, hash }));
      sessionStorage.setItem('billsetu_open', '1');
      sessionStorage.setItem('billsetu_actor', JSON.stringify({ id: 'owner', name: 'Owner', role: 'ADMIN' }));
      if (typeof enterApp === 'function') enterApp();
      return true;
    })()
  `);
  await wait(1200);

  // 02 — company setup wizard (should be empty name; check state default)
  await shot(win, shotDir, 'firstrun-02-company-setup.png');
  const setup = await evalJson(win, `{
    setupOpen: !!document.getElementById('modal-company-setup')?.classList.contains('open'),
    bizName: document.getElementById('setup-biz-name')?.value || '',
    trade: document.getElementById('setup-trade-name')?.value || '',
    gstin: document.getElementById('setup-gstin')?.value || '',
    phone: document.getElementById('setup-phone')?.value || '',
    address: document.getElementById('setup-address')?.value || '',
    stateVal: document.getElementById('setup-state')?.value || '',
    stateText: document.getElementById('setup-state')?.selectedOptions?.[0]?.textContent || '',
    stateOptions: [...(document.getElementById('setup-state')?.options || [])].slice(0,6).map(o => o.textContent.trim()),
    emptyBiz: State.business && { name: State.business.name, gstin: State.business.gstin, stateCode: State.business.stateCode, stateName: State.business.stateName, phone: State.business.phone },
    parties: (State.parties||[]).length,
    items: (State.items||[]).length,
    invoices: (State.invoices||[]).length,
    variant: (window.LEDGERBAY_BUILD && LEDGERBAY_BUILD.VARIANT) || null,
    appName: (window.LEDGERBAY_BUILD && LEDGERBAY_BUILD.APP_NAME) || null
  }`);
  note('setup=' + JSON.stringify(setup, null, 2));
  if (!setup.setupOpen) note('ISSUE: company setup wizard did not open on empty store first run');
  if (setup.bizName || setup.gstin || setup.phone) note('ISSUE: setup fields pre-filled');
  if (setup.stateVal === '27' || /Maharashtra/i.test(setup.stateText)) note('ISSUE: setup state defaults to Maharashtra instead of blank/select');
  if (setup.parties || setup.items || setup.invoices) note('ISSUE: sample parties/items/invoices present');

  // Complete setup with GENERIC non-personal name so we can walk remaining screens
  await win.webContents.executeJavaScript(`
    (function () {
      const n = document.getElementById('setup-biz-name');
      if (n) n.value = 'My Shop';
      const t = document.getElementById('setup-trade-name');
      if (t) t.value = '';
      const g = document.getElementById('setup-gstin');
      if (g) g.value = '';
      const p = document.getElementById('setup-phone');
      if (p) p.value = '';
      const a = document.getElementById('setup-address');
      if (a) a.value = '';
      // 1.13.9+ requires the GST state; pick a state (no personal data)
      const st = document.getElementById('setup-state');
      if (st && !st.value) { st.value = '22'; st.dispatchEvent(new Event('change')); }
      if (typeof submitCompanySetup === 'function') submitCompanySetup(new Event('submit'));
      return true;
    })()
  `);
  await wait(1000);
  note('completed setup with generic My Shop only (to reach later screens)');

  // 03 — empty-ish dashboard after setup
  await shot(win, shotDir, 'firstrun-03-dashboard.png');
  const dash = await evalJson(win, `{
    biz: State.business && State.business.name,
    chipState: document.getElementById('chip-state')?.textContent || '',
    parties: (State.parties||[]).length,
    items: (State.items||[]).length,
    invoices: (State.invoices||[]).length,
    leakHits: ${JSON.stringify(LEAK_WORDS)}.filter((w) => document.body.innerText.toLowerCase().includes(w.toLowerCase())),
    sampleGstin: /27AABCR1234/i.test(document.body.innerText)
  }`);
  note('dash=' + JSON.stringify(dash));
  if ((dash.leakHits || []).length || dash.sampleGstin) note('ISSUE: private/sample data on dashboard: ' + JSON.stringify(dash.leakHits));

  // 04 — Settings
  await win.webContents.executeJavaScript(`typeof switchView==='function' && switchView('settings')`);
  await wait(800);
  await shot(win, shotDir, 'firstrun-04-settings.png');
  const settings = await evalJson(win, `{
    setName: document.getElementById('set-name')?.value || document.getElementById('set-biz-name')?.value || '',
    setGstin: document.getElementById('set-gstin')?.value || '',
    setState: document.getElementById('set-state')?.value || '',
    setStateText: document.getElementById('set-state')?.selectedOptions?.[0]?.textContent || '',
    demoBtnHidden: (() => {
      const b = document.getElementById('btn-quick-sample');
      if (!b) return true;
      return b.hasAttribute('hidden') || b.classList.contains('d-none') || getComputedStyle(b).display==='none';
    })(),
    demoBtnText: document.getElementById('btn-quick-sample')?.textContent || null,
    backupCardH: document.querySelector('#backup-demo-card h4')?.textContent || null,
    leakHits: ${JSON.stringify(LEAK_WORDS)}.filter((w) => document.body.innerText.toLowerCase().includes(w.toLowerCase()))
  }`);
  note('settings=' + JSON.stringify(settings));
  if ((settings.leakHits || []).length) note('ISSUE: private/legacy name on settings: ' + JSON.stringify(settings.leakHits));
  if (!settings.demoBtnHidden) note('ISSUE: Reload demo button still visible in store build');

  // 05 — Backup / demo card area (scroll settings)
  await win.webContents.executeJavaScript(`
    document.getElementById('backup-demo-card')?.scrollIntoView({block:'center'});
  `);
  await wait(400);
  await shot(win, shotDir, 'firstrun-05-backup.png');

  // 06 — Sync wizard / settings sync section
  await win.webContents.executeJavaScript(`
    (function(){
      const sync = document.getElementById('sync-panel') || document.getElementById('view-sync')
        || document.querySelector('[data-view="sync"]') || document.getElementById('settings-sync');
      if (sync) sync.scrollIntoView({block:'center'});
      const tab = document.querySelector('[data-settings-tab="sync"], #tab-sync, button[onclick*="sync"]');
      if (tab) tab.click();
      if (typeof switchView === 'function') {
        try { switchView('sync'); } catch (_) {}
      }
    })()
  `);
  await wait(600);
  await shot(win, shotDir, 'firstrun-06-sync.png');
  const syncInfo = await evalJson(win, `{
    textHasBillSetu: /BillSetu/i.test(document.body.innerText),
    syncVisible: !!(document.getElementById('sync-panel') || document.querySelector('.sync-help')),
    help: document.querySelector('.sync-help')?.textContent || null
  }`);
  note('sync=' + JSON.stringify(syncInfo));

  // Invoice templates: open print modal with a blank draft invoice
  await win.webContents.executeJavaScript(`
    (function () {
      if (typeof switchView === 'function') switchView('dashboard');
      // Minimal empty draft so template preview renders headers only
      const inv = {
        id: 'firstrun-preview',
        invoiceNo: '',
        docType: 'TAX_INVOICE',
        date: new Date().toISOString().slice(0,10),
        partyId: null,
        partyName: '',
        items: [],
        lines: [],
        totals: { taxable: 0, cgst: 0, sgst: 0, igst: 0, grand: 0 },
        subtotal: 0, cgst: 0, sgst: 0, igst: 0, grandTotal: 0
      };
      if (!State.invoices) State.invoices = [];
      // Do not push into State permanently if openPrintModal accepts object — try both
      if (typeof openPrintModal === 'function') {
        try { openPrintModal(inv); return 'openPrintModal(obj)'; } catch (e1) {
          State.invoices.push(inv);
          try { openPrintModal(inv.id); return 'openPrintModal(id)'; } catch (e2) { return String(e2); }
        }
      }
      return 'no openPrintModal';
    })()
  `);
  await wait(900);
  await shot(win, shotDir, 'firstrun-07-print-templates.png');
  const themes = await evalJson(win, `{
    options: [...(document.getElementById('print-template-select')?.options || [])].map(o => ({v:o.value, t:o.textContent.trim()})),
    themeNames: (typeof INVOICE_THEMES !== 'undefined' ? INVOICE_THEMES.map(t => t.name) : null),
    pickerText: document.getElementById('theme-picker')?.innerText || null,
    leakHits: ${JSON.stringify(LEAK_WORDS)}.filter((w) => document.body.innerText.toLowerCase().includes(w.toLowerCase()))
  }`);
  note('themes=' + JSON.stringify(themes));
  const themeLeaks = LEAK_WORDS.filter((w) => (themes.themeNames || []).some((n) => String(n).toLowerCase().includes(w.toLowerCase())));
  if ((themes.leakHits || []).length || themeLeaks.length) {
    note('ISSUE: private/legacy name visible in print templates: ' + JSON.stringify([...(themes.leakHits || []), ...themeLeaks]));
  }

  // Cycle each template preview
  const ids = (themes.options || []).map((o) => o.v).filter(Boolean);
  let ti = 0;
  for (const id of ids) {
    ti += 1;
    await win.webContents.executeJavaScript(`
      (function(){
        const sel = document.getElementById('print-template-select');
        if (sel) { sel.value = ${JSON.stringify(id)}; sel.dispatchEvent(new Event('change', {bubbles:true})); }
        if (typeof syncThemeChrome === 'function') syncThemeChrome();
        if (typeof previewInvoiceTemplate === 'function') previewInvoiceTemplate();
        if (typeof renderPrintPreview === 'function') renderPrintPreview();
        if (typeof refreshPrintPreview === 'function') refreshPrintPreview();
      })()
    `);
    await wait(500);
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
    await shot(win, shotDir, `firstrun-08-template-${String(ti).padStart(2,'0')}-${safe}.png`);
  }

  // Print preview close → About/Help via in-app if any
  await win.webContents.executeJavaScript(`
    document.getElementById('modal-print')?.classList.remove('open');
    document.querySelector('#modal-print .modal-close, #modal-print [data-close]')?.click();
  `);
  await wait(400);

  // Help / about in settings or footer
  await win.webContents.executeJavaScript(`
    (function(){
      if (typeof switchView==='function') switchView('settings');
      const about = document.getElementById('about-panel') || document.getElementById('view-about')
        || document.querySelector('[data-view="about"]');
      about?.scrollIntoView({block:'center'});
      // open help modal if present
      document.getElementById('btn-about')?.click();
      document.querySelector('[data-open="about"]')?.click();
    })()
  `);
  await wait(500);
  await shot(win, shotDir, 'firstrun-09-about-help.png');
  const about = await evalJson(win, `{
    leakHits: ${JSON.stringify(LEAK_WORDS)}.filter((w) => document.body.innerText.toLowerCase().includes(w.toLowerCase())),
    versionText: (document.body.innerText.match(/1\\.\\d+\\.\\d+/)||[])[0] || null,
    desktop: !!(window.billsetuDesktop && billsetuDesktop.isDesktop),
    noDemoSeed: window.billsetuDesktop && billsetuDesktop.noDemoSeed,
    info: window.billsetuDesktop && billsetuDesktop.getInfo ? await billsetuDesktop.getInfo() : null
  }`);
  note('about=' + JSON.stringify(about));

  // Party lead sample GSTIN in DOM (hidden list chrome)
  const leaks = await evalJson(win, `{
    partyLeadGstin: document.getElementById('party-lead-gstin')?.textContent || null,
    chipState: document.getElementById('chip-state')?.textContent || null,
    htmlSampleGstin: !!document.body.innerHTML.includes('27AABCR1234A1Z2'),
    htmlLeaks: ${JSON.stringify(LEAK_WORDS)}.filter((w) => document.body.innerHTML.includes(w)),
    title: document.title
  }`);
  note('leaks=' + JSON.stringify(leaks));
  if (leaks.htmlSampleGstin) note('ISSUE: sample GSTIN 27AABCR1234A1Z2 still in HTML');
  if ((leaks.htmlLeaks || []).length) note('ISSUE: private/legacy name in HTML: ' + JSON.stringify(leaks.htmlLeaks));
  if (LEAK_WORDS.some((w) => (leaks.title || '').includes(w))) note('ISSUE: document.title carries a private/legacy name: ' + leaks.title);


  // UPI QR in print preview (dummy ID — production concern for blank QR)
  let upiQr = null;
  try {
    await win.webContents.executeJavaScript(`
      (function () {
        if (State.business) {
          State.business.upiId = 'test@upi';
          State.business.name = State.business.name || 'My Shop';
        }
        if (typeof saveToStorage === 'function') saveToStorage();
        const inv = {
          id: 'firstrun-upi',
          invoiceNo: 'UPI-TEST',
          docType: 'TAX_INVOICE',
          date: new Date().toISOString().slice(0,10),
          partyName: 'Walk-in',
          partyId: null,
          items: [{ description: 'Sample item', name: 'Sample item', hsn: '0000', qty: 1, rate: 100, gstRate: 18, amount: 100, preBillTaxableVal: 100, taxableVal: 100, cgstVal: 9, sgstVal: 9, igstVal: 0, cgstAmt: 9, sgstAmt: 9, igstAmt: 0, unit: 'pcs' }],
          lines: [{ name: 'Sample item', hsn: '0000', qty: 1, rate: 100, gstRate: 18, amount: 100 }],
          isInterstate: false,
          taxableTotal: 100, cgstTotal: 9, sgstTotal: 9, igstTotal: 0, roundOff: 0, grandTotal: 118,
          taxableAmount: 100, cgstAmount: 9, sgstAmount: 9, igstAmount: 0
        };
        State.invoices = (State.invoices || []).filter(x => x.id !== 'firstrun-upi').concat([inv]);
        if (typeof saveToStorage === 'function') saveToStorage();
        if (typeof openPrintModal === 'function') openPrintModal('firstrun-upi');
        return true;
      })()
    `);
    await wait(1200);
    // Dismiss the 'Set up your company' wizard (and its backdrop) so the print preview QR is visible
    await win.webContents.executeJavaScript(`
      (function () {
        const m = document.getElementById('modal-company-setup');
        if (m) { m.classList.remove('open'); m.style.display = 'none'; }
        const pv = document.getElementById('modal-print-preview');
        if (pv && !pv.classList.contains('open') && typeof openPrintModal === 'function') openPrintModal('firstrun-upi');
        const q = pv && pv.querySelector('svg.upi-qr, .upi-qr, .classic-upi');
        if (q && q.scrollIntoView) q.scrollIntoView({ block: 'center' });
        return true;
      })()
    `);
    await wait(600);
    await shot(win, shotDir, 'final-04-print-upi-qr.png');
    upiQr = await evalJson(win, `{
      upiId: State.business && State.business.upiId,
      previewHtml: (document.getElementById('print-preview') || document.querySelector('.print-preview') || document.getElementById('invoice-preview') || document.querySelector('#modal-print .preview') || document.querySelector('#modal-print'))?.innerHTML?.slice(0, 5000) || '',
      hasUpiSvg: !!document.querySelector('#modal-print-preview svg.upi-qr, #modal-print svg.upi-qr, #modal-print .upi-qr, #print-preview svg.upi-qr, .print-preview svg.upi-qr, #invoice-preview svg.upi-qr, svg.upi-qr'),
      hasUpiIdText: /test@upi/i.test(document.getElementById('modal-print-preview')?.innerText || document.body.innerText || ''),
      svgCount: document.querySelectorAll('#modal-print svg, #print-preview svg, .print-preview svg').length,
      qrHtmlLen: (typeof upiQrHtml === 'function' && State.business) ? String(upiQrHtml({ grandTotal: 118, invoiceNo: 'UPI-TEST' }, 96) || '').length : null
    }`);
    note('upiQr=' + JSON.stringify({ hasUpiSvg: upiQr.hasUpiSvg, hasUpiIdText: upiQr.hasUpiIdText, svgCount: upiQr.svgCount, qrHtmlLen: upiQr.qrHtmlLen, upiId: upiQr.upiId }));
    if (!upiQr.hasUpiSvg && !(upiQr.qrHtmlLen > 50)) note('ISSUE: UPI QR did not render in desktop print preview with test@upi');
  } catch (e) {
    note('UPI QR check error: ' + e);
  }

  // Key finals for release pack
  const finals = [
    ['firstrun-01-auth-gate.png', 'final-01-auth.png'],
    ['firstrun-02-company-setup.png', 'final-02-setup.png'],
    ['firstrun-03-dashboard.png', 'final-03-dashboard.png'],
  ];
  for (const [src, dst] of finals) {
    const a = path.join(shotDir, src);
    const b = path.join(shotDir, dst);
    if (fs.existsSync(a)) { fs.copyFileSync(a, b); note('final shot ' + b); }
  }
  // print UPI already written as final-04

  const reportPath = path.join(shotDir, 'firstrun-audit.json');
  fs.writeFileSync(reportPath, JSON.stringify({ findings, setup, dash, settings, themes, about, leaks, upiQr }, null, 2));
  note('wrote ' + reportPath);
  note('FIRSTRUN_AUDIT_OK');
  app.exit(0);
}

module.exports = { runFirstrunAudit };
