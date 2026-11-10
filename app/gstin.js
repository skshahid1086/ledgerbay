/**
 * Offline GSTIN helpers: format + mod-36 checksum, state/PAN autofill.
 * No online lookup — GST portal Search Taxpayer needs a captcha, and no
 * free keyless legitimate API was verified for Ledgerbay.
 */
(function (global) {
  const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  /**
   * THE canonical GST state / UT code list (2-digit) → name. Every state dropdown in the app is
   * built from this map (populateStateSelect / populateAllStateSelects); there are no hard-coded
   * <option> lists anywhere else. Checked against the GST e-way bill / e-invoice master codes
   * (docs.ewaybillgst.gov.in/apidocs/state-code.html, einvoice1.gst.gov.in MasterCodes):
   * 01–24, 26–38 and 97. 25 (Daman & Diu) was merged into 26 from 1 Aug 2020 and is kept only as
   * a legacy alias. 28 is the pre-2014 Andhra Pradesh code (still valid on old GSTINs/returns).
   * 99 (Centre Jurisdiction) is accepted in GSTINs but is not a place of supply, so it is not offered.
   */
  const GST_STATES = {
    "01": "Jammu & Kashmir",
    "02": "Himachal Pradesh",
    "03": "Punjab",
    "04": "Chandigarh",
    "05": "Uttarakhand",
    "06": "Haryana",
    "07": "Delhi",
    "08": "Rajasthan",
    "09": "Uttar Pradesh",
    "10": "Bihar",
    "11": "Sikkim",
    "12": "Arunachal Pradesh",
    "13": "Nagaland",
    "14": "Manipur",
    "15": "Mizoram",
    "16": "Tripura",
    "17": "Meghalaya",
    "18": "Assam",
    "19": "West Bengal",
    "20": "Jharkhand",
    "21": "Odisha",
    "22": "Chhattisgarh",
    "23": "Madhya Pradesh",
    "24": "Gujarat",
    "26": "Dadra & Nagar Haveli and Daman & Diu",
    "27": "Maharashtra",
    "28": "Andhra Pradesh (Before Division)",
    "29": "Karnataka",
    "30": "Goa",
    "31": "Lakshadweep",
    "32": "Kerala",
    "33": "Tamil Nadu",
    "34": "Puducherry",
    "35": "Andaman & Nicobar Islands",
    "36": "Telangana",
    "37": "Andhra Pradesh",
    "38": "Ladakh",
    "97": "Other Territory",
    "99": "Centre Jurisdiction"
  };

  /** Codes offered in every state / place-of-supply dropdown (numeric order). */
  const GST_STATE_CODES = Object.keys(GST_STATES).filter(code => code !== "99").sort();
  /** Retired codes → current code. */
  const LEGACY_STATE_CODES = { "25": "26" };

  function stateName(code) {
    return GST_STATES[normalizeStateCode(code)] || "";
  }

  function nameKey(name) {
    return String(name || "").toLowerCase().replace(/\(.*?\)/g, "").replace(/&/g, "and").replace(/[^a-z]/g, "");
  }

  /**
   * Normalise a stored state to a canonical 2-digit code. Accepts "7", "07", "07|Delhi",
   * legacy "25", or (when the code is missing) a state name such as "Delhi" / "Orissa".
   * Returns "" when it cannot be resolved.
   */
  function normalizeStateCode(code, name) {
    let c = String(code == null ? "" : code).trim();
    if (c.includes("|")) c = c.split("|")[0].trim();
    if (/^\d{1,2}$/.test(c)) c = c.padStart(2, "0");
    if (LEGACY_STATE_CODES[c]) c = LEGACY_STATE_CODES[c];
    if (GST_STATES[c] && c !== "99") return c;
    const key = nameKey(name);
    if (!key) return "";
    const aliases = { orissa: "21", pondicherry: "34", uttaranchal: "05", andamanandnicobar: "35",
      dadraandnagarhaveli: "26", damananddiu: "26", newdelhi: "07", jammuandkashmir: "01" };
    if (aliases[key]) return aliases[key];
    // Prefer the current Andhra Pradesh (37) over the pre-division code (28) for a bare name.
    const hit = GST_STATE_CODES.filter(k => nameKey(GST_STATES[k]) === key).sort((a, b) => (a === "37" ? -1 : b === "37" ? 1 : 0))[0];
    return hit || "";
  }

  /** State code from a GSTIN's first two digits ("" if it is not a known GST state code). */
  function gstinStateCode(raw) {
    const g = String(raw || "").trim().toUpperCase();
    const c = g.slice(0, 2);
    return /^\d{2}$/.test(c) && GST_STATES[c] ? c : "";
  }

  /**
   * Non-blocking check: does the GSTIN prefix disagree with the chosen state?
   * Returns a clear message, or "" when they agree / either is missing.
   */
  function stateMismatchMessage(gstin, chosenCode) {
    const g = gstinStateCode(gstin);
    const c = normalizeStateCode(chosenCode);
    if (!g || !c || g === c) return "";
    return `GSTIN starts with ${g} (${GST_STATES[g]}) but the state selected is ${c} (${GST_STATES[c]}). ` +
      `GST (CGST+SGST vs IGST) is decided by state, so please check which one is right.`;
  }

  const FORMAT_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

  function normalizeGstin(raw) {
    return String(raw || "").trim().toUpperCase().replace(/\s+/g, "");
  }

  /** Official GSTIN check-digit (mod-36 over first 14 characters). */
  function gstinChecksumDigit(first14) {
    const s = String(first14 || "").toUpperCase();
    if (s.length !== 14) return null;
    let factor = 1;
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const code = CHARSET.indexOf(s[i]);
      if (code < 0) return null;
      const product = code * factor;
      sum += Math.floor(product / 36) + (product % 36);
      factor = 3 - factor;
    }
    return CHARSET[(36 - (sum % 36)) % 36];
  }

  function validateGstin(raw) {
    const gstin = normalizeGstin(raw);
    if (!gstin) return { ok: true, empty: true, gstin: "" };
    if (gstin.length < 15) {
      return { ok: false, gstin, reason: "incomplete", message: "GSTIN must be 15 characters." };
    }
    if (gstin.length > 15 || !FORMAT_RE.test(gstin)) {
      return { ok: false, gstin, reason: "format", message: "That GSTIN format is not valid." };
    }
    const expected = gstinChecksumDigit(gstin.slice(0, 14));
    if (!expected || expected !== gstin[14]) {
      return {
        ok: false,
        gstin,
        reason: "checksum",
        expected,
        message: "That GSTIN check digit is wrong. Please re-check the number."
      };
    }
    const stateCode = gstin.slice(0, 2);
    const stateName = GST_STATES[stateCode] || null;
    const pan = gstin.slice(2, 12);
    return { ok: true, gstin, stateCode, stateName, pan };
  }

  function stateOptionValue(code) {
    const name = GST_STATES[code];
    return name ? `${code}|${name}` : null;
  }

  function ensureStateOption(selectEl, code) {
    if (!selectEl || !code) return;
    selectState(selectEl, code);
  }

  function setHint(el, text, kind) {
    if (!el) return;
    el.textContent = text || "";
    el.classList.remove("gstin-hint-ok", "gstin-hint-err", "gstin-hint-info", "gstin-hint-warn");
    if (!text) return;
    el.classList.add(kind === "ok" ? "gstin-hint-ok" : kind === "err" ? "gstin-hint-err" : kind === "warn" ? "gstin-hint-warn" : "gstin-hint-info");
  }

  /**
   * Bind live validation + state/PAN autofill to a GSTIN input.
   * opts: { stateSelect, panInput, hintEl, onValid }
   */
  function bindGstinField(input, opts) {
    if (!input) return null;
    if (input.dataset.gstinBound === "1") return input._gstinRun || null;
    input.dataset.gstinBound = "1";
    opts = opts || {};
    let lastAutofillState = null;
    if (opts.stateSelect && !opts.stateSelect.dataset.gstinStateListen) {
      opts.stateSelect.dataset.gstinStateListen = "1";
      opts.stateSelect.addEventListener("change", () => {
        opts.stateSelect.dataset.userTouched = "1";
        run(false); // re-check: show / clear the GSTIN-vs-state warning
      });
    }
    const run = (fromInput) => {
      const raw = input.value;
      const result = validateGstin(raw);
      if (result.empty) {
        setHint(opts.hintEl, "", "info");
        input.classList.remove("gstin-invalid");
        return result;
      }
      if (!result.ok) {
        if (normalizeGstin(raw).length >= 15) {
          setHint(opts.hintEl, result.message, "err");
          input.classList.add("gstin-invalid");
        } else {
          setHint(opts.hintEl, "Enter the full 15-character GSTIN.", "info");
          input.classList.remove("gstin-invalid");
        }
        return result;
      }
      input.classList.remove("gstin-invalid");
      input.value = result.gstin;
      if (opts.stateSelect && result.stateCode) {
        const curCode = String(opts.stateSelect.value || "").slice(0, 2);
        const userTouched = opts.stateSelect.dataset.userTouched === "1";
        // Autofill state from GSTIN on typing, but do not overwrite a manual state pick on blur.
        if (fromInput || !userTouched || curCode === result.stateCode || curCode === lastAutofillState) {
          ensureStateOption(opts.stateSelect, result.stateCode);
          lastAutofillState = result.stateCode;
          if (fromInput) opts.stateSelect.dataset.userTouched = "";
        }
      }
      if (opts.panInput && result.pan) {
        const cur = (opts.panInput.value || "").trim();
        if (!cur || cur === result.pan) opts.panInput.value = result.pan;
        else if (!opts.panInput.dataset.userTouched) opts.panInput.value = result.pan;
      }
      const label = result.stateName
        ? `Valid · ${result.stateCode} ${result.stateName} · PAN ${result.pan}`
        : `Valid · PAN ${result.pan}`;
      const mismatch = opts.stateSelect ? stateMismatchMessage(result.gstin, opts.stateSelect.value) : "";
      if (mismatch) setHint(opts.hintEl, "⚠ " + mismatch, "warn");
      else setHint(opts.hintEl, label, "ok");
      result.mismatch = mismatch;
      if (typeof opts.onValid === "function") opts.onValid(result);
      return result;
    };
    input._gstinRun = run;
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^0-9A-Z]/g, "").slice(0, 15);
      run(true);
    });
    input.addEventListener("blur", () => run(false));
    if (opts.panInput) {
      opts.panInput.addEventListener("input", () => { opts.panInput.dataset.userTouched = "1"; });
    }
    run(false);
    return run;
  }

  /**
   * Fill a state <select> from the canonical list. Option values are "07|Delhi" by default, or the
   * bare code when the select has data-gst-state="code". opts.suffix(code) adds a label suffix.
   */
  function populateStateSelect(selectEl, preferred, opts) {
    if (!selectEl) return;
    opts = opts || {};
    const codeOnly = (selectEl.dataset && selectEl.dataset.gstState === "code") || opts.format === "code";
    const current = selectEl.value;
    const placeholder = opts.placeholder || "Select state";
    selectEl.innerHTML = `<option value="">${placeholder}</option>` + GST_STATE_CODES.map(code => {
      const name = GST_STATES[code];
      const suffix = typeof opts.suffix === "function" ? (opts.suffix(code) || "") : "";
      const value = codeOnly ? code : `${code}|${name}`;
      return `<option value="${value}">${code} - ${name}${suffix}</option>`;
    }).join("");
    selectEl.dataset.gstPopulated = "1";
    const want = normalizeStateCode(preferred !== undefined && preferred !== null && preferred !== "" ? preferred : current);
    selectEl.value = want ? (codeOnly ? want : `${want}|${GST_STATES[want]}`) : "";
  }

  /** Populate every select[data-gst-state] under root (default: document). */
  function populateAllStateSelects(root) {
    const scope = root || (typeof document !== "undefined" ? document : null);
    if (!scope) return 0;
    const list = scope.querySelectorAll("select[data-gst-state]");
    list.forEach(sel => populateStateSelect(sel, sel.value || ""));
    return list.length;
  }

  /** Select a state in a populated select (value format agnostic). */
  function selectState(selectEl, code) {
    if (!selectEl) return;
    if (selectEl.dataset.gstPopulated !== "1") populateStateSelect(selectEl, "");
    const c = normalizeStateCode(code);
    const codeOnly = selectEl.dataset.gstState === "code";
    selectEl.value = c ? (codeOnly ? c : `${c}|${GST_STATES[c]}`) : "";
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => populateAllStateSelects());
    else populateAllStateSelects();
  }

  global.BillSetuGstin = {
    GST_STATES,
    normalizeGstin,
    gstinChecksumDigit,
    validateGstin,
    bindGstinField,
    GST_STATE_CODES,
    LEGACY_STATE_CODES,
    stateName,
    normalizeStateCode,
    gstinStateCode,
    stateMismatchMessage,
    populateStateSelect,
    populateAllStateSelects,
    selectState,
    stateOptionValue,
    ensureStateOption
  };
})(typeof window !== "undefined" ? window : globalThis);
