/**
 * Report-only printing: hide app chrome, emit a clean A4 (or landscape) sheet
 * with company header, title, filters, table (thead repeats), totals, generated-on.
 * Works via window.print on PC and BillPrintPlugin on Android.
 */
(function (global) {
  /* 1.13.11 (BR3): browser print uses document.title for the Save-as-PDF name and the print
     header. Every print path sets it to the document number / report name and restores it. */
  let savedTitle = null;
  function setPrintTitle(t) {
    const want = String(t || "").replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim();
    if (!want) return;
    if (savedTitle === null) savedTitle = document.title;
    document.title = want;
  }
  function restorePrintTitle() {
    if (savedTitle !== null) { document.title = savedTitle; savedTitle = null; }
  }
  global.setPrintTitle = setPrintTitle;
  global.restorePrintTitle = restorePrintTitle;
})(window);

(function (global) {
  const WIDE_REPORTS = new Set([
    "gstr1", "gstr2", "daybook", "aging", "godown",
    "ledger", "outstanding", "gst", "voucher", "brs"
  ]);

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function companyBlock() {
    const b = (typeof State !== "undefined" && State.business) || {};
    const lines = [
      b.name ? `<div class="rp-co-name">${esc(b.name)}</div>` : "",
      b.tradeName ? `<div class="rp-co-trade">${esc(b.tradeName)}</div>` : "",
      b.gstin ? `<div class="rp-co-meta">GSTIN: ${esc(b.gstin)}${b.pan ? " · PAN: " + esc(b.pan) : ""}</div>` : "",
      b.address ? `<div class="rp-co-addr">${esc(b.address)}</div>` : "",
      (b.phone || b.email) ? `<div class="rp-co-meta">${esc([b.phone, b.email].filter(Boolean).join(" · "))}</div>` : ""
    ];
    return `<header class="rp-header">${lines.join("")}</header>`;
  }

  function generatedFooter() {
    const now = new Date();
    const stamp = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
    return `<footer class="rp-footer"><span>Generated on ${esc(stamp)} (Asia/Calcutta)</span><span class="rp-pages"></span></footer>`;
  }

  function normTitle(s) {
    return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function parseAmountish(text) {
    const t = String(text || "").replace(/[,\s]/g, "").replace(/[₹]/g, "");
    const m = t.match(/-?[\d]+(?:\.\d+)?/);
    return m ? Number(m[0]) : NaN;
  }

  /** Strip chrome, dark fills, duplicate heading; mark profit/loss rows. */
  function cloneClean(node, printTitle) {
    if (!node) return "";
    const clone = node.cloneNode(true);
    clone.querySelectorAll("script, style, .no-print, button, .btn, input, select, textarea, .daybook-tools input, .daybook-tools select, label input, .reports-tabs").forEach(el => el.remove());
    clone.querySelectorAll("button, .btn").forEach(el => el.remove());
    sanitizePrintNode(clone, printTitle);
    return clone.innerHTML;
  }

  function sanitizePrintNode(root, printTitle) {
    if (!root) return;
    // Kill inline paints that survive CSS (e.g. P&L net row style.background)
    root.querySelectorAll("[style]").forEach(el => {
      el.style.removeProperty("background");
      el.style.removeProperty("background-color");
      el.style.removeProperty("background-image");
      el.style.removeProperty("box-shadow");
      // Drop forced light-on-dark text colours; CSS will set readable colours
      const c = (el.style.color || "").toLowerCase();
      if (c === "white" || c === "#fff" || c === "#ffffff" || c === "rgb(255, 255, 255)") {
        el.style.removeProperty("color");
      }
    });

    // Dedupe: hide in-body heading that equals (or is the stem of) the print title
    if (printTitle) {
      const want = normTitle(printTitle);
      const stem = want.replace(/\s*\([^)]*\)\s*$/, "").trim();
      root.querySelectorAll("h1, h2, h3, h4").forEach(h => {
        const got = normTitle(h.textContent);
        if (!got) return;
        if (got === want || got === stem || want === got || want.startsWith(got) || got.startsWith(stem)) {
          h.remove();
        }
      });
    }

    // Total / net rows: profit = green text, loss = red text on white
    root.querySelectorAll(".pnl-row.grand-total, .grand-total, tr.total-row, .calc-row.grand-total-row").forEach(row => {
      row.classList.remove("rp-loss", "rp-profit");
      const amountEl = row.querySelector("span:last-child, td:last-child, strong:last-child") || row;
      const amountText = amountEl.textContent || "";
      const n = parseAmountish(amountText);
      const looksNeg = /[-−(]/.test(amountText.replace(/₹/g, "")) && /\d/.test(amountText);
      const isLoss = (Number.isFinite(n) && n < 0) || looksNeg;
      const label = (row.textContent || "").toLowerCase();
      if (isLoss) row.classList.add("rp-loss");
      else if (/profit|net cash|net tax|net gst|closing cash|grand total|estimated net/.test(label)) row.classList.add("rp-profit");
    });
  }

  function filterSummaryFromReports() {
    const parts = [];
    const active = document.querySelector("#view-reports .report-panel:not(.d-none)");
    const pill = document.querySelector("#view-reports .reports-tabs .tab-pill.active");
    const title = active?.querySelector("h3")?.textContent?.trim()
      || pill?.textContent?.trim()
      || "Report";
    const month = document.getElementById("gstr-month")?.value;
    if (month && active?.id?.includes("gstr")) parts.push(`Period: ${month}`);
    const day = document.getElementById("daybook-date-picker")?.value;
    const flow = document.getElementById("daybook-flow")?.value;
    if (active?.id === "report-panel-daybook") {
      if (day) parts.push(`Date: ${day}`);
      if (flow && flow !== "ALL") parts.push(`Flow: ${flow}`);
    }
    return { title, filters: parts.join(" · "), key: pill?.getAttribute("data-report") || "report" };
  }

  function filterSummaryFromAccounts() {
    const pill = document.querySelector("#accounts-tabs .tab-pill.active");
    const key = pill?.getAttribute("data-acc") || "accounts";
    const titleMap = {
      chart: "Chart of accounts",
      voucher: "Voucher register",
      ledger: "Party / ledger statement",
      trial: "Trial balance",
      balancesheet: "Balance sheet",
      pnl: "Profit & loss",
      cashflow: "Cash & fund flow",
      brs: "Bank reconciliation",
      cheques: "Cheques",
      outstanding: "Outstanding",
      gst: "GST (books)",
      company: "Company & year"
    };
    const title = titleMap[key] || pill?.textContent?.trim() || "Books report";
    const fy = document.getElementById("accounts-fy-label")?.textContent?.trim() || "";
    const ledgerPick = document.getElementById("acc-ledger-pick");
    const filters = [
      fy,
      ledgerPick ? `Ledger: ${ledgerPick.options[ledgerPick.selectedIndex]?.text || ""}` : ""
    ].filter(Boolean).join(" · ");
    return { title, filters, key };
  }

  function filterSummaryFromPartyLedger() {
    const name = document.getElementById("party-lead-name")?.textContent?.trim() || "Party";
    const gstin = document.getElementById("party-lead-gstin")?.textContent?.trim() || "";
    const period = document.getElementById("party-stmt-period")?.textContent?.trim() || "";
    return {
      title: `Party ledger — ${name}`,
      filters: [gstin, period].filter(Boolean).join(" · "),
      key: "ledger"
    };
  }

  function currentViewName() {
    if (typeof State !== "undefined" && State.currentView) return State.currentView;
    const active = document.querySelector(".view-panel.active");
    return active ? (active.id || "").replace(/^view-/, "") : "";
  }

  function detectReportContext() {
    const view = currentViewName();
    if (view === "reports") {
      const panel = document.querySelector("#view-reports .report-panel:not(.d-none)");
      if (panel) {
        const meta = filterSummaryFromReports();
        return { kind: "reports", source: panel, meta, landscape: WIDE_REPORTS.has(meta.key) };
      }
    }
    if (view === "accounts") {
      const body = document.getElementById("accounts-body");
      if (body && body.innerHTML.trim()) {
        const meta = filterSummaryFromAccounts();
        return { kind: "accounts", source: body, meta, landscape: WIDE_REPORTS.has(meta.key) };
      }
    }
    if (view === "parties") {
      const ledger = document.getElementById("party-ledger-content");
      if (ledger && !ledger.classList.contains("d-none")) {
        const meta = filterSummaryFromPartyLedger();
        const wrap = document.createElement("div");
        const table = ledger.querySelector(".party-ledger-table-wrap, .table-responsive, table");
        const bal = document.getElementById("party-lead-balance");
        wrap.innerHTML = `
          ${bal ? `<p><strong>Balance:</strong> ${esc(bal.textContent)}</p>` : ""}
          ${table ? table.outerHTML : cloneClean(ledger)}
        `;
        return { kind: "party", source: wrap, meta, landscape: true, alreadyHtml: true };
      }
    }
    // Fallback only while on Reports (never steal party/accounts context)
    if (view === "reports") {
      const panel = document.querySelector("#view-reports .report-panel:not(.d-none)");
      if (panel) {
        const meta = filterSummaryFromReports();
        return { kind: "reports", source: panel, meta, landscape: WIDE_REPORTS.has(meta.key) };
      }
    }
    // Party ledger print button may fire while detail is open even if currentView lagged
    const ledger = document.getElementById("party-ledger-content");
    if (ledger && !ledger.classList.contains("d-none") && document.getElementById("view-parties")?.classList.contains("active")) {
      const meta = filterSummaryFromPartyLedger();
      const wrap = document.createElement("div");
      const table = ledger.querySelector(".party-ledger-table-wrap, .table-responsive, table");
      const bal = document.getElementById("party-lead-balance");
      wrap.innerHTML = `
        ${bal ? `<p><strong>Balance:</strong> ${esc(bal.textContent)}</p>` : ""}
        ${table ? table.outerHTML : cloneClean(ledger)}
      `;
      return { kind: "party", source: wrap, meta, landscape: true, alreadyHtml: true };
    }
    return null;
  }

  function buildReportHtml(ctx) {
    const printTitle = (ctx.meta && ctx.meta.title) || "Report";
    let bodyHtml;
    if (ctx.alreadyHtml) {
      const wrap = document.createElement("div");
      wrap.innerHTML = ctx.source.innerHTML;
      sanitizePrintNode(wrap, printTitle);
      bodyHtml = wrap.innerHTML;
    } else {
      bodyHtml = cloneClean(ctx.source, printTitle);
    }
    const landscape = !!ctx.landscape;
    const pageRule = landscape
      ? "@page { size: A4 landscape; margin: 8mm; }"
      : "@page { size: A4 portrait; margin: 10mm; }";
    const tableFs = landscape ? "9.5pt" : "10pt";
    const sheetCss = `
      ${pageRule}
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin: 0; padding: 0; background: #fff !important; color: #111 !important; font-family: "Liberation Sans", Arial, sans-serif; font-size: 11pt; }
      .rp-sheet { background: #fff !important; color: #111 !important; width: 100%; }
      .rp-header { border-bottom: 2px solid #111; padding-bottom: 8px; margin-bottom: 10px; }
      .rp-co-name { font-size: 15pt; font-weight: 700; }
      .rp-co-trade { font-size: 10pt; color: #333; }
      .rp-co-meta, .rp-co-addr { font-size: 9pt; color: #333; margin-top: 2px; }
      .rp-title { font-size: 13pt; font-weight: 700; margin: 0 0 4px; color: #111 !important; }
      .rp-filters { font-size: 9pt; color: #444; margin-bottom: 8px; }
      .rp-body { background: #fff !important; color: #111 !important; }
      .rp-body, .rp-body * {
        background-image: none !important;
        box-shadow: none !important;
        text-shadow: none !important;
      }
      /* Strip every coloured / dark fill from the live UI */
      .rp-body *:not(th):not(.pnl-row.subtotal):not(.pnl-row.grand-total):not(.rp-keep-fill) {
        background: transparent !important;
        background-color: transparent !important;
      }
      .rp-body h3, .rp-body h4 { margin: 8px 0 6px; font-size: 11pt; color: #111 !important; background: transparent !important; }
      .rp-body .text-muted, .rp-body .gstr-code { color: #444 !important; background: transparent !important; }
      .rp-body .gstr-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin: 8px 0 12px; }
      .rp-body .gstr-box, .rp-body .content-card, .rp-body .pnl-breakdown, .rp-body .aging-grid .aging-card {
        background: #fff !important; border: 1px solid #bbb; padding: 8px; color: #111 !important; box-shadow: none !important;
      }
      .rp-body .gstr-box strong, .rp-body .aging-card strong { font-size: 11pt; color: #111 !important; }
      .rp-body .pnl-breakdown { max-width: 100%; }
      .rp-body .pnl-row {
        display: flex; justify-content: space-between; align-items: baseline;
        padding: 6px 8px; margin: 0; border-radius: 0 !important;
        border-bottom: 1px solid #e5e5e5; color: #111 !important;
        background: #fff !important; font-size: 10.5pt; font-weight: 500;
      }
      .rp-body .pnl-row.highlight-green,
      .rp-body .pnl-row.highlight-red,
      .rp-body .pnl-row.highlight-amber {
        background: #fff !important; color: #111 !important;
      }
      .rp-body .pnl-row.subtotal {
        background: #f2f2f2 !important; color: #111 !important; font-weight: 700;
        border-top: 1px solid #999; border-bottom: 1px solid #999;
      }
      .rp-body .pnl-row.grand-total {
        background: #f2f2f2 !important; color: #111 !important;
        font-size: 11.5pt; font-weight: 800;
        border-top: 2px solid #111 !important; border-bottom: none !important;
        margin-top: 4px; padding-top: 8px;
      }
      .rp-body .pnl-row.grand-total.rp-loss,
      .rp-body .pnl-row.grand-total.rp-loss span {
        background: #fff !important; color: #b91c1c !important;
      }
      .rp-body .pnl-row.grand-total.rp-profit,
      .rp-body .pnl-row.grand-total.rp-profit span {
        background: #fff !important; color: #15803d !important;
      }
      .rp-body table {
        width: 100% !important; border-collapse: collapse; table-layout: auto;
        font-size: ${tableFs}; background: #fff !important; color: #111 !important;
      }
      .rp-body thead { display: table-header-group; }
      .rp-body tfoot { display: table-footer-group; }
      .rp-body tr { page-break-inside: avoid; break-inside: avoid; }
      .rp-body th, .rp-body td {
        border: 1px solid #333; padding: 5px 7px; text-align: left; vertical-align: top;
        background: #fff !important; color: #111 !important;
        word-break: break-word; overflow-wrap: anywhere; white-space: normal;
      }
      .rp-body th {
        font-weight: 700; background: #f2f2f2 !important; color: #111 !important;
        font-size: ${tableFs};
      }
      .rp-body td.num, .rp-body th.num, .rp-body td:last-child, .rp-body .text-right { text-align: right; }
      .rp-body tbody tr.total-row td, .rp-body tfoot td {
        font-weight: 700; background: #f2f2f2 !important; color: #111 !important;
        border-top: 2px solid #111;
      }
      .rp-body .table-responsive, .rp-body .party-ledger-table-wrap {
        overflow: visible !important; max-height: none !important; width: 100% !important;
      }
      .rp-body .calc-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #eee; background: #fff !important; color: #111 !important; }
      .rp-body .btn, .rp-body button, .rp-body input, .rp-body select, .rp-body textarea, .rp-body .no-print { display: none !important; }
      .rp-body .badge, .rp-body .badge-status-khata { background: #fff !important; color: #111 !important; border: 1px solid #999; }
      .rp-footer { margin-top: 12px; padding-top: 6px; border-top: 1px solid #999; font-size: 8pt; color: #444; display: flex; justify-content: space-between; }
      @media print {
        html, body { background: #fff !important; }
        .rp-sheet { box-shadow: none !important; }
      }
    `;
    const inner = `
      <div class="rp-sheet${landscape ? " rp-landscape" : ""}">
        ${companyBlock()}
        <h1 class="rp-title">${esc(printTitle)}</h1>
        ${ctx.meta.filters ? `<div class="rp-filters">${esc(ctx.meta.filters)}</div>` : ""}
        <div class="rp-body">${bodyHtml}</div>
        ${generatedFooter()}
      </div>`;
    return { inner, css: sheetCss, landscape, title: printTitle };
  }

  function ensurePrintRoot() {
    let root = document.getElementById("print-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "print-root";
      document.body.appendChild(root);
    }
    return root;
  }

  async function printReportNow() {
    if (typeof beginPrintJob === "function" && !beginPrintJob()) return;
    const ctx = detectReportContext();
    if (!ctx) {
      if (typeof showToast === "function") showToast("Open a report first, then print.", "error");
      return;
    }
    const built = buildReportHtml(ctx);
    const plugin = typeof billPrintPlugin === "function" ? billPrintPlugin() : null;

    if (plugin) {
      try {
        const viewportPx = built.landscape ? 1123 : 794;
        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${viewportPx}, initial-scale=1">
          <title>${esc(built.title)}</title><style>${built.css}</style></head>
          <body class="is-printing is-report-printing">${built.inner}</body></html>`;
        if (typeof dismissPrintOverlays === "function") dismissPrintOverlays();
        await callBillPrintHtml(plugin, {
          html,
          jobName: built.title || "Report",
          widthMm: built.landscape ? 297 : 210,
          heightMm: built.landscape ? 210 : 297
        });
        if (typeof showToast === "function") showToast("Opened the Android print dialog.");
        return;
      } catch (err) {
        console.warn(err);
        if (typeof showToast === "function") showToast("Print dialog failed; trying browser print.", "error");
      }
    }

    const root = ensurePrintRoot();
    // Invoice print may have left a portrait @page — clear it so report landscape can apply.
    if (typeof clearInvoicePrintPageStyle === "function") clearInvoicePrintPageStyle();
    else document.getElementById("invoice-print-page-style")?.remove();
    // Inject a style tag for report print once
    let style = document.getElementById("report-print-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "report-print-style";
      document.head.appendChild(style);
    }
    style.textContent = built.css + `
      @media print {
        body.is-report-printing > *:not(#print-root) { display: none !important; }
        body.is-report-printing #print-root { display: block !important; background: #fff !important; }
      }
      body.is-report-printing #print-root { background: #fff; }
    `;
    root.innerHTML = built.inner;
    document.body.classList.add("is-printing", "is-report-printing");
    document.body.classList.toggle("report-landscape", built.landscape);
    setTimeout(() => {
      const cleanup = () => {
        document.body.classList.remove("is-printing", "is-report-printing", "report-landscape");
        root.innerHTML = "";
        // Remove injected @page (landscape) so invoice/receipt prints stay portrait.
        const st = document.getElementById("report-print-style");
        if (st) st.remove();
        window.removeEventListener("afterprint", cleanup);
        if (typeof restorePrintTitle === "function") restorePrintTitle();
        if (typeof endPrintJob === "function") endPrintJob();
      };
      window.addEventListener("afterprint", cleanup);
      if (typeof setPrintTitle === "function") setPrintTitle(built.title || "Report");
      window.print();
      setTimeout(cleanup, 60_000);
    }, 180);
  }

  /** For tests / PDF capture: return standalone HTML of the current report. */
  function reportStandaloneHtml() {
    const ctx = detectReportContext();
    if (!ctx) return null;
    const built = buildReportHtml(ctx);
    const viewportPx = built.landscape ? 1123 : 794;
    return {
      html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=${viewportPx}, initial-scale=1">
        <title>${esc(built.title)}</title><style>${built.css}</style></head>
        <body class="is-printing is-report-printing">${built.inner}</body></html>`,
      landscape: built.landscape,
      title: built.title
    };
  }

  function wireReportPrintButtons() {
    const wire = (id) => {
      const btn = document.getElementById(id);
      if (!btn || btn.dataset.wired === "1") return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", e => {
        e.preventDefault();
        printReportNow();
      });
    };
    wire("btn-print-report");
    wire("btn-print-party-ledger");
    wire("btn-print-accounts-report");
  }


  /** Drop leftover report @page so a later invoice print cannot inherit landscape. */
  function clearReportPrintStyle() {
    const st = document.getElementById("report-print-style");
    if (st) st.remove();
    document.body.classList.remove("is-report-printing", "report-landscape");
  }

  /**
   * Force document @page for invoice/receipt web print.
   * mode: "a4" | "a5" | "thermal58" | "thermal80"
   */
  function applyInvoicePrintPageStyle(mode) {
    clearReportPrintStyle();
    let el = document.getElementById("invoice-print-page-style");
    if (!el) {
      el = document.createElement("style");
      el.id = "invoice-print-page-style";
      document.head.appendChild(el);
    }
    const m = String(mode || "a4").toLowerCase();
    let pageRule;
    if (m === "a5") pageRule = "@page { size: A5 portrait; margin: 0; }";
    else if (m === "thermal58" || m === "58") pageRule = "@page { size: 58mm auto; margin: 2mm; }";
    else if (m === "thermal80" || m === "80" || m === "thermal") pageRule = "@page { size: 80mm auto; margin: 2mm; }";
    else pageRule = "@page { size: A4 portrait; margin: 0; }"; // 1.13.4: full-page white sheet; the 8mm margin is padding inside the sheet
    el.textContent = pageRule;
    return el;
  }

  function clearInvoicePrintPageStyle() {
    document.getElementById("invoice-print-page-style")?.remove();
  }

  global.printCurrentReport = printReportNow;
  global.reportStandaloneHtml = reportStandaloneHtml;
  global.BillSetuReportPrint = { printReportNow, reportStandaloneHtml, detectReportContext, buildReportHtml, wireReportPrintButtons, clearReportPrintStyle, applyInvoicePrintPageStyle, clearInvoicePrintPageStyle };
  global.clearReportPrintStyle = clearReportPrintStyle;
  global.applyInvoicePrintPageStyle = applyInvoicePrintPageStyle;
  global.clearInvoicePrintPageStyle = clearInvoicePrintPageStyle;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireReportPrintButtons);
  } else {
    wireReportPrintButtons();
  }
})(typeof window !== "undefined" ? window : globalThis);
