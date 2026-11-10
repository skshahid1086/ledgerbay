/**
 * Cash & Bank — myBillBook-style accounts on top of Books ledgers.
 * A bank account IS a ledger in g-bank (or Cash in Hand in g-cash).
 * No parallel money system: balances, BRS, cashflow and Balance Sheet stay on Books.
 */
(function (global) {
  const LAST_ACCOUNT_KEY = "billsetu_last_account_id";
  let selectedAccountId = "l-cash";

  function ensureBankAccountsArray() {
    if (!Array.isArray(State.bankAccounts)) State.bankAccounts = [];
  }

  /** Stamp a record as changed so sync (last write wins on updatedAt) sends it. */
  function stamp(rec) {
    if (!rec || typeof rec !== "object") return rec;
    if (global.BillSetuSync && typeof global.BillSetuSync.markUpdated === "function") global.BillSetuSync.markUpdated(rec);
    else rec.updatedAt = Date.now();
    return rec;
  }

  /**
   * The one persist path for Cash & Bank (BUG-V21.2-02). saveToStorage() is the real app save
   * (app.js), wrapped by books.js (syncAccounting + company mirror) and sync.js (auto-sync).
   * Throws loudly in dev if it is ever missing instead of silently dropping the change.
   */
  function persistCashBank() {
    const save = global.saveToStorage || (typeof saveToStorage === "function" ? saveToStorage : null);
    if (typeof save !== "function") {
      console.error("[cash-bank] saveToStorage missing: change NOT saved");
      showToast?.("Could not save. Please try again.", "error");
      return false;
    }
    save();
    return true;
  }

  function todayISO() {
    const d = new Date();
    const z = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
  }

  function money(n) {
    return typeof formatINR === "function" ? formatINR(n) : `₹${(Number(n) || 0).toFixed(2)}`;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function ledgerBalance(ledgerId) {
    if (typeof ledgerNetPaise === "function") return ledgerNetPaise(ledgerId) / 100;
    const led = (State.accounts?.ledgers || []).find(l => l.id === ledgerId);
    if (!led) return 0;
    let paise = Math.round((Number(led.opening) || 0) * 100) * (led.openingDr === false ? -1 : 1);
    (State.accounts?.vouchers || []).forEach(v => {
      (v.lines || []).forEach(line => {
        if (line.ledgerId !== ledgerId) return;
        paise += Math.round((Number(line.dr) || 0) * 100) - Math.round((Number(line.cr) || 0) * 100);
      });
    });
    return paise / 100;
  }

  function cashBankAccounts() {
    ensureBankAccountsArray();
    if (!State.accounts?.ledgers) return [];
    const ledgers = (State.accounts?.ledgers || []).filter(l =>
      l.groupId === "g-bank" || l.groupId === "g-cash" || l.id === "l-cash" || l.id === "l-bank"
    );
    // Prefer bankAccounts meta merged onto ledgers
    return ledgers.map(l => {
      const meta = State.bankAccounts.find(a => a.id === l.id) || {};
      return Object.assign({}, l, meta, {
        id: l.id,
        name: meta.displayName || meta.name || l.name,
        displayName: meta.displayName || l.name,
        groupId: l.groupId,
        isCash: l.id === "l-cash" || l.groupId === "g-cash",
        opening: l.opening,
        openingDr: l.openingDr,
        openingAsOf: meta.openingAsOf || l.openingAsOf || "",
        bankName: meta.bankName || l.bankName || "",
        accountHolder: meta.accountHolder || l.accountHolder || "",
        accountNo: meta.accountNo || l.accountNo || "",
        ifsc: meta.ifsc || l.ifsc || "",
        branch: meta.branch || l.branch || "",
        upiId: meta.upiId || l.upiId || "",
        showOnInvoice: !!(meta.showOnInvoice ?? l.showOnInvoice),
        isDefault: !!(meta.isDefault ?? l.isDefault),
        system: !!l.system
      });
    }).sort((a, b) => {
      if (a.isCash && !b.isCash) return -1;
      if (!a.isCash && b.isCash) return 1;
      if (a.isDefault && !b.isDefault) return -1;
      return String(a.displayName).localeCompare(String(b.displayName));
    });
  }

  function defaultBankAccount() {
    const all = cashBankAccounts().filter(a => !a.isCash && !a.inactive);
    return all.find(a => a.isDefault) || all[0] || null;
  }

  function invoiceBankAccount() {
    const all = cashBankAccounts().filter(a => !a.isCash && !a.inactive);
    return all.find(a => a.showOnInvoice) || defaultBankAccount();
  }

  function defaultAccountIdForMode(mode) {
    const m = String(mode || "").toUpperCase();
    if (m === "CASH" || m === "CREDIT" || m === "") return "l-cash";
    try {
      const last = localStorage.getItem(LAST_ACCOUNT_KEY);
      if (last && last !== "l-cash" && cashBankAccounts().some(a => a.id === last && !a.isCash)) return last;
    } catch (_) {}
    const def = defaultBankAccount();
    return def?.id || "l-bank";
  }

  function rememberAccountId(id) {
    if (!id) return;
    try { localStorage.setItem(LAST_ACCOUNT_KEY, id); } catch (_) {}
  }

  function syncBankAccountToLedger(acc) {
    if (!State.accounts) State.accounts = { groups: [], ledgers: [], vouchers: [] };
    if (!Array.isArray(State.accounts.ledgers)) State.accounts.ledgers = [];
    let led = State.accounts.ledgers.find(l => l.id === acc.id);
    if (!led) {
      led = {
        id: acc.id,
        name: acc.displayName || acc.name || "Bank",
        groupId: acc.isCash ? "g-cash" : "g-bank",
        opening: Number(acc.opening) || 0,
        openingDr: true,
        system: !!acc.system,
        bankName: acc.bankName || "",
        accountHolder: acc.accountHolder || "",
        accountNo: acc.accountNo || "",
        ifsc: acc.ifsc || "",
        branch: acc.branch || "",
        upiId: acc.upiId || "",
        showOnInvoice: !!acc.showOnInvoice,
        isDefault: !!acc.isDefault,
        openingAsOf: acc.openingAsOf || "",
        updatedAt: Date.now()
      };
      State.accounts.ledgers.push(led);
    } else {
      const before = JSON.stringify(led);
      led.name = acc.displayName || acc.name || led.name;
      led.groupId = acc.isCash ? "g-cash" : "g-bank";
      if (acc.opening != null) led.opening = Number(acc.opening) || 0;
      led.openingDr = true;
      led.bankName = acc.bankName || "";
      led.accountHolder = acc.accountHolder || "";
      led.accountNo = acc.accountNo || "";
      led.ifsc = acc.ifsc || "";
      led.branch = acc.branch || "";
      led.upiId = acc.upiId || "";
      led.showOnInvoice = !!acc.showOnInvoice;
      led.isDefault = !!acc.isDefault;
      led.openingAsOf = acc.openingAsOf || "";
      if (JSON.stringify(led) !== before) led.updatedAt = Date.now();
    }
    // Mirror into bankAccounts collection
    ensureBankAccountsArray();
    const idx = State.bankAccounts.findIndex(a => a.id === acc.id);
    const rec = {
      id: acc.id,
      ledgerId: acc.id,
      displayName: acc.displayName || acc.name,
      name: acc.displayName || acc.name,
      bankName: acc.bankName || "",
      accountHolder: acc.accountHolder || "",
      accountNo: acc.accountNo || "",
      ifsc: acc.ifsc || "",
      branch: acc.branch || "",
      upiId: acc.upiId || "",
      opening: Number(acc.opening) || 0,
      openingAsOf: acc.openingAsOf || "",
      showOnInvoice: !!acc.showOnInvoice,
      isDefault: !!acc.isDefault,
      isCash: !!acc.isCash
    };
    if (idx >= 0) {
      const prev = State.bankAccounts[idx];
      const merged = Object.assign({}, prev, rec);
      const changed = Object.keys(rec).some(k => JSON.stringify(prev[k]) !== JSON.stringify(rec[k]));
      merged.updatedAt = changed || !prev.updatedAt ? Date.now() : prev.updatedAt;
      State.bankAccounts[idx] = merged;
    } else {
      rec.updatedAt = Date.now();
      State.bankAccounts.push(rec);
    }
    return led;
  }

  const bankHasDetails = a => !!(a && (String(a.bankName || "").trim() || String(a.accountNo || "").trim() || String(a.ifsc || "").trim()));

  /** Clear showOnInvoice / isDefault on every bank account and bank ledger except keepId. */
  function clearBankFlags(keepId, inv, def) {
    const fix = rec => {
      let ch = false;
      if (inv && rec.showOnInvoice) { rec.showOnInvoice = false; ch = true; }
      if (def && rec.isDefault) { rec.isDefault = false; ch = true; }
      if (ch) stamp(rec);
    };
    (State.bankAccounts || []).forEach(a => { if (a.id !== keepId) fix(a); });
    (State.accounts?.ledgers || []).forEach(l => { if (l.id !== keepId && l.groupId === "g-bank") fix(l); });
  }

  /**
   * 1.13.11: keep exactly one show-on-invoice and one default bank account. When several are
   * flagged, keep the one with bank details (newest edit first), so a book where an empty
   * account took over the invoice prints its real Bank Name / IFSC / A/c No again.
   * Flags only; no account is renamed, emptied or deleted.
   */
  function normalizeBankFlags() {
    ensureBankAccountsArray();
    const inactive = new Set((State.accounts?.ledgers || []).filter(l => l.inactive).map(l => l.id));
    const banks = State.bankAccounts.filter(a => a.id !== "l-cash" && !a.isCash && !inactive.has(a.id));
    if (!banks.length) return false;
    const rank = (a, b) => (bankHasDetails(b) - bankHasDetails(a)) || ((Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
    const syncLedger = a => {
      const l = (State.accounts?.ledgers || []).find(x => x.id === a.id);
      if (l && (!!l.showOnInvoice !== !!a.showOnInvoice || !!l.isDefault !== !!a.isDefault)) {
        l.showOnInvoice = !!a.showOnInvoice; l.isDefault = !!a.isDefault; stamp(l);
      }
    };
    let changed = false;
    for (const key of ["showOnInvoice", "isDefault"]) {
      const flagged = banks.filter(a => a[key]).sort(rank);
      let keep = flagged[0];
      if (!keep) {
        keep = (key === "showOnInvoice" ? banks.find(a => a.isDefault) : null) || banks.slice().sort(rank)[0];
        keep[key] = true; stamp(keep); changed = true;
      }
      for (const a of banks) if (a !== keep && a[key]) { a[key] = false; stamp(a); changed = true; }
      // inactive / ledger-only rows never carry the flag
      (State.bankAccounts || []).forEach(a => { if (a.id !== keep.id && a[key] && (inactive.has(a.id) || a.isCash)) { a[key] = false; stamp(a); changed = true; } });
    }
    banks.forEach(syncLedger);
    (State.accounts?.ledgers || []).forEach(l => {
      if (l.groupId === "g-bank" && !banks.some(a => a.id === l.id) && (l.showOnInvoice || l.isDefault)) {
        l.showOnInvoice = false; l.isDefault = false; stamp(l); changed = true;
      }
    });
    return changed;
  }

  let _migratingBank = false;
  function migrateSettingsBankToAccount() {
    if (_migratingBank) return;
    _migratingBank = true;
    try {
    ensureBankAccountsArray();
    if (!State.accounts) return;
    if (typeof ensureSystemLedger !== "function") return;
    const cash = ensureSystemLedger("l-cash", "Cash in Hand", "g-cash");
    cash.name = "Cash in Hand";
    syncBankAccountToLedger({
      id: "l-cash",
      displayName: "Cash in Hand",
      isCash: true,
      opening: cash.opening || 0,
      system: true
    });

    let bank = State.accounts.ledgers.find(l => l.id === "l-bank");
    if (!bank) bank = ensureSystemLedger("l-bank", "Bank", "g-bank");
    const b = State.business || {};
    // 1.13.11 (BUG-V21.9-BANK): the legacy Settings → bank migration runs exactly once per book.
    // A persistent flag on the synced business record stops it, and it only ever fills a
    // pristine built-in l-bank (no details, never renamed) in a book with no user bank accounts.
    // It never renames or alters an account the user has set up.
    if (!b.bankSettingsMigrated && State.business) {
      const hasSettingsBank = !!(b.bankName || b.bankAcc || b.bankIfsc);
      const lbRec = State.bankAccounts.find(a => a.id === "l-bank") || {};
      const hasDetails = a => !!(a && (a.bankName || a.accountNo || a.ifsc));
      const lbankPristine = !hasDetails(lbRec) && !hasDetails(bank)
        && /^(bank)?$/i.test(String(lbRec.displayName || lbRec.name || bank.name || "Bank").trim());
      const otherUserBanks = State.bankAccounts.some(a => a.id !== "l-bank" && a.id !== "l-cash" && !a.isCash);
      let ran = false;
      if (hasSettingsBank && lbankPristine && !otherUserBanks) {
        const display = b.bankName ? `${b.bankName}${b.bankAcc ? " ···" + String(b.bankAcc).slice(-4) : ""}` : "Bank Account";
        clearBankFlags("l-bank", true, true);
        syncBankAccountToLedger({
          id: "l-bank",
          displayName: display,
          bankName: b.bankName || "",
          accountHolder: b.name || "",
          accountNo: b.bankAcc || "",
          ifsc: b.bankIfsc || "",
          branch: b.bankBranch || "",
          upiId: lbRec.upiId || bank.upiId || "",
          opening: bank.opening || 0,
          openingAsOf: State.accounts?.fyStart || "",
          showOnInvoice: true,
          isDefault: true,
          isCash: false,
          system: true
        });
        ran = true;
      }
      State.business.bankSettingsMigrated = true;
      // Stamp the business record when the migration changed data so the flag syncs with it;
      // otherwise the flag rides along with the next business save (a sync merge keeps local keys).
      if (ran) stamp(State.business);
    }
    // Ensure l-bank exists in bankAccounts (no details, no rename)
    if (!State.bankAccounts.some(a => a.id === "l-bank")) {
      syncBankAccountToLedger({
        id: "l-bank",
        displayName: bank.name || "Bank",
        bankName: bank.bankName || "",
        accountHolder: bank.accountHolder || "",
        accountNo: bank.accountNo || "",
        ifsc: bank.ifsc || "",
        branch: bank.branch || "",
        upiId: bank.upiId || "",
        opening: bank.opening || 0,
        openingAsOf: bank.openingAsOf || "",
        showOnInvoice: !!bank.showOnInvoice || !cashBankAccounts().some(a => a.showOnInvoice && !a.isCash),
        isDefault: !!bank.isDefault || !cashBankAccounts().some(a => a.isDefault && !a.isCash),
        isCash: false,
        system: true
      });
    }
    // Exactly one default and one show-on-invoice bank account (repairs books hit by the old re-run).
    normalizeBankFlags();
    // One-time: fix bank-account copies holding a stale Settings VPA (BUG-V21.1-01).
    if (typeof migrateUpiVpaOnce === "function") migrateUpiVpaOnce();
    } finally { _migratingBank = false; }
  }

  function fillAccountSelect(selectEl, { mode, selectedId, includeCash = true } = {}) {
    if (!selectEl) return;
    const accounts = cashBankAccounts().filter(a => includeCash || !a.isCash);
    const prefer = selectedId || defaultAccountIdForMode(mode);
    selectEl.innerHTML = accounts.map(a =>
      `<option value="${esc(a.id)}" ${a.id === prefer ? "selected" : ""}>${esc(a.displayName || a.name)}${a.isDefault && !a.isCash ? " (default)" : ""}</option>`
    ).join("");
  }

  function updateReceivedInVisibility() {
    const group = document.getElementById("inv-account-group");
    const amtEl = document.getElementById("inv-amount-received");
    const mode = document.querySelector('input[name="inv-pay-mode"]:checked')?.value || "UPI";
    const amt = Number(amtEl?.value) || 0;
    if (!group) return;
    const show = amt > 0 && mode !== "CREDIT";
    group.classList.toggle("d-none", !show);
    if (show) {
      const sel = document.getElementById("inv-account-id");
      const current = sel?.value || "";
      const prefer = defaultAccountIdForMode(mode);
      const m = String(mode || "").toUpperCase();
      const currentIsCash = current === "l-cash";
      const wantCash = m === "CASH" || m === "CREDIT" || m === "";
      // When mode class changes, snap to the mode default; otherwise keep user pick.
      const keep = current && ((wantCash && currentIsCash) || (!wantCash && !currentIsCash));
      fillAccountSelect(sel, {
        mode,
        selectedId: keep ? current : prefer
      });
    }
  }

  function setBankUpiNote(text) {
    const input = document.getElementById("bank-upi");
    if (!input) return;
    let note = document.getElementById("bank-upi-note");
    if (!note && text) {
      note = document.createElement("p");
      note.id = "bank-upi-note";
      note.className = "text-xs text-muted";
      note.style.margin = "4px 0 0";
      input.insertAdjacentElement("afterend", note);
    }
    if (note) { note.textContent = text || ""; note.style.display = text ? "" : "none"; }
  }

  function openBankModal(editId) {
    const modal = document.getElementById("modal-bank-account");
    if (!modal) return;
    document.getElementById("modal-bank-title").textContent = editId ? "Edit bank account" : "Add bank account";
    document.getElementById("bank-edit-id").value = editId || "";
    const del = document.getElementById("btn-delete-bank");
    if (del) del.style.display = editId && editId !== "l-cash" && editId !== "l-bank" ? "" : "none";
    if (editId) {
      const acc = cashBankAccounts().find(a => a.id === editId) || {};
      document.getElementById("bank-display-name").value = acc.displayName || "";
      document.getElementById("bank-name").value = acc.bankName || "";
      document.getElementById("bank-holder").value = acc.accountHolder || "";
      document.getElementById("bank-acc-no").value = acc.accountNo || "";
      document.getElementById("bank-ifsc").value = acc.ifsc || "";
      document.getElementById("bank-branch").value = acc.branch || "";
      // The invoice account's UPI field IS Settings → UPI ID (never a stale bank copy, BUG-V21.2-01).
      const isInvoiceAcc = !!(invoiceBankAccount() && invoiceBankAccount().id === editId);
      // After "Keep" the account's own UPI ID lives in upiIdOwn: show THAT here (not Settings),
      // and say which UPI ID invoices print, so the two are never confused.
      const rec = (State.bankAccounts || []).find(a => a.id === editId) || {};
      // 1.13.5 (B2): any account with its own kept UPI ID shows it, invoice account or not.
      const ownVpa = String(rec.upiIdOwn || "").trim();
      const settingsNow = typeof currentUpiVpa === "function" ? currentUpiVpa() : "";
      const upiVal = ownVpa || (isInvoiceAcc ? settingsNow : (acc.upiId || ""));
      document.getElementById("bank-upi").value = upiVal;
      modal.dataset.prefillUpi = upiVal;
      modal.dataset.wasInvoice = isInvoiceAcc ? "1" : "";
      modal.dataset.ownVpa = ownVpa ? "1" : "";
      setBankUpiNote(ownVpa
        ? (settingsNow
          ? `This account's own UPI ID. Invoices print ${settingsNow} (Settings → UPI ID).`
          : "This account's own UPI ID. Invoices print no UPI QR (Settings → UPI ID is empty).")
        : "");
      document.getElementById("bank-opening").value = Number(acc.opening) || 0;
      document.getElementById("bank-opening-asof").value = acc.openingAsOf || "";
      document.getElementById("bank-show-invoice").checked = !!acc.showOnInvoice;
      document.getElementById("bank-is-default").checked = !!acc.isDefault;
      // Cash in Hand: only opening editable-ish
      const isCash = editId === "l-cash";
      ["bank-name", "bank-holder", "bank-acc-no", "bank-ifsc", "bank-branch", "bank-upi", "bank-show-invoice", "bank-is-default"].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.disabled = isCash;
      });
      if (isCash) document.getElementById("bank-display-name").value = "Cash in Hand";
    } else {
      ["bank-display-name", "bank-name", "bank-holder", "bank-acc-no", "bank-ifsc", "bank-branch", "bank-upi"].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.value = ""; el.disabled = false; }
      });
      modal.dataset.prefillUpi = "";
      modal.dataset.wasInvoice = "";
      modal.dataset.ownVpa = "";
      setBankUpiNote("");
      document.getElementById("bank-opening").value = 0;
      document.getElementById("bank-opening-asof").value = todayISO();
      document.getElementById("bank-show-invoice").checked = false;
      document.getElementById("bank-show-invoice").disabled = false;
      document.getElementById("bank-is-default").checked = false;
      document.getElementById("bank-is-default").disabled = false;
    }
    modal.classList.add("open");
  }

  function closeBankModal() {
    document.getElementById("modal-bank-account")?.classList.remove("open");
  }

  /** Settings → UPI ID write from Cash & Bank: one value, stamped so sync carries it (LWW on business.updatedAt). */
  function setSettingsVpa(vpa) {
    if (!State.business) return false;
    const next = String(vpa || "").trim();
    if (String(State.business.upiId || "").trim() === next) return false;
    State.business.upiId = next;
    State.business.updatedAt = Date.now();
    return true;
  }

  function deriveCopies() {
    if (typeof deriveUpiVpaCopies === "function") deriveUpiVpaCopies();
  }

  /**
   * Clear two-button choice when a newly chosen invoice account's VPA differs from Settings
   * (BUG-V21.2-07). Resolves "use" or "keep"; closing the dialog keeps the Settings VPA.
   */
  function askInvoiceVpaChoice(accountName, accountVpa, settingsVpa) {
    return new Promise(resolve => {
      document.getElementById("modal-vpa-choice")?.remove();
      const wrap = document.createElement("div");
      wrap.className = "modal-backdrop open";
      wrap.id = "modal-vpa-choice";
      const useLabel = accountVpa ? `Use ${esc(accountVpa)} on invoices` : "Remove UPI QR from invoices";
      const keepLabel = settingsVpa ? `Keep ${esc(settingsVpa)} on invoices` : "Keep invoices without UPI QR";
      const body = accountVpa
        ? (settingsVpa
          ? `Invoices now print the UPI ID <strong>${esc(settingsVpa)}</strong> (Settings → UPI ID). <strong>${esc(accountName)}</strong> has the UPI ID <strong>${esc(accountVpa)}</strong>. Which UPI ID should your invoice QR codes use?`
          : `Invoices print no UPI QR right now. <strong>${esc(accountName)}</strong> has the UPI ID <strong>${esc(accountVpa)}</strong>. Use it for invoice QR codes?`)
        : `<strong>${esc(accountName)}</strong> has no UPI ID. Invoices now print the UPI ID <strong>${esc(settingsVpa)}</strong>. Keep it, or remove the UPI QR from invoices?`;
      wrap.innerHTML = `<div class="modal-window" role="dialog" aria-modal="true" aria-labelledby="vpa-choice-title">
          <div class="modal-header"><h3 id="vpa-choice-title">UPI ID on invoices</h3></div>
          <div class="modal-body"><p>${body}</p><p class="text-muted" style="font-size:.85em">Your choice is saved as Settings → UPI ID, which every invoice and every synced device uses.</p></div>
          <div class="modal-footer">
            <button class="btn btn-outline" type="button" id="btn-vpa-keep">${keepLabel}</button>
            <button class="btn btn-primary" type="button" id="btn-vpa-use">${useLabel}</button>
          </div></div>`;
      document.body.appendChild(wrap);
      const done = choice => { wrap.remove(); resolve(choice); };
      wrap.querySelector("#btn-vpa-keep").addEventListener("click", () => done("keep"));
      wrap.querySelector("#btn-vpa-use").addEventListener("click", () => done("use"));
      wrap.addEventListener("click", ev => { if (ev.target === wrap) done("keep"); });
    });
  }

  async function saveBankAccount() {
    const modal = document.getElementById("modal-bank-account");
    const editId = document.getElementById("bank-edit-id").value;
    const displayName = document.getElementById("bank-display-name").value.trim();
    if (!displayName) {
      showToast?.("Display name is required", "error");
      return;
    }
    const id = editId || ("l-bank-" + Date.now().toString(36));
    const isCash = id === "l-cash";
    const showOnInvoice = !isCash && document.getElementById("bank-show-invoice").checked;
    const isDefault = !isCash && document.getElementById("bank-is-default").checked;
    const settingsVpa = typeof currentUpiVpa === "function" ? currentUpiVpa() : String(State.business?.upiId || "").trim();
    const enteredVpa = isCash ? "" : document.getElementById("bank-upi").value.trim();
    const prefillVpa = String(modal?.dataset.prefillUpi || "");
    const prevInvoiceId = invoiceBankAccount()?.id || null;
    const wasInvoice = !!editId && prevInvoiceId === id;
    const editingOwnVpa = wasInvoice && modal?.dataset.ownVpa === "1";
    if (isDefault) {
      State.bankAccounts.forEach(a => { if (a.id !== id && a.isDefault) { a.isDefault = false; stamp(a); } });
      (State.accounts?.ledgers || []).forEach(l => { if (l.id !== id && l.groupId === "g-bank" && l.isDefault) { l.isDefault = false; stamp(l); } });
    }
    if (showOnInvoice) {
      State.bankAccounts.forEach(a => { if (a.id !== id && a.showOnInvoice) { a.showOnInvoice = false; stamp(a); } });
      (State.accounts?.ledgers || []).forEach(l => { if (l.id !== id && l.groupId === "g-bank" && l.showOnInvoice) { l.showOnInvoice = false; stamp(l); } });
    }
    const opening = Number(document.getElementById("bank-opening").value) || 0;
    syncBankAccountToLedger({
      id,
      displayName: isCash ? "Cash in Hand" : displayName,
      bankName: document.getElementById("bank-name").value.trim(),
      accountHolder: document.getElementById("bank-holder").value.trim(),
      accountNo: document.getElementById("bank-acc-no").value.trim(),
      ifsc: document.getElementById("bank-ifsc").value.trim(),
      branch: document.getElementById("bank-branch").value.trim(),
      upiId: enteredVpa,
      opening,
      openingAsOf: document.getElementById("bank-opening-asof").value || "",
      showOnInvoice,
      isDefault,
      isCash,
      system: id === "l-cash" || id === "l-bank"
    });
    const nowInvoice = !isCash && invoiceBankAccount()?.id === id;
    let askChoice = false;
    if (editingOwnVpa && nowInvoice) {
      // The field held the account's own (kept-aside) UPI ID: update that, never Settings.
      const rec = (State.bankAccounts || []).find(a => a.id === id);
      if (rec) {
        if (enteredVpa && enteredVpa !== settingsVpa) { if (rec.upiIdOwn !== enteredVpa) { rec.upiIdOwn = enteredVpa; stamp(rec); } }
        else if (rec.upiIdOwn) { delete rec.upiIdOwn; stamp(rec); }
      }
    } else if (!nowInvoice && !isCash && modal?.dataset.ownVpa === "1") {
      // Non-invoice account whose field showed its own kept UPI ID: keep upiIdOwn in step with the edit.
      const rec = (State.bankAccounts || []).find(a => a.id === id);
      if (rec) {
        if (enteredVpa) { if (rec.upiIdOwn !== enteredVpa) { rec.upiIdOwn = enteredVpa; stamp(rec); } }
        else if (rec.upiIdOwn) { delete rec.upiIdOwn; stamp(rec); }
      }
    } else if (nowInvoice && enteredVpa !== settingsVpa) {
      if (wasInvoice) {
        // Same invoice account: its UPI field is Settings → UPI ID. Only an actual edit of the
        // field writes Settings; an untouched field can never push an old copy back.
        if (enteredVpa !== prefillVpa && setSettingsVpa(enteredVpa)) {
          showToast?.(enteredVpa ? `Invoices now use UPI ID ${enteredVpa}` : "UPI QR removed from invoices", "success", { ttlMs: 2200 });
        }
      } else {
        askChoice = true; // newly chosen invoice account with a different VPA: ask, never silent
      }
    }
    deriveCopies();
    persistCashBank();
    closeBankModal();
    renderCashBank();
    showToast?.("Bank account saved");
    // Opening-balance on create: same money toast as ledger moves
    if (!editId && opening > 0 && typeof moneyToAccountToast === "function") {
      moneyToAccountToast(id, opening, "IN");
    }
    if (askChoice) {
      // Account's own VPA is kept aside so choosing "keep" never loses it.
      const rec = (State.bankAccounts || []).find(a => a.id === id);
      if (rec && enteredVpa && rec.upiIdOwn !== enteredVpa) { rec.upiIdOwn = enteredVpa; stamp(rec); persistCashBank(); }
      const choice = await askInvoiceVpaChoice(displayName, enteredVpa, settingsVpa);
      if (choice === "use") {
        setSettingsVpa(enteredVpa);
        if (rec && rec.upiIdOwn) { delete rec.upiIdOwn; stamp(rec); }
        showToast?.(enteredVpa ? `Invoices now use UPI ID ${enteredVpa}` : "UPI QR removed from invoices", "success", { ttlMs: 2200 });
      }
      deriveCopies();
      persistCashBank();
      renderCashBank();
    }
  }

  function deleteBankAccount() {
    const id = document.getElementById("bank-edit-id").value;
    if (!id || id === "l-cash" || id === "l-bank") {
      showToast?.("This account cannot be deleted", "error");
      return;
    }
    if (!confirm("Delete this bank account? Past transactions stay on the ledger history.")) return;
    const wasInvoice = invoiceBankAccount()?.id === id;
    // Tombstone so other devices drop it too (sync), then remove locally.
    if (global.BillSetuSync && typeof global.BillSetuSync.softDelete === "function") global.BillSetuSync.softDelete("bankAccounts", id);
    State.bankAccounts = (State.bankAccounts || []).filter(a => a.id !== id);
    // Keep ledger for history but mark inactive
    const led = State.accounts?.ledgers?.find(l => l.id === id);
    if (led) { led.inactive = true; led.showOnInvoice = false; led.isDefault = false; stamp(led); }
    if (wasInvoice) {
      // Hand "show on invoice" to the default bank; Settings → UPI ID is unchanged.
      const next = (State.bankAccounts || []).find(a => !a.isCash && a.id !== "l-cash" && a.isDefault) || (State.bankAccounts || []).find(a => !a.isCash && a.id !== "l-cash");
      if (next) { next.showOnInvoice = true; stamp(next); const nl = State.accounts?.ledgers?.find(l => l.id === next.id); if (nl) { nl.showOnInvoice = true; stamp(nl); } }
    }
    deriveCopies();
    persistCashBank();
    closeBankModal();
    renderCashBank();
    showToast?.("Bank account removed");
  }

  function renderCashBank() {
    if (typeof ensureAccounts === "function") ensureAccounts();
    else migrateSettingsBankToAccount();
    const list = document.getElementById("cb-accounts-list");
    if (!list) return;
    const accounts = cashBankAccounts().filter(a => !a.inactive);
    list.innerHTML = accounts.map(a => {
      const bal = ledgerBalance(a.id);
      const active = a.id === selectedAccountId ? "active" : "";
      return `<div class="cb-account-card ${active}" data-id="${esc(a.id)}" onclick="selectCashBankAccount('${esc(a.id)}')">
        <div class="cb-name">${esc(a.displayName || a.name)}</div>
        <div class="cb-meta">${a.isCash ? "Cash" : esc([a.bankName, a.accountNo ? "···" + String(a.accountNo).slice(-4) : ""].filter(Boolean).join(" · "))}</div>
        <div class="cb-bal">${money(bal)}</div>
        <div class="cb-badges">
          ${a.isDefault && !a.isCash ? '<span class="cb-chip default">Default</span>' : ""}
          ${a.showOnInvoice ? '<span class="cb-chip invoice">On invoice</span>' : ""}
          ${a.isCash ? "" : `<button type="button" class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openBankModal('${esc(a.id)}')">Edit</button>`}
          ${a.isCash ? `<button type="button" class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openBankModal('${esc(a.id)}')">Edit</button>` : ""}
        </div>
      </div>`;
    }).join("");

    const filter = document.getElementById("cb-filter-account");
    if (filter) {
      const cur = filter.value || selectedAccountId;
      filter.innerHTML = accounts.map(a =>
        `<option value="${esc(a.id)}" ${a.id === cur ? "selected" : ""}>${esc(a.displayName || a.name)}</option>`
      ).join("");
      selectedAccountId = filter.value || selectedAccountId;
    }
    renderCashBankTxns();
  }

  function selectCashBankAccount(id) {
    selectedAccountId = id;
    const filter = document.getElementById("cb-filter-account");
    if (filter) filter.value = id;
    renderCashBank();
  }

  function renderCashBankTxns() {
    const body = document.getElementById("cb-txn-body");
    if (!body) return;
    const accountId = document.getElementById("cb-filter-account")?.value || selectedAccountId;
    selectedAccountId = accountId;
    const from = document.getElementById("cb-filter-from")?.value || "";
    const to = document.getElementById("cb-filter-to")?.value || "";
    const led = (State.accounts?.ledgers || []).find(l => l.id === accountId);
    let running = Math.round((Number(led?.opening) || 0) * 100) * (led?.openingDr === false ? -1 : 1);
    const rows = [];
    rows.push({
      date: led?.openingAsOf || State.accounts?.fyStart || "",
      particulars: "Opening balance",
      type: "Opening",
      dr: running > 0 ? running / 100 : 0,
      cr: running < 0 ? -running / 100 : 0,
      bal: running / 100,
      opening: true
    });
    const vouchers = (State.accounts?.vouchers || [])
      .filter(v => (!from || v.date >= from) && (!to || v.date <= to))
      .slice()
      .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number)));
    vouchers.forEach(v => {
      (v.lines || []).forEach(line => {
        if (line.ledgerId !== accountId) return;
        const dr = Math.round((Number(line.dr) || 0) * 100);
        const cr = Math.round((Number(line.cr) || 0) * 100);
        if (!dr && !cr) return;
        running += dr - cr;
        rows.push({
          date: v.date,
          particulars: v.narration || v.number || v.type,
          type: v.type || "",
          dr: dr / 100,
          cr: cr / 100,
          bal: running / 100
        });
      });
    });
    // If from filter, recompute opening as balance before from
    document.getElementById("cb-txn-title").textContent =
      `Transactions — ${cashBankAccounts().find(a => a.id === accountId)?.displayName || accountId}`;
    body.innerHTML = rows.map(r => `
      <tr>
        <td>${esc(r.date || "—")}</td>
        <td>${esc(r.particulars)}</td>
        <td>${esc(r.type)}</td>
        <td class="num">${r.dr ? money(r.dr) : ""}</td>
        <td class="num">${r.cr ? money(r.cr) : ""}</td>
        <td class="num"><strong>${money(r.bal)}</strong></td>
      </tr>`).join("") || `<tr><td colspan="6" class="empty-state-message">No transactions</td></tr>`;
  }

  function openTransferModal() {
    const modal = document.getElementById("modal-cb-transfer");
    if (!modal) return;
    const accounts = cashBankAccounts().filter(a => !a.inactive);
    const opts = accounts.map(a => `<option value="${esc(a.id)}">${esc(a.displayName || a.name)}</option>`).join("");
    document.getElementById("cb-xfer-from").innerHTML = opts;
    document.getElementById("cb-xfer-to").innerHTML = opts;
    if (accounts[0]) document.getElementById("cb-xfer-from").value = accounts[0].id;
    if (accounts[1]) document.getElementById("cb-xfer-to").value = accounts[1].id;
    else if (accounts[0]) document.getElementById("cb-xfer-to").value = accounts[0].id;
    document.getElementById("cb-xfer-amount").value = "";
    document.getElementById("cb-xfer-date").value = todayISO();
    document.getElementById("cb-xfer-notes").value = "";
    modal.classList.add("open");
  }

  function saveTransfer() {
    const from = document.getElementById("cb-xfer-from").value;
    const to = document.getElementById("cb-xfer-to").value;
    const amount = Number(document.getElementById("cb-xfer-amount").value) || 0;
    const date = document.getElementById("cb-xfer-date").value || todayISO();
    const notes = document.getElementById("cb-xfer-notes").value.trim();
    if (!from || !to || from === to) {
      showToast?.("Choose two different accounts", "error");
      return;
    }
    if (amount <= 0) {
      showToast?.("Enter an amount", "error");
      return;
    }
    ensureAccounts?.();
    const id = "vch-contra-" + Date.now().toString(36);
    const paise = Math.round(amount * 100);
    const voucher = {
      id,
      date,
      type: "Contra",
      number: "CTR-" + Date.now().toString(36).toUpperCase(),
      narration: notes || `Transfer ${from} → ${to}`,
      sourceKind: "contra",
      lines: [
        { ledgerId: to, dr: amount, cr: 0, refType: "", refName: "" },
        { ledgerId: from, dr: 0, cr: amount, refType: "", refName: "" }
      ],
      updatedAt: Date.now()
    };
    State.accounts.vouchers.push(voucher);
    persistCashBank();
    document.getElementById("modal-cb-transfer")?.classList.remove("open");
    renderCashBank();
    showToast?.("Transfer recorded");
  }

  function openAdjustModal() {
    const modal = document.getElementById("modal-cb-adjust");
    if (!modal) return;
    const accounts = cashBankAccounts().filter(a => !a.inactive);
    document.getElementById("cb-adj-account").innerHTML = accounts.map(a =>
      `<option value="${esc(a.id)}" ${a.id === selectedAccountId ? "selected" : ""}>${esc(a.displayName || a.name)}</option>`
    ).join("");
    document.getElementById("cb-adj-amount").value = "";
    document.getElementById("cb-adj-date").value = todayISO();
    document.getElementById("cb-adj-notes").value = "";
    modal.classList.add("open");
  }

  function saveAdjust() {
    const accountId = document.getElementById("cb-adj-account").value;
    const amount = Number(document.getElementById("cb-adj-amount").value) || 0;
    const date = document.getElementById("cb-adj-date").value || todayISO();
    const notes = document.getElementById("cb-adj-notes").value.trim();
    const type = document.querySelector('input[name="cb-adj-type"]:checked')?.value || "add";
    if (!accountId || amount <= 0) {
      showToast?.("Choose an account and amount", "error");
      return;
    }
    ensureAccounts?.();
    // Contra against Capital for add, against Indirect Expense for reduce (simple adjustment)
    const offset = type === "add" ? "l-capital" : "l-round";
    const id = "vch-adj-" + Date.now().toString(36);
    const lines = type === "add"
      ? [
          { ledgerId: accountId, dr: amount, cr: 0, refType: "", refName: "" },
          { ledgerId: offset, dr: 0, cr: amount, refType: "", refName: "" }
        ]
      : [
          { ledgerId: offset, dr: amount, cr: 0, refType: "", refName: "" },
          { ledgerId: accountId, dr: 0, cr: amount, refType: "", refName: "" }
        ];
    State.accounts.vouchers.push({
      id,
      date,
      type: "Journal",
      number: "ADJ-" + Date.now().toString(36).toUpperCase(),
      narration: notes || (type === "add" ? "Add money" : "Reduce money"),
      sourceKind: "adjust",
      lines,
      updatedAt: Date.now()
    });
    persistCashBank();
    document.getElementById("modal-cb-adjust")?.classList.remove("open");
    renderCashBank();
    showToast?.("Adjustment saved");
  }

  /** Business bank/UPI fields for invoice templates from show-on-invoice account. */
  function invoiceBankDetails() {
    const acc = invoiceBankAccount();
    const b = State.business || {};
    if (!acc) {
      return {
        bankName: b.bankName || "",
        bankBranch: b.bankBranch || "",
        bankAcc: b.bankAcc || "",
        bankIfsc: b.bankIfsc || "",
        upiId: typeof currentUpiVpa === "function" ? currentUpiVpa(b, null) : (b.upiId || ""),
        accountHolder: b.name || ""
      };
    }
    return {
      bankName: acc.bankName || b.bankName || "",
      bankBranch: acc.branch || b.bankBranch || "",
      bankAcc: acc.accountNo || b.bankAcc || "",
      bankIfsc: acc.ifsc || b.bankIfsc || "",
      upiId: typeof currentUpiVpa === "function" ? currentUpiVpa(b, acc) : (b.upiId || acc.upiId || ""),
      accountHolder: acc.accountHolder || b.name || ""
    };
  }

  function wireCashBank() {
    migrateSettingsBankToAccount();
    document.getElementById("btn-cb-add-bank")?.addEventListener("click", () => openBankModal(null));
    document.getElementById("btn-close-bank-modal")?.addEventListener("click", closeBankModal);
    document.getElementById("btn-cancel-bank")?.addEventListener("click", closeBankModal);
    document.getElementById("btn-save-bank")?.addEventListener("click", saveBankAccount);
    document.getElementById("btn-delete-bank")?.addEventListener("click", deleteBankAccount);
    document.getElementById("btn-cb-transfer")?.addEventListener("click", openTransferModal);
    document.getElementById("btn-close-cb-transfer")?.addEventListener("click", () => document.getElementById("modal-cb-transfer")?.classList.remove("open"));
    document.getElementById("btn-cancel-cb-transfer")?.addEventListener("click", () => document.getElementById("modal-cb-transfer")?.classList.remove("open"));
    document.getElementById("btn-save-cb-transfer")?.addEventListener("click", saveTransfer);
    document.getElementById("btn-cb-adjust")?.addEventListener("click", openAdjustModal);
    document.getElementById("btn-close-cb-adjust")?.addEventListener("click", () => document.getElementById("modal-cb-adjust")?.classList.remove("open"));
    document.getElementById("btn-cancel-cb-adjust")?.addEventListener("click", () => document.getElementById("modal-cb-adjust")?.classList.remove("open"));
    document.getElementById("btn-save-cb-adjust")?.addEventListener("click", saveAdjust);
    document.getElementById("cb-filter-account")?.addEventListener("change", renderCashBankTxns);
    document.getElementById("cb-filter-from")?.addEventListener("change", renderCashBankTxns);
    document.getElementById("cb-filter-to")?.addEventListener("change", renderCashBankTxns);

    // Invoice: show Received in when amount > 0
    document.getElementById("inv-amount-received")?.addEventListener("input", updateReceivedInVisibility);
    document.querySelectorAll('input[name="inv-pay-mode"]').forEach(el => {
      el.addEventListener("change", () => {
        const mode = el.value;
        fillAccountSelect(document.getElementById("inv-account-id"), { mode });
        updateReceivedInVisibility();
      });
    });
    document.getElementById("inv-fully-paid")?.addEventListener("change", () => setTimeout(updateReceivedInVisibility, 0));

    // Payment modal account select
    document.getElementById("pay-mode")?.addEventListener("change", () => {
      const mode = document.getElementById("pay-mode").value;
      fillAccountSelect(document.getElementById("pay-account-id"), { mode });
      const label = document.getElementById("pay-account-label");
      // direction may be set elsewhere
      if (label) label.textContent = (window.__payDirection === "OUT") ? "Paid from" : "Received in";
    });

    document.getElementById("exp-mode")?.addEventListener("change", () => {
      fillAccountSelect(document.getElementById("exp-account-id"), {
        mode: document.getElementById("exp-mode").value
      });
    });
  }

  document.addEventListener("DOMContentLoaded", wireCashBank);

  // Exports
  global.cashBankAccounts = cashBankAccounts;
  global.defaultAccountIdForMode = defaultAccountIdForMode;
  global.rememberAccountId = rememberAccountId;
  global.fillAccountSelect = fillAccountSelect;
  global.updateReceivedInVisibility = updateReceivedInVisibility;
  global.renderCashBank = renderCashBank;
  global.selectCashBankAccount = selectCashBankAccount;
  global.openBankModal = openBankModal;
  global.migrateSettingsBankToAccount = migrateSettingsBankToAccount;
  global.normalizeBankFlags = normalizeBankFlags;
  global.invoiceBankDetails = invoiceBankDetails;
  global.invoiceBankAccount = invoiceBankAccount;
  global.defaultBankAccount = defaultBankAccount;
  global.ledgerBalance = ledgerBalance;
  global.syncBankAccountToLedger = syncBankAccountToLedger;
  global.saveBankAccount = saveBankAccount;
  global.persistCashBank = persistCashBank;
})(typeof window !== "undefined" ? window : globalThis);
