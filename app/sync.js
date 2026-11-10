/**
 * Ledgerbay offline-first sync — multi-company, record LWW, duplicate doc renumber,
 * stock rebuild, passcode auth, merge/replace first-join.
 */
(function () {
  const SYNC_KEY = "billsetu_sync_v1";
  const REGISTRY_KEY = "billsetu_registry_v1";
  const DATA_KEY = "billsetu_data_v1";

  const ARRAY_COLLECTIONS = [
    "parties", "items", "invoices", "purchases", "expenses",
    "purchaseOrders", "debitNotes", "payments", "recurringBills", "godowns",
    "stockTransfers", "staff", "loyaltyLedger", "customFieldDefs", "activityLog",
    "bankAccounts"
  ];

  const DOC_NUMBER_FIELDS = {
    invoices: "invoiceNo",
    purchases: "purchaseNo",
    debitNotes: "noteNo",
    purchaseOrders: "poNo",
    payments: "receiptNo"
  };

  /** Map collection → BillSetuDocNumbering series key for counter bump after merge. */
  const COLLECTION_SERIES = {
    invoices: null, // resolved per-row via docType
    purchases: "PURCHASE",
    debitNotes: "DEBIT_NOTE",
    purchaseOrders: "PURCHASE_ORDER",
    payments: null // RECEIPT vs PAYMENT via direction
  };

  function now() { return Date.now(); }

  function loadSyncConfig() {
    try {
      return Object.assign({
        enabled: false,
        url: "",
        passcode: "",
        deviceId: "",
        lastSyncAt: 0,
        lastStatus: "idle",
        lastError: "",
        autoSync: true,
        autoSeconds: 60,
        pendingHint: 0,
        joinedOnce: false,
        role: "join"
      }, JSON.parse(localStorage.getItem(SYNC_KEY) || "{}"));
    } catch {
      return { enabled: false, url: "", passcode: "", deviceId: "", lastSyncAt: 0, lastStatus: "idle", lastError: "", autoSync: true, autoSeconds: 60, pendingHint: 0, joinedOnce: false, role: "join" };
    }
  }

  function saveSyncConfig(cfg) {
    localStorage.setItem(SYNC_KEY, JSON.stringify(cfg));
    window.__billsetuSyncConfig = cfg;
    updateSyncStatusChip();
    updateSyncSettingsStatus();
  }

  function ensureDeviceId(cfg) {
    if (cfg.deviceId) return cfg;
    cfg.deviceId = "dev-" + now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    saveSyncConfig(cfg);
    return cfg;
  }

  function stampRecord(rec) {
    if (!rec || typeof rec !== "object") return rec;
    if (!rec.updatedAt) rec.updatedAt = now();
    if (!rec.createdAt) rec.createdAt = rec.updatedAt;
    return rec;
  }

  function tsOf(rec) {
    if (!rec) return 0;
    return Math.max(Number(rec.updatedAt) || 0, Number(rec.deletedAt) || 0);
  }

  function alive(rec) {
    return rec && !rec.deletedAt;
  }

  function activeCompanyId() {
    try {
      const reg = JSON.parse(localStorage.getItem(REGISTRY_KEY) || "null");
      if (reg && reg.activeId) return reg.activeId;
    } catch (_) {}
    return (State.accounts && State.accounts.companyId) || "co-main";
  }

  function companyStorageKey(id) {
    return `billsetu_company_${id}`;
  }

  function yearStorageKey(companyId, yearId) {
    return `billsetu_year_${companyId}_${yearId}`;
  }

  function readRegistry() {
    try {
      return JSON.parse(localStorage.getItem(REGISTRY_KEY) || "null");
    } catch {
      return null;
    }
  }

  function mapFromArray(list, stripStock) {
    const map = {};
    (list || []).forEach(row => {
      if (!row || !row.id) return;
      const copy = { ...row };
      if (stripStock) delete copy.stock;
      map[row.id] = stampRecord(copy);
    });
    return map;
  }

  function accountsPushMaps(accounts) {
    if (!accounts) return {};
    return {
      accountsGroups: mapFromArray(accounts.groups),
      accountsLedgers: mapFromArray(accounts.ledgers),
      accountsVouchers: mapFromArray(accounts.vouchers),
      accountsCheques: mapFromArray(accounts.cheques),
      accountsOpeningBills: mapFromArray(accounts.openingBills),
      accountsMeta: {
        meta: stampRecord({
          id: "meta",
          bankDates: accounts.bankDates || {},
          chequeLayout: accounts.chequeLayout || null,
          fyStart: accounts.fyStart || "",
          fyEnd: accounts.fyEnd || "",
          yearId: accounts.yearId || "",
          companyId: accounts.companyId || "",
          companyName: accounts.companyName || "",
          updatedAt: accounts.updatedAt || now()
        })
      }
    };
  }

  function snapshotToPush(data) {
    settleStockDocs(data);
    const push = {
      business: {
        business: stampRecord({ ...(data.business || {}), id: "business" })
      }
    };
    for (const key of ARRAY_COLLECTIONS) {
      const map = mapFromArray(data[key], key === "items");
      const tombs = (data._syncTombs && data._syncTombs[key]) || (State._syncTombs && State._syncTombs[key]) || {};
      Object.entries(tombs).forEach(([id, rec]) => { map[id] = rec; });
      push[key] = map;
    }
    Object.assign(push, accountsPushMaps(data.accounts));

    // counters from doc numbers
    const counters = {};
    const bump = (name, list, field) => {
      let max = 0;
      (list || []).forEach(row => {
        if (!alive(row)) return;
        const m = String(row[field] || "").match(/(\d+)\s*$/);
        if (m) max = Math.max(max, Number(m[1]));
      });
      counters[name] = { id: name, value: max, updatedAt: now() };
    };
    bump("invoice", data.invoices, "invoiceNo");
    bump("purchase", data.purchases, "purchaseNo");
    bump("debitNote", data.debitNotes, "noteNo");
    bump("purchaseOrder", data.purchaseOrders, "poNo");
    bump("payment", data.payments, "receiptNo");
    if (data.accounts && data.accounts.vouchers) {
      let max = 0;
      data.accounts.vouchers.forEach(v => {
        if (!alive(v)) return;
        const m = String(v.voucherNo || v.number || "").match(/(\d+)\s*$/);
        if (m) max = Math.max(max, Number(m[1]));
      });
      counters.voucher = { id: "voucher", value: max, updatedAt: now() };
    }
    // Per-series counters (align with /api/reserve-number ids)
    try {
      const dn = data.business && data.business.docNumbering && data.business.docNumbering.series;
      if (dn) {
        Object.keys(dn).forEach(seriesKey => {
          const next = Number(dn[seriesKey].nextNumber) || 1;
          const used = Math.max(0, next - 1);
          const id = "series:" + seriesKey;
          const prev = Number(counters[id] && counters[id].value) || 0;
          counters[id] = { id, value: Math.max(prev, used), seriesKey, updatedAt: now() };
        });
      }
    } catch (_) {}
    push.counters = counters;
    return push;
  }

  function currentStateSnapshot() {
    return {
      business: State.business,
      parties: State.parties,
      items: State.items,
      invoices: State.invoices,
      purchases: State.purchases,
      expenses: State.expenses,
      purchaseOrders: State.purchaseOrders,
      debitNotes: State.debitNotes,
      payments: State.payments,
      recurringBills: State.recurringBills,
      godowns: State.godowns,
      stockTransfers: State.stockTransfers,
      staff: State.staff,
      activityLog: State.activityLog,
      loyaltyLedger: State.loyaltyLedger,
      customFieldDefs: State.customFieldDefs,
      bankAccounts: State.bankAccounts,
      accounts: State.accounts,
      _syncTombs: State._syncTombs
    };
  }

  function buildPushBundle() {
    const companyId = activeCompanyId();
    const push = snapshotToPush(currentStateSnapshot());
    const registry = readRegistry();
    const otherCompanies = {};
    const years = {};
    if (registry && Array.isArray(registry.companies)) {
      registry.companies.forEach(co => {
        if (!co || !co.id || co.id === companyId) return;
        try {
          const raw = localStorage.getItem(companyStorageKey(co.id));
          if (!raw) return;
          const data = JSON.parse(raw);
          otherCompanies[co.id] = { push: snapshotToPush(data) };
        } catch (_) {}
      });
      Object.entries(registry.years || {}).forEach(([cid, list]) => {
        (list || []).forEach(y => {
          const yearId = typeof y === "string" ? y : y.id;
          if (!yearId) return;
          const key = `${cid}_${yearId}`;
          try {
            const raw = localStorage.getItem(yearStorageKey(cid, yearId));
            if (!raw) return;
            const snapshot = JSON.parse(raw);
            years[key] = stampRecord({ id: key, companyId: cid, yearId, snapshot, updatedAt: snapshot.updatedAt || now() });
          } catch (_) {}
        });
      });
    }
    return {
      companyId,
      companyIds: (registry && registry.companies || []).map(c => c.id).filter(Boolean),
      registry: registry ? { registry: stampRecord({ ...registry, id: "registry" }) } : null,
      push,
      otherCompanies,
      years
    };
  }

  function applyPullMapToArray(key, map, targetState) {
    if (!map) return 0;
    let applied = 0;
    if (!Array.isArray(targetState[key])) targetState[key] = [];
    if (!targetState._syncTombs) targetState._syncTombs = {};
    if (!targetState._syncTombs[key]) targetState._syncTombs[key] = {};
    const byId = new Map(targetState[key].map(r => [r.id, r]));
    Object.values(map).forEach(remote => {
      if (!remote || !remote.id) return;
      const local = byId.get(remote.id) || targetState._syncTombs[key][remote.id];
      if (local && tsOf(local) > tsOf(remote)) return;
      applied++;
      if (remote.deletedAt) {
        byId.delete(remote.id);
        targetState._syncTombs[key][remote.id] = remote;
      } else {
        delete targetState._syncTombs[key][remote.id];
        const prev = byId.get(remote.id) || {};
        const stock = prev.stock;
        const merged = { ...remote };
        if (key === "items" && stock != null && merged.stock == null) merged.stock = stock;
        byId.set(remote.id, merged);
      }
    });
    targetState[key] = [...byId.values()];
    return applied;
  }

  function applyAccountsPull(pull, targetState) {
    if (!targetState.accounts) targetState.accounts = { groups: [], ledgers: [], vouchers: [], cheques: [], openingBills: [], bankDates: {}, chequeLayout: null };
    let applied = 0;
    const pairs = [
      ["accountsGroups", "groups"],
      ["accountsLedgers", "ledgers"],
      ["accountsVouchers", "vouchers"],
      ["accountsCheques", "cheques"],
      ["accountsOpeningBills", "openingBills"]
    ];
    pairs.forEach(([pullKey, arrKey]) => {
      if (!pull[pullKey]) return;
      const fake = { [arrKey]: targetState.accounts[arrKey] || [], _syncTombs: targetState._syncTombs || {} };
      // reuse array merge via temp
      if (!Array.isArray(fake[arrKey])) fake[arrKey] = [];
      if (!fake._syncTombs[arrKey]) fake._syncTombs[arrKey] = {};
      const byId = new Map(fake[arrKey].map(r => [r.id, r]));
      Object.values(pull[pullKey]).forEach(remote => {
        if (!remote || !remote.id) return;
        const local = byId.get(remote.id);
        if (local && tsOf(local) > tsOf(remote)) return;
        applied++;
        if (remote.deletedAt) byId.delete(remote.id);
        else byId.set(remote.id, remote);
      });
      targetState.accounts[arrKey] = [...byId.values()];
    });
    if (pull.accountsMeta && pull.accountsMeta.meta) {
      const meta = pull.accountsMeta.meta;
      const localTs = Number(targetState.accounts.updatedAt) || 0;
      if (tsOf(meta) >= localTs) {
        targetState.accounts.bankDates = meta.bankDates || targetState.accounts.bankDates || {};
        if (meta.chequeLayout) targetState.accounts.chequeLayout = meta.chequeLayout;
        if (meta.fyStart) targetState.accounts.fyStart = meta.fyStart;
        if (meta.fyEnd) targetState.accounts.fyEnd = meta.fyEnd;
        if (meta.yearId) targetState.accounts.yearId = meta.yearId;
        if (meta.companyId) targetState.accounts.companyId = meta.companyId;
        targetState.accounts.updatedAt = meta.updatedAt || now();
        applied++;
      }
    }
    return applied;
  }

  /** A profile nobody has filled in yet (fresh install / wizard skipped): never wins over a real one. */
  function isBlankProfile(b) {
    if (!b || typeof b !== "object") return true;
    return !String(b.name || "").trim() && !String(b.gstin || "").trim() && !String(b.upiId || "").trim() &&
      !String(b.phone || "").trim() && !String(b.address || "").trim();
  }

  /**
   * Joining (first sync on this device, or Replace): take the server's / first device's business
   * profile as-is, whatever the timestamps say (BUG-V21.2-04). A blank server profile never
   * replaces a filled local one. Returns true if the server profile was adopted.
   */
  let lastAdoptFilledLocal = false;
  let lastAdoptChanged = [];   // 1.13.14: company fields the last adopt changed on this device (for the sync notice)
  function adoptServerBusiness(pull, targetState) {
    lastAdoptFilledLocal = false;
    lastAdoptChanged = [];
    const remote = pull && pull.business && pull.business.business;
    if (!remote || remote.deletedAt || isBlankProfile(remote)) return false;
    const { id, deletedAt, companyId, ...rest } = remote;
    const local = targetState.business || {};
    // Keep only device-local bookkeeping that is not part of the shared profile.
    // 1.13.13 (SY12): the server's non-blank fields win, but a blank server field (e.g. a blank name)
    // never wipes this device's own value; GSTIN/state/PAN stay one consistent set.
    const merged = typeof window.mergeRestoredBusiness === "function" ? window.mergeRestoredBusiness(local, rest) : { ...rest };
    const blank = v => !String(v == null ? "" : v).trim();
    // Fields this device filled in (the server had them blank) are pushed back so every device gets them.
    lastAdoptFilledLocal = ["name", "tradeName", "gstin", "pan", "stateCode", "address", "phone", "email"].some(k => blank(rest[k]) && !blank(merged[k]));
    targetState.business = { ...merged, updatedAt: lastAdoptFilledLocal ? now() : (tsOf(remote) || now()) };
    // 1.13.14: remember which company fields the join changed on this device; runSync tells the user.
    lastAdoptChanged = typeof window.businessChangedFields === "function" ? window.businessChangedFields(local, merged) : [];
    if (local.docConflictNotices && !targetState.business.docConflictNotices) targetState.business.docConflictNotices = local.docConflictNotices;
    return true;
  }

  function applyPullToState(pull, targetState, opts) {
    let applied = 0;
    settleStockDocs(targetState);
    if (pull.business && pull.business.business) {
      const remote = pull.business.business;
      const local = targetState.business || {};
      const blankOverFilled = isBlankProfile(remote) && !isBlankProfile(local);
      if (!blankOverFilled && tsOf(remote) >= tsOf({ updatedAt: local.updatedAt })) {
        const { id, deletedAt, ...rest } = remote;
        targetState.business = { ...targetState.business, ...rest };
        applied++;
      }
    }
    for (const key of ARRAY_COLLECTIONS) {
      applied += applyPullMapToArray(key, pull[key], targetState);
    }
    applied += applyAccountsPull(pull, targetState);
    if (pull.counters) {
      State._syncCounters = Object.assign({}, State._syncCounters || {},
        Object.fromEntries(Object.entries(pull.counters).map(([k, v]) => [k, Number(v.value) || 0])));
      if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.bumpSeriesPastMax) {
        Object.entries(pull.counters).forEach(([k, v]) => {
          const val = Number(v && v.value) || 0;
          if (!val) return;
          if (String(k).startsWith("series:")) {
            BillSetuDocNumbering.bumpSeriesPastMax(String(k).slice(7), [String(val)]);
          }
        });
      }
    }
    return applied;
  }

  /** Friendly device label for conflict notices. */
  function deviceLabelOf(row, fallbackId) {
    if (row && row.originDeviceLabel) return String(row.originDeviceLabel);
    const id = (row && (row.originDeviceId || row.deviceId)) || fallbackId || "";
    if (!id) return "another device";
    const s = String(id);
    if (/phone/i.test(s)) return "Phone";
    if (/pc|desktop|host/i.test(s)) return "PC";
    // device-A → A, device-Phone → Phone
    const tail = s.replace(/^device-/i, "");
    if (tail && tail !== s) return tail;
    return s.length > 18 ? s.slice(0, 16) + "…" : s;
  }

  /**
   * Detect duplicate doc numbers (same series text, different id).
   * Keeper: earlier createdAt, then earlier originDeviceId / deviceId / id.
   * Loser is renumbered to the next free number in that prefix/width.
   * Bumps BillSetuDocNumbering counters past the merged max.
   * Returns notices: { collection, id, from, to, deviceLabel, message }.
   */
  function renumberDuplicates(targetState) {
    const notices = [];
    const seriesOf = (num) => {
      const s = String(num || "");
      const m = s.match(/^(.*?)(\d+)\s*$/);
      if (!m) return { prefix: s, width: 3, n: 0 };
      return { prefix: m[1], width: m[2].length, n: Number(m[2]) };
    };
    const nextFree = (used, prefix, width, start) => {
      let n = Math.max(1, start);
      for (;;) {
        const candidate = prefix + String(n).padStart(width, "0");
        if (!used.has(candidate)) return { candidate, n };
        n++;
      }
    };
    const sortKeepers = (a, b) => {
      const ta = Number(a.createdAt) || Number(a.updatedAt) || 0;
      const tb = Number(b.createdAt) || Number(b.updatedAt) || 0;
      if (ta !== tb) return ta - tb;
      const da = String(a.originDeviceId || a.deviceId || "");
      const db = String(b.originDeviceId || b.deviceId || "");
      if (da !== db) return da.localeCompare(db);
      return String(a.id).localeCompare(String(b.id));
    };

    const bumpMaxBySeries = Object.create(null);

    Object.entries(DOC_NUMBER_FIELDS).forEach(([collection, field]) => {
      const list = targetState[collection];
      if (!Array.isArray(list)) return;
      const aliveRows = list.filter(alive).slice().sort(sortKeepers);
      const used = new Set();
      aliveRows.forEach(row => {
        const no = row[field];
        if (!no) return;
        // Track max trailing digits for counter bump
        const parsed = seriesOf(no);
        let seriesKey = COLLECTION_SERIES[collection];
        if (collection === "invoices" && typeof BillSetuDocNumbering !== "undefined") {
          seriesKey = BillSetuDocNumbering.seriesForDocType(row.docType || "TAX_INVOICE");
        } else if (collection === "payments") {
          seriesKey = (row.direction === "OUT" || row.type === "PAYMENT") ? "PAYMENT" : "RECEIPT";
        }
        if (seriesKey && parsed.n) {
          bumpMaxBySeries[seriesKey] = Math.max(bumpMaxBySeries[seriesKey] || 0, parsed.n);
        }

        if (!used.has(no)) {
          used.add(no);
          return;
        }
        // Duplicate — renumber this later-created / later-device row
        const { candidate, n } = nextFree(used, parsed.prefix, parsed.width, parsed.n + 1);
        const from = no;
        row[field] = candidate;
        row.previousDocNo = from;
        row.renumberedAt = now();
        row.renumberReason = "duplicate-on-sync";
        row.updatedAt = now();
        used.add(candidate);
        if (seriesKey) bumpMaxBySeries[seriesKey] = Math.max(bumpMaxBySeries[seriesKey] || 0, n);
        const label = deviceLabelOf(row);
        const message = `${from} from ${label} was renumbered to ${candidate}`;
        notices.push({ collection, id: row.id, from, to: candidate, deviceLabel: label, message, field });
      });
    });

    // Manual vouchers
    if (targetState.accounts && Array.isArray(targetState.accounts.vouchers)) {
      const field = "voucherNo";
      const aliveRows = targetState.accounts.vouchers.filter(v => alive(v) && !v.sourceId).slice().sort(sortKeepers);
      const used = new Set(targetState.accounts.vouchers.filter(alive).map(v => v.voucherNo || v.number).filter(Boolean));
      const seen = new Set();
      aliveRows.forEach(row => {
        const no = row.voucherNo || row.number;
        if (!no) return;
        if (!seen.has(no)) { seen.add(no); return; }
        const { prefix, width, n } = seriesOf(no);
        const { candidate } = nextFree(used, prefix, width, n + 1);
        const from = no;
        row.voucherNo = candidate;
        row.previousDocNo = from;
        row.renumberedAt = now();
        row.updatedAt = now();
        used.add(candidate);
        seen.add(candidate);
        const label = deviceLabelOf(row);
        const message = `${from} from ${label} was renumbered to ${candidate}`;
        notices.push({ collection: "vouchers", id: row.id, from, to: candidate, deviceLabel: label, message, field });
      });
    }

    // Bump local Settings counters past merged max (no change when already ahead)
    if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.bumpSeriesPastMax) {
      Object.entries(bumpMaxBySeries).forEach(([seriesKey, maxN]) => {
        // Collect used numbers for that series from invoices etc. — bumpSeriesPastMax takes list
        BillSetuDocNumbering.bumpSeriesPastMax(seriesKey, [String(maxN)]);
      });
    } else if (targetState.business && targetState.business.docNumbering && targetState.business.docNumbering.series) {
      Object.entries(bumpMaxBySeries).forEach(([seriesKey, maxN]) => {
        const cfg = targetState.business.docNumbering.series[seriesKey];
        if (!cfg) return;
        if (maxN >= (Number(cfg.nextNumber) || 1)) cfg.nextNumber = maxN + 1;
      });
    }

    // Activity log + durable conflict notices on business
    if (notices.length) {
      if (!Array.isArray(targetState.activityLog)) targetState.activityLog = [];
      notices.forEach(n => {
        targetState.activityLog.push({
          id: "log-renum-" + n.id + "-" + now(),
          at: new Date().toISOString(),
          actor: "Sync",
          role: "SYSTEM",
          action: n.message,
          kind: "doc-renumber",
          from: n.from,
          to: n.to,
          collection: n.collection,
          docId: n.id
        });
      });
      if (targetState.activityLog.length > 200) {
        targetState.activityLog.splice(0, targetState.activityLog.length - 200);
      }
      if (!targetState.business) targetState.business = {};
      const prev = Array.isArray(targetState.business.docConflictNotices)
        ? targetState.business.docConflictNotices : [];
      targetState.business.docConflictNotices = prev.concat(notices.map(n => ({
        at: now(),
        message: n.message,
        from: n.from,
        to: n.to,
        id: n.id
      }))).slice(-20);
      targetState.business.updatedAt = now();
    }
    return notices;
  }


  // 1.13.8 (L1): per-godown stock follows documents across devices.
  // item.godownQty (G) and item.stockDocs (D, the document movements already counted in G) travel together.
  // Anything not from a document (opening stock, adjustments, transfers) stays in G − D untouched.
  // Before a pull D is settled from local docs (local G already includes them); after a pull
  // G += moves(merged docs) − D, so pulled purchases, sales and deletes move stock exactly once.
  function stockDefaultGodown(st) {
    const gds = st.godowns || [];
    const d = gds.find(g => g && g.isDefault) || gds[0];
    return (d && d.id) || "gd-main";
  }
  function stockIsService(it) {
    return typeof isServiceCategory === "function" && isServiceCategory(it.category);
  }
  function stockDocMoves(st) {
    const moves = new Map();
    const main = stockDefaultGodown(st);
    const add = (itemId, gid, qty) => {
      const n = Number(qty) || 0;
      if (!itemId || !n) return;
      if (!moves.has(itemId)) moves.set(itemId, {});
      const m = moves.get(itemId);
      const g = gid || main;
      m[g] = Math.round(((m[g] || 0) + n) * 1000) / 1000;
    };
    const live = d => alive(d) && !d.cancelled;
    (st.purchases || []).filter(live).forEach(doc => {
      (doc.items || []).forEach(line => add(line.itemId, line.godownId || doc.godownId, Number(line.qty) || 0));
    });
    (st.invoices || []).filter(live).forEach(doc => {
      const t = doc.docType || "TAX_INVOICE";
      if (t === "ESTIMATE" || t === "PROFORMA" || t === "QUOTATION") return;
      const sign = t === "CREDIT_NOTE" ? 1 : -1;
      (doc.items || []).forEach(line => add(line.itemId, line.godownId, sign * (Number(line.qty) || 0)));
    });
    (st.debitNotes || []).filter(live).forEach(doc => {
      if (doc.itemId) add(doc.itemId, doc.godownId, -(Number(doc.qty) || 0));
    });
    return moves;
  }
  function settleStockDocs(targetState) {
    const st = targetState || State;
    if (!st || !Array.isArray(st.items)) return;
    const moves = stockDocMoves(st);
    st.items.forEach(it => {
      if (!it || it.trackSerial || stockIsService(it)) return;
      it.stockDocs = { ...(moves.get(it.id) || {}) };
    });
  }

  function rebuildStockFromDocuments(targetState) {
    const st = targetState || State;
    if (!Array.isArray(st.items)) return;
    const moves = stockDocMoves(st);
    const main = stockDefaultGodown(st);
    const serials = new Map(st.items.map(it => [it.id, []]));
    const bump = (itemId, dir, serialList) => {
      if (!itemId || !serials.has(itemId)) return;
      if (Array.isArray(serialList) && serialList.length) {
        const cur = serials.get(itemId) || [];
        if (dir === "in") serials.set(itemId, [...cur, ...serialList]);
        else {
          const remove = new Set(serialList);
          serials.set(itemId, cur.filter(s => !remove.has(s)));
        }
      }
    };
    (st.purchases || []).filter(alive).forEach(doc => {
      (doc.items || []).forEach(line => bump(line.itemId, "in", line.serials));
    });
    (st.invoices || []).filter(alive).forEach(doc => {
      const posted = !doc.docType || doc.docType === "TAX_INVOICE" || doc.docType === "BILL_OF_SUPPLY";
      if (!posted) return;
      (doc.items || []).forEach(line => bump(line.itemId, "out", line.serials));
    });
    st.items = st.items.map(it => {
      const next = { ...it };
      if ((it.serials || []).length || (serials.get(it.id) || []).length) {
        next.serials = serials.get(it.id) || [];
        next.stock = next.serials.length;
        return next;
      }
      if (stockIsService(it)) return next;
      if (it.trackSerial) { next.stock = (it.serials || []).length; return next; }
      const now = moves.get(it.id) || {};
      const g = { ...(it.godownQty && typeof it.godownQty === "object" ? it.godownQty : {}) };
      if (!Object.keys(g).length && Number(it.stock)) g[main] = Number(it.stock) || 0;
      if (it.stockDocs && typeof it.stockDocs === "object") {
        const prev = it.stockDocs;
        new Set([...Object.keys(prev), ...Object.keys(now)]).forEach(gid => {
          const delta = (Number(now[gid]) || 0) - (Number(prev[gid]) || 0);
          if (Math.abs(delta) > 1e-9) g[gid] = Math.max(0, Math.round(((Number(g[gid]) || 0) + delta) * 1000) / 1000);
        });
      }
      // (no stockDocs = record from an older version: its godownQty is taken as already matching the docs)
      next.godownQty = g;
      next.stockDocs = { ...now };
      next.stock = Object.values(g).reduce((sum, q) => sum + (Number(q) || 0), 0);
      return next;
    });
  }

  function plainError(err) {
    const msg = String(err && err.message || err || "");
    const code = err && err.code;
    if (code === "locked" || /15 minutes|locked out|Too many/i.test(msg)) return "Server locked you out after too many wrong passcodes. Wait 15 minutes.";
    if (code === "unauthorized" || /Wrong passcode|Unauthorized/i.test(msg)) return "Wrong passcode.";
    if (/Passcode not set/i.test(msg)) return "Server has no passcode yet. On the PC open the setup page once.";
    if (/Failed to fetch|NetworkError|ECONNREFUSED|unreachable|Load failed/i.test(msg)) return "Server unreachable. Check the address and that the PC is on the same Wi‑Fi.";
    if (/HTTP 429/.test(msg)) return "Server locked you out after too many wrong passcodes. Wait 15 minutes.";
    return msg || "Sync failed.";
  }

  async function httpJson(url, options) {
    const opts = options || {};
    const headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
    try {
      const Cap = window.Capacitor;
      const Http = Cap && Cap.Plugins && Cap.Plugins.CapacitorHttp;
      if (Http && typeof Http.request === "function") {
        const res = await Http.request({
          url,
          method: (opts.method || "GET").toUpperCase(),
          headers,
          data: opts.body ? JSON.parse(opts.body) : undefined,
          connectTimeout: 15000,
          readTimeout: 60000
        });
        const status = res.status || 0;
        const data = typeof res.data === "string" ? JSON.parse(res.data || "{}") : (res.data || {});
        if (status >= 400) {
          const err = new Error(data.error || ("HTTP " + status));
          err.status = status;
          err.code = data.code;
          throw err;
        }
        return data;
      }
    } catch (err) {
      if (err && err.status) throw err;
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (err) {
      const e = new Error("Server unreachable");
      e.code = "unreachable";
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || ("HTTP " + res.status));
      err.status = res.status;
      err.code = data.code;
      throw err;
    }
    return data;
  }

  function downloadBackupJson() {
    try {
      const blob = {
        exportedAt: new Date().toISOString(),
        data: localStorage.getItem(DATA_KEY),
        registry: localStorage.getItem(REGISTRY_KEY),
        companies: {},
        years: {}
      };
      const reg = readRegistry();
      if (reg) {
        (reg.companies || []).forEach(c => {
          blob.companies[c.id] = localStorage.getItem(companyStorageKey(c.id));
        });
        Object.entries(reg.years || {}).forEach(([cid, list]) => {
          (list || []).forEach(y => {
            const yearId = typeof y === "string" ? y : y.id;
            if (!yearId) return;
            blob.years[`${cid}_${yearId}`] = localStorage.getItem(yearStorageKey(cid, yearId));
          });
        });
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(blob)], { type: "application/json" }));
      a.download = `ledgerbay-backup-before-sync-${Date.now()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    } catch (_) {}
  }

  function replaceLocalWithServerPull(result) {
    // Wipe active company arrays then apply pull (and other companies into their keys)
    ARRAY_COLLECTIONS.forEach(k => { State[k] = []; });
    State._syncTombs = {};
    if (result.registry) {
      localStorage.setItem(REGISTRY_KEY, JSON.stringify(result.registry));
    }
    applyPullToState(result.pull || {}, State);
    Object.entries(result.pullCompanies || {}).forEach(([cid, pull]) => {
      if (cid === activeCompanyId()) return;
      const fake = { business: {}, accounts: { groups: [], ledgers: [], vouchers: [], cheques: [], openingBills: [], bankDates: {} }, _syncTombs: {} };
      ARRAY_COLLECTIONS.forEach(k => { fake[k] = []; });
      applyPullToState(pull, fake);
      rebuildStockFromDocuments(fake);
      const payload = {
        business: fake.business,
        parties: fake.parties,
        items: fake.items,
        invoices: fake.invoices,
        purchases: fake.purchases,
        expenses: fake.expenses,
        purchaseOrders: fake.purchaseOrders,
        debitNotes: fake.debitNotes,
        payments: fake.payments,
        recurringBills: fake.recurringBills,
        godowns: fake.godowns,
        stockTransfers: fake.stockTransfers,
        staff: fake.staff,
        activityLog: fake.activityLog,
        loyaltyLedger: fake.loyaltyLedger,
        customFieldDefs: fake.customFieldDefs,
        accounts: fake.accounts,
        schemaVersion: 3
      };
      localStorage.setItem(companyStorageKey(cid), JSON.stringify(payload));
    });
    Object.entries(result.years || {}).forEach(([id, rec]) => {
      if (rec && rec.snapshot) {
        const [cid, yearId] = id.split(/_(?=fy-)/);
        if (cid && yearId) localStorage.setItem(yearStorageKey(cid, yearId), JSON.stringify(rec.snapshot));
      }
    });
  }

  async function runSync(reason, opts) {
    let cfg = ensureDeviceId(loadSyncConfig());
    if (!cfg.enabled || !cfg.url) {
      cfg.lastStatus = "off";
      saveSyncConfig(cfg);
      return { ok: false, skipped: true };
    }
    if (!cfg.passcode) {
      cfg.lastStatus = "error";
      cfg.lastError = "Enter the sync passcode in Settings.";
      saveSyncConfig(cfg);
      if (typeof showToast === "function") showToast(cfg.lastError, "error");
      return { ok: false, error: cfg.lastError };
    }
    cfg.lastStatus = "syncing";
    cfg.lastError = "";
    saveSyncConfig(cfg);
    try {
      const base = cfg.url.replace(/\/+$/, "");
      const mode = (opts && opts.mode) || "merge";
      if (mode === "replace" || (opts && opts.backupFirst)) downloadBackupJson();

      const bundle = buildPushBundle();
      // First sync on this device (or Replace): do not push this device's business profile —
      // the server's / first device's profile is adopted below. Pushed afterwards only if the
      // server has none (BUG-V21.2-04).
      const joining = mode === "replace" || !cfg.joinedOnce;
      const pushNoBusiness = joining && bundle.push ? Object.fromEntries(Object.entries(bundle.push).filter(([k]) => k !== "business")) : bundle.push;
      const body = {
        passcode: cfg.passcode,
        deviceId: cfg.deviceId,
        since: mode === "replace" ? 0 : (cfg.lastSyncAt || 0),
        // 1.13.9 (L1b): server change-sequence cursor. A device that only has the old
        // timestamp cursor sends 0 once (one full pull); old servers ignore these fields.
        sinceSeq: mode === "replace" ? 0 : (Number(cfg.lastSyncSeq) || 0),
        seqEpoch: cfg.lastSyncSeqEpoch || "",
        companyId: bundle.companyId,
        companyIds: bundle.companyIds,
        registry: bundle.registry,
        firstJoin: joining,
        push: mode === "replace" ? {} : pushNoBusiness,
        otherCompanies: mode === "replace" ? {} : bundle.otherCompanies,
        years: mode === "replace" ? {} : bundle.years
      };
      const result = await httpJson(base + "/api/sync", {
        method: "POST",
        headers: { "X-BillSetu-Passcode": cfg.passcode },
        body: JSON.stringify(body)
      });

      let notices = [];
      let needBusinessPush = false;
      if (mode === "replace") {
        const localBusiness = State.business;
        replaceLocalWithServerPull(result);
        if (!adoptServerBusiness(result.pull || {}, State)) {
          State.business = localBusiness;
          needBusinessPush = !isBlankProfile(localBusiness);
        }
        notices = renumberDuplicates(State);
        rebuildStockFromDocuments(State);
      } else {
        if (result.registry && (!readRegistry() || tsOf(result.registry) >= tsOf(readRegistry()))) {
          localStorage.setItem(REGISTRY_KEY, JSON.stringify(result.registry));
        }
        if (joining) {
          if (!adoptServerBusiness(result.pull || {}, State)) needBusinessPush = !isBlankProfile(State.business);
          else if (lastAdoptFilledLocal) needBusinessPush = true;
          const { business: _b, ...restPull } = result.pull || {};
          applyPullToState(restPull, State);
        } else {
          applyPullToState(result.pull || {}, State);
        }
        // Other companies into their storage keys
        Object.entries(result.pullCompanies || {}).forEach(([cid, pull]) => {
          if (cid === bundle.companyId) return;
          let data = {};
          try { data = JSON.parse(localStorage.getItem(companyStorageKey(cid)) || "{}"); } catch (_) { data = {}; }
          ARRAY_COLLECTIONS.forEach(k => { if (!Array.isArray(data[k])) data[k] = []; });
          if (!data.business) data.business = {};
          applyPullToState(pull, data);
          rebuildStockFromDocuments(data);
          localStorage.setItem(companyStorageKey(cid), JSON.stringify(data));
        });
        Object.entries(result.years || {}).forEach(([id, rec]) => {
          if (!rec || !rec.snapshot) return;
          const parts = id.match(/^(.*)_(fy-.*)$/);
          if (parts) localStorage.setItem(yearStorageKey(parts[1], parts[2]), JSON.stringify(rec.snapshot));
        });
        notices = renumberDuplicates(State);
        rebuildStockFromDocuments(State);
      }
      // Bank-account VPA copies follow the (possibly just pulled) Settings → UPI ID.
      if (typeof deriveUpiVpaCopies === "function") deriveUpiVpaCopies();
      if (needBusinessPush && State.business) State.business.updatedAt = now();

      if (typeof saveToStorage === "function") saveToStorage();
      if (typeof writeStaffIndex === "function") writeStaffIndex();

      cfg = loadSyncConfig();
      cfg.lastSyncAt = result.serverTime || now();
      if (result.cursor != null && result.seqEpoch) { cfg.lastSyncSeq = Number(result.cursor) || 0; cfg.lastSyncSeqEpoch = result.seqEpoch; }
      else { delete cfg.lastSyncSeq; delete cfg.lastSyncSeqEpoch; }
      cfg.lastStatus = "ok";
      cfg.lastError = "";
      cfg.joinedOnce = true;
      cfg.pendingHint = 0;
      saveSyncConfig(cfg);

      if (typeof refreshAllViews === "function") refreshAllViews();
      else {
        try { if (typeof renderDashboard === "function") renderDashboard(); } catch (_) {}
      }
      // Open Settings form: refresh an untouched UPI field so a later Save can't resend an old VPA.
      try {
        const upiEl = document.getElementById("set-upi-id");
        if (upiEl && typeof window.__settingsUpiBaseline === "string" && upiEl.value.trim() === window.__settingsUpiBaseline && typeof currentUpiVpa === "function") {
          upiEl.value = currentUpiVpa();
          window.__settingsUpiBaseline = upiEl.value;
        }
      } catch (_) {}

      const bizLine = lastAdoptChanged.length ? `Business details updated from the synced books: ${lastAdoptChanged.join(", ")}.` : "";
      lastAdoptChanged = [];
      if (notices.length) {
        const lines = notices.map(n => n.message || `${n.from} → ${n.to}`).join("; ");
        if (typeof showToast === "function") {
          showToast(bizLine ? `${lines}. ${bizLine}` : lines, "warn", bizLine ? { ttlMs: 8000 } : undefined);
        }
        if (typeof showDocConflictBanner === "function") {
          try { showDocConflictBanner(notices); } catch (_) {}
        }
        console.info("[BillSetuSync] renumbered", notices);
      } else if (bizLine && typeof showToast === "function") {
        showToast(bizLine, "warn", { ttlMs: 8000 });
      } else if (typeof showToast === "function" && reason === "manual") {
        showToast("Synced with server");
      }
      if (needBusinessPush) {
        // Server had no profile yet: this device is the first one, so send its profile now.
        clearTimeout(window.__billsetuSyncSaveTimer);
        const follow = await runSync("auto", { mode: "merge" });
        return { ok: true, result, notices, pushedBusiness: !!(follow && follow.ok) };
      }
      return { ok: true, result, notices };
    } catch (err) {
      cfg = loadSyncConfig();
      cfg.lastStatus = "error";
      cfg.lastError = plainError(err);
      saveSyncConfig(cfg);
      if (typeof showToast === "function" && (reason === "manual" || reason === "join")) {
        showToast(cfg.lastError, "error");
      }
      return { ok: false, error: cfg.lastError };
    }
  }

  function softDelete(collection, id) {
    if (!id) return;
    const list = State[collection];
    if (!Array.isArray(list)) return;
    const row = list.find(r => r.id === id);
    if (!State._syncTombs) State._syncTombs = {};
    if (!State._syncTombs[collection]) State._syncTombs[collection] = {};
    const tomb = { ...(row || { id }), id, deletedAt: now(), updatedAt: now() };
    State._syncTombs[collection][id] = tomb;
    State[collection] = list.filter(r => r.id !== id);
  }

  function markUpdated(rec) {
    if (rec && typeof rec === "object") {
      rec.updatedAt = now();
      if (!rec.createdAt) rec.createdAt = rec.updatedAt;
      try {
        const cfg = loadSyncConfig();
        if (cfg && cfg.deviceId) {
          if (!rec.originDeviceId) rec.originDeviceId = cfg.deviceId;
          if (!rec.originDeviceLabel) {
            const id = String(cfg.deviceId || "");
            const tail = id.replace(/^device-/i, "");
            rec.originDeviceLabel = /phone/i.test(id) ? "Phone"
              : /pc|desktop|host/i.test(id) ? "PC"
              : (tail || id || "device");
          }
        }
      } catch (_) {}
    }
    return rec;
  }

  function countPendingLocal() {
    // Heuristic: records newer than lastSyncAt
    const cfg = loadSyncConfig();
    const since = Number(cfg.lastSyncAt) || 0;
    let n = 0;
    ARRAY_COLLECTIONS.forEach(key => {
      (State[key] || []).forEach(r => { if (tsOf(r) > since) n++; });
    });
    if (State.accounts) {
      ["groups", "ledgers", "vouchers", "cheques", "openingBills"].forEach(k => {
        (State.accounts[k] || []).forEach(r => { if (tsOf(r) > since) n++; });
      });
    }
    return n;
  }

  function updateSyncStatusChip() {
    const cfg = loadSyncConfig();
    const el = document.getElementById("sync-status-chip");
    if (!el) return;
    const val = el.querySelector(".chip-val") || el;
    if (!cfg.enabled) {
      val.textContent = "Sync off";
      el.title = "Open Settings → Device Sync";
      el.dataset.state = "off";
      return;
    }
    if (cfg.lastStatus === "syncing") {
      val.textContent = "Syncing…";
      el.dataset.state = "syncing";
    } else if (cfg.lastStatus === "error") {
      val.textContent = "Sync error";
      el.title = cfg.lastError || "Sync error";
      el.dataset.state = "error";
    } else if (cfg.lastSyncAt) {
      const ago = Math.round((now() - cfg.lastSyncAt) / 60000);
      val.textContent = ago <= 0 ? "Synced just now" : `Synced ${ago}m ago`;
      el.dataset.state = "ok";
      el.title = new Date(cfg.lastSyncAt).toLocaleString();
    } else {
      val.textContent = "Sync ready";
      el.dataset.state = "ready";
    }
  }

  function formatSyncAgo(ts) {
    if (!ts) return "";
    const mins = Math.max(0, Math.round((now() - ts) / 60000));
    if (mins <= 0) return "Synced just now";
    if (mins === 1) return "Synced 1 min ago";
    if (mins < 60) return `Synced ${mins} min ago`;
    const hrs = Math.round(mins / 60);
    if (hrs === 1) return "Synced 1 hour ago";
    if (hrs < 48) return `Synced ${hrs} hours ago`;
    return "Synced " + new Date(ts).toLocaleDateString();
  }

  function updateSyncSettingsStatus() {
    const cfg = loadSyncConfig();
    const last = document.getElementById("sync-last-time");
    const pending = document.getElementById("sync-pending-count");
    const err = document.getElementById("sync-error-text");
    const row = document.getElementById("sync-status-row");
    const text = document.getElementById("sync-status-text");
    const joinWrap = document.getElementById("sync-join-mode-wrap");
    const pendingN = countPendingLocal();

    if (last) {
      last.textContent = cfg.lastSyncAt
        ? new Date(cfg.lastSyncAt).toLocaleString()
        : "Never";
    }
    if (pending) pending.textContent = String(pendingN);

    let state = "idle";
    let label = "Not synced";
    if (cfg.lastStatus === "syncing") {
      state = "syncing";
      label = "Syncing…";
    } else if (cfg.lastStatus === "error") {
      state = "error";
      const msg = String(cfg.lastError || "");
      if (/unreachable|fetch|network|Failed to fetch|timeout/i.test(msg)) label = "Can't reach server";
      else if (/lock/i.test(msg)) label = "Locked out — try later";
      else if (/passcode|Wrong/i.test(msg)) label = "Wrong passcode";
      else label = "Can't reach server";
    } else if (cfg.lastSyncAt) {
      state = "ok";
      label = formatSyncAgo(cfg.lastSyncAt);
    } else if (cfg.enabled && cfg.url) {
      state = "ready";
      label = "Not synced";
    }

    if (row) row.dataset.state = state;
    if (text) text.textContent = label;
    if (err) {
      err.textContent = cfg.lastStatus === "error" ? (cfg.lastError || "") : "";
      err.hidden = cfg.lastStatus !== "error";
    }
    if (joinWrap) {
      // Show Merge/Replace only before first successful join
      joinWrap.hidden = !!cfg.joinedOnce;
    }
  }

  function defaultServerUrl() {
    try {
      if (typeof location !== "undefined" && /^https?:$/i.test(location.protocol) && location.hostname) {
        // Same origin when running from the sync server / PC web app
        if (location.port && location.port !== "80" && location.port !== "443") {
          return location.origin;
        }
        return location.origin;
      }
    } catch (_) {}
    return "";
  }

  async function firstJoinFlow() {
    const modeEl = document.querySelector('input[name="sync-join-mode"]:checked');
    const mode = modeEl ? modeEl.value : "merge";
    downloadBackupJson();
    return runSync("join", { mode, backupFirst: false });
  }

  function readSyncFormInto(cfg) {
    const url = document.getElementById("sync-url");
    const pass = document.getElementById("sync-passcode");
    const enabled = document.getElementById("sync-enabled");
    const auto = document.getElementById("sync-auto");
    cfg.url = (url?.value || "").trim();
    cfg.passcode = (pass?.value || "").trim();
    cfg.enabled = !!enabled?.checked;
    cfg.autoSync = auto ? !!auto.checked : true;
    ensureDeviceId(cfg);
    return cfg;
  }

  function syncFormDirty() {
    const cfg = loadSyncConfig();
    const url = (document.getElementById("sync-url")?.value || "").trim();
    const pass = (document.getElementById("sync-passcode")?.value || "").trim();
    const enabled = !!document.getElementById("sync-enabled")?.checked;
    const auto = document.getElementById("sync-auto") ? !!document.getElementById("sync-auto").checked : true;
    return url !== (cfg.url || "")
      || pass !== (cfg.passcode || "")
      || enabled !== !!cfg.enabled
      || auto !== (cfg.autoSync !== false);
  }

  function refreshSyncSaveVisibility() {
    const saveBtn = document.getElementById("btn-sync-save");
    if (!saveBtn) return;
    saveBtn.hidden = !syncFormDirty();
  }


  function applySyncRole(role) {
    const host = document.getElementById("sync-host-panel");
    const join = document.getElementById("sync-join-panel");
    const isHost = role === "host";
    if (host) {
      host.hidden = !isHost;
      host.classList.toggle("d-none", !isHost);
    }
    if (join) {
      join.hidden = isHost;
      join.classList.toggle("d-none", isHost);
    }
    const hostRadio = document.getElementById("sync-role-host");
    const joinRadio = document.getElementById("sync-role-join");
    if (hostRadio) hostRadio.checked = isHost;
    if (joinRadio) joinRadio.checked = !isHost;
    const hint = document.getElementById("sync-host-hint-url");
    if (hint) {
      const u = defaultServerUrl() || "http://192.168.x.x:3000";
      hint.textContent = u.includes("127.0.0.1") || u.includes("localhost")
        ? "http://<this-PC-LAN-IP>:3000"
        : u;
    }
  }

  async function testSyncConnection() {
    const result = document.getElementById("sync-test-result");
    const url = (document.getElementById("sync-url")?.value || "").trim().replace(/\/$/, "");
    const pass = (document.getElementById("sync-passcode")?.value || "").trim();
    if (result) {
      result.hidden = false;
      result.style.color = "";
      result.textContent = "Testing…";
    }
    if (!url) {
      if (result) { result.style.color = "var(--accent-red, #b91c1c)"; result.textContent = "Enter the server address first."; }
      return false;
    }
    if (!/^https?:\/\//i.test(url)) {
      if (result) { result.style.color = "var(--accent-red, #b91c1c)"; result.textContent = "Address must start with http:// or https://"; }
      return false;
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url + "/api/health", { method: "GET", signal: ctrl.signal, cache: "no-store" });
      clearTimeout(timer);
      let body = null;
      try { body = await res.json(); } catch (_) {}
      if (!res.ok) {
        if (result) {
          result.style.color = "var(--accent-red, #b91c1c)";
          result.textContent = "Server responded with HTTP " + res.status + ". Is the sync host running on your network?";
        }
        return false;
      }
      if (body && body.passcodeSet === false) {
        if (result) {
          result.style.color = "var(--accent-amber, #b45309)";
          result.textContent = "Reachable, but no passcode set yet. Open /setup on the PC first.";
        }
        return false;
      }
      if (!pass) {
        if (result) {
          result.style.color = "var(--accent-amber, #b45309)";
          result.textContent = "Server reachable (v" + (body?.version || "?") + "). Enter the passcode to sync.";
        }
        return true;
      }
      // Light auth probe via sync with empty push (server rejects bad passcode)
      const probe = await fetch(url + "/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-BillSetu-Passcode": pass },
        body: JSON.stringify({
          deviceId: "probe",
          companyId: "probe",
          since: Date.now() + 1e12,
          records: {},
          passcode: pass
        })
      });
      if (probe.status === 401 || probe.status === 403) {
        if (result) {
          result.style.color = "var(--accent-red, #b91c1c)";
          result.textContent = "Wrong passcode. Check the code set on the PC /setup page.";
        }
        return false;
      }
      if (result) {
        result.style.color = "var(--accent-green, #047857)";
        result.textContent = "Connected · " + (body?.version || "ok") + (body?.passcodeSet ? " · passcode ok" : "");
      }
      return true;
    } catch (err) {
      const msg = (err && err.name === "AbortError")
        ? "Timed out. Same Wi‑Fi as the host? Is sync running on that device?"
        : ("Cannot reach server. " + (err?.message || "Check the address and that the PC firewall allows port 3000."));
      if (result) { result.style.color = "var(--accent-red, #b91c1c)"; result.textContent = msg; }
      return false;
    }
  }


  function lbSyncPlatform() {
    try {
      if (window.billsetuDesktop && (billsetuDesktop.isDesktop || billsetuDesktop.platform)) return "desktop";
    } catch (_) {}
    try {
      if (window.Capacitor && typeof Capacitor.isNativePlatform === "function" && Capacitor.isNativePlatform()) {
        const p = (Capacitor.getPlatform && Capacitor.getPlatform()) || "android";
        return p === "ios" ? "ios" : "android";
      }
    } catch (_) {}
    return "web";
  }

  function refreshSyncHelpCopy() {
    const plat = lbSyncPlatform();
    const help = document.querySelector(".sync-help");
    const hostPanel = document.getElementById("sync-host-panel");
    const batHints = {
      web: {
        help: "On a computer, run start-sync (start-sync.bat on Windows, or node server.mjs), then enter the address it shows.",
        host: "On this computer, run <strong>start-sync.bat</strong> (Windows) or <code>node server.mjs</code> in the Ledgerbay folder. It starts the sync server.",
        file: "Opening the app as a file:// page cannot push — other devices need the http address from the sync host."
      },
      desktop: {
        help: "In the desktop app use <strong>Help → Sync</strong> or Host in Settings, then join from other devices with that address.",
        host: "This desktop app can host sync from Settings. Share the address shown below and your passcode with phones or other PCs on the same Wi‑Fi.",
        file: "Other devices must use the http address from Host — not a local file path."
      },
      android: {
        help: "On Android, choose <strong>Join</strong> and enter the address and passcode from the computer (or desktop app) that is hosting sync.",
        host: "Hosting sync from the phone is limited. Prefer a computer or desktop app as Host, then Join from this device.",
        file: "Use the http address from your Host device on the same Wi‑Fi."
      },
      ios: {
        help: "Choose <strong>Join</strong> and enter the address and passcode from the device hosting sync.",
        host: "Prefer a computer or desktop app as Host, then Join from this device.",
        file: "Use the http address from your Host device on the same Wi‑Fi."
      }
    };
    const copy = batHints[plat] || batHints.web;
    if (help) help.innerHTML = copy.help;
    if (hostPanel) {
      const ps = hostPanel.querySelectorAll("p.text-sm, p.text-xs.text-muted");
      // first instructional p.text-sm
      const main = hostPanel.querySelector("p.text-sm");
      if (main) main.innerHTML = copy.host;
      const fileP = [...hostPanel.querySelectorAll("p.text-xs")].find(el => /file:\/\/|start-sync|http address/i.test(el.textContent || ""));
      if (fileP) fileP.textContent = copy.file;
    }
  }

  function bindSyncSettingsUi() {
    const url = document.getElementById("sync-url");
    const pass = document.getElementById("sync-passcode");
    const enabled = document.getElementById("sync-enabled");
    const auto = document.getElementById("sync-auto");
    const cfg = loadSyncConfig();
    if (url) url.value = cfg.url || defaultServerUrl();
    if (pass) pass.value = cfg.passcode || "";
    if (enabled) enabled.checked = !!cfg.enabled;
    if (auto) auto.checked = cfg.autoSync !== false;

    const saveBtn = document.getElementById("btn-sync-save");
    const nowBtn = document.getElementById("btn-sync-now");
    const eyeBtn = document.getElementById("btn-sync-pass-toggle");

    const markDirty = () => refreshSyncSaveVisibility();
    [url, pass, enabled, auto].forEach(el => {
      if (!el || el.dataset.dirtyBound) return;
      el.dataset.dirtyBound = "1";
      el.addEventListener("input", markDirty);
      el.addEventListener("change", markDirty);
    });

    if (saveBtn && !saveBtn.dataset.bound) {
      saveBtn.dataset.bound = "1";
      saveBtn.addEventListener("click", () => {
        const next = readSyncFormInto(loadSyncConfig());
        saveSyncConfig(next);
        startAutoSync();
        refreshSyncSaveVisibility();
        if (typeof showToast === "function") showToast("Sync settings saved");
      });
    }
    if (nowBtn && !nowBtn.dataset.bound) {
      nowBtn.dataset.bound = "1";
      nowBtn.addEventListener("click", async () => {
        const next = readSyncFormInto(loadSyncConfig());
        // Turning Sync now on implies enabling sync
        next.enabled = true;
        if (enabled) enabled.checked = true;
        saveSyncConfig(next);
        startAutoSync();
        refreshSyncSaveVisibility();
        if (!next.joinedOnce) {
          await firstJoinFlow();
        } else {
          await runSync("manual", { mode: "merge" });
        }
        updateSyncSettingsStatus();
      });
    }
    if (eyeBtn && !eyeBtn.dataset.bound) {
      eyeBtn.dataset.bound = "1";
      eyeBtn.addEventListener("click", () => {
        if (!pass) return;
        const show = pass.type === "password";
        pass.type = show ? "text" : "password";
        eyeBtn.setAttribute("aria-label", show ? "Hide passcode" : "Show passcode");
        eyeBtn.title = show ? "Hide passcode" : "Show passcode";
        const showIcon = eyeBtn.querySelector(".eye-show");
        const hideIcon = eyeBtn.querySelector(".eye-hide");
        if (showIcon) showIcon.classList.toggle("d-none", show);
        if (hideIcon) hideIcon.classList.toggle("d-none", !show);
      });
    }
    // Remove legacy First join button if present in older HTML
    const joinBtn = document.getElementById("btn-sync-join");
    if (joinBtn) joinBtn.remove();

    const role = cfg.role === "host" ? "host" : "join";
    applySyncRole(role);
    document.querySelectorAll('input[name="sync-role"]').forEach(el => {
      if (el.dataset.roleBound) return;
      el.dataset.roleBound = "1";
      el.addEventListener("change", () => {
        const next = loadSyncConfig();
        next.role = el.value;
        saveSyncConfig(next);
        applySyncRole(el.value);
      });
    });

    const testBtn = document.getElementById("btn-sync-test");
    if (testBtn && !testBtn.dataset.bound) {
      testBtn.dataset.bound = "1";
      testBtn.addEventListener("click", () => testSyncConnection());
    }

    refreshSyncSaveVisibility();
    updateSyncStatusChip();
    updateSyncSettingsStatus();
  }

  let autoTimer = null;
  function startAutoSync() {
    if (autoTimer) clearInterval(autoTimer);
    autoTimer = setInterval(() => {
      const cfg = loadSyncConfig();
      if (cfg.enabled && cfg.url && cfg.autoSync !== false) runSync("auto");
    }, Math.max(15, Number(loadSyncConfig().autoSeconds) || 60) * 1000);
  }

  function patchNextDocNo() {
    // Fold server/sync counters into BillSetuDocNumbering; do NOT replace the
    // Settings-driven formatter with a hard-coded year pattern.
    if (typeof BillSetuDocNumbering === "undefined") return;
    const counters = (typeof State !== "undefined" && State._syncCounters) || {};
    const map = [
      ["invoice", "TAX_INVOICE"],
      ["purchase", "PURCHASE"],
      ["debitNote", "DEBIT_NOTE"],
      ["purchaseOrder", "PURCHASE_ORDER"],
      ["payment", "RECEIPT"]
    ];
    map.forEach(([cKey, seriesKey]) => {
      const v = Number(counters[cKey]) || 0;
      if (v > 0 && BillSetuDocNumbering.bumpSeriesPastMax) {
        BillSetuDocNumbering.bumpSeriesPastMax(seriesKey, [String(v)]);
      }
    });
  }

  function patchDeleteExpense() {
    if (typeof deleteExpense !== "function") return;
    window.deleteExpense = function (id) {
      if (typeof blockedAction === "function" && blockedAction("expense")) return;
      softDelete("expenses", id);
      if (typeof saveToStorage === "function") saveToStorage();
      if (typeof renderExpensesTable === "function") renderExpensesTable();
      const cfg = loadSyncConfig();
      if (cfg.enabled && cfg.autoSync !== false) runSync("auto");
    };
    try { deleteExpense = window.deleteExpense; } catch (_) {}
  }

  function patchSaveToStorage() {
    if (typeof saveToStorage !== "function") return;
    const original = saveToStorage;
    window.saveToStorage = function () {
      if (State.business) {
        State.business.updatedAt = State.business.updatedAt || now();
      }
      original();
      const cfg = loadSyncConfig();
      if (cfg.enabled && cfg.autoSync !== false) {
        // debounce after save
        clearTimeout(window.__billsetuSyncSaveTimer);
        window.__billsetuSyncSaveTimer = setTimeout(() => runSync("auto"), 800);
      }
      updateSyncSettingsStatus();
    };
    try { saveToStorage = window.saveToStorage; } catch (_) {}
  }

  window.BillSetuSync = {
    loadSyncConfig,
    saveSyncConfig,
    testSyncConnection,
    applySyncRole,
    runSync,
    softDelete,
    markUpdated,
    isBlankProfile,
    rebuildStockFromDocuments: st => rebuildStockFromDocuments(st || State),
    settleStockDocs: st => settleStockDocs(st || State),
    renumberDuplicates: () => renumberDuplicates(State),
    updateSyncStatusChip,
    bindSyncSettingsUi,
    countPendingLocal,
    downloadBackupJson,
    activeCompanyId,
    ARRAY_COLLECTIONS,
    DOC_NUMBER_FIELDS
  };

  window.updateSyncStatusChip = updateSyncStatusChip;

  document.addEventListener("DOMContentLoaded", () => {
    ensureDeviceId(loadSyncConfig());
    bindSyncSettingsUi();
    patchNextDocNo();
    patchDeleteExpense();
    patchSaveToStorage();
    startAutoSync();
    updateSyncStatusChip();
    setTimeout(() => {
      const cfg = loadSyncConfig();
      if (cfg.enabled && cfg.url && cfg.autoSync !== false) runSync("open");
    }, 1200);
  });
})();
