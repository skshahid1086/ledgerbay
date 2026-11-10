/**
 * Ledgerbay v20 — per-document-type number series + default print template.
 * Numbers are peeked for new drafts; the counter advances only on successful save.
 * Settings live on State.business.docNumbering / printDefaults (synced with business).
 */
(function (global) {
  "use strict";

  const SERIES_DEFS = [
    { key: "TAX_INVOICE", label: "Sales invoice (GST)", defaultPrefix: "INV", sample: "invoice" },
    { key: "BILL_OF_SUPPLY", label: "Bill of supply", defaultPrefix: "BOS", sample: "invoice" },
    { key: "ESTIMATE", label: "Quotation / estimate", defaultPrefix: "QT", sample: "invoice" },
    { key: "PROFORMA", label: "Proforma invoice", defaultPrefix: "PI", sample: "invoice" },
    { key: "DELIVERY_CHALLAN", label: "Delivery challan", defaultPrefix: "DC", sample: "invoice" },
    { key: "CREDIT_NOTE", label: "Credit note (sales return)", defaultPrefix: "CN", sample: "invoice" },
    { key: "PURCHASE", label: "Purchase bill (our ref)", defaultPrefix: "PUR", sample: "purchase" },
    { key: "PURCHASE_ORDER", label: "Purchase order", defaultPrefix: "PO", sample: "purchaseOrder" },
    { key: "DEBIT_NOTE", label: "Debit note (purchase return)", defaultPrefix: "DN", sample: "debitNote" },
    { key: "RECEIPT", label: "Payment receipt (money in)", defaultPrefix: "RCT", sample: "payment" },
    { key: "PAYMENT", label: "Payment voucher (money out)", defaultPrefix: "PMT", sample: "payment" }
  ];

  const DOC_TYPE_TO_SERIES = {
    TAX_INVOICE: "TAX_INVOICE",
    BILL_OF_SUPPLY: "BILL_OF_SUPPLY",
    ESTIMATE: "ESTIMATE",
    PROFORMA: "PROFORMA",
    DELIVERY_CHALLAN: "DELIVERY_CHALLAN",
    CREDIT_NOTE: "CREDIT_NOTE",
    PURCHASE: "PURCHASE",
    PURCHASE_ORDER: "PURCHASE_ORDER",
    DEBIT_NOTE: "DEBIT_NOTE"
  };

  const PREFIX_TO_SERIES = {
    INV: "TAX_INVOICE",
    BOS: "BILL_OF_SUPPLY",
    QT: "ESTIMATE",
    PI: "PROFORMA",
    DC: "DELIVERY_CHALLAN",
    CN: "CREDIT_NOTE",
    PUR: "PURCHASE",
    PO: "PURCHASE_ORDER",
    DN: "DEBIT_NOTE",
    RCT: "RECEIPT",
    PMT: "PAYMENT",
    POS: "TAX_INVOICE"
  };

  function defaultSeriesCfg(def) {
    return {
      prefix: def.defaultPrefix,
      fyToken: "{FY}", // "", "{FY}"→26-27, "{FYYYY}"→2026-27, "{YY}"→26
      separator: "-",
      padWidth: 4,
      nextNumber: 1,
      resetEachFy: true,
      fyKey: "" // last FY used for reset tracking
    };
  }

  function ensureDocNumbering() {
    const b = (typeof State !== "undefined" && State.business) ? State.business : null;
    if (!b) return { series: {} };
    if (!b.docNumbering || typeof b.docNumbering !== "object") b.docNumbering = { series: {} };
    if (!b.docNumbering.series) b.docNumbering.series = {};
    SERIES_DEFS.forEach(def => {
      const cur = b.docNumbering.series[def.key] || {};
      b.docNumbering.series[def.key] = Object.assign(defaultSeriesCfg(def), cur);
    });
    return b.docNumbering;
  }

  function ensurePrintDefaults() {
    const b = (typeof State !== "undefined" && State.business) ? State.business : null;
    if (!b) return { template: "GOLD", paperSize: "A4", thermalWidth: "80" };
    if (!b.printDefaults || typeof b.printDefaults !== "object") {
      b.printDefaults = { template: "GOLD", paperSize: "A4", thermalWidth: "80" };
    }
    if (!b.printDefaults.template) b.printDefaults.template = "GOLD";
    if (!b.printDefaults.paperSize) b.printDefaults.paperSize = "A4";
    if (!b.printDefaults.thermalWidth) b.printDefaults.thermalWidth = "80";
    return b.printDefaults;
  }

  /** Indian financial year: Apr–Mar. dateIso optional YYYY-MM-DD. */
  function financialYearParts(dateIso) {
    let d;
    if (dateIso && /^\d{4}-\d{2}-\d{2}/.test(dateIso)) {
      const [y, m] = dateIso.split("-").map(Number);
      d = new Date(y, m - 1, 1);
    } else {
      d = new Date();
    }
    const y = d.getFullYear();
    const m = d.getMonth(); // 0-based
    const start = m >= 3 ? y : y - 1;
    const end = start + 1;
    const yyStart = String(start).slice(-2);
    const yyEnd = String(end).slice(-2); // 99 → 00 at century boundary
    return {
      start,
      end,
      // Short form (default {FY}): 26-27, 99-00
      fy: `${yyStart}-${yyEnd}`,
      // Long form ({FYYYY}): 2026-27
      fyyyy: `${start}-${yyEnd}`,
      yy: yyStart,
      key: `${start}-${end}`,
      label: `${yyStart}-${yyEnd}`
    };
  }

  function seriesForDocType(docType) {
    return DOC_TYPE_TO_SERIES[docType] || "TAX_INVOICE";
  }

  function seriesForPrefix(prefix) {
    return PREFIX_TO_SERIES[String(prefix || "").toUpperCase()] || "TAX_INVOICE";
  }

  function getSeriesCfg(seriesKey) {
    const dn = ensureDocNumbering();
    return dn.series[seriesKey] || defaultSeriesCfg(SERIES_DEFS.find(s => s.key === seriesKey) || SERIES_DEFS[0]);
  }

  function maybeResetForFy(cfg, dateIso) {
    if (!cfg.resetEachFy) return cfg;
    const fy = financialYearParts(dateIso);
    if (cfg.fyKey && cfg.fyKey !== fy.key) {
      cfg.nextNumber = 1;
      cfg.fyKey = fy.key;
    } else if (!cfg.fyKey) {
      cfg.fyKey = fy.key;
    }
    return cfg;
  }

  function buildNumber(cfg, dateIso, numberOverride) {
    const fy = financialYearParts(dateIso);
    const prefix = String(cfg.prefix || "").trim();
    const sep = cfg.separator == null ? "-" : String(cfg.separator);
    const pad = Math.max(1, Math.min(8, Number(cfg.padWidth) || 4));
    const n = Math.max(1, Number(numberOverride != null ? numberOverride : cfg.nextNumber) || 1);
    const num = String(n).padStart(pad, "0");
    const parts = [];
    if (prefix) parts.push(prefix);
    if (cfg.fyToken === "{FY}") parts.push(fy.fy);
    else if (cfg.fyToken === "{FYYYY}") parts.push(fy.fyyyy);
    else if (cfg.fyToken === "{YY}") parts.push(fy.yy);
    parts.push(num);
    return parts.join(sep);
  }

  /** Preview without mutating counter. */
  function previewNextNumber(seriesKey, dateIso) {
    ensureDocNumbering();
    const cfg = Object.assign({}, getSeriesCfg(seriesKey));
    maybeResetForFy(cfg, dateIso);
    return buildNumber(cfg, dateIso);
  }

  /**
   * Peek next number for a draft (no increment). Compatible with legacy nextDocNo(prefix).
   */
  function peekNextDocNo(prefixOrSeries, dateIso) {
    const key = SERIES_DEFS.some(s => s.key === prefixOrSeries)
      ? prefixOrSeries
      : seriesForPrefix(prefixOrSeries);
    return previewNextNumber(key, dateIso);
  }

  /**
   * After a successful save: if the saved number matches the peeked next (or uses this series),
   * advance nextNumber. Always keep nextNumber > any trailing digits already used in this series.
   */
  function commitDocNumber(seriesKey, usedNumber, dateIso) {
    ensureDocNumbering();
    const cfg = getSeriesCfg(seriesKey);
    maybeResetForFy(cfg, dateIso);
    const used = String(usedNumber || "");
    const match = used.match(/(\d+)\s*$/);
    const usedN = match ? Number(match[1]) : 0;
    const expected = buildNumber(cfg, dateIso);
    // Advance so next peek is above this number
    const next = Math.max(Number(cfg.nextNumber) || 1, usedN + 1);
    // If they used the expected next (or higher), bump past it
    cfg.nextNumber = next;
    const fy = financialYearParts(dateIso);
    cfg.fyKey = fy.key;
    const dn = ensureDocNumbering();
    dn.series[seriesKey] = cfg;
    if (typeof State !== "undefined" && State.business) {
      State.business.docNumbering = dn;
      State.business.updatedAt = Date.now();
    }
    return cfg;
  }

  function isDuplicateInvoiceNo(invoiceNo, excludeId) {
    const needle = String(invoiceNo || "").trim().toLowerCase();
    if (!needle || typeof State === "undefined") return false;
    return (State.invoices || []).some(inv =>
      inv.id !== excludeId && String(inv.invoiceNo || "").toLowerCase() === needle
    );
  }

  function isDuplicateReceiptNo(receiptNo, excludeId) {
    const needle = String(receiptNo || "").trim().toLowerCase();
    if (!needle || typeof State === "undefined") return false;
    return (State.payments || []).some(p =>
      p.id !== excludeId && String(p.receiptNo || "").toLowerCase() === needle
    );
  }

  /* ---------- Settings UI ---------- */

  function renderNumberingSettings() {
    const host = document.getElementById("doc-numbering-list");
    if (!host) return;
    ensureDocNumbering();
    const dateIso = new Date().toISOString().slice(0, 10);
    host.innerHTML = SERIES_DEFS.map(def => {
      const cfg = getSeriesCfg(def.key);
      const preview = previewNextNumber(def.key, dateIso);
      return `
        <div class="doc-series-card" data-series="${def.key}">
          <div class="doc-series-head">
            <strong>${esc(def.label)}</strong>
            <span class="doc-series-preview" data-preview="${def.key}">Next: ${esc(preview)}</span>
          </div>
          <div class="form-row doc-series-row">
            <div class="form-group col-3">
              <label>Prefix</label>
              <input type="text" class="form-control dn-prefix" data-series="${def.key}" value="${escAttr(cfg.prefix)}" maxlength="12">
            </div>
            <div class="form-group col-3">
              <label>Year</label>
              <select class="form-control dn-fy" data-series="${def.key}">
                <option value="" ${!cfg.fyToken ? "selected" : ""}>None</option>
                <option value="{FY}" ${cfg.fyToken === "{FY}" ? "selected" : ""}>{FY} 26-27</option>
                <option value="{FYYYY}" ${cfg.fyToken === "{FYYYY}" ? "selected" : ""}>{FYYYY} 2026-27</option>
                <option value="{YY}" ${cfg.fyToken === "{YY}" ? "selected" : ""}>{YY} 26</option>
              </select>
            </div>
            <div class="form-group col-2">
              <label>Separator</label>
              <input type="text" class="form-control dn-sep" data-series="${def.key}" value="${escAttr(cfg.separator)}" maxlength="3">
            </div>
            <div class="form-group col-2">
              <label>Digits</label>
              <input type="number" class="form-control dn-pad" data-series="${def.key}" min="1" max="8" value="${Number(cfg.padWidth) || 4}">
            </div>
            <div class="form-group col-2">
              <label>Next no.</label>
              <input type="number" class="form-control dn-next" data-series="${def.key}" min="1" value="${Number(cfg.nextNumber) || 1}">
            </div>
          </div>
          <label class="radio-label dn-reset-label">
            <input type="checkbox" class="dn-reset" data-series="${def.key}" ${cfg.resetEachFy ? "checked" : ""}>
            Reset counter each financial year (1 Apr)
          </label>
        </div>`;
    }).join("");

    host.querySelectorAll("input, select").forEach(el => {
      el.addEventListener("input", () => refreshSeriesPreview(el.dataset.series));
      el.addEventListener("change", () => refreshSeriesPreview(el.dataset.series));
    });
  }

  function readSeriesFromUi(seriesKey) {
    const card = document.querySelector(`.doc-series-card[data-series="${seriesKey}"]`);
    if (!card) return getSeriesCfg(seriesKey);
    const fy = financialYearParts(new Date().toISOString().slice(0, 10));
    const prev = getSeriesCfg(seriesKey);
    return {
      prefix: card.querySelector(".dn-prefix")?.value.trim() || "",
      fyToken: card.querySelector(".dn-fy")?.value || "",
      separator: card.querySelector(".dn-sep")?.value ?? "-",
      padWidth: Math.max(1, Math.min(8, Number(card.querySelector(".dn-pad")?.value) || 4)),
      nextNumber: Math.max(1, Number(card.querySelector(".dn-next")?.value) || 1),
      resetEachFy: !!card.querySelector(".dn-reset")?.checked,
      // Stamp current FY on explicit Settings save so maybeResetForFy cannot
      // treat a blank fyKey as a rollover and wipe the user's Next value.
      fyKey: prev.fyKey || fy.key
    };
  }

  function refreshSeriesPreview(seriesKey) {
    if (!seriesKey) {
      SERIES_DEFS.forEach(d => refreshSeriesPreview(d.key));
      return;
    }
    const cfg = readSeriesFromUi(seriesKey);
    const preview = buildNumber(cfg, new Date().toISOString().slice(0, 10));
    const el = document.querySelector(`[data-preview="${seriesKey}"]`);
    if (el) el.textContent = `Next: ${preview}`;
  }

  function saveNumberingFromSettings() {
    ensureDocNumbering();
    const dn = ensureDocNumbering();
    SERIES_DEFS.forEach(def => {
      dn.series[def.key] = readSeriesFromUi(def.key);
    });
    if (typeof State !== "undefined" && State.business) {
      State.business.docNumbering = dn;
    }
  }

  function renderDefaultTemplatePicker() {
    const host = document.getElementById("default-template-picker");
    if (!host) return;
    const defs = ensurePrintDefaults();
    const themes = (typeof INVOICE_THEMES !== "undefined" ? INVOICE_THEMES : []).map(t => {
      if (t.id === "A4_GST") return Object.assign({}, t, { name: "Classic Full Page", blurb: "GST A4 sheet" });
      return t;
    });
    const swatch = { GOLD: "#C4A35A", CLASSIC: "#1C2E4A", SIMPLE: "#0F766E", A4_GST: "#334155", THERMAL: "#0F172A", THERMAL_80: "#44403C" };
    host.innerHTML = themes.map(theme => `
      <button type="button" class="theme-card default-tpl-card ${defs.template === theme.id ? "active" : ""}" data-template="${theme.id}" aria-pressed="${defs.template === theme.id}">
        <span class="theme-swatch" style="background:${swatch[theme.id] || "#0F766E"}" aria-hidden="true"></span>
        <span class="thumb thumb-${theme.id.toLowerCase()}" aria-hidden="true"></span>
        <span class="theme-name">${esc(theme.name)}</span>
        <span class="theme-paper">${esc(theme.paper)}</span>
      </button>`).join("");
    host.querySelectorAll(".default-tpl-card").forEach(btn => {
      btn.addEventListener("click", () => {
        const pd = ensurePrintDefaults();
        pd.template = btn.dataset.template;
        host.querySelectorAll(".default-tpl-card").forEach(b => {
          b.classList.toggle("active", b === btn);
          b.setAttribute("aria-pressed", b === btn ? "true" : "false");
        });
        const sizeWrap = document.getElementById("set-default-size-wrap");
        const paperWrap = document.getElementById("set-default-paper-wrap");
        if (sizeWrap) sizeWrap.classList.toggle("d-none", pd.template !== "SIMPLE");
        if (paperWrap) paperWrap.classList.toggle("d-none", !(pd.template === "THERMAL" || pd.template === "THERMAL_80"));
      });
    });
    const sizeSel = document.getElementById("set-default-paper-size");
    const thermSel = document.getElementById("set-default-thermal-width");
    if (sizeSel) sizeSel.value = defs.paperSize || "A4";
    if (thermSel) thermSel.value = String(defs.thermalWidth || "80");
    const sizeWrap = document.getElementById("set-default-size-wrap");
    const paperWrap = document.getElementById("set-default-paper-wrap");
    if (sizeWrap) sizeWrap.classList.toggle("d-none", defs.template !== "SIMPLE");
    if (paperWrap) paperWrap.classList.toggle("d-none", !(defs.template === "THERMAL" || defs.template === "THERMAL_80"));
  }

  function savePrintDefaultsFromSettings() {
    const pd = ensurePrintDefaults();
    const active = document.querySelector("#default-template-picker .default-tpl-card.active");
    if (active) pd.template = active.dataset.template;
    const sizeSel = document.getElementById("set-default-paper-size");
    const thermSel = document.getElementById("set-default-thermal-width");
    if (sizeSel) pd.paperSize = sizeSel.value || "A4";
    if (thermSel) pd.thermalWidth = thermSel.value || "80";
    if (typeof State !== "undefined" && State.business) State.business.printDefaults = pd;
  }

  function applyDefaultTemplateToPrintUi() {
    const pd = ensurePrintDefaults();
    const tpl = document.getElementById("print-template-select");
    const size = document.getElementById("print-size-select");
    const paper = document.getElementById("print-paper-select");
    if (tpl && pd.template) tpl.value = pd.template;
    if (size && pd.paperSize) size.value = pd.paperSize;
    if (paper && pd.thermalWidth) paper.value = String(pd.thermalWidth);
  }

  function setAsDefaultFromPrintModal() {
    const pd = ensurePrintDefaults();
    pd.template = document.getElementById("print-template-select")?.value || pd.template;
    pd.paperSize = document.getElementById("print-size-select")?.value || pd.paperSize;
    pd.thermalWidth = document.getElementById("print-paper-select")?.value || pd.thermalWidth;
    if (typeof State !== "undefined" && State.business) {
      State.business.printDefaults = pd;
      State.business.updatedAt = Date.now();
    }
    if (typeof saveToStorage === "function") saveToStorage();
    if (typeof showToast === "function") showToast("Default print template updated.");
  }

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  function escAttr(s) { return esc(s); }

  /**
   * After sync merge: ensure nextNumber is past the highest trailing digits
   * already used in documents for this series. No-op when already ahead.
   */
  function bumpSeriesPastMax(seriesKey, usedNumbers) {
    ensureDocNumbering();
    const cfg = getSeriesCfg(seriesKey);
    let max = 0;
    (usedNumbers || []).forEach(no => {
      const m = String(no || "").match(/(\d+)\s*$/);
      if (m) max = Math.max(max, Number(m[1]));
    });
    if (max >= (Number(cfg.nextNumber) || 1)) {
      cfg.nextNumber = max + 1;
      const dn = ensureDocNumbering();
      dn.series[seriesKey] = cfg;
      if (typeof State !== "undefined" && State.business) {
        State.business.docNumbering = dn;
        State.business.updatedAt = Date.now();
      }
    }
    return cfg.nextNumber;
  }

  /**
   * When sync is connected, ask the server to atomically reserve the next
   * counter for this series. Returns the reserved formatted number, or null
   * if offline / unavailable (caller falls back to local peek/commit).
   */
  async function reserveOnServer(seriesKey, dateIso) {
    try {
      if (typeof BillSetuSync === "undefined" || !BillSetuSync.loadSyncConfig) return null;
      const cfg = BillSetuSync.loadSyncConfig();
      if (!cfg.enabled || !cfg.url || !cfg.passcode) return null;
      ensureDocNumbering();
      const seriesCfg = Object.assign({}, getSeriesCfg(seriesKey));
      maybeResetForFy(seriesCfg, dateIso);
      const base = String(cfg.url).replace(/\/+$/, "");
      const companyId = (typeof BillSetuSync.activeCompanyId === "function")
        ? BillSetuSync.activeCompanyId()
        : (JSON.parse(localStorage.getItem("billsetu_registry_v1") || "{}").activeId || "co-main");
      const res = await fetch(base + "/api/reserve-number", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-BillSetu-Passcode": cfg.passcode
        },
        body: JSON.stringify({
          passcode: cfg.passcode,
          companyId,
          seriesKey,
          deviceId: cfg.deviceId || "",
          // Hint: local next — server takes max(server, hint)
          hintNext: Number(seriesCfg.nextNumber) || 1,
          prefix: seriesCfg.prefix,
          fyToken: seriesCfg.fyToken,
          separator: seriesCfg.separator,
          padWidth: seriesCfg.padWidth,
          dateIso: dateIso || new Date().toISOString().slice(0, 10)
        })
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || !data.ok || data.number == null) return null;
      // Align local counter past reserved
      const cfgLocal = getSeriesCfg(seriesKey);
      cfgLocal.nextNumber = Math.max(Number(cfgLocal.nextNumber) || 1, Number(data.nextNumber) || (Number(data.number) + 1));
      const fy = financialYearParts(dateIso);
      cfgLocal.fyKey = fy.key;
      const dn = ensureDocNumbering();
      dn.series[seriesKey] = cfgLocal;
      if (typeof State !== "undefined" && State.business) {
        State.business.docNumbering = dn;
        State.business.updatedAt = Date.now();
      }
      if (data.formatted) return data.formatted;
      return buildNumber(Object.assign({}, cfgLocal, { nextNumber: data.number }), dateIso, data.number);
    } catch (_) {
      return null;
    }
  }

  // Legacy-compatible nextDocNo: peek only (no increment).
  function nextDocNo(prefix) {
    return peekNextDocNo(prefix);
  }

  global.BillSetuDocNumbering = {
    SERIES_DEFS,
    ensureDocNumbering,
    ensurePrintDefaults,
    financialYearParts,
    fyLabel: (dateIso) => financialYearParts(dateIso).label,
    seriesForDocType,
    seriesForPrefix,
    previewNextNumber,
    peekNextDocNo,
    commitDocNumber,
    isDuplicateInvoiceNo,
    isDuplicateReceiptNo,
    renderNumberingSettings,
    saveNumberingFromSettings,
    renderDefaultTemplatePicker,
    savePrintDefaultsFromSettings,
    applyDefaultTemplateToPrintUi,
    setAsDefaultFromPrintModal,
    refreshSeriesPreview,
    bumpSeriesPastMax,
    reserveOnServer,
    buildNumber,
    getSeriesCfg,
    nextDocNo
  };
  global.nextDocNo = nextDocNo;
})(typeof window !== "undefined" ? window : globalThis);
