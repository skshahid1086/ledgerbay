/**
 * Printable invoice layouts. Classic Gold is the shop default.
 * The boxed tax invoice and receipt are drawn from scratch.
 */

const INVOICE_THEMES = [
  { id: "GOLD", name: "Classic Gold", paper: "A4", blurb: "Default shop bill" },
  { id: "CLASSIC", name: "Classic Tax Invoice", paper: "A4", blurb: "Boxed tax invoice" },
  { id: "SIMPLE", name: "Classic Simple", paper: "A4 / A5", blurb: "Compact boxed bill" },
  { id: "A4_GST", name: "Classic Full Page", paper: "A4", blurb: "GST A4 sheet" },
  { id: "THERMAL", name: "Boxed receipt", paper: "58 / 80 mm", blurb: "Counter slip" },
  { id: "THERMAL_80", name: "Plain slip", paper: "80 mm", blurb: "Short cash memo" }
];

function isThermalTemplate(template) {
  return template === "THERMAL" || template === "THERMAL_58" || template === "THERMAL_80";
}


const PRINT_PREF_KEY = "billsetu_print_prefs_v1";

function loadPrintPrefs() {
  try { return JSON.parse(localStorage.getItem(PRINT_PREF_KEY) || "{}") || {}; }
  catch { return {}; }
}

function savePrintPref(docType, patch) {
  const all = loadPrintPrefs();
  const key = String(docType || "DEFAULT").toUpperCase();
  all[key] = Object.assign({}, all[key] || {}, patch || {}, { updatedAt: Date.now() });
  all.LAST = Object.assign({}, all.LAST || {}, patch || {}, { updatedAt: Date.now() });
  try { localStorage.setItem(PRINT_PREF_KEY, JSON.stringify(all)); } catch (_) {}
}

function printPrefFor(docType) {
  const all = loadPrintPrefs();
  const key = String(docType || "DEFAULT").toUpperCase();
  return Object.assign({}, all.LAST || {}, all[key] || {});
}

function applyPrintPrefsToUi(docType) {
  // Settings default wins. Session/local "last used" no longer overrides the shop default.
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.applyDefaultTemplateToPrintUi) {
    BillSetuDocNumbering.applyDefaultTemplateToPrintUi();
  } else {
    const pref = printPrefFor(docType);
    const tpl = document.getElementById("print-template-select");
    const size = document.getElementById("print-size-select");
    const paper = document.getElementById("print-paper-select");
    if (tpl && pref.template) tpl.value = pref.template;
    if (size && pref.paperSize) size.value = pref.paperSize;
    if (paper && pref.thermalWidth) paper.value = String(pref.thermalWidth);
  }
  const makeDef = document.getElementById("print-make-default");
  if (makeDef) makeDef.checked = false;
  if (typeof syncThemeChrome === "function") syncThemeChrome();
}

function rememberCurrentPrintPrefs(docType) {
  // Only persist as shop default when the user ticks "Make this my default template".
  const makeDef = document.getElementById("print-make-default");
  if (makeDef && makeDef.checked) {
    if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.setAsDefaultFromPrintModal) {
      BillSetuDocNumbering.setAsDefaultFromPrintModal();
    } else {
      const tpl = document.getElementById("print-template-select")?.value;
      const size = document.getElementById("print-size-select")?.value;
      const paper = document.getElementById("print-paper-select")?.value;
      savePrintPref(docType, {
        template: tpl || "GOLD",
        paperSize: size || "A4",
        thermalWidth: paper || "80"
      });
    }
    makeDef.checked = false;
  }
}

function selectedTemplateId() {
  const v = document.getElementById("print-template-select")?.value;
  if (v) return v;
  if (typeof BillSetuDocNumbering !== "undefined") {
    return BillSetuDocNumbering.ensurePrintDefaults().template || "GOLD";
  }
  return "GOLD";
}

function invoiceCopyLabel() {
  const value = document.getElementById("print-copy-select")?.value || "ORIGINAL";
  if (value === "DUPLICATE") return "DUPLICATE FOR TRANSPORTER";
  if (value === "TRIPLICATE") return "TRIPLICATE FOR SUPPLIER";
  return "ORIGINAL FOR RECIPIENT";
}

function businessInitials(name) {
  // 1.13.11 (BR1): no name → no initials (never an app-name fallback).
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "";
  const letters = (parts.length >= 2 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2));
  return letters.toUpperCase();
}

function logoMarkHtml(size, extraClass) {
  const b = themeBusinessBank();
  const cls = extraClass ? ` ${extraClass}` : "";
  const logo = typeof safeImageUrl === "function" ? safeImageUrl(b.logo) : "";
  if (logo) {
    return `<img class="biz-logo-img${cls}" src="${logo}" alt="" width="${size}" height="${size}">`;
  }
  const initials = businessInitials(b.name);
  if (!initials) return "";
  return `<span class="biz-logo-fallback${cls}">${escHtml(initials)}</span>`;
}


/* 1.13.10: customer documents carry no app branding footer. */

function amountWordsPlain(amount) {
  // Full Indian legal form — callers that previously appended "Rupees" should use amountInWords() instead.
  return convertNumberToWords(amount).replace(/\s+/g, " ").trim();
}
function amountInWords(amount) {
  return convertNumberToWords(amount).replace(/\s+/g, " ").trim();
}

function qtyPlain(qty) {
  const n = Number(qty) || 0;
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
}

function partyAddressOf(inv) {
  const party = (State.parties || []).find(p => p.id === inv.partyId);
  return inv.partyAddress || party?.address || "";
}

function shipAddressOf(inv) {
  return inv.shipAddress || partyAddressOf(inv);
}

function lineTax(item) {
  return lineTaxAmt(item);
}

function lineDiscountRupees(inv) {
  return (inv.items || []).reduce((sum, item) => {
    const raw = (Number(item.qty) || 0) * (Number(item.rate) || 0);
    return sum + raw * ((Number(item.discPercent) || 0) / 100);
  }, 0);
}

/** Bill-level ₹ discount only (not line %). Used for Tally "Less: Discount" row. */
function billLevelDiscountRupees(inv) {
  return (Number(inv.billDiscount) || 0) + (Number(inv.loyaltyDiscount) || 0);
}

/** Legacy: line % + bill ₹ (without loyalty). Prefer billLevelDiscountRupees for print. */
function billDiscountRupees(inv) {
  return lineDiscountRupees(inv) + (Number(inv.billDiscount) || 0);
}

/**
 * Pre–bill-discount taxable for a line (after line % disc).
 * Prefer item.preBillTaxableVal from BillSetuMoney; else recompute from qty×rate.
 */
function linePreBillTaxable(item) {
  if (item && item.preBillTaxableVal != null && item.preBillTaxableVal !== "") {
    return Number(item.preBillTaxableVal) || 0;
  }
  const qty = Number(item && item.qty) || 0;
  const rate = Number(item && item.rate) || 0;
  const discPct = Math.max(0, Number(item && item.discPercent) || 0);
  let afterLine = qty * rate * (100 - discPct) / 100;
  const gst = Number(item && item.gstRate) || 0;
  if ((item && (item.rateInclusive || item.inclusive)) && gst > 0) {
    afterLine = afterLine * 100 / (100 + gst);
  }
  return Math.round(afterLine * 100) / 100;
}

function lineTaxAmt(item) {
  return (Number(item.cgstVal ?? item.cgstAmt) || 0)
    + (Number(item.sgstVal ?? item.sgstAmt) || 0)
    + (Number(item.igstVal ?? item.igstAmt) || 0);
}


function themeBusinessBank() {
  const b = State.business || {};
  const bank = typeof invoiceBankDetails === "function" ? invoiceBankDetails() : null;
  if (!bank) return Object.assign({}, b, { bankAccountHolder: b.name || "" });
  return Object.assign({}, b, {
    bankName: bank.bankName || b.bankName || "",
    bankBranch: bank.bankBranch || b.bankBranch || "",
    bankAcc: bank.bankAcc || b.bankAcc || "",
    bankIfsc: bank.bankIfsc || b.bankIfsc || "",
    upiId: currentUpiVpa(b),
    bankAccountHolder: bank.accountHolder || b.name || ""
  });
}

function upiPayload(inv) {
  const b = themeBusinessBank();
  const amount = Number(inv.grandTotal || 0).toFixed(2);
  const query = [
    ["pa", currentUpiVpa()],
    ["pn", b.bankAccountHolder || b.name || ""],
    ["am", amount],
    ["cu", "INR"],
    ["tn", inv.invoiceNo || ""]
  ].map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join("&");
  return `upi://pay?${query}`;
}

function upiQrHtml(inv, px) {
  if (!currentUpiVpa() || typeof qrSvg !== "function") return "";
  return qrSvg(upiPayload(inv), px || 96);
}

function lineMetaHtml(item) {
  const bits = [];
  const serials = item.serials || [];
  if (serials.length) bits.push(`<div class="line-serial">Serial No: ${serials.map(code => escHtml(code)).join(", ")}</div>`);
  if (typeof customFieldsPrintHtml === "function") {
    const extra = customFieldsPrintHtml(item);
    if (extra) bits.push(extra);
  }
  if (item.batchExp) bits.push(`<div class="line-serial">Batch: ${escHtml(item.batchExp)}</div>`);
  return bits.join("");
}

function docHeading(inv) {
  if (inv.docType === "BILL_OF_SUPPLY") return "BILL OF SUPPLY";
  if (inv.docType === "ESTIMATE") return "ESTIMATE";
  if (inv.docType === "PROFORMA") return "PROFORMA INVOICE";
  if (inv.docType === "DELIVERY_CHALLAN") return "DELIVERY CHALLAN";
  if (inv.docType === "CREDIT_NOTE") return "CREDIT NOTE";
  return "TAX INVOICE";
}

function chunkWithFooter(items, bodyMax, lastMax) {
  const list = items || [];
  if (list.length <= lastMax) return [list];
  const chunks = [];
  let index = 0;
  while (list.length - index > lastMax) {
    const take = Math.min(bodyMax, list.length - index - 1);
    chunks.push(list.slice(index, index + take));
    index += take;
  }
  chunks.push(list.slice(index));
  return chunks;
}

function goldIcon(kind) {
  const open = `<svg class="gold-ico" viewBox="0 0 24 24" fill="none" stroke="#b8956a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">`;
  if (kind === "phone") return `${open}<path d="M6 3h3l2 5-2 1a12 12 0 0 0 6 6l1-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/></svg>`;
  if (kind === "mail") return `${open}<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 7 9-7"/></svg>`;
  return `${open}<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.2"/></svg>`;
}

function cornerFlourishes() {
  const svg = `<svg viewBox="0 0 72 72" aria-hidden="true"><path d="M8 46C8 22 20 8 46 8" fill="none" stroke="#c4a35a" stroke-width="1.4"/><path d="M8 32C8 16 16 8 32 8" fill="none" stroke="#c4a35a" stroke-width="1"/><path d="M16 14c3 5 2 10-1 14" fill="none" stroke="#c4a35a" stroke-width="0.9"/><circle cx="12" cy="12" r="2.1" fill="none" stroke="#c4a35a" stroke-width="1"/><path d="M22 9c2 3 1 6-2 8" fill="none" stroke="#c4a35a" stroke-width="0.8"/></svg>`;
  return ["tl", "tr", "bl", "br"].map(pos => `<span class="flourish ${pos}">${svg}</span>`).join("");
}

function gstSummaryRows(inv) {
  const rates = [...new Set((inv.items || []).map(item => Number(item.gstRate) || 0))];
  const half = !inv.isInterstate && rates.length === 1 ? rates[0] / 2 : null;
  const full = inv.isInterstate && rates.length === 1 ? rates[0] : null;
  if (inv.isInterstate) {
    return `<div class="gold-sum-row"><span>IGST${full != null ? ` @${full}%` : ""}</span><span>₹ ${formatAmount(inv.igstTotal)}</span></div>`;
  }
  return `<div class="gold-sum-row"><span>CGST${half != null ? ` @${half}%` : ""}</span><span>₹ ${formatAmount(inv.cgstTotal)}</span></div>
    <div class="gold-sum-row"><span>SGST${half != null ? ` @${half}%` : ""}</span><span>₹ ${formatAmount(inv.sgstTotal)}</span></div>`;
}

function renderInvoiceTemplate(inv, template) {
  const id = template || selectedTemplateId();
  if (id === "GOLD") return generateGoldInvoice(inv);
  if (id === "CLASSIC") return generateClassicInvoice(inv, { compact: false });
  if (id === "SIMPLE") return generateClassicInvoice(inv, { compact: true });
  if (id === "THERMAL" || id === "THERMAL_58") return generateClassicThermal(inv);
  if (id === "THERMAL_80") return generateThermalSlip(inv);
  return generateStandardA4Invoice(inv);
}

function generateGoldInvoice(inv) {
  const chunks = chunkWithFooter(inv.items || [], 12, 5);
  return chunks.map((items, pageIndex) => goldPage(inv, items, pageIndex, chunks.length)).join("");
}

function goldPage(inv, items, pageIndex, pageCount) {
  const b = themeBusinessBank(); // 1.13.11: bank block follows the show-on-invoice account
  const last = pageIndex === pageCount - 1;
  const address = partyAddressOf(inv);
  const ship = shipAddressOf(inv);
  const qtyTotal = (inv.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const taxTotal = (Number(inv.cgstTotal) || 0) + (Number(inv.sgstTotal) || 0) + (Number(inv.igstTotal) || 0);
  const lineTotal = (inv.items || []).reduce((sum, item) => sum + linePreBillTaxable(item), 0);
  const discount = billLevelDiscountRupees(inv);
  const signName = b.signatureName || b.name;
  const rows = items.map((item, idx) => {
    const serialIndex = (inv.items || []).indexOf(item);
    const tax = lineTax(item);
    return `<tr>
      <td class="c-no">${serialIndex + 1}</td>
      <td><div class="item-name">${escHtml(item.description || "")}</div>${lineMetaHtml(item)}</td>
      <td>${escHtml(item.hsn || "")}</td>
      <td>${qtyPlain(item.qty)} ${escHtml(item.unit || "PCS")}</td>
      <td class="num">${formatAmount(item.rate)}</td>
      <td class="num">${formatAmount(tax)}<div class="tax-rate">(${escHtml(String(item.gstRate || 0))}%)</div></td>
      <td class="num">${formatAmount(linePreBillTaxable(item))}</td>
    </tr>`;
  }).join("");

  const header = pageIndex === 0 ? `
    <header class="gold-head">
      ${logoMarkHtml(64) ? `<div class="gold-logo">${logoMarkHtml(64)}</div>` : ""}
      <div class="gold-id">
        ${String(b.name || "").trim() ? `<h1>${escHtml(b.name)}</h1>` : ""}
        ${b.gstin ? `<div class="gold-gstin"><strong>GSTIN</strong> ${escHtml(b.gstin)}</div>` : ""}
        <div class="gold-contact">
          ${b.phone ? `<span>${goldIcon("phone")} ${escHtml(b.phone)}</span>` : ""}
          ${b.email ? `<span>${goldIcon("mail")} ${escHtml(b.email)}</span>` : ""}
        </div>
        <div class="gold-contact">${goldIcon("pin")} <span>${escHtml(b.address || "")}</span></div>
      </div>
      <div class="gold-doc">
        <div class="gold-doc-title">${escHtml(docHeading(inv))}</div>
        <div class="gold-copy">${escHtml(invoiceCopyLabel())}</div>
      </div>
    </header>
    <div class="gold-rule"></div>
    <div class="gold-meta">
      <div><div class="k">Invoice No.</div><div class="v">${escHtml(inv.invoiceNo || "")}</div></div>
      <div><div class="k">Invoice Date</div><div class="v">${escHtml(formatInvoiceDate(inv.date))}</div></div>
      ${inv.ewayBill ? `<div><div class="k">E-Way Bill</div><div class="v">${escHtml(inv.ewayBill)}</div></div>` : ""}
      ${inv.vehicleNo ? `<div><div class="k">Vehicle</div><div class="v">${escHtml(inv.vehicleNo)}</div></div>` : ""}
      ${inv.transporterName ? `<div><div class="k">Transporter</div><div class="v">${escHtml(inv.transporterName)}</div></div>` : ""}
    </div>
    <div class="gold-parties">
      <div>
        <div class="k">Bill To</div>
        <div class="party">${escHtml(inv.partyName || "")}</div>
        <div>${escHtml(address)}</div>
        <div><span class="k">Mobile</span> ${escHtml(inv.partyPhone || "")}</div>
        <div><span class="k">Place of Supply</span> ${escHtml(inv.posStateName || "")}</div>
      </div>
      <div>
        <div class="k">Ship To</div>
        <div class="party">${escHtml(inv.shipName || inv.partyName || "")}</div>
        <div>${escHtml(ship)}</div>
        <div><span class="k">Mobile</span> ${escHtml(inv.partyPhone || "")}</div>
        <div><span class="k">Place of Supply</span> ${escHtml(inv.posStateName || "")}</div>
      </div>
    </div>` : `
    <header class="gold-continued">
      ${String(b.name || "").trim() ? `<strong>${escHtml(b.name)}</strong>` : ""}
      <span>${escHtml(inv.invoiceNo || "")} · ${escHtml(formatInvoiceDate(inv.date))}</span>
      <span>Continued</span>
    </header>`;

  const foot = last ? `
    <div class="gold-lower">
      <div>
        <h3>Terms &amp; Conditions</h3>
        <ol class="gold-terms">${termsListHtml(b.terms)}</ol>
        <h3>Bank Details</h3>
        <table class="gold-bank">
          <tr><th>Name</th><td>${escHtml(b.bankAccountHolder || b.name || "")}</td></tr>
          <tr><th>IFSC</th><td>${escHtml(b.bankIfsc || "")}</td></tr>
          <tr><th>Account No</th><td>${escHtml(b.bankAcc || "")}</td></tr>
          <tr><th>Bank Name</th><td>${escHtml([b.bankName, b.bankBranch].filter(Boolean).join(", "))}</td></tr>
        </table>
        ${currentUpiVpa() ? `<div class="gold-qr">
          <div class="qr-title">Payment QR Code</div>
          ${upiQrHtml(inv, 92)}
          <div class="pay-marks"><span>PhonePe</span><span>GPay</span><span>Paytm</span><span>UPI</span></div>
          <div class="upi-id">UPI ID: ${escHtml(currentUpiVpa())}</div>
        </div>` : ""}
      </div>
      <div>
        <div class="gold-sum">
          <div class="gold-sum-row"><span>Subtotal</span><span>₹ ${formatAmount(lineTotal)}</span></div>
          ${discount ? `<div class="gold-sum-row"><span>Less: Discount</span><span>- ₹ ${formatAmount(discount)}</span></div>` : ""}
          <div class="gold-sum-row"><span>Taxable Amount</span><span>₹ ${formatAmount(inv.taxableTotal)}</span></div>
          ${gstSummaryRows(inv)}
          ${Math.abs(Number(inv.roundOff) || 0) >= 0.01 ? `<div class="gold-sum-row"><span>Round Off</span><span>${Number(inv.roundOff) < 0 ? "- " : ""}₹ ${formatAmount(Math.abs(inv.roundOff))}</span></div>` : ""}
          <div class="gold-sum-row grand"><span>Total Amount</span><span>₹ ${formatAmount(inv.grandTotal)}</span></div>
          <div class="gold-sum-row"><span>Received Amount</span><span>₹ ${formatAmount(inv.amountReceived)}</span></div>
          <div class="gold-sum-row"><span>Balance</span><span>₹ ${formatAmount(inv.balanceDue)}</span></div>
        </div>
        <div class="gold-words">
          <div class="k">Total Amount (in words)</div>
          <div>${escHtml(amountInWords(inv.grandTotal))}</div>
        </div>
        ${taxTotal > 0.0001 ? `<div class="gold-words">
          <div class="k">Tax Amount (in words)</div>
          <div>${escHtml(amountInWords(taxTotal))}</div>
        </div>` : ""}
        <div class="gold-sign">
          ${(typeof safeImageUrl === "function" ? safeImageUrl(b.signatureImage) : "") ? `<img class="sign-img" src="${safeImageUrl(b.signatureImage)}" alt="">` : `<div class="sign-gap"></div>`}
          <div class="sign-label">Signature</div>
          <div class="sign-name">${escHtml(signName)}</div>
        </div>
      </div>
    </div>` : `<div class="carry-foot">Continued on next page</div>`;

  return `<article class="sheet-page sheet-a4 gold-page" style="background:#ffffff" data-width-mm="210" data-height-mm="297">
    ${cornerFlourishes()}
    <div class="gold-frame">
      ${header}
      <div class="gold-items">
        <table class="gold-table">
          <thead>
            <tr>
              ${pageIndex > 0 ? `<th class="carry" colspan="7">Continued</th></tr><tr>` : ""}
              <th class="c-no">No</th><th>Items</th><th>HSN No.</th><th>Qty.</th><th class="num">Rate</th><th class="num">Tax</th><th class="num">Total</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
        ${last ? "" : ""}
        <div class="gold-grow" style="background:#ffffff"></div>
        ${last ? `<table class="gold-table gold-sub">
          <tr>
            <td class="c-no"></td>
            <td>SUBTOTAL</td>
            <td></td>
            <td>${qtyPlain(qtyTotal)}</td>
            <td></td>
            <td class="num">₹ ${formatAmount(taxTotal)}</td>
            <td class="num">₹ ${formatAmount(lineTotal)}</td>
          </tr>
        </table>` : ""}
      </div>
      ${foot}
    </div>
  </article>`;
}

function termsListHtml(terms) {
  const lines = String(terms || "").split(/\n+/).map(line => line.replace(/^\s*\d+[\.\)]\s*/, "").trim()).filter(Boolean);
  if (!lines.length) return "<li>Goods sold as per this invoice.</li>";
  return lines.map(line => `<li>${escHtml(line)}</li>`).join("");
}

function metaPairs(inv) {
  const ref = [inv.referenceNo, inv.referenceDate ? formatInvoiceDate(inv.referenceDate) : ""].filter(Boolean).join("  ");
  return [
    ["Invoice No.", inv.invoiceNo || "", "Dated", formatInvoiceDate(inv.date)],
    ["Delivery Note", inv.deliveryNote || "", "Mode/Terms of Payment", inv.paymentTerms || inv.paymentMode || ""],
    ["Reference No. & Date", ref, "Other References", inv.otherReferences || ""],
    ["Buyer's Order No.", inv.buyerOrderNo || "", "Dated", inv.buyerOrderDate ? formatInvoiceDate(inv.buyerOrderDate) : ""],
    ["Dispatch Doc No.", inv.dispatchDocNo || "", "Delivery Note Date", inv.deliveryNoteDate ? formatInvoiceDate(inv.deliveryNoteDate) : ""],
    ["Dispatched through", inv.dispatchedThrough || "", "Destination", inv.destination || ""],
    ["E-Way Bill", inv.ewayBill || "", "Vehicle", inv.vehicleNo || ""],
    ["Transporter", inv.transporterName || "", "Terms of Delivery", inv.termsOfDelivery || ""]
  ];
}

function generateClassicInvoice(inv, options) {
  const compact = !!(options && options.compact);
  const a5 = compact && (document.getElementById("print-size-select")?.value === "A5");
  const lastMax = compact ? (a5 ? 4 : 7) : 5;
  const bodyMax = compact ? (a5 ? 10 : 14) : 12;
  const chunks = chunkWithFooter(inv.items || [], bodyMax, lastMax);
  return chunks.map((items, pageIndex) => classicPage(inv, items, pageIndex, chunks.length, compact, a5)).join("");
}

function classicPage(inv, items, pageIndex, pageCount, compact, a5) {
  const b = State.business;
  const last = pageIndex === pageCount - 1;
  const paper = a5 ? "sheet-a5" : "sheet-a4";
  const width = a5 ? "148" : "210";
  const height = a5 ? "210" : "297";
  const keepBlank = b.classicBlankCells !== false;
  let pairs = metaPairs(inv);
  if (compact) {
    const transport = pairs.filter((row, index) => index > 1 && (row[1] || row[3]) && /e-way|vehicle|transporter/i.test(`${row[0]} ${row[2]}`));
    pairs = [pairs[0], pairs[1], ...transport];
  }
  else if (!keepBlank) {
    pairs = pairs.filter((row, index) => index === 0 || row[1] || row[3]);
  }
  const metaHtml = pairs.map(row => `
    <tr>
      <td class="lbl">${escHtml(row[0])}</td><td>${escHtml(row[1])}</td>
      <td class="lbl">${escHtml(row[2])}</td><td>${escHtml(row[3])}</td>
    </tr>`).join("");
  const stateLine = `State Name : ${escHtml(b.stateName || "")}, Code : ${escHtml(b.stateCode || "")}`;
  const buyerState = `State Name : ${escHtml(inv.posStateName || "")}, Code : ${escHtml(inv.posStateCode || "")}`;
  const startIndex = (inv.items || []).indexOf(items[0]);
  const body = items.map((item, idx) => `
    <tr>
      <td class="c">${startIndex + idx + 1}</td>
      <td><div>${escHtml(item.description || "")}</div>${lineMetaHtml(item)}</td>
      <td class="c">${escHtml(item.hsn || "")}</td>
      <td class="c">${qtyPlain(item.qty)}</td>
      <td class="num">${formatAmount(item.rate)}</td>
      <td class="c">${escHtml(item.unit || "")}</td>
      <td class="c">${Number(item.discPercent) ? escHtml(String(item.discPercent)) : ""}</td>
      <td class="num">${formatAmount(linePreBillTaxable(item))}</td>
    </tr>`).join("");
  const taxRows = last ? classicTaxRows(inv) : `<tr><td colspan="8" class="carry-foot">Continued on next page</td></tr>`;
  const hsn = last ? classicHsnTable(inv) : "";
  const closing = last ? classicClosing(inv) : "";
  const seller = pageIndex === 0 ? `
    <tr class="title-row">
      <td colspan="2">
        <div class="classic-title">${escHtml(docHeading(inv))}</div>
        <div class="classic-copy">${escHtml(invoiceCopyLabel())}</div>
      </td>
    </tr>
    <tr>
      <td class="seller">
        <div class="seller-top">${logoMarkHtml(46)}<div>${String(b.name || "").trim() ? `<strong class="seller-name">${escHtml(b.name)}</strong>` : ""}</div></div>
        <div>${escHtml(b.address || "")}</div>
        <div>GSTIN/UIN: ${escHtml(b.gstin || "")}</div>
        <div>${stateLine}</div>
        ${b.phone ? `<div>Contact: ${escHtml(b.phone)}</div>` : ""}
        ${b.email ? `<div>E-Mail: ${escHtml(b.email)}</div>` : ""}
      </td>
      <td class="meta-cell"><table class="meta-table">${metaHtml}</table></td>
    </tr>
    <tr>
      <td>
        <div class="lbl">Consignee (Ship to)</div>
        <strong>${escHtml(inv.shipName || inv.partyName || "")}</strong>
        <div>${escHtml(shipAddressOf(inv))}</div>
        ${inv.partyGstin ? `<div>GSTIN/UIN: ${escHtml(inv.partyGstin)}</div>` : "<div>GSTIN/UIN:</div>"}
        <div>${buyerState}</div>
      </td>
      <td>
        <div class="lbl">Buyer (Bill to)</div>
        <strong>${escHtml(inv.partyName || "")}</strong>
        <div>${escHtml(partyAddressOf(inv))}</div>
        ${inv.partyGstin ? `<div>GSTIN/UIN: ${escHtml(inv.partyGstin)}</div>` : "<div>GSTIN/UIN:</div>"}
        <div>${buyerState}</div>
        ${inv.partyPhone ? `<div>Contact: ${escHtml(inv.partyPhone)}</div>` : ""}
      </td>
    </tr>` : `
    <tr><td colspan="2" class="carry-top">
      ${String(b.name || "").trim() ? `<strong>${escHtml(b.name)}</strong> · ` : ""}${escHtml(inv.invoiceNo || "")} · Continued
    </td></tr>`;

  return `<article class="sheet-page ${paper} classic-page${compact ? " compact" : ""}${a5 ? " a5" : ""}" style="background:#ffffff" data-width-mm="${width}" data-height-mm="${height}">
    <table class="classic-wrap">
      <tbody>
        ${seller}
        <tr class="items-row"><td colspan="2" class="items-cell">
          <div class="classic-body">
            <table class="classic-items">
              <thead>
                <tr>
                  <th>Sl No.</th>
                  <th>Description of Goods</th>
                  <th>HSN/SAC</th>
                  <th>Quantity</th>
                  <th>Rate</th>
                  <th>per</th>
                  <th>Disc. %</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                ${body}
                <tr class="classic-fill" aria-hidden="true"><td></td><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
                ${taxRows}
              </tbody>
            </table>
            ${last ? `<div class="classic-foot">
              <div class="words-row"><div><span class="lbl">Amount Chargeable (in words)</span><div class="words">${escHtml(amountInWords(inv.grandTotal))}</div></div><div class="eoe">E. &amp; O.E</div></div>
              ${hsn}${closing}
            </div>` : ``}
          </div>
        </td></tr>
      </tbody>
    </table>
  </article>`;
}

function classicTaxRows(inv) {
  const rows = [];
  const push = (label, amount) => {
    rows.push(`<tr class="tax-line"><td></td><td>${escHtml(label)}</td><td></td><td></td><td></td><td></td><td></td><td class="num">${formatAmount(amount)}</td></tr>`);
  };
  /* Tally style: lines at pre-discount → Less: Discount → taxes → round → total */
  const discount = billLevelDiscountRupees(inv);
  if (discount) push("Less: Discount", -discount);
  if (inv.isInterstate) push("IGST", inv.igstTotal);
  else {
    push("CGST", inv.cgstTotal);
    push("SGST", inv.sgstTotal);
  }
  if (Math.abs(Number(inv.roundOff) || 0) >= 0.005) push("Round Off", inv.roundOff);
  const qtyTotal = (inv.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const units = [...new Set((inv.items || []).map(item => item.unit || "").filter(Boolean))];
  const qtyLabel = `${qtyPlain(qtyTotal)}${units.length === 1 ? " " + units[0] : ""}`;
  rows.push(`<tr class="total-line"><td></td><td>Total</td><td></td><td class="c">${escHtml(qtyLabel)}</td><td></td><td></td><td></td><td class="num">${formatAmount(inv.grandTotal)}</td></tr>`);
  return rows.join("");
}

function hsnGroups(inv) {
  const map = new Map();
  (inv.items || []).forEach(item => {
    const key = `${item.hsn || ""}|${item.gstRate || 0}`;
    if (!map.has(key)) {
      map.set(key, { hsn: item.hsn || "", rate: Number(item.gstRate) || 0, taxable: 0, cgst: 0, sgst: 0, igst: 0 });
    }
    const row = map.get(key);
    row.taxable += Number(item.taxableVal) || 0;
    row.cgst += Number(item.cgstVal ?? item.cgstAmt) || 0;
    row.sgst += Number(item.sgstVal ?? item.sgstAmt) || 0;
    row.igst += Number(item.igstVal ?? item.igstAmt) || 0;
  });
  return [...map.values()];
}

function classicHsnTable(inv) {
  const groups = hsnGroups(inv);
  const taxTotal = groups.reduce((sum, row) => sum + row.cgst + row.sgst + row.igst, 0);
  if (inv.isInterstate) {
    const body = groups.map(row => `<tr>
      <td>${escHtml(row.hsn)}</td>
      <td class="num">${formatAmount(row.taxable)}</td>
      <td class="c">${row.rate}%</td>
      <td class="num">${formatAmount(row.igst)}</td>
      <td class="num">${formatAmount(row.igst)}</td>
    </tr>`).join("");
    return `<table class="hsn-table">
      <thead>
        <tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable Value</th><th colspan="2">Integrated Tax</th><th rowspan="2">Total Tax Amount</th></tr>
        <tr><th>Rate</th><th>Amount</th></tr>
      </thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${formatAmount(inv.taxableTotal)}</td><td></td><td class="num">${formatAmount(taxTotal)}</td><td class="num">${formatAmount(taxTotal)}</td></tr></tfoot>
    </table>
    <div class="tax-words"><span class="lbl">Tax Amount (in words)</span> ${escHtml(amountInWords(taxTotal))}</div>`;
  }
  const body = groups.map(row => `<tr>
    <td>${escHtml(row.hsn)}</td>
    <td class="num">${formatAmount(row.taxable)}</td>
    <td class="c">${row.rate / 2}%</td>
    <td class="num">${formatAmount(row.cgst)}</td>
    <td class="c">${row.rate / 2}%</td>
    <td class="num">${formatAmount(row.sgst)}</td>
    <td class="num">${formatAmount(row.cgst + row.sgst)}</td>
  </tr>`).join("");
  return `<table class="hsn-table">
    <thead>
      <tr><th rowspan="2">HSN/SAC</th><th rowspan="2">Taxable Value</th><th colspan="2">Central Tax</th><th colspan="2">State Tax</th><th rowspan="2">Total Tax Amount</th></tr>
      <tr><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th></tr>
    </thead>
    <tbody>${body}</tbody>
    <tfoot><tr><td>Total</td><td class="num">${formatAmount(inv.taxableTotal)}</td><td></td><td class="num">${formatAmount(inv.cgstTotal)}</td><td></td><td class="num">${formatAmount(inv.sgstTotal)}</td><td class="num">${formatAmount(taxTotal)}</td></tr></tfoot>
  </table>
  <div class="tax-words"><span class="lbl">Tax Amount (in words)</span> ${escHtml(amountInWords(taxTotal))}</div>`;
}

function classicClosing(inv) {
  const b = themeBusinessBank(); // 1.13.11: bank block follows the show-on-invoice account
  const city = (b.jurisdiction || "").toUpperCase();
  const declaration = b.declaration || "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";
  const signName = b.signatureName || b.name;
  return `<div class="classic-close">
      <div>
        <div>Company's PAN: <strong>${escHtml(b.pan || "")}</strong></div>
        <div class="decl-box">
          <div class="lbl">Declaration</div>
          <div>${escHtml(declaration)}</div>
        </div>
        <table class="mini-bank">
          <tr><td>A/c Holder</td><td>${escHtml(b.name || "")}</td></tr>
          <tr><td>Bank Name</td><td>${escHtml(b.bankName || "")}</td></tr>
          <tr><td>A/c No.</td><td>${escHtml(b.bankAcc || "")}</td></tr>
          <tr><td>Branch &amp; IFS Code</td><td>${escHtml([b.bankBranch, b.bankIfsc].filter(Boolean).join(" · "))}</td></tr>
        </table>
        ${currentUpiVpa() ? `<div class="classic-upi">${upiQrHtml(inv, 72)}<div>UPI: ${escHtml(currentUpiVpa())}</div></div>` : ""}
      </div>
      <div class="for-box">
        ${String(b.name || "").trim() ? `<div>for ${escHtml(b.name)}</div>` : ""}
        ${(typeof safeImageUrl === "function" ? safeImageUrl(b.signatureImage) : "") ? `<img class="sign-img" src="${safeImageUrl(b.signatureImage)}" alt="">` : `<div class="sign-gap"></div>`}
        <div class="auth">Authorised Signatory</div>
        <div class="sign-name">${escHtml(signName)}</div>
      </div>
    </div>
    ${city ? `<div class="jurisdiction">SUBJECT TO ${escHtml(city)} JURISDICTION</div>` : ""}
    <div class="computer">This is a Computer Generated Invoice</div>`;
}

function thermalWidthMm() {
  const template = selectedTemplateId();
  if (template === "THERMAL_58") return 58;
  if (template === "THERMAL_80") return 80;
  return document.getElementById("print-paper-select")?.value === "58" ? 58 : 80;
}

function generateClassicThermal(inv) {
  const b = State.business;
  const width = thermalWidthMm();
  const items = (inv.items || []).map((item, idx) => `
    <div class="slip-item">
      <div><strong>${idx + 1}. ${escHtml(item.description || "")}</strong></div>
      ${lineMetaHtml(item)}
      <div class="slip-item-meta">HSN ${escHtml(item.hsn || "-")} · ${qtyPlain(item.qty)} ${escHtml(item.unit || "")} × ${formatAmount(item.rate)}</div>
      <div class="slip-amt">${formatAmount(linePreBillTaxable(item))}</div>
    </div>`).join("");
  const tax = inv.isInterstate
    ? `<div class="slip-row"><span>IGST</span><span>${formatAmount(inv.igstTotal)}</span></div>`
    : `<div class="slip-row"><span>CGST</span><span>${formatAmount(inv.cgstTotal)}</span></div>
       <div class="slip-row"><span>SGST</span><span>${formatAmount(inv.sgstTotal)}</span></div>`;
  const discount = billLevelDiscountRupees(inv);
  const taxAmt = (Number(inv.cgstTotal) || 0) + (Number(inv.sgstTotal) || 0) + (Number(inv.igstTotal) || 0);
  return `<article class="sheet-page sheet-slip classic-slip w${width}" style="background:#ffffff" data-width-mm="${width}" data-height-mm="200">
    <div class="slip-box" style="background:#ffffff">
      ${b.logo ? `<div class="slip-logo-wrap">${logoMarkHtml(36, "mono")}</div>` : ""}
      ${String(b.name || "").trim() ? `<div class="slip-name">${escHtml(b.name)}</div>` : ""}
      ${b.address ? `<div>${escHtml(b.address)}</div>` : ""}
      ${b.gstin ? `<div>GSTIN ${escHtml(b.gstin)}</div>` : ""}
      <div>${escHtml(b.stateName || "")} · ${escHtml(b.stateCode || "")}</div>
      <div class="slip-rule"></div>
      <div class="slip-doc">${escHtml(docHeading(inv))}</div>
      <div>${escHtml(invoiceCopyLabel())}</div>
      <div class="slip-row"><span>${escHtml(inv.invoiceNo || "")}</span><span>${escHtml(formatInvoiceDate(inv.date))}</span></div>
      <div class="slip-rule"></div>
      <div><strong>${escHtml(inv.partyName || "")}</strong></div>
      <div>${escHtml(partyAddressOf(inv))}</div>
      ${inv.partyPhone ? `<div>Ph ${escHtml(inv.partyPhone)}</div>` : ""}
      <div class="slip-rule"></div>
      ${items}
      <div class="slip-rule"></div>
      ${discount ? `<div class="slip-row"><span>Less: Discount</span><span>-${formatAmount(discount)}</span></div>` : ""}
      <div class="slip-row"><span>Taxable</span><span>${formatAmount(inv.taxableTotal)}</span></div>
      ${tax}
      <div class="slip-row total"><span>TOTAL</span><span>${formatAmount(inv.grandTotal)}</span></div>
      <div class="slip-words">${escHtml(amountInWords(inv.grandTotal))}</div>
      ${taxAmt > 0.0001 ? `<div class="slip-words">Tax: ${escHtml(amountInWords(taxAmt))}</div>` : ""}
      ${currentUpiVpa() ? `<div class="slip-qr">${upiQrHtml(inv, 78)}<div>UPI ${escHtml(currentUpiVpa())}</div></div>` : ""}
      <div class="slip-thanks">This is a Computer Generated Invoice</div>
    </div>
  </article>`;
}

function renderThemePicker() {
  const host = document.getElementById("theme-picker");
  if (!host || host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  const swatch = { GOLD: "#C4A35A", CLASSIC: "#1C2E4A", SIMPLE: "#0F766E", A4_GST: "#334155", THERMAL: "#0F172A", THERMAL_80: "#44403C" };
  host.innerHTML = INVOICE_THEMES.map(theme => `
    <button type="button" class="theme-card" data-template="${theme.id}">
      <span class="theme-swatch" style="background:${swatch[theme.id] || "#0F766E"}" aria-hidden="true"></span>
      <span class="thumb thumb-${theme.id.toLowerCase()}" aria-hidden="true"></span>
      <span class="theme-name">${theme.name}</span>
      <span class="theme-paper">${theme.paper}</span>
    </button>`).join("");
  host.querySelectorAll(".theme-card").forEach(button => {
    button.addEventListener("click", () => {
      const select = document.getElementById("print-template-select");
      if (select) select.value = button.dataset.template;
      syncThemeChrome();
      const inv = State.activeInvoiceForPrint;
      rememberCurrentPrintPrefs(inv?.docType || inv?.type || "DEFAULT");
      renderPrintableCanvas();
    });
  });
}

function syncThemeChrome() {
  const template = selectedTemplateId();
  document.querySelectorAll(".theme-card").forEach(button => {
    button.classList.toggle("active", button.dataset.template === template);
  });
  document.getElementById("print-size-wrap")?.classList.toggle("d-none", template !== "SIMPLE");
  const thermal = isThermalTemplate(template);
  document.getElementById("print-paper-wrap")?.classList.toggle("d-none", template !== "THERMAL" && template !== "THERMAL_80");
  document.getElementById("printable-invoice-container")?.classList.toggle("is-thermal", thermal);
}

window.loadPrintPrefs = loadPrintPrefs;
window.savePrintPref = savePrintPref;
window.printPrefFor = printPrefFor;
window.applyPrintPrefsToUi = applyPrintPrefsToUi;
window.rememberCurrentPrintPrefs = rememberCurrentPrintPrefs;
