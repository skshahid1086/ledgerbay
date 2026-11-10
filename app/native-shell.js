/**
 * Phone chrome, logo uploads, and print / PDF.
 * On Android the system print dialog comes from the BillPrint plugin.
 * On a PC, Print uses the browser. Share and Download build a PDF file.
 */

function isNativeApp() {
  return !!(window.Capacitor && typeof window.Capacitor.isNativePlatform === "function" && window.Capacitor.isNativePlatform());
}

function billPrintPlugin() {
  if (!isNativeApp() || !window.Capacitor) return null;
  try {
    if (window.Capacitor.Plugins && window.Capacitor.Plugins.BillPrint) {
      return window.Capacitor.Plugins.BillPrint;
    }
    if (typeof window.Capacitor.registerPlugin === "function") {
      return window.Capacitor.registerPlugin("BillPrint");
    }
  } catch (err) {
    console.warn("BillPrint plugin unavailable", err);
  }
  return null;
}


/** Re-entrancy guard: one print job at a time (blocks double-click / double-bind). */
let __billsetuPrinting = false;
let __billsetuPrintTimer = null;
function beginPrintJob() {
  if (__billsetuPrinting) return false;
  __billsetuPrinting = true;
  clearTimeout(__billsetuPrintTimer);
  __billsetuPrintTimer = setTimeout(() => { __billsetuPrinting = false; }, 4000);
  return true;
}
function endPrintJob() {
  clearTimeout(__billsetuPrintTimer);
  __billsetuPrinting = false;
}
window.beginPrintJob = beginPrintJob;
window.endPrintJob = endPrintJob;

async function callBillPrintHtml(plugin, opts) {
  if (!plugin) throw new Error("No print plugin");
  if (plugin.__billsetuBusy) {
    const err = new Error("Print already in progress");
    err.code = "PRINT_BUSY";
    throw err;
  }
  plugin.__billsetuBusy = true;
  try {
    return await plugin.printHtml(opts);
  } finally {
    setTimeout(() => { plugin.__billsetuBusy = false; }, 4000);
  }
}
window.callBillPrintHtml = callBillPrintHtml;


function bindOnce(el, event, handler, flag) {
  if (!el) return;
  const key = flag || ("wired" + event);
  if (el.dataset[key] === "1") return;
  el.dataset[key] = "1";
  el.addEventListener(event, handler);
}

/** Keep modals/drawers as direct body children so topbar stacking cannot trap them. */
function ensureOverlaysOnBody() {
  const ids = [
    "modal-invoice", "modal-discard-draft", "modal-invoice-created", "modal-print-preview", "modal-party",
    "modal-item", "modal-payment", "modal-expense", "modal-barcode", "modal-receipt-voucher",
    "modal-po", "modal-debit", "modal-purchase", "modal-receive", "modal-voucher",
    "invoice-detail-root", "toast-container", "print-root", "scan-overlay", "auth-gate",
    "sidebar-backdrop"
  ];
  ids.forEach(id => {
    const node = document.getElementById(id);
    if (node && node.parentElement !== document.body) document.body.appendChild(node);
  });
  document.querySelectorAll(".modal-backdrop").forEach(node => {
    if (node.parentElement !== document.body) document.body.appendChild(node);
  });
}

function compressImageFile(file, maxPx) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that image"));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, (maxPx || 512) / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const mime = file.type === "image/png" ? "image/png" : "image/jpeg";
        resolve(canvas.toDataURL(mime, 0.82));
      };
      img.onerror = () => reject(new Error("That file is not a usable image"));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function refreshBrandPreviews() {
  const b = State.business || {};
  const logoBox = document.getElementById("logo-preview");
  if (logoBox) {
    logoBox.innerHTML = b.logo
      ? `<img src="${typeof safeImageUrl === "function" ? safeImageUrl(b.logo) : ""}" alt="Business logo">`
      : `<span>${escHtml(typeof businessInitials === "function" ? businessInitials(b.name) : "")}</span>`;
  }
  const signBox = document.getElementById("sign-preview");
  if (signBox) {
    const sign = typeof safeImageUrl === "function" ? safeImageUrl(b.signatureImage) : "";
    signBox.innerHTML = sign
      ? `<img src="${sign}" alt="Signature">`
      : `<span class="text-muted text-sm">No image</span>`;
  }
}

async function storeBrandImage(file, key) {
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    showToast("Use a PNG, JPG, or WebP image.", "error");
    return;
  }
  try {
    State.business[key] = await compressImageFile(file, key === "signatureImage" ? 640 : 512);
    refreshBrandPreviews();
    saveToStorage();
    showToast(key === "logo" ? "Logo saved on this device." : "Signature saved on this device.");
  } catch (err) {
    showToast(err.message || "Could not use that image.", "error");
  }
}

function stampTableLabels(root) {
  (root || document).querySelectorAll(".table-responsive table").forEach(table => {
    const heads = [...table.querySelectorAll("thead th")].map(th => th.textContent.trim());
    table.querySelectorAll("tbody tr").forEach(row => {
      [...row.children].forEach((cell, index) => {
        if (cell.tagName === "TD" && heads[index]) cell.dataset.label = heads[index];
      });
    });
  });
}

const APPBAR_TITLES = {
  dashboard: "Dashboard",
  pos: "Counter",
  sales: "Bills",
  parties: "Parties",
  purchases: "Purchases",
  inventory: "Items",
  godowns: "Godowns",
  expenses: "Expenses",
  reports: "Reports",
  staff: "Staff",
  settings: "Settings",
  accounts: "Books",
  recurring: "Recurring"
};
const APPBAR_MAIN = new Set(["dashboard", "sales", "parties", "inventory"]);
const FAB_LABELS = {
  dashboard: "+ Create Invoice",
  pos: "+ Create Invoice",
  sales: "+ Create Invoice",
  parties: "+ Add Party",
  inventory: "+ Create New Item",
  accounts: "+ New voucher"
};

function syncAppBar(viewName) {
  const title = document.getElementById("appbar-title");
  const back = document.getElementById("appbar-back");
  const partyOpen = document.body.classList.contains("party-detail-open") && viewName === "parties";
  const partyName = document.getElementById("party-lead-name")?.textContent;
  if (title) title.textContent = partyOpen && partyName ? partyName : (APPBAR_TITLES[viewName] || "Ledgerbay");
  const sub = partyOpen || !APPBAR_MAIN.has(viewName);
  if (back) back.hidden = !sub;
  document.querySelector(".topbar")?.classList.toggle("show-back", sub);
}

function syncFab(viewName) {
  const fab = document.getElementById("mobile-fab");
  const label = document.getElementById("fab-label");
  const blocked = viewName === "accounts" && typeof canWrite === "function" && !canWrite("accounts");
  const text = blocked ? "" : (FAB_LABELS[viewName] || "");
  if (label && text) label.textContent = text;
  if (fab) {
    fab.classList.toggle("is-off", !text);
    fab.setAttribute("aria-label", text || "Create");
  }
}

function syncBottomNav(viewName) {
  document.querySelectorAll("#bottom-nav [data-view]").forEach(button => {
    button.classList.toggle("active", button.dataset.view === viewName);
  });
  syncAppBar(viewName);
  syncFab(viewName);
}

function closeDrawer() {
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("show");
}

function openDrawer() {
  document.getElementById("sidebar")?.classList.add("open");
  document.getElementById("sidebar-backdrop")?.classList.add("show");
}

function mobilePrimaryAction() {
  const view = State.currentView || "dashboard";
  if (view === "parties" && typeof openAddPartyModal === "function") return openAddPartyModal();
  if (view === "inventory" && typeof openAddItemModal === "function") return openAddItemModal();
  if (view === "accounts" && typeof openVoucherModal === "function") return openVoucherModal("Journal");
  if (view === "purchases") return switchView("purchases");
  if (typeof openNewInvoiceModal === "function") openNewInvoiceModal();
}

function topOpenModal() {
  const open = [...document.querySelectorAll(".modal-backdrop.open")];
  return open[open.length - 1] || null;
}

function handleHardwareBack() {
  if (document.body.classList.contains("barcode-scanner-active")) {
    if (typeof stopBarcodeScan === "function") stopBarcodeScan();
    return;
  }
  // 1) Invoice "More" sheet
  if (typeof isInvoiceMoreOpen === "function" && isInvoiceMoreOpen()) {
    closeInvoiceMore();
    return;
  }
  // 2) Top-most modal (print / edit / pay) — above detail in z-order
  const modal = topOpenModal();
  if (modal) {
    modal.classList.remove("open");
    if (modal.id === "modal-invoice") {
      document.body.classList.remove("invoice-modal-open");
      if (typeof setInvoiceModalOpen === "function") setInvoiceModalOpen(false);
    }
    // Sync stuck overlay classes if no other modal remains
    if (!document.querySelector(".modal-backdrop.open")) {
      document.body.classList.remove("invoice-modal-open");
    }
    return;
  }
  // 3) Invoice / purchase detail sheet
  if (typeof isInvoiceDetailOpen === "function" && isInvoiceDetailOpen()) {
    closeInvoiceDetail();
    return;
  }
  // 4) Sidebar drawer
  if (document.getElementById("sidebar")?.classList.contains("open")) {
    closeDrawer();
    return;
  }
  // Clear stuck sidebar backdrop if any
  document.getElementById("sidebar-backdrop")?.classList.remove("show");
  // 5–6) Step through hash history (Sales→Parties→Dashboard→exit toast).
  // Same path as browser Back / history-nav onPopState (NEW-1).
  history.back();
}

window.handleHardwareBack = handleHardwareBack;

async function bootNativeChrome() {
  if (!isNativeApp()) return;
  try {
    const StatusBar = window.Capacitor.registerPlugin("StatusBar");
    await StatusBar.setOverlaysWebView({ overlay: false });
    await StatusBar.setBackgroundColor({ color: "#0F766E" });
    await StatusBar.setStyle({ style: "LIGHT" });
  } catch (err) {
    console.warn("Status bar", err);
  }
  try {
    const Splash = window.Capacitor.registerPlugin("SplashScreen");
    await Splash.hide();
  } catch (err) {
    console.warn("Splash", err);
  }
  try {
    const App = window.Capacitor.registerPlugin("App");
    await App.addListener("backButton", handleHardwareBack);
  } catch (err) {
    console.warn("Back button", err);
  }
}

function bytesToDataUrl(buffer, mime) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

let printAssetPromise;
function loadPrintAssets() {
  if (!printAssetPromise) {
    printAssetPromise = (async () => {
      const [theme, indexCss, regular, bold, serif] = await Promise.all([
        fetch("theme.css").then(res => res.text()),
        fetch("index.css").then(res => res.text()),
        fetch("fonts/LiberationSans-Regular.ttf").then(res => res.arrayBuffer()),
        fetch("fonts/LiberationSans-Bold.ttf").then(res => res.arrayBuffer()),
        fetch("fonts/LiberationSerif-Bold.ttf").then(res => res.arrayBuffer())
      ]);
      const faces = {
        "fonts/LiberationSans-Regular.ttf": bytesToDataUrl(regular, "font/ttf"),
        "fonts/LiberationSans-Bold.ttf": bytesToDataUrl(bold, "font/ttf"),
        "fonts/LiberationSerif-Bold.ttf": bytesToDataUrl(serif, "font/ttf")
      };
      let css = `${indexCss}\n${theme}`;
      Object.entries(faces).forEach(([path, url]) => {
        css = css.split(path).join(url);
      });
      return css;
    })();
  }
  return printAssetPromise;
}

function currentSheetsHtml() {
  renderPrintableCanvas();
  return document.getElementById("printable-invoice-container")?.innerHTML || "";
}

async function standalonePrintHtml() {
  const css = await loadPrintAssets().catch(() => "");
  const body = currentSheetsHtml();
  const size = paperSizeMm();
  const isA5 = size.widthMm <= 150 && size.heightMm <= 220;
  const isA4 = size.widthMm >= 200;
  const pageRule = isA5
    ? "@page { size: A5 portrait; margin: 8mm; }"
    : (isA4
      ? "@page { size: A4 portrait; margin: 8mm; }"
      : `@page { size: ${size.widthMm}mm auto; margin: 0; }`);
  // Match WebView layout width (CSS 96dpi) so phone print does not shrink to device-width.
  const viewportPx = Math.max(320, Math.round((size.widthMm / 25.4) * 96));
  const fillH = isA5 ? "190mm" : (isA4 ? "277mm" : "auto");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${viewportPx}, initial-scale=1, maximum-scale=1">
  <style>
    ${css}
    html, body {
      margin: 0 !important; padding: 0 !important; background: #fff !important;
      width: 100% !important; max-width: 100% !important;
      height: auto !important;
    }
    #print-root {
      display: block !important; margin: 0 !important; padding: 0 !important;
      width: 100% !important; max-width: 100% !important;
    }
    * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
    .sheet-page, .gold-page, .gold-frame, .gold-grow, .classic-page, .classic-slip, .slip-box, .bsf-sheet { background: #fff !important; }
    .sheet-page, .bsf-sheet {
      box-shadow: none !important; margin: 0 !important; zoom: 1 !important; transform: none !important;
      width: 100% !important; max-width: 100% !important; min-width: 0 !important;
      box-sizing: border-box !important;
      break-after: page !important; page-break-after: always !important;
    }
    .sheet-page:last-child, .bsf-sheet:last-child {
      break-after: auto !important; page-break-after: auto !important;
    }
    body.is-printing .sheet-a4,
    body.is-printing .sheet-a4.gold-page,
    body.is-printing .sheet-a4.classic-page,
    body.is-printing .bsf-sheet {
      min-height: ${fillH} !important;
      height: ${fillH} !important;
      padding: 0 !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
    }
    body.is-printing .bsf-sheet .bsf-items {
      flex: 1 1 auto !important; display: flex !important; flex-direction: column !important; min-height: 0 !important;
    }
    body.is-printing .bsf-sheet .bsf-grow,
    body.is-printing .gold-grow,
    body.is-printing .classic-items { flex: 1 1 auto !important; height: 100% !important; }
    body.is-printing .classic-fill { height: 100% !important; }
    body.is-printing .classic-fill td { height: 100% !important; border-top: none !important; padding: 0 !important; }
    body.is-printing .classic-wrap {
      flex: 1 1 auto !important; width: 100% !important; height: 100% !important; min-height: 100% !important;
    }
    body.is-printing .classic-wrap .items-row { height: 100% !important; }
    body.is-printing .classic-page .items-cell { height: 100% !important; padding: 0 !important; }
    body.is-printing .classic-body {
      display: flex !important; flex-direction: column !important;
      min-height: 100% !important; height: 100% !important;
    }
    body.is-printing .bsf-table thead { display: table-header-group !important; }
    body.is-printing .bsf-table tr { break-inside: avoid; page-break-inside: avoid; }
    body.is-printing .sheet-a5 {
      min-height: 190mm !important;
      height: 190mm !important;
      padding: 0 !important;
      overflow: hidden !important;
      display: flex !important;
      flex-direction: column !important;
    }
    .gold-page { padding: 0 !important; }
    .gold-frame {
      min-height: 100% !important;
      height: 100% !important;
      border-color: #c4a35a !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .sheet-a5 .gold-frame, .sheet-a5 .classic-wrap { min-height: 100% !important; height: 100% !important; }
    ${pageRule}
  </style></head><body class="is-printing"><div id="print-root">${body}</div></body></html>`;
}

function paperSizeMm() {
  const template = selectedTemplateId();
  if (template === "SIMPLE" && document.getElementById("print-size-select")?.value === "A5") {
    return { widthMm: 148, heightMm: 210 };
  }
  if (typeof isThermalTemplate === "function" && isThermalTemplate(template)) {
    const width = thermalWidthMm();
    const sheet = document.querySelector("#printable-invoice-container .sheet-page");
    const height = sheet ? Math.max(80, Math.ceil(sheet.scrollHeight * 25.4 / 96) + 6) : 200;
    return { widthMm: width, heightMm: height };
  }
  return { widthMm: 210, heightMm: 297 };
}

function dismissPrintOverlays() {
  // System PrintManager dialog opens behind any fullscreen in-app preview.
  // Close it before calling native print so the dialog is visible immediately
  // (without needing hardware Back). Do not push history or leave overlays.
  const preview = document.getElementById("modal-print-preview");
  if (preview) preview.classList.remove("open");
  const voucher = document.getElementById("modal-receipt-voucher");
  if (voucher) voucher.classList.remove("open");
  document.body.classList.remove("invoice-modal-open");
  if (typeof closeInvoiceMore === "function") closeInvoiceMore();
}

async function printPreparedInvoice() {
  const inv = State.activeInvoiceForPrint;
  if (!inv) return;
  if (typeof beginPrintJob === "function" && !beginPrintJob()) return;
  const plugin = billPrintPlugin();
  if (plugin) {
    try {
      const html = await standalonePrintHtml();
      if (!html || html.length < 40 || !html.includes("<body")) {
        throw new Error("Bill HTML was empty");
      }
      const size = paperSizeMm();
      // Close preview/overlays FIRST so PrintManager is not hidden behind them.
      dismissPrintOverlays();
      // Yield a frame so the WebView paints without the overlay before print().
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
      await callBillPrintHtml(plugin, {
        html,
        jobName: inv.invoiceNo || inv.receiptNo || "Document",
        widthMm: size.widthMm,
        heightMm: size.heightMm
      });
      showToast("Opened the Android print dialog.");
      return; // never fall through to window.print when plugin succeeds
    } catch (err) {
      console.warn(err);
      showToast("Print dialog failed. Sharing a PDF instead.", "error");
      await sharePreparedPdf();
      return;
    } finally {
      /* keep guard until timeout so a second tap cannot re-enter */
    }
  }
  const root = document.getElementById("print-root") || Object.assign(document.createElement("div"), { id: "print-root" });
  if (!root.parentNode) document.body.appendChild(root);
  root.innerHTML = currentSheetsHtml();
  document.body.classList.add("is-printing");
    const tpl = document.getElementById("print-template-select")?.value || "";
    const thermal = /THERMAL/i.test(tpl);
    document.body.classList.toggle("is-thermal-print", thermal);
    if (thermal) {
      const w = document.getElementById("print-paper-select")?.value || (tpl.includes("80") ? "80" : "58");
      document.body.setAttribute("data-thermal-width", w);
    } else {
      document.body.removeAttribute("data-thermal-width");
    }
  // Always re-assert portrait / thermal @page; clear any leftover report landscape rule.
  if (typeof applyInvoicePrintPageStyle === "function") {
    const sizeSel = document.getElementById("print-size-select")?.value || "";
    let pageMode = "a4";
    if (thermal) {
      const w = document.body.getAttribute("data-thermal-width") || "80";
      pageMode = w === "58" ? "thermal58" : "thermal80";
    } else if (sizeSel === "A5" || /A5/i.test(tpl)) {
      pageMode = "a5";
    }
    applyInvoicePrintPageStyle(pageMode);
  } else if (typeof clearReportPrintStyle === "function") {
    clearReportPrintStyle();
  }
  setTimeout(() => {
    const cleanup = () => {
      document.body.classList.remove("is-printing"); document.body.classList.remove("is-thermal-print"); document.body.removeAttribute("data-thermal-width");
      root.innerHTML = "";
      if (typeof clearInvoicePrintPageStyle === "function") clearInvoicePrintPageStyle();
      window.removeEventListener("afterprint", cleanup);
      if (typeof endPrintJob === "function") endPrintJob();
      if (typeof restorePrintTitle === "function") restorePrintTitle();
    };
    window.addEventListener("afterprint", cleanup);
    if (typeof setPrintTitle === "function") setPrintTitle(inv.invoiceNo || inv.receiptNo || "Document");
    window.print();
    setTimeout(cleanup, 60_000);
  }, 200);
}

async function sheetsToPdfBlob() {
  if (typeof html2canvas !== "function" || !window.jspdf?.jsPDF) {
    throw new Error("PDF library did not load");
  }
  renderPrintableCanvas();
  const sheets = [...document.querySelectorAll("#printable-invoice-container .sheet-page")];
  if (!sheets.length) throw new Error("Nothing to print");
  const size = paperSizeMm();
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "mm", format: [size.widthMm, size.heightMm], orientation: size.widthMm > size.heightMm ? "l" : "p" });
  const host = document.createElement("div");
  host.id = "pdf-isolate";
  document.body.appendChild(host);
  document.body.classList.add("pdf-capturing");
  const clones = sheets.map(sheet => {
    const clone = sheet.cloneNode(true);
    clone.style.zoom = "1";
    clone.style.transform = "none";
    clone.style.background = "#ffffff";
    clone.querySelectorAll(".gold-frame, .gold-grow, .slip-box, .classic-page").forEach(el => {
      el.style.background = "#ffffff";
    });
    host.appendChild(clone);
    return clone;
  });
  try {
    for (let index = 0; index < clones.length; index++) {
      const canvas = await html2canvas(clones[index], { scale: 2, backgroundColor: "#ffffff", useCORS: true, logging: false });
      const heightMm = size.widthMm * (canvas.height / canvas.width);
      if (index) pdf.addPage([size.widthMm, Math.max(size.heightMm, heightMm)]);
      pdf.addImage(canvas.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, size.widthMm, heightMm);
    }
  } finally {
    host.remove();
    document.body.classList.remove("pdf-capturing");
  }
  return pdf.output("blob");
}

window.pdfFileName = function pdfFileName(inv) {
  const raw = (inv && typeof inv === "object")
    ? (inv.invoiceNo || inv.receiptNo || "document")
    : (inv || "document");
  const no = String(raw).replace(/[^\w.-]+/g, "_");
  return `${no}.pdf`;
}

async function downloadPreparedPdf() {
  const inv = State.activeInvoiceForPrint;
  if (!inv) return;
  const plugin = billPrintPlugin();
  if (plugin) {
    try {
      const html = await standalonePrintHtml();
      const size = paperSizeMm();
      const saved = await plugin.htmlToPdf({
        html,
        fileName: pdfFileName(inv),
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        download: true
      });
      showToast(saved?.displayPath ? `Saved ${saved.displayPath}` : "PDF saved.");
      return;
    } catch (err) {
      console.warn(err);
    }
  }
  const blob = await sheetsToPdfBlob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = pdfFileName(inv);
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  showToast("PDF download started.");
}

async function sharePreparedPdf() {
  const inv = State.activeInvoiceForPrint;
  if (!inv) return;
  const plugin = billPrintPlugin();
  if (plugin) {
    try {
      const html = await standalonePrintHtml();
      const size = paperSizeMm();
      const saved = await plugin.htmlToPdf({
        html,
        fileName: pdfFileName(inv),
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        download: false
      });
      const Share = window.Capacitor.registerPlugin("Share");
      const fileUrl = saved.uri && String(saved.uri).startsWith("file:") ? saved.uri : `file://${saved.path}`;
      await Share.share({
        title: inv.invoiceNo,
        text: typeof billShareText === "function" ? billShareText(inv) : inv.invoiceNo,
        files: [fileUrl],
        dialogTitle: "Share invoice PDF"
      });
      return;
    } catch (err) {
      console.warn(err);
      showToast("Could not open the share sheet.", "error");
      return;
    }
  }
  const blob = await sheetsToPdfBlob();
  const file = new File([blob], pdfFileName(inv), { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: inv.invoiceNo, text: inv.invoiceNo });
    return;
  }
  await downloadPreparedPdf();
  showToast("This browser saved the PDF instead of opening a share sheet.");
}

async function runPrintAction(kind) {
  const select = document.getElementById("print-template-select");
  if (!select || !State.activeInvoiceForPrint) return;
  if (kind === "a4" && typeof isThermalTemplate === "function" && isThermalTemplate(select.value)) {
    select.value = "GOLD";
  }
  if (kind === "thermal" && typeof isThermalTemplate === "function" && !isThermalTemplate(select.value)) {
    select.value = "THERMAL";
  }
  renderPrintableCanvas();
  try {
    if (kind === "share") await sharePreparedPdf();
    else if (kind === "download") await downloadPreparedPdf();
    else await printPreparedInvoice();
  } catch (err) {
    console.warn(err);
    showToast(err.message || "Could not prepare the invoice.", "error");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll('input[type="number"]').forEach(input => {
    if (!input.getAttribute("inputmode")) input.setAttribute("inputmode", "decimal");
  });
  document.getElementById("bottom-nav")?.addEventListener("click", event => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.id === "bottom-more") openDrawer();
    else if (button.dataset.view) {
      if (button.dataset.view === "parties") document.body.classList.remove("party-detail-open");
      switchView(button.dataset.view);
    }
  });
  document.getElementById("mobile-fab")?.addEventListener("click", mobilePrimaryAction);
  document.getElementById("appbar-back")?.addEventListener("click", () => {
    if (typeof isInvoiceMoreOpen === "function" && isInvoiceMoreOpen()) { closeInvoiceMore(); return; }
    const modal = topOpenModal();
    if (modal) {
      modal.classList.remove("open");
      if (modal.id === "modal-invoice") {
        document.body.classList.remove("invoice-modal-open");
        if (typeof setInvoiceModalOpen === "function") setInvoiceModalOpen(false);
      }
      return;
    }
    if (typeof isInvoiceDetailOpen === "function" && isInvoiceDetailOpen()) {
      closeInvoiceDetail();
      return;
    }
    if (document.body.classList.contains("party-detail-open")) {
      if (typeof closePartyDetail === "function") closePartyDetail();
      else document.body.classList.remove("party-detail-open");
      return;
    }
    if (document.getElementById("sidebar")?.classList.contains("open")) {
      closeDrawer();
      return;
    }
    if ((State.currentView || "dashboard") !== "dashboard") switchView("dashboard");
  });
  document.getElementById("party-tabs")?.addEventListener("click", event => {
    const tab = event.target.closest("[data-party-tab]");
    if (tab && typeof setPartyTab === "function") setPartyTab(tab.dataset.partyTab);
  });
  document.getElementById("party-more-actions")?.addEventListener("click", () => {
    if (typeof setPartyTab === "function") setPartyTab("details");
  });
  document.getElementById("daybook-flow")?.addEventListener("change", () => {
    if (typeof filterDaybookRows === "function") filterDaybookRows();
  });
  const createdId = () => (typeof createdInvoiceId === "function" ? createdInvoiceId() : "");
  document.getElementById("btn-created-done")?.addEventListener("click", () => closeInvoiceCreated());
  document.getElementById("btn-close-created")?.addEventListener("click", () => closeInvoiceCreated());
  document.getElementById("btn-created-edit")?.addEventListener("click", () => {
    const id = createdId();
    closeInvoiceCreated();
    if (id && typeof editInvoice === "function") editInvoice(id);
  });
  document.getElementById("btn-created-print")?.addEventListener("click", () => {
    const id = createdId();
    closeInvoiceCreated();
    if (id) openPrintModal(id);
  });
  document.getElementById("btn-created-download")?.addEventListener("click", async () => {
    const id = createdId();
    closeInvoiceCreated();
    if (!id) return;
    openPrintModal(id);
    if (typeof runPrintAction === "function") await runPrintAction("download");
  });
  document.getElementById("btn-created-share")?.addEventListener("click", () => {
    const id = createdId();
    if (id && typeof shareWhatsAppInvoice === "function") shareWhatsAppInvoice(id);
  });
  document.getElementById("btn-party-back")?.addEventListener("click", () => {
    if (typeof closePartyDetail === "function") closePartyDetail();
  });
  document.getElementById("appbar-search")?.addEventListener("click", () => {
    const bar = document.querySelector(".topbar");
    bar?.classList.toggle("search-open");
    if (bar?.classList.contains("search-open")) document.getElementById("global-search")?.focus();
  });
  bindOnce(document.getElementById("btn-print-a4"), "click", () => runPrintAction("a4"), "printWired");
  bindOnce(document.getElementById("btn-print-thermal"), "click", () => runPrintAction("thermal"), "printWired");
  bindOnce(document.getElementById("btn-share-pdf"), "click", () => runPrintAction("share"), "printWired");
  bindOnce(document.getElementById("btn-download-pdf"), "click", () => runPrintAction("download"), "printWired");
  ["print-copy-select", "print-size-select", "print-paper-select"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      renderPrintableCanvas();
      const inv = State.activeInvoiceForPrint;
      if (typeof rememberCurrentPrintPrefs === "function") {
        rememberCurrentPrintPrefs(inv?.docType || "DEFAULT");
      }
    });
  });
  document.getElementById("print-template-select")?.addEventListener("change", () => {
    const inv = State.activeInvoiceForPrint;
    if (typeof rememberCurrentPrintPrefs === "function") {
      rememberCurrentPrintPrefs(inv?.docType || "DEFAULT");
    }
  });
  document.getElementById("btn-logo-upload")?.addEventListener("click", () => document.getElementById("set-logo-file")?.click());
  document.getElementById("btn-sign-upload")?.addEventListener("click", () => document.getElementById("set-sign-file")?.click());
  document.getElementById("set-logo-file")?.addEventListener("change", event => {
    storeBrandImage(event.target.files?.[0], "logo");
    event.target.value = "";
  });
  document.getElementById("set-sign-file")?.addEventListener("change", event => {
    storeBrandImage(event.target.files?.[0], "signatureImage");
    event.target.value = "";
  });
  document.getElementById("btn-logo-remove")?.addEventListener("click", () => {
    State.business.logo = "";
    refreshBrandPreviews();
    saveToStorage();
    showToast("Logo removed.");
  });
  document.getElementById("btn-sign-remove")?.addEventListener("click", () => {
    State.business.signatureImage = "";
    refreshBrandPreviews();
    saveToStorage();
    showToast("Signature image removed.");
  });
  const viewport = document.querySelector(".view-viewport");
  if (viewport && window.MutationObserver) {
    let pending = 0;
    const observer = new MutationObserver(() => {
      cancelAnimationFrame(pending);
      pending = requestAnimationFrame(() => stampTableLabels(viewport));
    });
    observer.observe(viewport, { childList: true, subtree: true });
  }
  bootNativeChrome();
});

window.NativeShell = window.NativeShell || {};
window.NativeShell.pdfFileName = pdfFileName;
