/**
 * Ledgerbay v16 — unified recent activity, payment/expense detail, receipt print.
 */
(function () {
  "use strict";

  let dashTxnFilter = "all";

  function money(n) {
    return typeof formatINR === "function" ? formatINR(n) : ("₹ " + Number(n || 0).toFixed(2));
  }
  function shortDate(iso) {
    return typeof formatShortDate === "function" ? formatShortDate(iso) : String(iso || "").slice(0, 10);
  }
  function esc(s) {
    return typeof escHtml === "function" ? escHtml(s) : String(s || "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function words(n) {
    if (typeof convertNumberToWords === "function") return convertNumberToWords(n);
    return String(n);
  }

  function docTypeLabel(docType) {
    const map = {
      TAX_INVOICE: "Sale",
      BILL_OF_SUPPLY: "Sale",
      ESTIMATE: "Quotation",
      PROFORMA: "Proforma",
      CREDIT_NOTE: "Credit Note",
      DEBIT_NOTE: "Debit Note",
      DELIVERY_CHALLAN: "Challan"
    };
    return map[docType] || docType || "Sale";
  }

  function filterBucket(row) {
    if (row.bucket === "sale" || row.bucket === "quotation" || row.bucket === "challan" || row.bucket === "credit") return "sales";
    if (row.bucket === "receipt") return "receipts";
    if (row.bucket === "payment") return "payments";
    if (row.bucket === "purchase" || row.bucket === "debit") return "purchases";
    if (row.bucket === "expense") return "expenses";
    if (row.bucket === "journal" || row.bucket === "contra") return "all";
    return "all";
  }

  /** Collect every transaction type for the dashboard feed. */
  window.collectRecentActivity = function collectRecentActivity() {
    const rows = [];

    (State.invoices || []).forEach(inv => {
      if (inv.deleted) return;
      let bucket = "sale";
      let typeLabel = docTypeLabel(inv.docType);
      if (inv.docType === "ESTIMATE" || inv.docType === "PROFORMA") bucket = "quotation";
      else if (inv.docType === "CREDIT_NOTE") bucket = "credit";
      else if (inv.docType === "DELIVERY_CHALLAN") bucket = "challan";
      // Sales / quotations / challans = money toward the business (in);
      // credit notes = refund / out.
      const inbound = inv.docType !== "CREDIT_NOTE";
      rows.push({
        id: inv.id,
        kind: "invoice",
        bucket,
        typeLabel,
        ref: inv.invoiceNo,
        party: inv.partyName || "Cash",
        date: inv.date,
        sortKey: `${inv.date || ""}T${inv.createdAt || inv.updatedAt || ""}|${inv.id}`,
        amount: Number(inv.grandTotal) || 0,
        inbound,
        status: inv.status || "",
        open: () => typeof openInvoiceDetail === "function" && openInvoiceDetail(inv.id)
      });
    });

    (State.payments || []).forEach(pay => {
      if (pay.direction === "LOYALTY" || pay.deleted) return;
      const inbound = pay.direction !== "OUT";
      rows.push({
        id: pay.id,
        kind: "payment",
        bucket: inbound ? "receipt" : "payment",
        typeLabel: inbound ? "Receipt" : "Payment",
        ref: pay.receiptNo || pay.id,
        party: pay.partyName || "",
        date: pay.date,
        sortKey: `${pay.date || ""}T${pay.createdAt || ""}|${pay.id}`,
        amount: Number(pay.amount) || 0,
        inbound,
        status: pay.mode || "",
        open: () => typeof openPaymentDetail === "function" && openPaymentDetail(pay.id)
      });
    });

    (State.purchases || []).forEach(pur => {
      if (pur.deleted) return;
      rows.push({
        id: pur.id,
        kind: "purchase",
        bucket: "purchase",
        typeLabel: "Purchase",
        ref: pur.billNo || pur.id,
        party: pur.supplierName || "",
        date: pur.date,
        sortKey: `${pur.date || ""}T${pur.createdAt || ""}|${pur.id}`,
        amount: Number(pur.totalBill || pur.grandTotal) || 0,
        inbound: false,
        status: pur.status || "",
        open: () => typeof openPurchaseDetail === "function" && openPurchaseDetail(pur.id)
      });
    });

    (State.expenses || []).forEach(exp => {
      if (exp.deleted) return;
      rows.push({
        id: exp.id,
        kind: "expense",
        bucket: "expense",
        typeLabel: "Expense",
        ref: exp.receiptNo || exp.id,
        party: exp.category || "Expense",
        date: exp.date,
        sortKey: `${exp.date || ""}T${exp.createdAt || ""}|${exp.id}`,
        amount: Number(exp.amount) || 0,
        inbound: false,
        status: exp.mode || "",
        open: () => typeof openExpenseDetail === "function" && openExpenseDetail(exp.id)
      });
    });

    (State.debitNotes || []).forEach(note => {
      if (note.deleted) return;
      rows.push({
        id: note.id,
        kind: "debit",
        bucket: "debit",
        typeLabel: "Debit Note",
        ref: note.noteNo || note.id,
        party: note.supplierName || note.partyName || "",
        date: note.date,
        sortKey: `${note.date || ""}T${note.createdAt || ""}|${note.id}`,
        amount: Number(note.total || note.grandTotal) || 0,
        inbound: true,
        status: "",
        open: () => {
          if (typeof openDebitNoteDetail === "function") openDebitNoteDetail(note.id);
          else showToast("Debit note " + (note.noteNo || note.id));
        }
      });
    });

    // Optional books vouchers (journal / contra) if present
    const vouchers = State.vouchers || State.booksVouchers || [];
    vouchers.forEach(v => {
      if (v.deleted) return;
      const t = String(v.type || v.voucherType || "JOURNAL").toUpperCase();
      rows.push({
        id: v.id,
        kind: "voucher",
        bucket: t.includes("CONTRA") ? "contra" : "journal",
        typeLabel: t.includes("CONTRA") ? "Contra" : "Journal",
        ref: v.voucherNo || v.number || v.id,
        party: v.narration || v.partyName || "",
        date: v.date,
        sortKey: `${v.date || ""}T${v.createdAt || ""}|${v.id}`,
        amount: Number(v.amount || v.total) || 0,
        inbound: false,
        status: "",
        open: () => showToast((v.voucherNo || v.id) + " — open from Books")
      });
    });

    rows.sort((a, b) => String(b.sortKey).localeCompare(String(a.sortKey)));
    return rows;
  };

  window.setDashTxnFilter = function setDashTxnFilter(filter) {
    dashTxnFilter = filter || "all";
    document.querySelectorAll("#dash-txn-filters .txn-chip").forEach(chip => {
      chip.classList.toggle("active", chip.dataset.filter === dashTxnFilter);
    });
    renderDashRecentActivity();
  };


  function titleCaseMode(mode) {
    const raw = String(mode || "").trim();
    if (!raw) return "";
    const map = {
      CASH: "Cash", UPI: "UPI", BANK: "Bank", CHEQUE: "Cheque",
      CARD: "Card", CREDIT: "Credit", NEFT: "NEFT", RTGS: "RTGS",
      OTHER: "Other"
    };
    const key = raw.toUpperCase().replace(/\s+/g, "_");
    if (map[key]) return map[key];
    return raw.replace(/[_-]+/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  function purchaseStatusInfo(pur) {
    if (!pur) return { label: "—", className: "badge-neutral" };
    if (pur.cancelled || String(pur.status || "").toUpperCase() === "CANCELLED") {
      return { label: "Cancelled", className: "badge-cancelled" };
    }
    const due = Number(pur.balanceDue);
    const total = Number(pur.totalBill != null ? pur.totalBill : pur.grandTotal) || 0;
    const paid = Number(pur.paidAmount) || 0;
    const today = typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10);
    const dueAmt = Number.isFinite(due) ? due : Math.max(0, total - paid);
    if (dueAmt <= 0.009) return { label: "Paid", className: "badge-paid" };
    if (pur.dueDate && String(pur.dueDate) < today && dueAmt > 0.009) {
      return { label: "Overdue", className: "badge-overdue" };
    }
    const st = String(pur.status || "").toUpperCase();
    if (st === "PARTIAL" || (paid > 0.009 && dueAmt > 0.009)) {
      return { label: "Partial", className: "badge-partial" };
    }
    if (st === "UNPAID" || dueAmt + 0.009 >= total || paid <= 0.009) {
      return { label: "Unpaid", className: "badge-unpaid" };
    }
    return { label: "Partial", className: "badge-partial" };
  }

  /** Coloured pay-status for sales/purchases; title-case mode chip for money movements. */
  function txnStatusChip(row) {
    if (!row) return { label: "—", className: "badge-neutral" };
    if (row.kind === "invoice") {
      const inv = (State.invoices || []).find(i => i.id === row.id);
      if (typeof invoiceStatusInfo === "function") return invoiceStatusInfo(inv);
      return purchaseStatusInfo(inv);
    }
    if (row.kind === "purchase") {
      const pur = (State.purchases || []).find(p => p.id === row.id);
      return purchaseStatusInfo(pur);
    }
    if (row.kind === "payment" || row.kind === "expense") {
      const label = titleCaseMode(row.status) || "—";
      return { label, className: "badge-neutral" };
    }
    return { label: "—", className: "badge-neutral" };
  }

  window.renderDashRecentActivity = function renderDashRecentActivity() {
    const recentTable = document.getElementById("dash-recent-invoices");
    if (!recentTable) return;
    const all = collectRecentActivity();
    const filtered = dashTxnFilter === "all"
      ? all
      : all.filter(r => {
          const b = filterBucket(r);
          if (dashTxnFilter === "sales") return b === "sales";
          return b === dashTxnFilter;
        });
    const slice = filtered.slice(0, 25);
    if (!slice.length) {
      recentTable.innerHTML = `<tr><td colspan="6" class="empty-state-message">No transactions yet.</td></tr>`;
      return;
    }
    recentTable.innerHTML = slice.map(row => {
      const signClass = row.inbound ? "txn-in" : "txn-out";
      const sign = row.inbound ? "+" : "−";
      const chipClass = `txn-type-chip txn-${row.bucket}`;
      const st = txnStatusChip(row);
      const statusHtml = `<span class="badge ${st.className}">${esc(st.label)}</span>`;
      return `
      <tr class="txn-row inv-row" data-txn-kind="${esc(row.kind)}" data-txn-id="${esc(row.id)}" onclick="openTxnFromDash(event)">
        <td class="m-title">
          <strong class="m-party">${esc(row.party)}</strong>
          <div class="phone-sub"><span class="${chipClass}">${esc(row.typeLabel)}</span> ${esc(row.ref)} · ${shortDate(row.date)}</div>
        </td>
        <td><span class="${chipClass}">${esc(row.typeLabel)}</span></td>
        <td><strong>${esc(row.ref)}</strong></td>
        <td class="num">${shortDate(row.date)}</td>
        <td class="m-amt num ${signClass}"><strong>${sign}${money(row.amount)}</strong></td>
        <td class="m-status">${statusHtml}</td>
        <td class="m-actions" onclick="event.stopPropagation()">
          <span class="m-mode">${statusHtml}</span>
          <div class="row-actions">
          <button type="button" class="act-btn act-btn-print" onclick="event.stopPropagation(); openTxnPrint('${esc(row.kind)}','${esc(row.id)}')" title="Print" aria-label="Print"><svg class="act-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
        </div></td>
      </tr>`;
    }).join("");
  };

  window.openTxnFromDash = function openTxnFromDash(event) {
    if (!event) return;
    if (event.target.closest?.(".row-actions, .row-menu, button, a, summary, details")) return;
    const tr = event.currentTarget;
    const kind = tr?.dataset?.txnKind;
    const id = tr?.dataset?.txnId;
    if (!kind || !id) return;
    openTxnByKind(kind, id);
  };

  function openTxnByKind(kind, id) {
    if (kind === "invoice") return openInvoiceDetail?.(id);
    if (kind === "payment") return openPaymentDetail?.(id);
    if (kind === "purchase") return openPurchaseDetail?.(id);
    if (kind === "expense") return openExpenseDetail?.(id);
    if (kind === "debit" && typeof openDebitNoteDetail === "function") return openDebitNoteDetail(id);
  }

  window.openTxnPrint = function openTxnPrint(kind, id) {
    if (kind === "invoice") {
      if (typeof openPrintModal === "function") openPrintModal(id);
      else openInvoiceDetail?.(id);
      return;
    }
    if (kind === "payment") {
      printPaymentReceipt(id);
      return;
    }
    if (kind === "expense") {
      openExpenseDetail?.(id);
      return;
    }
    openTxnByKind(kind, id);
  };

  // ---------- Receipt HTML (A4 / A5 / thermal) ----------
  function partyBalanceAfter(pay) {
    const party = (State.parties || []).find(p => p.id === pay.partyId);
    if (!party) return null;
    return { balance: Number(party.balance) || 0, balType: party.balType || "RECEIVABLE" };
  }

  function settlementsHtml(pay, compact) {
    const list = pay.settlements || [];
    if (!list.length) {
      const applied = Number(pay.applied) || 0;
      if (applied > 0.009) {
        return compact
          ? `<div>Against bills: ${money(applied)}</div>`
          : `<tr><td colspan="2">On-account / against open bills</td><td class="num">${money(applied)}</td></tr>`;
      }
      return compact ? "" : `<tr><td colspan="3" class="muted">On-account (no specific invoice)</td></tr>`;
    }
    if (compact) {
      return list.map(s => `<div>${esc(s.invoiceNo || s.billNo || "")}: ${money(s.amount)}</div>`).join("");
    }
    return list.map(s =>
      `<tr><td>${esc(s.invoiceNo || s.billNo || "")}</td><td>${shortDate(s.date || "")}</td><td class="num">${money(s.amount)}</td></tr>`
    ).join("");
  }

  window.buildPaymentReceiptHtml = function buildPaymentReceiptHtml(pay, size) {
    const b = State.business || {};
    const inbound = pay.direction !== "OUT";
    const title = inbound ? "PAYMENT RECEIPT" : "PAYMENT VOUCHER";
    const partyLine = inbound ? "Received with thanks from" : "Paid to";
    const bal = partyBalanceAfter(pay);
    const balLine = bal
      ? `Balance after: ${money(bal.balance)} ${bal.balType === "PAYABLE" ? "(payable)" : "(receivable)"}`
      : "";
    const amtWords = words(pay.amount);
    const wordsLine = /rupees/i.test(amtWords) ? amtWords : `Rupees ${amtWords} Only`;
    const sizeClass = size === "thermal58" ? "rcpt-thermal rcpt-58"
      : size === "thermal80" ? "rcpt-thermal rcpt-80"
      : size === "a5" ? "rcpt-a5"
      : "rcpt-a4";
    const thermal = sizeClass.includes("thermal");

    const settleBlock = thermal
      ? `<div class="rcpt-block"><strong>Settlement</strong>${settlementsHtml(pay, true) || "<div>On-account</div>"}</div>`
      : `<table class="rcpt-table"><thead><tr><th>Against</th><th>Date</th><th>Amount</th></tr></thead><tbody>${settlementsHtml(pay, false)}</tbody></table>`;

    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(pay.receiptNo || "Receipt")}</title>
<style>
  @page { margin: ${size && size.startsWith("thermal") ? "8mm" : "0"}; size: ${size === "a5" ? "A5 portrait" : size && size.startsWith("thermal") ? (size === "thermal58" ? "58mm auto" : "80mm auto") : "A4 portrait"}; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", system-ui, sans-serif; color: #0f172a; background: #fff; }
  .rcpt-a4 { width: 190mm; margin: 0 auto; padding: 8mm; }
  .rcpt-a5 { width: 132mm; margin: 0 auto; padding: 6mm; font-size: 12px; }
  .rcpt-thermal { margin: 0 auto; padding: 4px; font-size: 11px; font-family: ui-monospace, monospace; }
  .rcpt-58 { width: 48mm; } .rcpt-80 { width: 68mm; }
  .rcpt-head { text-align: center; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 10px; }
  .rcpt-head h1 { margin: 0; font-size: ${thermal ? "13px" : "18px"}; }
  .rcpt-head .meta { font-size: ${thermal ? "9px" : "11px"}; color: #475569; }
  .rcpt-title { text-align: center; font-weight: 800; letter-spacing: 0.04em; margin: 10px 0; font-size: ${thermal ? "12px" : "15px"}; }
  .rcpt-row { display: flex; justify-content: space-between; gap: 8px; margin: 4px 0; font-size: ${thermal ? "10px" : "13px"}; }
  .rcpt-amt { margin: 12px 0; padding: 10px; border: 2px solid #059669; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
  .rcpt-thermal .rcpt-amt { border-width: 1px; padding: 6px; border-radius: 0; }
  .rcpt-amt strong { font-size: ${thermal ? "14px" : "22px"}; color: ${inbound ? "#059669" : "#b91c1c"}; }
  .rcpt-words { font-style: italic; font-size: ${thermal ? "9px" : "12px"}; margin-bottom: 10px; }
  .rcpt-table { width: 100%; border-collapse: collapse; font-size: 12px; margin: 8px 0 12px; }
  .rcpt-table th, .rcpt-table td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; }
  .rcpt-table .num { text-align: right; }
  .rcpt-block { margin: 8px 0; font-size: 10px; }
  .rcpt-bal { font-size: ${thermal ? "10px" : "12px"}; margin: 8px 0; }
  .rcpt-sign { display: flex; justify-content: space-between; margin-top: ${thermal ? "16px" : "36px"}; padding-top: 8px; border-top: 1px dashed #94a3b8; font-size: ${thermal ? "9px" : "11px"}; }
  .rcpt-sign .pad { height: ${thermal ? "24px" : "40px"}; }
</style></head><body>
<div class="${sizeClass}">
  <div class="rcpt-head">
    ${String(b.name || "").trim() ? `<h1>${esc(b.name)}</h1>` : ""}
    ${b.address ? `<div class="meta">${esc(b.address)}</div>` : ""}
    ${b.gstin || b.phone ? `<div class="meta">${[b.gstin ? "GSTIN: " + esc(b.gstin) : "", b.phone ? esc(b.phone) : ""].filter(Boolean).join(" · ")}</div>` : ""}
  </div>
  <div class="rcpt-title">${title}</div>
  <div class="rcpt-row"><span><strong>No:</strong> ${esc(pay.receiptNo || "")}</span><span><strong>Date:</strong> ${shortDate(pay.date)}</span></div>
  <div class="rcpt-row"><span><strong>${partyLine}:</strong> ${esc(pay.partyName || "")}</span></div>
  <div class="rcpt-row"><span><strong>Mode:</strong> ${esc(pay.mode || "")}</span>${pay.refNo || pay.reference ? `<span><strong>Ref:</strong> ${esc(pay.refNo || pay.reference)}</span>` : ""}</div>
  <div class="rcpt-amt"><span>${inbound ? "Amount received" : "Amount paid"}</span><strong>${money(pay.amount)}</strong></div>
  <div class="rcpt-words"><strong>In words:</strong> ${esc(wordsLine)}</div>
  ${settleBlock}
  ${balLine ? `<div class="rcpt-bal"><strong>${esc(balLine)}</strong></div>` : ""}
  ${pay.notes ? `<div class="rcpt-bal">Notes: ${esc(pay.notes)}</div>` : ""}
  <div class="rcpt-sign">
    <div><div class="pad"></div>Customer / Party</div>
    <div style="text-align:right">${String(b.name || "").trim() ? `<div>For <strong>${esc(b.name)}</strong></div>` : ""}<div class="pad"></div>Authorized Signatory</div>
  </div>
</div>
</body></html>`;
  };

  window.printPaymentReceipt = async function printPaymentReceipt(paymentId, size) {
    const pay = (State.payments || []).find(p => p.id === paymentId);
    if (!pay) {
      showToast("Receipt not found.", "error");
      return;
    }
    if (typeof beginPrintJob === "function" && !beginPrintJob()) return;
    const paper = size || "a4";
    const html = buildPaymentReceiptHtml(pay, paper);
    const widthMm = paper === "a5" ? 148 : paper === "thermal58" ? 58 : paper === "thermal80" ? 80 : 210;
    const heightMm = paper === "a5" ? 210 : paper.startsWith("thermal") ? 200 : 297;

    if (typeof dismissPrintOverlays === "function") dismissPrintOverlays();
    document.getElementById("modal-receipt-voucher")?.classList.remove("open");

    const plugin = typeof billPrintPlugin === "function" ? billPrintPlugin() : null;
    if (plugin) {
      try {
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 60)));
        await callBillPrintHtml(plugin, {
          html,
          jobName: pay.receiptNo || "Receipt",
          widthMm,
          heightMm
        });
        showToast("Opened the Android print dialog.");
        return;
      } catch (err) {
        console.warn(err);
        showToast("Print failed.", "error");
      }
    }

    // Web / PC: print via hidden iframe
    let frame = document.getElementById("receipt-print-frame");
    if (!frame) {
      frame = document.createElement("iframe");
      frame.id = "receipt-print-frame";
      frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
      document.body.appendChild(frame);
    }
    const doc = frame.contentDocument || frame.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    }, 250);
  };

  // ---------- Payment / expense detail (reuse invoice-detail shell) ----------
  function iconSvg(name) {
    const paths = {
      edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>',
      print: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
      share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
      more: '<circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="19" r="1.5"/>',
      pdf: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
      trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
      back: '<polyline points="15 18 9 12 15 6"/>',
      close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'
    };
    return `<svg class="invd-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[name] || ""}</svg>`;
  }

  let activeTxnKind = null;
  let activeTxnId = null;

  function openDetailShell(html) {
    const root = document.getElementById("invoice-detail-root");
    const panel = document.getElementById("invoice-detail-panel");
    if (!root || !panel) return;
    panel.innerHTML = html;
    root.classList.add("open");
    document.body.classList.add("invoice-detail-open");
    bindTxnDetailChrome();
  }

  function bindTxnDetailChrome() {
    document.getElementById("invd-back")?.addEventListener("click", () => {
      if (document.getElementById("invd-more-sheet")?.classList.contains("open")) closeTxnMore();
      else closeTxnDetail();
    });
    document.getElementById("invd-close")?.addEventListener("click", () => {
      if (document.getElementById("invd-more-sheet")?.classList.contains("open")) closeTxnMore();
      else closeTxnDetail();
    });
    document.getElementById("invd-sticky-bar")?.addEventListener("click", onTxnAction);
    document.getElementById("invd-more-list")?.addEventListener("click", onTxnAction);
    document.getElementById("invd-more-close")?.addEventListener("click", closeTxnMore);
    document.getElementById("invd-more-backdrop")?.addEventListener("click", closeTxnMore);
  }

  function closeTxnMore() {
    document.getElementById("invd-more-sheet")?.classList.remove("open");
    document.getElementById("invd-more-sheet")?.setAttribute("hidden", "");
    document.getElementById("invd-more-backdrop")?.setAttribute("hidden", "");
  }

  function openTxnMore() {
    document.getElementById("invd-more-sheet")?.classList.add("open");
    document.getElementById("invd-more-sheet")?.removeAttribute("hidden");
    document.getElementById("invd-more-backdrop")?.removeAttribute("hidden");
  }

  function closeTxnDetail() {
    closeTxnMore();
    document.getElementById("invoice-detail-root")?.classList.remove("open");
    document.body.classList.remove("invoice-detail-open");
    activeTxnKind = null;
    activeTxnId = null;
  }

  // Prefer invoice-detail close when kind is invoice/purchase — those use their own binders.
  // Our openers replace panel HTML and rebind.

  function onTxnAction(event) {
    const btn = event.target.closest("[data-act]");
    if (!btn || btn.disabled) return;
    const act = btn.dataset.act;
    if (act === "more") { openTxnMore(); return; }
    if (act === "print-a4") { printPaymentReceipt(activeTxnId, "a4"); return; }
    if (act === "print-a5") { printPaymentReceipt(activeTxnId, "a5"); return; }
    if (act === "print-t58") { printPaymentReceipt(activeTxnId, "thermal58"); return; }
    if (act === "print-t80") { printPaymentReceipt(activeTxnId, "thermal80"); return; }

    if (activeTxnKind === "payment") {
      const pay = (State.payments || []).find(p => p.id === activeTxnId);
      if (!pay) return;
      if (act === "print") { closeTxnMore(); printPaymentReceipt(pay.id, "a4"); return; }
      if (act === "share") {
        const phone = ((State.parties || []).find(p => p.id === pay.partyId)?.phone || "").replace(/\D/g, "");
        const text = `Namaste ${pay.partyName},\nPayment of *${money(pay.amount)}* (${pay.mode}) on ${shortDate(pay.date)}.\nReceipt: *${pay.receiptNo}*.${State.business?.name ? "\n— " + State.business.name : ""}`;
        const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
        window.open(url, "_blank");
        return;
      }
      if (act === "edit") { closeTxnDetail(); editPayment(pay.id); return; }
      if (act === "delete") {
        if (!confirm(`Delete ${pay.receiptNo}? Party balance and invoice settlements will be reversed.`)) return;
        reversePaymentEffects(pay);
        // 1.13.5: tombstone the receipt so the delete reaches other devices.
        if (window.BillSetuSync && typeof BillSetuSync.softDelete === "function") BillSetuSync.softDelete("payments", pay.id);
        else State.payments = State.payments.filter(p => p.id !== pay.id);
        saveToStorage();
        closeTxnDetail();
        if (typeof renderDashboard === "function") renderDashboard();
        showToast("Receipt deleted and balances reversed.");
        return;
      }
      if (act === "pdf") { printPaymentReceipt(pay.id, "a4"); return; }
    }

    if (activeTxnKind === "expense") {
      const exp = (State.expenses || []).find(e => e.id === activeTxnId);
      if (!exp) return;
      if (act === "print") {
        // Simple expense slip via receipt builder shape
        const faux = {
          id: exp.id,
          receiptNo: exp.receiptNo || ("EXP-" + exp.id.slice(-4)),
          date: exp.date,
          partyName: exp.category,
          direction: "OUT",
          amount: exp.amount,
          mode: exp.mode,
          notes: exp.notes,
          settlements: []
        };
        const html = buildPaymentReceiptHtml(faux, "a5");
        // Temporarily stash and print via iframe
        let frame = document.getElementById("receipt-print-frame");
        if (!frame) {
          frame = document.createElement("iframe");
          frame.id = "receipt-print-frame";
          frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;";
          document.body.appendChild(frame);
        }
        const doc = frame.contentDocument || frame.contentWindow.document;
        doc.open(); doc.write(html); doc.close();
        const plugin = typeof billPrintPlugin === "function" ? billPrintPlugin() : null;
        if (plugin) {
          if (typeof dismissPrintOverlays === "function") dismissPrintOverlays();
          callBillPrintHtml(plugin, { html, jobName: faux.receiptNo, widthMm: 148, heightMm: 210 });
        } else {
          setTimeout(() => { frame.contentWindow.focus(); frame.contentWindow.print(); }, 250);
        }
        return;
      }
      if (act === "edit") { closeTxnDetail(); editExpense(exp.id); return; }
      if (act === "delete") {
        if (!confirm("Delete this expense?")) return;
        if (window.BillSetuSync && typeof BillSetuSync.softDelete === "function") BillSetuSync.softDelete("expenses", exp.id);
        else State.expenses = State.expenses.filter(e => e.id !== exp.id);
        saveToStorage();
        closeTxnDetail();
        if (typeof renderExpensesTable === "function") renderExpensesTable();
        if (typeof renderDashboard === "function") renderDashboard();
        showToast("Expense deleted.");
        return;
      }
      if (act === "share") {
        const text = `Expense ${money(exp.amount)} — ${exp.category} on ${shortDate(exp.date)} (${exp.mode})`;
        window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, "_blank");
      }
    }
  }

  window.reversePaymentEffects = function reversePaymentEffects(pay) {
    if (!pay) return;
    const party = (State.parties || []).find(p => p.id === pay.partyId);
    const amt = Number(pay.amount) || 0;
    const settlements = pay.settlements || [];

    // Reverse invoice settlements first
    settlements.forEach(s => {
      if (s.purchaseId) {
        const pur = (State.purchases || []).find(x => x.id === s.purchaseId);
        if (!pur) return;
        const back = Number(s.amount) || 0;
        pur.paidAmount = Math.max(0, Math.round(((Number(pur.paidAmount) || 0) - back) * 100) / 100);
        pur.balanceDue = Math.round(((Number(pur.balanceDue) || 0) + back) * 100) / 100;
        pur.status = pur.balanceDue <= 0.009 ? "PAID" : (pur.paidAmount > 0.009 ? "PARTIAL" : "UNPAID");
        if (window.BillSetuSync && BillSetuSync.markUpdated) BillSetuSync.markUpdated(pur);
        return;
      }
      const inv = (State.invoices || []).find(i => i.id === s.invoiceId);
      if (!inv) return;
      const applied = Number(s.amount) || 0;
      inv.paidAmount = Math.max(0, Math.round(((Number(inv.paidAmount) || 0) - applied) * 100) / 100);
      inv.amountReceived = inv.paidAmount;
      inv.balanceDue = Math.round(((Number(inv.balanceDue) || 0) + applied) * 100) / 100;
      inv.status = inv.balanceDue <= 0.009 ? "PAID" : (inv.paidAmount > 0.009 ? "PARTIAL" : "UNPAID");
      if (window.BillSetuSync && BillSetuSync.markUpdated) BillSetuSync.markUpdated(inv);
    });

    // If no settlements recorded but applied > 0, best-effort: add applied back to party only
    if (party) {
      if (pay.direction === "OUT") {
        // Original OUT reduced payable / flipped — reverse by adding back as payable
        if ((party.balType || "") === "RECEIVABLE" && (Number(party.balance) || 0) > 0.009) {
          const cover = Math.min(Number(party.balance) || 0, amt);
          const rest = Math.round((amt - cover) * 100) / 100;
          party.balance = Math.round(((Number(party.balance) || 0) - cover) * 100) / 100;
          if (rest > 0.009) {
            party.balance = rest;
            party.balType = "PAYABLE";
          } else if (party.balance <= 0.009) {
            party.balance = 0;
          }
        } else {
          party.balance = Math.round(((Number(party.balance) || 0) + amt) * 100) / 100;
          party.balType = "PAYABLE";
        }
      } else {
        // IN receipt: reverse by increasing receivable (or reducing payable)
        if ((party.balType || "RECEIVABLE") === "PAYABLE") {
          const cover = Math.min(Number(party.balance) || 0, amt);
          const rest = Math.round((amt - cover) * 100) / 100;
          party.balance = Math.round(((Number(party.balance) || 0) - cover) * 100) / 100;
          if (rest > 0.009) {
            party.balance = rest;
            party.balType = "RECEIVABLE";
          } else if (party.balance <= 0.009) {
            party.balance = 0;
            party.balType = "RECEIVABLE";
          }
        } else {
          party.balance = Math.round(((Number(party.balance) || 0) + amt) * 100) / 100;
          party.balType = "RECEIVABLE";
        }
      }
      if (window.BillSetuSync && BillSetuSync.markUpdated) BillSetuSync.markUpdated(party);
    }
  };

  window.editPayment = function editPayment(paymentId) {
    const pay = (State.payments || []).find(p => p.id === paymentId);
    if (!pay) return;
    reversePaymentEffects(pay);
    // Remove so re-save creates fresh settlements; keep id for replace
    State._editingPaymentId = pay.id;
    State.payments = State.payments.filter(p => p.id !== pay.id);
    const party = (State.parties || []).find(p => p.id === pay.partyId);
    if (party) {
      State.selectedPartyId = party.id;
      if (typeof selectParty === "function") selectParty(party.id);
      document.getElementById("pay-party-name").value = `${party.name} (Due: ${money(party.balance)})`;
    }
    document.getElementById("pay-date").value = pay.date || (typeof todayISO === "function" ? todayISO() : "");
    document.getElementById("pay-amount").value = pay.amount;
    if (document.getElementById("pay-mode")) document.getElementById("pay-mode").value = pay.mode || "CASH";
    if (document.getElementById("pay-notes")) document.getElementById("pay-notes").value = pay.notes || "";
    document.getElementById("modal-payment")?.classList.add("open");
    saveToStorage();
    showToast("Previous receipt reversed. Save to reapply.");
  };

  window.editExpense = function editExpense(expenseId) {
    const exp = (State.expenses || []).find(e => e.id === expenseId);
    if (!exp) return;
    State._editingExpenseId = exp.id;
    document.getElementById("exp-date").value = exp.date || "";
    document.getElementById("exp-category").value = exp.category || "Rent";
    document.getElementById("exp-amount").value = exp.amount;
    document.getElementById("exp-mode").value = exp.mode || "CASH";
    document.getElementById("exp-notes").value = exp.notes || "";
    document.getElementById("modal-expense")?.classList.add("open");
  };

  window.openPaymentDetail = function openPaymentDetail(paymentId) {
    const pay = (State.payments || []).find(p => p.id === paymentId);
    if (!pay) {
      showToast("Receipt not found.", "error");
      return;
    }
    activeTxnKind = "payment";
    activeTxnId = paymentId;
    const inbound = pay.direction !== "OUT";
    const bal = partyBalanceAfter(pay);
    const settleRows = (pay.settlements || []).map(s =>
      `<div class="invd-line"><span>${esc(s.invoiceNo || s.billNo || "")}</span><strong>${money(s.amount)}</strong></div>`
    ).join("") || `<div class="invd-line muted">On-account / unallocated</div>`;

    openDetailShell(`
      <div class="invd-header">
        <button type="button" class="invd-back" id="invd-back" aria-label="Back">${iconSvg("back")}</button>
        <div class="invd-header-main">
          <div class="invd-title-row">
            <h2>${esc(pay.receiptNo || "Receipt")}</h2>
            <span class="badge ${inbound ? "badge-paid" : "badge-unpaid"}">${inbound ? "Receipt" : "Payment"}</span>
          </div>
          <div class="invd-sub">${shortDate(pay.date)} · ${esc(pay.mode || "")}</div>
        </div>
        <button type="button" class="btn-icon invd-close" id="invd-close" aria-label="Close">${iconSvg("close")}</button>
      </div>
      <div class="invd-scroll">
        <section class="invd-party">
          <strong>${esc(pay.partyName || "")}</strong>
        </section>
        <section class="invd-amounts">
          <div><span>Amount</span><strong class="${inbound ? "txn-in" : "txn-out"}">${money(pay.amount)}</strong></div>
          <div><span>Applied</span><strong>${money(pay.applied || 0)}</strong></div>
          <div><span>Balance after</span><strong>${bal ? money(bal.balance) : "—"}</strong></div>
        </section>
        <section class="invd-block">
          <h3>Settlement</h3>
          ${settleRows}
          ${pay.notes ? `<p class="text-muted text-sm">${esc(pay.notes)}</p>` : ""}
        </section>
        <section class="invd-block">
          <h3>Print size</h3>
          <div class="txn-print-sizes">
            <button type="button" class="btn btn-outline btn-sm" data-act="print-a4">A4</button>
            <button type="button" class="btn btn-outline btn-sm" data-act="print-a5">A5</button>
            <button type="button" class="btn btn-outline btn-sm" data-act="print-t58">Thermal 58</button>
            <button type="button" class="btn btn-outline btn-sm" data-act="print-t80">Thermal 80</button>
          </div>
        </section>
      </div>
      <div class="invd-sticky-bar" id="invd-sticky-bar">
        <button type="button" class="invd-bar-btn invd-bar-primary" data-act="edit">${iconSvg("edit")}<span>Edit</span></button>
        <button type="button" class="invd-bar-btn" data-act="print">${iconSvg("print")}<span>Print</span></button>
        <button type="button" class="invd-bar-btn" data-act="share">${iconSvg("share")}<span>Share</span></button>
        <button type="button" class="invd-bar-btn" data-act="more" id="invd-more-btn">${iconSvg("more")}<span>More</span></button>
      </div>
      <div class="invd-more-backdrop" id="invd-more-backdrop" hidden></div>
      <div class="invd-more-sheet" id="invd-more-sheet" hidden role="dialog">
        <div class="invd-more-handle"></div>
        <div class="invd-more-title">More actions</div>
        <div class="invd-more-list" id="invd-more-list">
          <button type="button" class="invd-sheet-item" data-act="pdf">${iconSvg("pdf")}<span>Print / PDF</span></button>
          <button type="button" class="invd-sheet-item invd-sheet-danger" data-act="delete">${iconSvg("trash")}<span>Delete</span></button>
        </div>
        <button type="button" class="btn btn-outline btn-block" id="invd-more-close">Close</button>
      </div>
    `);
  };

  window.openExpenseDetail = function openExpenseDetail(expenseId) {
    const exp = (State.expenses || []).find(e => e.id === expenseId);
    if (!exp) {
      showToast("Expense not found.", "error");
      return;
    }
    activeTxnKind = "expense";
    activeTxnId = expenseId;
    openDetailShell(`
      <div class="invd-header">
        <button type="button" class="invd-back" id="invd-back" aria-label="Back">${iconSvg("back")}</button>
        <div class="invd-header-main">
          <div class="invd-title-row">
            <h2>${esc(exp.category || "Expense")}</h2>
            <span class="badge badge-unpaid">Expense</span>
          </div>
          <div class="invd-sub">${shortDate(exp.date)} · ${esc(exp.mode || "")}</div>
        </div>
        <button type="button" class="btn-icon invd-close" id="invd-close" aria-label="Close">${iconSvg("close")}</button>
      </div>
      <div class="invd-scroll">
        <section class="invd-amounts">
          <div><span>Amount</span><strong class="txn-out">${money(exp.amount)}</strong></div>
          <div><span>Mode</span><strong>${esc(exp.mode || "")}</strong></div>
          <div><span>Category</span><strong>${esc(exp.category || "")}</strong></div>
        </section>
        <section class="invd-block">
          <h3>Notes</h3>
          <p>${esc(exp.notes || "—")}</p>
        </section>
      </div>
      <div class="invd-sticky-bar" id="invd-sticky-bar">
        <button type="button" class="invd-bar-btn invd-bar-primary" data-act="edit">${iconSvg("edit")}<span>Edit</span></button>
        <button type="button" class="invd-bar-btn" data-act="print">${iconSvg("print")}<span>Print</span></button>
        <button type="button" class="invd-bar-btn" data-act="share">${iconSvg("share")}<span>Share</span></button>
        <button type="button" class="invd-bar-btn" data-act="more">${iconSvg("more")}<span>More</span></button>
      </div>
      <div class="invd-more-backdrop" id="invd-more-backdrop" hidden></div>
      <div class="invd-more-sheet" id="invd-more-sheet" hidden>
        <div class="invd-more-title">More actions</div>
        <div class="invd-more-list" id="invd-more-list">
          <button type="button" class="invd-sheet-item invd-sheet-danger" data-act="delete">${iconSvg("trash")}<span>Delete</span></button>
        </div>
        <button type="button" class="btn btn-outline btn-block" id="invd-more-close">Close</button>
      </div>
    `);
  };

  /** 1.13.11: debit-note rows open a read-only detail view (was an undefined function). */
  window.openDebitNoteDetail = function openDebitNoteDetail(noteId) {
    const note = (State.debitNotes || []).find(n => n.id === noteId);
    if (!note) {
      showToast("Debit note not found.", "error");
      return;
    }
    activeTxnKind = "debit";
    activeTxnId = noteId;
    const total = Number(note.total || note.grandTotal) || 0;
    const gst = Number(note.gstAmount) || 0;
    const row = (k, v) => v === "" || v == null ? "" : `<div class="invd-kv"><span>${esc(k)}</span><strong>${esc(v)}</strong></div>`;
    openDetailShell(`
      <div class="invd-header">
        <button type="button" class="invd-back" id="invd-back" aria-label="Back">${iconSvg("back")}</button>
        <div class="invd-header-main">
          <div class="invd-title-row">
            <h2>${esc(note.noteNo || "Debit note")}</h2>
            <span class="badge badge-paid">Debit Note</span>
          </div>
          <div class="invd-sub">${[shortDate(note.date), esc(note.supplierName || note.partyName || "")].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" class="btn-icon invd-close" id="invd-close" aria-label="Close">${iconSvg("close")}</button>
      </div>
      <div class="invd-scroll" id="debit-note-detail">
        <section class="invd-amounts">
          <div><span>Total</span><strong class="txn-in">${money(total)}</strong></div>
          <div><span>GST</span><strong>${money(gst)}</strong></div>
          <div><span>Taxable</span><strong>${money(Math.max(0, total - gst))}</strong></div>
        </section>
        <section class="invd-block">
          <h3>Details</h3>
          ${row("Supplier", note.supplierName || note.partyName || "")}
          ${row("Item returned", note.itemName || "")}
          ${row("Quantity", note.qty != null ? String(note.qty) : "")}
          ${row("Against bill", note.againstBill || "")}
          ${row("Reason", note.reason || note.notes || "")}
        </section>
      </div>
    `);
  };

  // Hook filters once DOM ready
  document.addEventListener("DOMContentLoaded", () => {
    document.getElementById("dash-txn-filters")?.addEventListener("click", e => {
      const chip = e.target.closest(".txn-chip");
      if (chip?.dataset?.filter) setDashTxnFilter(chip.dataset.filter);
    });
  });
})();
