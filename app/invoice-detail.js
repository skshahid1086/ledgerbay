/**
 * Ledgerbay — invoice / bill detail panel (myBillBook-style).
 * Desktop: right drawer. Phone: fullscreen. Android back closes it.
 */
(function () {
  "use strict";

  let activeDetailId = null;
  let activeDetailKind = "invoice"; // invoice | purchase | po | debit

  function el(id) {
    return document.getElementById(id);
  }

  function money(n) {
    return typeof formatINR === "function" ? formatINR(n) : ("₹ " + Number(n || 0).toFixed(2));
  }

  function shortDate(iso) {
    return typeof formatShortDate === "function" ? formatShortDate(iso) : String(iso || "").slice(0, 10);
  }

  function escapeHtml(s) {
    return typeof escHtml === "function" ? escHtml(s) : String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  window.invoiceStatusInfo = function invoiceStatusInfo(inv) {
    if (!inv) return { label: "—", className: "badge-unpaid" };
    if (inv.cancelled || inv.status === "CANCELLED") {
      return { label: "Cancelled", className: "badge-cancelled" };
    }
    const due = Number(inv.balanceDue) || 0;
    const total = Number(inv.grandTotal) || 0;
    const today = typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10);
    if (due <= 0.009) return { label: "Paid", className: "badge-paid" };
    if (inv.dueDate && String(inv.dueDate) < today && due > 0.009) {
      return { label: "Overdue", className: "badge-overdue" };
    }
    if (due + 0.009 >= total) return { label: "Unpaid", className: "badge-unpaid" };
    return { label: "Partial", className: "badge-partial" };
  };

  function docTypeLabel(docType) {
    const map = {
      TAX_INVOICE: "Tax Invoice",
      BILL_OF_SUPPLY: "Bill of Supply",
      ESTIMATE: "Quotation",
      PROFORMA: "Proforma",
      CREDIT_NOTE: "Credit Note",
      DELIVERY_CHALLAN: "Delivery Challan"
    };
    return map[docType] || docType || "Bill";
  }

  function findInvoice(id) {
    return (State.invoices || []).find(i => i.id === id);
  }

  function paymentHistoryFor(inv) {
    const rows = [];
    if (!inv) return rows;
    const collected = typeof invoiceCollectedOnBill === "function" ? invoiceCollectedOnBill(inv) : (Number(inv.collectedOnBill != null ? inv.collectedOnBill : inv.amountReceived) || 0);
    if (collected > 0.009) {
      rows.push({
        date: inv.date,
        mode: inv.paymentMode || "Cash",
        amount: collected,
        note: "Collected on bill"
      });
    }
    (State.payments || []).forEach(pay => {
      if (pay.partyId !== inv.partyId) return;
      if (pay.direction === "LOYALTY") return;
      if (pay.invoiceId && pay.invoiceId !== inv.id) return;
      if (!pay.invoiceId && pay.direction !== "IN") return;
      // Show IN receipts for the party as related history when applied > 0 and dates overlap loosely
      if (pay.invoiceId === inv.id || (pay.direction === "IN" && Number(pay.applied) > 0 && pay.partyId === inv.partyId)) {
        if (pay.invoiceId && pay.invoiceId !== inv.id) return;
        rows.push({
          date: pay.date,
          mode: pay.mode || "Cash",
          amount: Number(pay.amount) || 0,
          note: pay.receiptNo || "Receipt"
        });
      }
    });
    // De-dupe by receipt note+date+amount
    const seen = new Set();
    return rows.filter(r => {
      const key = `${r.date}|${r.note}|${r.amount}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function taxBreakupHtml(inv) {
    if (!inv) return "";
    if (inv.isInterstate) {
      return `<div class="invd-tax-row"><span>IGST</span><strong>${money(inv.igstTotal)}</strong></div>`;
    }
    return `
      <div class="invd-tax-row"><span>CGST</span><strong>${money(inv.cgstTotal)}</strong></div>
      <div class="invd-tax-row"><span>SGST</span><strong>${money(inv.sgstTotal)}</strong></div>`;
  }

  const ICO = {
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
    share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
    more: '<circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
    pdf: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    pay: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    duplicate: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    convert: '<polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
    credit: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>',
    cancel: '<circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
    back: '<polyline points="15 18 9 12 15 6"/>'
  };

  function icon(name, cls) {
    const body = ICO[name] || ICO.more;
    return `<svg class="invd-ico${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  /** Public helper so row menus can reuse the same glyphs. */
  window.billsetuIcon = icon;

  function itemsHtml(inv) {
    const items = inv?.items || [];
    if (!items.length) return `<p class="text-muted">No line items.</p>`;
    const deskRows = items.map((line, i) => {
      const tax = Number(line.igstVal || 0) + Number(line.cgstVal || 0) + Number(line.sgstVal || 0);
      const serials = (line.serials || []).length ? `<div class="invd-serials">${escapeHtml(line.serials.join(", "))}</div>` : "";
      return `<tr>
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(line.description || "")}</strong>
          <div class="invd-item-meta">HSN ${escapeHtml(line.hsn || "—")} · GST ${Number(line.gstRate) || 0}%</div>${serials}</td>
        <td class="num">${Number(line.qty) || 0} ${escapeHtml(line.unit || "")}</td>
        <td class="num">${money(line.rate)}</td>
        <td class="num">${money(tax)}</td>
        <td class="num"><strong>${money(line.total)}</strong></td>
      </tr>`;
    }).join("");
    const phoneCards = items.map((line, i) => {
      const tax = Number(line.igstVal || 0) + Number(line.cgstVal || 0) + Number(line.sgstVal || 0);
      const qty = Number(line.qty) || 0;
      const unit = escapeHtml(line.unit || "");
      const serials = (line.serials || []).length ? `<div class="invd-serials">${escapeHtml(line.serials.join(", "))}</div>` : "";
      return `<article class="invd-item-card">
        <div class="invd-item-card-top">
          <strong class="invd-item-name">${escapeHtml(line.description || "")}</strong>
          <strong class="invd-item-amt">${money(line.total)}</strong>
        </div>
        <div class="invd-item-card-sub">
          <span>${qty} ${unit} × ${money(line.rate)}</span>
          <span>Tax ${money(tax)} · GST ${Number(line.gstRate) || 0}%</span>
        </div>
        ${serials}
      </article>`;
    }).join("");
    return `
      <table class="invd-items invd-items-desk">
        <thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Tax</th><th class="num">Amount</th></tr></thead>
        <tbody>${deskRows}</tbody>
      </table>
      <div class="invd-items-phone">${phoneCards}</div>`;
  }

  function paymentsHtml(inv) {
    const rows = paymentHistoryFor(inv);
    if (!rows.length) return `<p class="text-muted invd-empty">No payments recorded yet.</p>`;
    return `<ul class="invd-pay-list">${rows.map(r => `
      <li>
        <div><strong>${escapeHtml(r.note)}</strong><div class="invd-party-meta">${shortDate(r.date)} · ${escapeHtml(r.mode)}</div></div>
        <strong>${money(r.amount)}</strong>
      </li>`).join("")}</ul>`;
  }

  function previewHtml(inv) {
    const status = invoiceStatusInfo(inv);
    return `
      <button type="button" class="invd-preview-card" data-act="preview" title="Open full bill preview">
        <div class="invd-preview-top">
          <strong>${escapeHtml(State.business?.name || "")}</strong>
          <span class="badge ${status.className}">${status.label}</span>
        </div>
        <div class="invd-preview-no">${escapeHtml(inv.invoiceNo)}</div>
        <div class="invd-preview-party">${escapeHtml(inv.partyName || "Cash")}</div>
        <div class="invd-preview-amt">${money(inv.grandTotal)}</div>
        <div class="invd-preview-hint">Tap for full bill preview</div>
      </button>`;
  }

  function canConvert(inv) {
    return inv && (inv.docType === "ESTIMATE" || inv.docType === "PROFORMA") && !inv.cancelled;
  }

  function templateSelectHtml(inv) {
    const templates = (typeof INVOICE_THEMES !== "undefined" ? INVOICE_THEMES : [
      { id: "GOLD", name: "Classic Gold" },
      { id: "CLASSIC", name: "Classic" },
      { id: "THERMAL", name: "Thermal" }
    ]);
    const tplOpts = templates.map(t =>
      `<option value="${escapeHtml(t.id)}" ${(inv.printTemplate || "GOLD") === t.id ? "selected" : ""}>${escapeHtml(t.name)}</option>`
    ).join("");
    return `<div class="invd-template">
      <label for="invd-template-select">Print template</label>
      <select id="invd-template-select" class="form-control">${tplOpts}</select>
    </div>`;
  }

  function stickyBarHtml(inv) {
    const cancelled = !!(inv.cancelled || inv.status === "CANCELLED");
    return `<div class="invd-sticky-bar" id="invd-sticky-bar">
      <button type="button" class="invd-bar-btn invd-bar-primary" data-act="edit" ${cancelled ? "disabled" : ""}>${icon("edit")}<span>Edit</span></button>
      <button type="button" class="invd-bar-btn" data-act="print">${icon("print")}<span>Print</span></button>
      ${canConvert(inv) ? `<button type="button" class="invd-bar-btn invd-bar-primary act-convert-gst" data-act="convert">${icon("convert")}<span>Convert to GST Bill</span></button>` : ""}
      <button type="button" class="invd-bar-btn" data-act="share">${icon("share")}<span>Share</span></button>
      <button type="button" class="invd-bar-btn" data-act="more" id="invd-more-btn">${icon("more")}<span>More</span></button>
    </div>`;
  }

  function moreSheetHtml(inv) {
    const cancelled = !!(inv.cancelled || inv.status === "CANCELLED");
    const convert = canConvert(inv)
      ? `<button type="button" class="invd-sheet-item" data-act="convert">${icon("convert")}<span>Convert to GST bill</span></button>`
      : "";
    const credit = (!cancelled && inv.docType !== "CREDIT_NOTE" && inv.docType !== "ESTIMATE" && inv.docType !== "PROFORMA")
      ? `<button type="button" class="invd-sheet-item" data-act="credit">${icon("credit")}<span>Credit Note / Return</span></button>`
      : "";
    const recordPay = (!cancelled && typeof isPostedSale === "function" && isPostedSale(inv) && Number(inv.balanceDue) > 0.009)
      ? `<button type="button" class="invd-sheet-item invd-sheet-primary" data-act="pay">${icon("pay")}<span>Record Payment</span></button>`
      : "";
    return `
      <div class="invd-more-backdrop" id="invd-more-backdrop" hidden></div>
      <div class="invd-more-sheet" id="invd-more-sheet" hidden role="dialog" aria-label="More actions">
        <div class="invd-more-handle" aria-hidden="true"></div>
        <div class="invd-more-title">More actions</div>
        <div class="invd-more-list" id="invd-more-list">
          <button type="button" class="invd-sheet-item" data-act="pdf">${icon("pdf")}<span>Download PDF</span></button>
          ${recordPay}
          <button type="button" class="invd-sheet-item" data-act="duplicate">${icon("duplicate")}<span>Duplicate</span></button>
          ${convert}
          ${credit}
          <button type="button" class="invd-sheet-item" data-act="cancel" ${cancelled ? "disabled" : ""}>${icon("cancel")}<span>Cancel bill</span></button>
          <button type="button" class="invd-sheet-item invd-sheet-danger" data-act="delete">${icon("trash")}<span>Delete</span></button>
        </div>
        ${templateSelectHtml(inv)}
        <button type="button" class="btn btn-outline btn-block" id="invd-more-close">Close</button>
      </div>`;
  }

  function actionsHtml(inv) {
    // Sticky bar + more sheet; no duplicate body grid.
    return stickyBarHtml(inv) + moreSheetHtml(inv);
  }

  function renderInvoiceBody(inv) {
    const status = invoiceStatusInfo(inv);
    const received = Number(inv.amountReceived || inv.paidAmount) || 0;
    return `
      <div class="invd-header">
        <button type="button" class="invd-back" id="invd-back" aria-label="Back">${icon("back")}</button>
        <div class="invd-header-main">
          <div class="invd-title-row">
            <h2>${escapeHtml(inv.invoiceNo)}</h2>
            <span class="badge ${status.className}">${status.label}</span>
            ${inv.edited ? `<span class="badge badge-edited">Edited</span>` : ""}
          </div>
          <div class="invd-sub">${escapeHtml(docTypeLabel(inv.docType))} · ${shortDate(inv.date)}${inv.dueDate ? " · Due " + shortDate(inv.dueDate) : ""}</div>
        </div>
        <button type="button" class="btn-icon invd-close" id="invd-close" aria-label="Close">${icon("close")}</button>
      </div>
      <div class="invd-scroll">
        <section class="invd-party">
          <strong>${escapeHtml(inv.partyName || "Cash")}</strong>
          <div class="invd-party-meta">${escapeHtml(inv.partyPhone || "")}${inv.partyGstin ? " · GSTIN " + escapeHtml(inv.partyGstin) : ""}</div>
        </section>
        <section class="invd-amounts">
          <div><span>Total</span><strong>${money(inv.grandTotal)}</strong></div>
          <div><span>Received</span><strong>${money(received)}</strong></div>
          <div class="${Number(inv.balanceDue) > 0.009 ? "due" : ""}"><span>Balance due</span><strong>${money(inv.balanceDue)}</strong></div>
        </section>
        <section class="invd-block">
          <h3>Items</h3>
          ${itemsHtml(inv)}
          <div class="invd-tax">
            <div class="invd-tax-row"><span>Taxable</span><strong>${money(inv.taxableTotal)}</strong></div>
            ${taxBreakupHtml(inv)}
            ${Number(inv.billDiscount) > 0 ? `<div class="invd-tax-row"><span>Bill discount</span><strong>- ${money(inv.billDiscount)}</strong></div>` : ""}
            ${Number(inv.loyaltyDiscount) > 0 ? `<div class="invd-tax-row"><span>Loyalty</span><strong>- ${money(inv.loyaltyDiscount)}</strong></div>` : ""}
            <div class="invd-tax-row invd-tax-total"><span>Grand total</span><strong>${money(inv.grandTotal)}</strong></div>
          </div>
        </section>
        <section class="invd-block">
          <h3>Payment history</h3>
          ${paymentsHtml(inv)}
        </section>
        <section class="invd-block">
          <h3>Bill preview</h3>
          ${previewHtml(inv)}
        </section>
      </div>
      ${actionsHtml(inv)}`;
  }

  function renderPurchaseBody(pur) {
    const paid = Number(pur.paidAmount) || 0;
    const total = Number(pur.totalBill) || 0;
    const due = Math.max(0, total - paid);
    const status = pur.status || (due <= 0.009 ? "PAID" : "UNPAID");
    const badge = status === "PAID" ? "badge-paid" : "badge-unpaid";
    const deskItems = (pur.items || []).map((line, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><strong>${escapeHtml(line.description || line.name || "")}</strong></td>
        <td class="num">${Number(line.qty) || 0}</td>
        <td class="num">${money(line.rate)}</td>
        <td class="num"><strong>${money(line.total || (Number(line.qty) * Number(line.rate)))}</strong></td>
      </tr>`).join("");
    const phoneCards = (pur.items || []).map((line) => {
      const amt = money(line.total || (Number(line.qty) * Number(line.rate)));
      return `<article class="invd-item-card">
        <div class="invd-item-card-top">
          <strong class="invd-item-name">${escapeHtml(line.description || line.name || "")}</strong>
          <strong class="invd-item-amt">${amt}</strong>
        </div>
        <div class="invd-item-card-sub">
          <span>${Number(line.qty) || 0} × ${money(line.rate)}</span>
        </div>
      </article>`;
    }).join("");
    return `
      <div class="invd-header">
        <button type="button" class="invd-back" id="invd-back" aria-label="Back">${icon("back")}</button>
        <div class="invd-header-main">
          <div class="invd-title-row">
            <h2>${escapeHtml(pur.billNo)}</h2>
            <span class="badge ${badge}">${escapeHtml(status)}</span>
          </div>
          <div class="invd-sub">Purchase · ${shortDate(pur.date)}</div>
        </div>
        <button type="button" class="btn-icon invd-close" id="invd-close" aria-label="Close">${icon("close")}</button>
      </div>
      <div class="invd-scroll">
        <section class="invd-party">
          <strong>${escapeHtml(pur.supplierName || "")}</strong>
          <div class="invd-party-meta">${pur.supplierGstin ? "GSTIN " + escapeHtml(pur.supplierGstin) : ""}</div>
        </section>
        <section class="invd-amounts">
          <div><span>Total</span><strong>${money(total)}</strong></div>
          <div><span>Paid</span><strong>${money(paid)}</strong></div>
          <div class="${due > 0.009 ? "due" : ""}"><span>Balance</span><strong>${money(due)}</strong></div>
        </section>
        <section class="invd-block">
          <h3>Items</h3>
          <table class="invd-items invd-items-desk">
            <thead><tr><th>#</th><th>Item</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th></tr></thead>
            <tbody>${deskItems || `<tr><td colspan="5" class="text-muted">No line items stored.</td></tr>`}</tbody>
          </table>
          <div class="invd-items-phone">${phoneCards || `<p class="text-muted">No line items stored.</p>`}</div>
          <div class="invd-tax">
            <div class="invd-tax-row"><span>Taxable</span><strong>${money(pur.taxableAmount)}</strong></div>
            <div class="invd-tax-row"><span>GST</span><strong>${money(pur.gstAmount)}</strong></div>
            <div class="invd-tax-row invd-tax-total"><span>Total</span><strong>${money(total)}</strong></div>
          </div>
        </section>
      </div>
      <div class="invd-sticky-bar" id="invd-sticky-bar">
        <button type="button" class="invd-bar-btn invd-bar-primary" data-act="pay-purchase">${icon("pay")}<span>Payment</span></button>
        <button type="button" class="invd-bar-btn invd-bar-danger" data-act="delete-purchase">${icon("trash")}<span>Delete</span></button>
      </div>`;
  }

  function openMoreSheet() {
    const sheet = el("invd-more-sheet");
    const backdrop = el("invd-more-backdrop");
    if (!sheet) return;
    sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => {
      sheet.classList.add("open");
      backdrop?.classList.add("open");
    });
  }

  function closeMoreSheet() {
    const sheet = el("invd-more-sheet");
    const backdrop = el("invd-more-backdrop");
    sheet?.classList.remove("open");
    backdrop?.classList.remove("open");
    setTimeout(() => {
      if (sheet) sheet.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }, 180);
  }

  function isMoreSheetOpen() {
    return !!el("invd-more-sheet")?.classList.contains("open");
  }

  function openFullBillPreview(inv) {
    if (!inv) return;
    closeMoreSheet();
    // Apply this bill's template to the print picker so the rendered bill matches.
    const sel = el("print-template-select");
    if (sel && inv.printTemplate) sel.value = inv.printTemplate;
    // On APK: skip the fullscreen print-preview modal so PrintManager is not
    // hidden behind it (dialog used to appear only after hardware Back).
    if (typeof isNativeApp === "function" && isNativeApp()
        && typeof billPrintPlugin === "function" && billPrintPlugin()) {
      State.activeInvoiceForPrint = inv;
      if (typeof renderPrintableCanvas === "function") renderPrintableCanvas();
      if (typeof printPreparedInvoice === "function") {
        printPreparedInvoice();
        return;
      }
    }
    if (typeof openPrintModal === "function") openPrintModal(inv.id);
  }

  function bindPanelChrome() {
    el("invd-back")?.addEventListener("click", () => {
      if (isMoreSheetOpen()) closeMoreSheet();
      else closeInvoiceDetail();
    });
    el("invd-close")?.addEventListener("click", () => {
      if (isMoreSheetOpen()) closeMoreSheet();
      else closeInvoiceDetail();
    });
    el("invd-sticky-bar")?.addEventListener("click", onActionClick);
    el("invd-more-list")?.addEventListener("click", onActionClick);
    el("invd-more-close")?.addEventListener("click", closeMoreSheet);
    el("invd-more-backdrop")?.addEventListener("click", closeMoreSheet);
    el("invoice-detail-panel")?.querySelector('[data-act="preview"]')?.addEventListener("click", onActionClick);
    el("invd-template-select")?.addEventListener("change", e => {
      const inv = findInvoice(activeDetailId);
      if (!inv) return;
      inv.printTemplate = e.target.value;
      const sel = el("print-template-select");
      if (sel) sel.value = e.target.value;
      if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(inv);
      if (typeof saveToStorage === "function") saveToStorage();
      showToast("Template saved for this bill.");
    });
  }

  function onActionClick(event) {
    const btn = event.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === "more") {
      openMoreSheet();
      return;
    }

    if (activeDetailKind === "purchase") {
      const pur = (State.purchases || []).find(p => p.id === activeDetailId);
      if (!pur) return;
      if (act === "pay-purchase") {
        const party = State.parties.find(p => p.id === pur.supplierId);
        if (party) {
          State.selectedPartyId = party.id;
          closeInvoiceDetail();
          if (typeof selectParty === "function") selectParty(party.id);
          document.getElementById("pay-party-name").value = `${party.name} (Due: ${formatINR(party.balance)})`;
          document.getElementById("pay-date").value = todayISO();
          document.getElementById("pay-amount").value = party.balance > 0 ? party.balance : "";
          document.getElementById("modal-payment").classList.add("open");
        } else showToast("Supplier not found for this bill.", "error");
      } else if (act === "delete-purchase") {
        deletePurchase(pur.id);
      }
      return;
    }

    const inv = findInvoice(activeDetailId);
    if (!inv) return;

    if (act === "preview") {
      openFullBillPreview(inv);
      return;
    }

    // Close more sheet before actions that navigate away
    if (isMoreSheetOpen() && act !== "print" && act !== "pdf" && act !== "share") closeMoreSheet();

    if (act === "edit") {
      closeInvoiceDetail();
      editInvoice(inv.id);
    } else if (act === "print") {
      openFullBillPreview(inv);
    } else if (act === "pdf") {
      openFullBillPreview(inv);
      setTimeout(() => { if (typeof runPrintAction === "function") runPrintAction("download"); }, 200);
    } else if (act === "share") {
      if (typeof shareWhatsAppInvoice === "function") shareWhatsAppInvoice(inv.id);
    } else if (act === "pay") {
      closeMoreSheet();
      recordPaymentForInvoice(inv.id);
    } else if (act === "duplicate") {
      closeInvoiceDetail();
      duplicateInvoice(inv.id);
    } else if (act === "convert") {
      if (typeof convertEstimateToTaxInvoice === "function") {
        convertEstimateToTaxInvoice(inv.id);
        openInvoiceDetail(inv.id);
      }
    } else if (act === "credit") {
      closeInvoiceDetail();
      startCreditNoteFromInvoice(inv.id);
    } else if (act === "cancel") {
      closeMoreSheet();
      cancelInvoice(inv.id);
    } else if (act === "delete") {
      closeMoreSheet();
      deleteInvoice(inv.id);
    }
  }

  window.openInvoiceDetail = function openInvoiceDetail(invoiceId) {
    const inv = findInvoice(invoiceId);
    if (!inv) {
      showToast("Invoice not found.", "error");
      return;
    }
    activeDetailId = invoiceId;
    activeDetailKind = "invoice";
    const root = el("invoice-detail-root");
    const panel = el("invoice-detail-panel");
    if (!root || !panel) return;
    panel.innerHTML = renderInvoiceBody(inv);
    root.classList.add("open");
    document.body.classList.add("invoice-detail-open");
    bindPanelChrome();
  };

  window.openPurchaseDetail = function openPurchaseDetail(purchaseId) {
    const pur = (State.purchases || []).find(p => p.id === purchaseId);
    if (!pur) {
      showToast("Purchase not found.", "error");
      return;
    }
    activeDetailId = purchaseId;
    activeDetailKind = "purchase";
    const root = el("invoice-detail-root");
    const panel = el("invoice-detail-panel");
    if (!root || !panel) return;
    panel.innerHTML = renderPurchaseBody(pur);
    root.classList.add("open");
    document.body.classList.add("invoice-detail-open");
    bindPanelChrome();
  };

  window.closeInvoiceDetail = function closeInvoiceDetail() {
    closeMoreSheet();
    const root = el("invoice-detail-root");
    root?.classList.remove("open");
    document.body.classList.remove("invoice-detail-open");
    activeDetailId = null;
  };

  window.isInvoiceMoreOpen = isMoreSheetOpen;
  window.closeInvoiceMore = closeMoreSheet;

  window.isInvoiceDetailOpen = function isInvoiceDetailOpen() {
    return !!el("invoice-detail-root")?.classList.contains("open");
  };

  window.openInvoiceDetailFromRow = function openInvoiceDetailFromRow(event) {
    if (!event) return;
    const t = event.target;
    if (t.closest?.(".row-actions, .row-menu, button, a, summary, details, input, select, label")) return;
    const tr = event.currentTarget;
    const id = tr?.dataset?.invoiceId;
    if (id) openInvoiceDetail(id);
  };

  window.openPurchaseDetailFromRow = function openPurchaseDetailFromRow(event) {
    if (!event) return;
    if (event.target.closest?.(".row-actions, .row-menu, button, a, summary, details")) return;
    const id = event.currentTarget?.dataset?.purchaseId;
    if (id) openPurchaseDetail(id);
  };

  /** Reverse stock / party / loyalty effects of an existing posted invoice. */
  window.reverseInvoiceEffects = function reverseInvoiceEffects(inv, opts) {
    if (!inv || inv.cancelled) return;
    const party = State.parties.find(p => p.id === inv.partyId);
    const docType = inv.docType;
    const nonPosting = docType === "ESTIMATE" || docType === "PROFORMA";
    if (nonPosting) return;

    if (docType === "CREDIT_NOTE") {
      if (party) {
        // Reverse credit: undo the reduction of receivable / increase of payable
        if (party.balType === "PAYABLE") {
          party.balance = Math.max(0, (Number(party.balance) || 0) - (Number(inv.grandTotal) || 0));
        } else {
          party.balance = (Number(party.balance) || 0) + (Number(inv.grandTotal) || 0);
          party.balType = "RECEIVABLE";
        }
        const reverse = typeof pointsEarnedFor === "function"
          ? pointsEarnedFor(inv.grandTotal)
          : Math.floor((Number(inv.grandTotal) || 0) / 100);
        party.loyaltyPoints = (Number(party.loyaltyPoints) || 0) + reverse;
      }
      (inv.items || []).forEach(line => adjustStockLine(line, "out"));
      return;
    }

    if (party && docType !== "DELIVERY_CHALLAN") {
      const due = Number(inv.balanceDue) || 0;
      // 1.13.7 (C1): cancel / delete removes the whole bill; paid parts become advances.
      // Edit (no opts) still reverses only the due, since its receipts stay on the re-saved bill.
      if (opts && opts.release && typeof releaseBillMoney === "function") releaseBillMoney(inv, "invoice", party, opts.release);
      else if (due > 0.009 && typeof partyAddReceivable === "function") partyAddReceivable(party, -due);
      else if (due > 0.009 && (party.balType || "RECEIVABLE") === "RECEIVABLE") {
        party.balance = Math.max(0, Math.round(((Number(party.balance) || 0) - due) * 100) / 100);
      }
      // Reverse loyalty settle
      const redeemed = Number(inv.loyaltyPointsRedeemed) || 0;
      const earned = Number(inv.loyaltyPointsEarned) || 0;
      party.loyaltyPoints = Math.max(0, (Number(party.loyaltyPoints) || 0) + redeemed - earned);
      State.loyaltyLedger = (State.loyaltyLedger || []).filter(e => e.invoiceId !== inv.id);
    }
    (inv.items || []).forEach(line => adjustStockLine(line, "in"));
  };

  /** Apply stock / party / loyalty for a (new or edited) invoice object. */
  window.applyInvoiceEffects = function applyInvoiceEffects(inv) {
    if (!inv || inv.cancelled) return;
    const party = State.parties.find(p => p.id === inv.partyId);
    const docType = inv.docType;
    const nonPosting = docType === "ESTIMATE" || docType === "PROFORMA";
    const grandTotal = Number(inv.grandTotal) || 0;
    const balanceDue = Number(inv.balanceDue) || 0;
    const items = inv.items || [];

    if (docType === "CREDIT_NOTE") {
      if (party) {
        if (party.balType === "PAYABLE") party.balance = (Number(party.balance) || 0) + grandTotal;
        else {
          party.balance = (Number(party.balance) || 0) - grandTotal;
          if (party.balance < -0.001) {
            party.balance = typeof roundMoney === "function" ? roundMoney(-party.balance) : Math.round(-party.balance * 100) / 100;
            party.balType = "PAYABLE";
          } else party.balance = Math.max(0, typeof roundMoney === "function" ? roundMoney(party.balance) : Math.round(party.balance * 100) / 100);
        }
        const reverse = typeof pointsEarnedFor === "function" ? pointsEarnedFor(grandTotal) : Math.floor(grandTotal / 100);
        party.loyaltyPoints = Math.max(0, (Number(party.loyaltyPoints) || 0) - reverse);
      }
      items.forEach(line => adjustStockLine(line, "in"));
      return;
    }
    if (nonPosting) return;

    if (party && balanceDue > 0 && docType !== "DELIVERY_CHALLAN") {
      if (typeof partyAddReceivable === "function") partyAddReceivable(party, balanceDue);
      else { party.balance = (Number(party.balance) || 0) + balanceDue; party.balType = "RECEIVABLE"; }
    }
    items.forEach(line => adjustStockLine(line, "out"));
    if (party && docType !== "DELIVERY_CHALLAN") {
      if (typeof settleLoyaltyOnInvoice === "function") settleLoyaltyOnInvoice(party, inv);
      else party.loyaltyPoints = (party.loyaltyPoints || 0) + Math.floor(grandTotal / 100);
    }
  };

  window.editInvoice = async function editInvoice(invoiceId) {
    if (typeof blockedAction === "function" && blockedAction("sales")) return;
    if (typeof isInvoiceFormOpen === "function" && isInvoiceFormOpen() && typeof isInvoiceDraftDirty === "function" && isInvoiceDraftDirty()) {
      const discard = typeof askDiscardDraft === "function" ? await askDiscardDraft() : confirm("Discard draft?");
      if (!discard) return;
    }
    const inv = findInvoice(invoiceId);
    if (!inv) {
      showToast("Invoice not found.", "error");
      return;
    }
    if (inv.cancelled || inv.status === "CANCELLED") {
      showToast("Cancelled bills cannot be edited. Duplicate it instead.", "error");
      return;
    }
    // Never leave detail stacked under/over the edit modal (nav + back both break).
    if (typeof closeInvoiceDetail === "function" && isInvoiceDetailOpen()) closeInvoiceDetail();
    State.editingInvoiceId = inv.id;
    // 1.13.17: a credit note must re-mirror its linked invoice (or its own saved lines if unlinked).
    // 1.13.18 (BUG-8): any other saved sales doc re-mirrors its own posted split until party/POS change.
    if (inv.docType === "CREDIT_NOTE" && typeof creditNoteMirrorFrom === "function") {
      State.invoiceMirrorSplit = creditNoteMirrorFrom(inv);
    } else if (typeof gstSplitFromSavedDoc === "function") {
      const split = gstSplitFromSavedDoc(inv);
      State.invoiceMirrorSplit = split
        ? { ...split, invoiceId: inv.id, invoiceNo: inv.invoiceNo, partyId: inv.partyId || "" }
        : null;
    } else {
      State.invoiceMirrorSplit = null;
    }
    const modal = el("modal-invoice");
    el("invoice-modal-title").textContent = `Edit ${docTypeLabel(inv.docType)} ${inv.invoiceNo}`;

    el("inv-doc-type").value = inv.docType || "TAX_INVOICE";
    el("inv-number").value = inv.invoiceNo || "";
    el("inv-date").value = inv.date || todayISO();
    el("inv-due-date").value = inv.dueDate || inv.date || todayISO();

    const setVal = (id, v) => { const f = el(id); if (f) f.value = v == null ? "" : v; };
    setVal("inv-eway-bill", inv.ewayBill || "");
    setVal("inv-vehicle-no", inv.vehicleNo || "");
    setVal("inv-transporter-name", inv.transporterName || "");
    setVal("inv-transporter-id", inv.transporterId || "");
    setVal("inv-irn", inv.irn || "");
    setVal("inv-ack-no", inv.ackNo || "");
    setVal("inv-ack-date", inv.ackDate || "");
    setVal("inv-delivery-note", inv.deliveryNote || "");
    setVal("inv-payment-terms", inv.paymentTerms || "");
    setVal("inv-reference-no", inv.referenceNo || "");
    setVal("inv-reference-date", inv.referenceDate || "");
    setVal("inv-other-ref", inv.otherReferences || "");
    setVal("inv-buyer-order", inv.buyerOrderNo || "");
    setVal("inv-buyer-order-date", inv.buyerOrderDate || "");
    setVal("inv-dispatch-doc", inv.dispatchDocNo || "");
    setVal("inv-delivery-note-date", inv.deliveryNoteDate || "");
    setVal("inv-dispatched-through", inv.dispatchedThrough || "");
    setVal("inv-destination", inv.destination || "");
    setVal("inv-terms-delivery", inv.termsOfDelivery || "");
    setVal("inv-bill-discount", inv.billDiscount || 0);
    setVal("inv-notes", inv.notes || "");
    setVal("inv-amount-received", inv.amountReceived || 0);
    setVal("inv-loyalty-points", inv.loyaltyPointsRedeemed || 0);

    const partySelect = el("inv-party-select");
    partySelect.innerHTML = State.parties.map(p => `
      <option value="${escapeHtml(p.id)}">${escapeHtml(p.name)} (${p.type === "CUSTOMER" ? "Customer" : "Supplier"})${typeof partyStateLabel === "function" && partyStateLabel(p) ? " - " + escapeHtml(partyStateLabel(p)) : ""}</option>
    `).join("");
    if (inv.partyId) partySelect.value = inv.partyId;
    // Keep the place of supply saved on the bill (falls back to the party / business state).
    const savedPos = inv.posStateCode
      || (typeof defaultPlaceOfSupply === "function" ? defaultPlaceOfSupply(State.parties.find(p => p.id === inv.partyId)) : "");
    if (typeof refreshPosStateOptions === "function") refreshPosStateOptions(savedPos);

    const mode = inv.paymentMode || "CASH";
    const radio = document.querySelector(`input[name="inv-pay-mode"][value="${mode}"]`)
      || document.querySelector('input[name="inv-pay-mode"][value="CASH"]');
    if (radio) radio.checked = true;
    setVal("inv-upi-ref", inv.upiRef || "");
    setVal("inv-card-ref", inv.cardRef || "");
    setVal("inv-bank-ref", inv.bankRef || "");
    setVal("inv-cheque-no", inv.chequeNo || "");
    setVal("inv-cheque-date", inv.chequeDate || "");
    setVal("inv-cheque-bank", inv.chequeBank || "");
    if (typeof syncInvoicePayModeFields === "function") syncInvoicePayModeFields();
    if (typeof fillAccountSelect === "function") {
      fillAccountSelect(el("inv-account-id"), { mode, selectedId: inv.accountId || "" });
    }
    if (typeof updateReceivedInVisibility === "function") updateReceivedInVisibility();

    if (inv.godownId && el("inv-godown")) el("inv-godown").value = inv.godownId;

    State.invoiceDraftItems = (inv.items || []).map(line => ({ ...line, serials: [...(line.serials || [])] }));
    if (!State.invoiceDraftItems.length) State.invoiceDraftItems = [blankInvoiceLine()];
    State.invoiceAmountReceivedTouched = true;

    if (typeof prepareInvoiceExtras === "function") prepareInvoiceExtras();
    if (typeof refreshCatalogDatalist === "function") refreshCatalogDatalist();
    renderInvoiceLineItems();
    updateInvoicePartyMeta({ keepPos: true });
    recalculateInvoice();
    if (typeof setInvoiceModalOpen === "function") setInvoiceModalOpen(true);
    else modal.classList.add("open");
  };

  window.duplicateInvoice = function duplicateInvoice(invoiceId) {
    if (typeof blockedAction === "function" && blockedAction("sales")) return;
    const inv = findInvoice(invoiceId);
    if (!inv) return;
    State.editingInvoiceId = null;
    openNewInvoiceModal();
    el("invoice-modal-title").textContent = `Duplicate of ${inv.invoiceNo}`;
    el("inv-doc-type").value = inv.docType || "TAX_INVOICE";
    if (typeof syncInvoiceNumberPrefix === "function") syncInvoiceNumberPrefix();
    el("inv-date").value = todayISO();
    el("inv-due-date").value = todayISO();
    const partySelect = el("inv-party-select");
    if (inv.partyId) partySelect.value = inv.partyId;
    State.invoiceDraftItems = (inv.items || []).map(line => ({
      ...line,
      serials: [] // new bill — serials must be re-picked
    }));
    if (!State.invoiceDraftItems.length) State.invoiceDraftItems = [blankInvoiceLine()];
    el("inv-amount-received").value = "";
    State.invoiceAmountReceivedTouched = false;
    if (el("inv-bill-discount")) el("inv-bill-discount").value = inv.billDiscount || 0;
    if (el("inv-notes")) el("inv-notes").value = inv.notes || "";
    renderInvoiceLineItems();
    updateInvoicePartyMeta();
    recalculateInvoice();
    showToast("Duplicated — pick serials and save as a new bill.");
  };

  window.startCreditNoteFromInvoice = function startCreditNoteFromInvoice(invoiceId) {
    if (typeof blockedAction === "function" && blockedAction("sales")) return;
    const inv = findInvoice(invoiceId);
    if (!inv) return;
    State.editingInvoiceId = null;
    openNewInvoiceModal();
    el("invoice-modal-title").textContent = `Credit Note against ${inv.invoiceNo}`;
    // 1.13.16/17: a return mirrors its original bill's stored split (it reverses the tax as charged).
    // The linked invoice id is stored on the credit note so an edit can re-apply the same mirror.
    const split = typeof gstSplitFromSavedDoc === "function" ? gstSplitFromSavedDoc(inv) : (typeof inv.isInterstate === "boolean" ? { isInterstate: inv.isInterstate, posStateCode: inv.posStateCode || "" } : null);
    State.invoiceMirrorSplit = split
      ? { ...split, invoiceNo: inv.invoiceNo, invoiceId: inv.id }
      : null;
    el("inv-doc-type").value = "CREDIT_NOTE";
    if (typeof syncInvoiceNumberPrefix === "function") syncInvoiceNumberPrefix();
    el("inv-date").value = todayISO();
    el("inv-due-date").value = todayISO();
    const partySelect = el("inv-party-select");
    if (inv.partyId) partySelect.value = inv.partyId;
    State.invoiceDraftItems = (inv.items || []).map(line => ({
      ...line,
      serials: [...(line.serials || [])]
    }));
    if (el("inv-reference-no")) el("inv-reference-no").value = inv.invoiceNo;
    if (el("inv-reference-date")) el("inv-reference-date").value = inv.date || "";
    if (el("inv-notes")) el("inv-notes").value = `Against ${inv.invoiceNo}`;
    State.invoiceAmountReceivedTouched = true;
    el("inv-amount-received").value = "0";
    renderInvoiceLineItems();
    updateInvoicePartyMeta();
    // A credit note carries the original bill's place of supply.
    if (inv.posStateCode && typeof setInvoicePos === "function") { setInvoicePos(inv.posStateCode); evaluateTaxType(); }
    recalculateInvoice();
  };

  window.recordPaymentForInvoice = function recordPaymentForInvoice(invoiceId) {
    const inv = findInvoice(invoiceId);
    if (!inv) return;
    const party = State.parties.find(p => p.id === inv.partyId);
    if (!party) {
      showToast("No party on this bill to record a payment against.", "error");
      return;
    }
    State.selectedPartyId = party.id;
    closeInvoiceDetail();
    if (typeof selectParty === "function") selectParty(party.id);
    if (typeof switchView === "function") switchView("parties");
    document.getElementById("pay-party-name").value = `${party.name} (Due: ${formatINR(party.balance)})`;
    document.getElementById("pay-date").value = todayISO();
    document.getElementById("pay-amount").value = Number(inv.balanceDue) > 0 ? inv.balanceDue : "";
    document.getElementById("pay-notes").value = `Against ${inv.invoiceNo}`;
    document.getElementById("modal-payment").classList.add("open");
  };

  window.cancelInvoice = function cancelInvoice(invoiceId) {
    if (typeof blockedAction === "function" && blockedAction("sales")) return;
    const inv = findInvoice(invoiceId);
    if (!inv) return;
    if (inv.cancelled) {
      showToast("Already cancelled.");
      return;
    }
    if (!confirm(`Cancel ${inv.invoiceNo}? Stock and party balance will be reversed.`)) return;
    reverseInvoiceEffects(inv, { release: "cancelled" });
    inv.cancelled = true;
    inv.status = "CANCELLED";
    inv.balanceDue = 0;
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(inv);
    saveToStorage();
    showToast(`${inv.invoiceNo} cancelled.`);
    openInvoiceDetail(inv.id);
    if (typeof renderSalesTable === "function") renderSalesTable();
    if (typeof renderDashboard === "function") renderDashboard();
  };

  /** 1.13.7 (C1): undo a purchase's stock and supplier effects before it is deleted.
   *  Paid-on-bill money becomes an advance payment; supplier payments that settled it are
   *  detached (unapplied advances). There is no purchase Cancel in the UI, and reports do not
   *  filter cancelled purchases, so purchases are only deleted. */
  window.reversePurchaseEffects = function reversePurchaseEffects(pur, action) {
    if (!pur || pur.cancelled) return;
    const supplier = State.parties.find(p => p.id === pur.supplierId);
    if (typeof releaseBillMoney === "function") releaseBillMoney(pur, "purchase", supplier, action || "deleted");
    (pur.items || []).forEach(line => adjustStockLine({ ...line, godownId: line.godownId || pur.godownId }, "out"));
  };

  window.deletePurchase = function deletePurchase(purchaseId) {
    if (typeof blockedAction === "function" && blockedAction("purchase")) return;
    const pur = (State.purchases || []).find(p => p.id === purchaseId);
    if (!pur) return;
    if (!confirm(`Delete purchase ${pur.billNo}? Stock and the supplier balance will be reversed; any payment on it is kept as an advance.`)) return;
    reversePurchaseEffects(pur, "deleted");
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.softDelete) BillSetuSync.softDelete("purchases", pur.id);
    else State.purchases = State.purchases.filter(p => p.id !== pur.id);
    saveToStorage();
    closeInvoiceDetail();
    if (typeof renderPurchasesTable === "function") renderPurchasesTable();
    if (typeof renderDashboard === "function") renderDashboard();
    showToast("Purchase deleted.");
  };

  window.deleteInvoice = function deleteInvoice(invoiceId) {
    if (typeof blockedAction === "function" && blockedAction("sales")) return;
    const inv = findInvoice(invoiceId);
    if (!inv) return;
    if (!confirm(`Delete ${inv.invoiceNo}? This removes the bill and reverses stock / balance.`)) return;
    if (!inv.cancelled) reverseInvoiceEffects(inv, { release: "deleted" });
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.softDelete) {
      BillSetuSync.softDelete("invoices", inv.id);
    } else {
      State.invoices = State.invoices.filter(i => i.id !== inv.id);
    }
    saveToStorage();
    closeInvoiceDetail();
    showToast(`${inv.invoiceNo} deleted.`);
    if (typeof renderSalesTable === "function") renderSalesTable();
    if (typeof renderDashboard === "function") renderDashboard();
  };

  // Backdrop click + Escape close
  document.addEventListener("DOMContentLoaded", () => {
    el("invoice-detail-root")?.addEventListener("click", e => {
      if (e.target.id === "invoice-detail-root") closeInvoiceDetail();
    });
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && isInvoiceDetailOpen()) {
        if (document.querySelector(".modal-backdrop.open")) return;
        if (isMoreSheetOpen()) { closeMoreSheet(); return; }
        closeInvoiceDetail();
      }
    });
  });
})();
