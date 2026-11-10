'use strict';
const fs = require('fs');
const path = require('path');

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
  fs.writeFileSync(dest, (await win.webContents.capturePage()).toPNG());
  console.log('[firstrun-extra] shot', dest);
}
async function runFirstrunExtra({ app, getMainWindow, shotDir }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const win = await waitForWindow(getMainWindow);
  await wait(1500);
  // Unlock + minimal generic shop (reuse existing lock if any)
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
      await new Promise(r => setTimeout(r, 400));
      if (!(State.business && State.business.name)) {
        const n = document.getElementById('setup-biz-name');
        if (n) n.value = 'My Shop';
        if (typeof submitCompanySetup === 'function') submitCompanySetup(new Event('submit'));
      } else {
        document.getElementById('modal-company-setup')?.classList.remove('open');
      }
      return true;
    })()
  `);
  await wait(1000);

  // Settings templates
  await win.webContents.executeJavaScript(`typeof switchView==='function' && switchView('settings')`);
  await wait(600);
  await win.webContents.executeJavaScript(`document.getElementById('print-template-select')?.scrollIntoView({block:'center'})`);
  await wait(400);
  await shot(win, shotDir, 'firstrun-07b-settings-templates.png');

  // Backup card
  await win.webContents.executeJavaScript(`document.getElementById('backup-demo-card')?.scrollIntoView({block:'center'})`);
  await wait(400);
  await shot(win, shotDir, 'firstrun-05-backup.png');

  // Sync section in settings
  await win.webContents.executeJavaScript(`
    (function(){
      const el = document.querySelector('.sync-help, #sync-card, #desktop-sync, [id*="sync"]');
      el?.scrollIntoView({block:'center'});
    })()
  `);
  await wait(400);
  await shot(win, shotDir, 'firstrun-06-sync.png');

  // Create a real empty invoice and open print
  const opened = await win.webContents.executeJavaScript(`
    (function () {
      const inv = {
        id: 'firstrun-preview',
        invoiceNo: 'PREVIEW',
        docType: 'TAX_INVOICE',
        date: new Date().toISOString().slice(0,10),
        partyName: '',
        partyId: null,
        items: [],
        lines: [],
        taxableAmount: 0, cgstAmount: 0, sgstAmount: 0, igstAmount: 0, grandTotal: 0
      };
      State.invoices = (State.invoices || []).filter(x => x.id !== 'firstrun-preview').concat([inv]);
      if (typeof saveToStorage === 'function') saveToStorage();
      if (typeof openPrintModal === 'function') { openPrintModal('firstrun-preview'); return 'openPrintModal'; }
      if (typeof openInvoiceDetail === 'function') { openInvoiceDetail('firstrun-preview'); return 'detail'; }
      return 'fail';
    })()
  `);
  console.log('[firstrun-extra] open=', opened);
  await wait(1000);
  await shot(win, shotDir, 'firstrun-07c-print-modal.png');

  const ids = ['GOLD','CLASSIC','SIMPLE','A4_GST','THERMAL','THERMAL_80'];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    await win.webContents.executeJavaScript(`
      (function(){
        const sel = document.getElementById('print-template-select');
        if (sel) {
          sel.value = ${JSON.stringify('ID')};
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (typeof syncThemeChrome === 'function') syncThemeChrome();
        if (typeof renderInvoicePreview === 'function') renderInvoicePreview();
        if (typeof refreshPrintPreview === 'function') refreshPrintPreview();
        if (typeof updatePrintModal === 'function') updatePrintModal();
        // common pattern: re-call openPrintModal to refresh
        if (typeof openPrintModal === 'function') openPrintModal('firstrun-preview');
      })()
    `.replaceAll('ID', id).replace('replaceAll', 'replace') /* noop guard */);
    // fix: above replaceAll may not exist in old node — do properly
    await wait(0);
  }
  // Proper loop without broken replace
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    await win.webContents.executeJavaScript(`
      (function(){
        const sel = document.getElementById('print-template-select');
        if (sel) {
          sel.value = "${id}";
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (typeof syncThemeChrome === 'function') syncThemeChrome();
        if (typeof openPrintModal === 'function') openPrintModal('firstrun-preview');
      })()
    `);
    await wait(700);
    await shot(win, shotDir, `firstrun-08-template-${String(i + 1).padStart(2, '0')}-${id}.png`);
  }

  // Parties view to see sample GSTIN chrome if visible
  await win.webContents.executeJavaScript(`
    document.getElementById('modal-print')?.classList.remove('open');
    typeof switchView==='function' && switchView('parties');
  `);
  await wait(600);
  await shot(win, shotDir, 'firstrun-10-parties-empty.png');

  console.log('[firstrun-extra] OK');
  app.exit(0);
}
module.exports = { runFirstrunExtra };
