/**
 * Ledgerbay v20 — Import parties / items from myBillBook or other CSVs.
 * Auto-detects myBillBook columns; supports manual mapping, preview warnings,
 * duplicate policies, undo snapshot, and sync via saveToStorage.
 */
(function (global) {
  "use strict";

  const UNDO_KEY = "billsetu_import_undo_v1";

  const PARTY_FIELDS = [
    { key: "name", label: "Party name", required: true },
    { key: "category", label: "Category / group" },
    { key: "phone", label: "Mobile" },
    { key: "type", label: "Party type (Customer/Supplier)" },
    { key: "balance", label: "Balance (INR)" },
    { key: "direction", label: "Direction (To Collect / To Pay)" }
  ];

  const ITEM_FIELDS = [
    { key: "name", label: "Item name", required: true },
    { key: "category", label: "Category (Sub_label)" },
    { key: "serialized", label: "Serialized" },
    { key: "code", label: "Item code" },
    { key: "stock", label: "Stock qty" },
    { key: "unit", label: "Unit" },
    { key: "sellingPrice", label: "Selling price" },
    { key: "costPrice", label: "Purchase price" }
  ];

  const MBB_PARTY = {
    name: ["party name", "party", "name", "customer name", "supplier name"],
    category: ["category", "group", "party category"],
    phone: ["mobile number", "mobile", "phone", "phone number", "contact"],
    type: ["party type", "type", "customer/supplier"],
    balance: ["balance (inr)", "balance", "opening balance", "amount"],
    direction: ["direction", "balance type", "to collect/to pay"]
  };

  const MBB_ITEM = {
    name: ["item name", "item", "name", "product name"],
    category: ["sub_label", "sub label", "category", "group"],
    serialized: ["serialized", "serial", "track serial"],
    code: ["item code", "code", "sku", "barcode"],
    stock: ["stock qty", "stock", "qty", "quantity", "opening stock"],
    unit: ["unit", "uom"],
    sellingPrice: ["selling price", "sale price", "mrp", "price"],
    costPrice: ["purchase price", "cost price", "buy price", "cost"]
  };

  let session = {
    kind: null, // parties | items
    headers: [],
    rows: [],
    mapping: {},
    dupPolicy: "skip", // skip | update | keep_both
    preview: null
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = "";
    let i = 0;
    let inQuotes = false;
    const src = String(text || "").replace(/^\uFEFF/, "");
    while (i < src.length) {
      const ch = src[i];
      if (inQuotes) {
        if (ch === '"') {
          if (src[i + 1] === '"') { cell += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        cell += ch; i++; continue;
      }
      if (ch === '"') { inQuotes = true; i++; continue; }
      if (ch === ",") { row.push(cell); cell = ""; i++; continue; }
      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && src[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some(c => String(c).trim() !== "")) rows.push(row);
        row = []; i++; continue;
      }
      cell += ch; i++;
    }
    if (cell.length || row.length) {
      row.push(cell);
      if (row.some(c => String(c).trim() !== "")) rows.push(row);
    }
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map(h => String(h || "").trim());
    const records = rows.slice(1).map(r => {
      const obj = {};
      headers.forEach((h, idx) => { obj[h] = r[idx] == null ? "" : String(r[idx]); });
      return obj;
    });
    return { headers, records };
  }

  function normHeader(h) {
    return String(h || "").trim().toLowerCase().replace(/[_/]+/g, " ").replace(/\s+/g, " ");
  }

  function scoreMap(headers, dict) {
    const mapping = {};
    const used = new Set();
    Object.keys(dict).forEach(field => {
      const aliases = dict[field];
      let best = null;
      let bestScore = -1;
      headers.forEach(h => {
        if (used.has(h)) return;
        const n = normHeader(h);
        aliases.forEach(a => {
          const an = normHeader(a);
          let score = 0;
          if (n === an) score = 100;
          else if (n.includes(an) || an.includes(n)) score = 60;
          if (score > bestScore) { bestScore = score; best = h; }
        });
      });
      if (best && bestScore >= 60) {
        mapping[field] = best;
        used.add(best);
      }
    });
    return mapping;
  }

  function detectKind(headers) {
    const partyScore = Object.keys(scoreMap(headers, MBB_PARTY)).length;
    const itemScore = Object.keys(scoreMap(headers, MBB_ITEM)).length;
    const norms = headers.map(normHeader);
    const hasPartyName = norms.some(h => h.includes("party name") || h === "party");
    const hasItemName = norms.some(h => h.includes("item name") || h === "item");
    const hasDirection = norms.some(h => h.includes("direction") || h.includes("to collect"));
    const hasSerialized = norms.some(h => h.includes("serial"));
    if (hasItemName || hasSerialized || (itemScore > partyScore && itemScore >= 3)) return "items";
    if (hasPartyName || hasDirection || (partyScore > itemScore && partyScore >= 3)) return "parties";
    if (itemScore >= partyScore && itemScore >= 2) return "items";
    if (partyScore >= 2) return "parties";
    return "unknown";
  }

  function autoMap(kind, headers) {
    if (kind === "parties") return scoreMap(headers, MBB_PARTY);
    if (kind === "items") return scoreMap(headers, MBB_ITEM);
    return {};
  }

  function num(v) {
    if (v == null) return null;
    const s = String(v).trim().replace(/,/g, "").replace(/₹/g, "").replace(/\s/g, "");
    if (s === "" || s === "-" || s === "—") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  function truthySerialized(v) {
    const s = String(v || "").trim().toLowerCase();
    return s === "yes" || s === "y" || s === "true" || s === "1" || s === "serial" || s === "serialized";
  }

  function normalizePhone(raw) {
    let s = String(raw || "").trim();
    if (!s) return { phone: "", warning: "blank_mobile" };
    s = s.replace(/[^\d+]/g, "");
    if (s.startsWith("+91")) s = s.slice(3);
    if (s.startsWith("91") && s.length === 12) s = s.slice(2);
    if (s.startsWith("0") && s.length === 11) s = s.slice(1);
    if (!/^[6-9]\d{9}$/.test(s)) return { phone: s, warning: "invalid_mobile" };
    return { phone: s, warning: null };
  }

  function mapPartyType(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (s.startsWith("sup")) return "SUPPLIER";
    return "CUSTOMER";
  }

  function mapDirection(raw, type, balance) {
    const s = String(raw || "").trim().toLowerCase();
    if (s.includes("pay")) return "PAYABLE";
    if (s.includes("collect") || s.includes("receive")) return "RECEIVABLE";
    if (Math.abs(balance || 0) < 1e-9) {
      return type === "SUPPLIER" ? "PAYABLE" : "RECEIVABLE";
    }
    return type === "SUPPLIER" ? "PAYABLE" : "RECEIVABLE";
  }

  function mapItemCategory(sub) {
    const s = String(sub || "").trim();
    if (!s || s === "-") return "GENERAL";
    const key = s.toUpperCase().replace(/\s+/g, "_");
    if (typeof CATEGORY_PRESETS !== "undefined" && CATEGORY_PRESETS[key]) return key;
    // Match by label
    if (typeof CATEGORY_PRESETS !== "undefined") {
      const hit = Object.entries(CATEGORY_PRESETS).find(([, p]) =>
        String(p.label || "").toLowerCase() === s.toLowerCase());
      if (hit) return hit[0];
    }
    // Keep free-text category (ensureBooks no longer strips these)
    return key.length <= 40 ? key : s.slice(0, 40);
  }

  function cell(record, mapping, field) {
    const col = mapping[field];
    if (!col) return "";
    return record[col] == null ? "" : record[col];
  }

  function buildPartyPreview(records, mapping, dupPolicy) {
    const existingByName = new Map();
    (State.parties || []).forEach(p => {
      const k = String(p.name || "").trim().toLowerCase();
      if (k) existingByName.set(k, p);
    });
    const seenInFile = new Map();
    const rows = [];
    const warnings = [];
    let skip = 0, update = 0, add = 0, keepBoth = 0;
    let sumRecv = 0, sumPay = 0;

    records.forEach((rec, idx) => {
      const name = String(cell(rec, mapping, "name") || "").trim();
      if (!name) {
        warnings.push({ row: idx + 2, level: "error", msg: "Missing party name — row skipped" });
        skip++;
        return;
      }
      const phoneInfo = normalizePhone(cell(rec, mapping, "phone"));
      if (phoneInfo.warning === "blank_mobile") {
        warnings.push({ row: idx + 2, level: "warn", msg: `${name}: blank mobile` });
      } else if (phoneInfo.warning === "invalid_mobile") {
        warnings.push({ row: idx + 2, level: "warn", msg: `${name}: invalid mobile “${cell(rec, mapping, "phone")}”` });
      }
      const type = mapPartyType(cell(rec, mapping, "type"));
      const balance = Math.abs(num(cell(rec, mapping, "balance")) || 0);
      const balType = mapDirection(cell(rec, mapping, "direction"), type, balance);
      if (balType === "RECEIVABLE") sumRecv += balance; else sumPay += balance;
      let category = String(cell(rec, mapping, "category") || "").trim();
      if (category === "-") category = "";

      const key = name.toLowerCase();
      const fileDup = seenInFile.has(key);
      const existing = existingByName.get(key);
      let action = "add";
      let finalName = name;
      if (fileDup) {
        warnings.push({ row: idx + 2, level: "warn", msg: `Duplicate name in file: ${name}` });
        if (dupPolicy === "skip") { action = "skip"; skip++; }
        else if (dupPolicy === "update") { action = "update_file"; update++; }
        else { action = "add"; finalName = `${name} (${seenInFile.get(key) + 1})`; keepBoth++; }
      } else if (existing) {
        warnings.push({ row: idx + 2, level: "warn", msg: `Already in books: ${name}` });
        if (dupPolicy === "skip") { action = "skip"; skip++; }
        else if (dupPolicy === "update") { action = "update"; update++; }
        else { action = "add"; finalName = `${name} (import)`; keepBoth++; }
      } else {
        add++;
      }
      seenInFile.set(key, (seenInFile.get(key) || 0) + 1);

      rows.push({
        action, finalName, name, type, balance, balType,
        phone: phoneInfo.phone, group: category,
        existingId: existing?.id || null
      });
    });

    return {
      kind: "parties",
      rows,
      warnings,
      counts: {
        total: records.length,
        add, update, skip, keepBoth,
        customers: rows.filter(r => r.action !== "skip" && r.type === "CUSTOMER").length,
        suppliers: rows.filter(r => r.action !== "skip" && r.type === "SUPPLIER").length,
        sumRecv: Math.round(sumRecv * 100) / 100,
        sumPay: Math.round(sumPay * 100) / 100
      }
    };
  }

  function buildItemPreview(records, mapping, dupPolicy) {
    const existingByName = new Map();
    (State.items || []).forEach(it => {
      const k = String(it.name || "").trim().toLowerCase();
      if (k) existingByName.set(k, it);
    });
    const seenInFile = new Map();
    const rows = [];
    const warnings = [];
    let skip = 0, update = 0, add = 0, keepBoth = 0;

    records.forEach((rec, idx) => {
      const name = String(cell(rec, mapping, "name") || "").trim();
      if (!name) {
        warnings.push({ row: idx + 2, level: "error", msg: "Missing item name — row skipped" });
        skip++;
        return;
      }
      const selling = num(cell(rec, mapping, "sellingPrice"));
      const cost = num(cell(rec, mapping, "costPrice"));
      const stock = num(cell(rec, mapping, "stock"));
      const unit = String(cell(rec, mapping, "unit") || "PCS").trim() || "PCS";
      const code = String(cell(rec, mapping, "code") || "").trim();
      const trackSerial = truthySerialized(cell(rec, mapping, "serialized"));
      const category = mapItemCategory(cell(rec, mapping, "category"));

      if (selling == null) warnings.push({ row: idx + 2, level: "warn", msg: `${name}: blank selling price` });
      if (cost == null) warnings.push({ row: idx + 2, level: "warn", msg: `${name}: blank purchase price` });
      if (stock != null && stock < 0) warnings.push({ row: idx + 2, level: "warn", msg: `${name}: negative stock (${stock})` });

      const key = name.toLowerCase();
      const fileDup = seenInFile.has(key);
      const existing = existingByName.get(key);
      let action = "add";
      let finalName = name;
      if (fileDup) {
        warnings.push({ row: idx + 2, level: "warn", msg: `Duplicate name in file: ${name}` });
        if (dupPolicy === "skip") { action = "skip"; skip++; }
        else if (dupPolicy === "update") { action = "update_file"; update++; }
        else { action = "add"; finalName = `${name} (${seenInFile.get(key) + 1})`; keepBoth++; }
      } else if (existing) {
        warnings.push({ row: idx + 2, level: "warn", msg: `Already in books: ${name}` });
        if (dupPolicy === "skip") { action = "skip"; skip++; }
        else if (dupPolicy === "update") { action = "update"; update++; }
        else { action = "add"; finalName = `${name} (import)`; keepBoth++; }
      } else {
        add++;
      }
      seenInFile.set(key, (seenInFile.get(key) || 0) + 1);

      rows.push({
        action, finalName, name, category, trackSerial, code,
        stock: stock == null ? 0 : stock,
        unit, sellingPrice: selling == null ? 0 : selling,
        costPrice: cost == null ? 0 : cost,
        existingId: existing?.id || null
      });
    });

    return {
      kind: "items",
      rows,
      warnings,
      counts: {
        total: records.length,
        add, update, skip, keepBoth,
        serialized: rows.filter(r => r.action !== "skip" && r.trackSerial).length,
        negStock: rows.filter(r => r.action !== "skip" && r.stock < 0).length,
        blankPrice: rows.filter(r => r.action !== "skip" && (!r.sellingPrice || !r.costPrice)).length
      }
    };
  }

  function takeUndoSnapshot(kind) {
    const snap = {
      at: Date.now(),
      kind,
      parties: JSON.parse(JSON.stringify(State.parties || [])),
      items: JSON.parse(JSON.stringify(State.items || [])),
      businessUpdatedAt: State.business?.updatedAt || 0
    };
    try {
      localStorage.setItem(UNDO_KEY, JSON.stringify(snap));
    } catch (err) {
      console.warn("import undo snapshot failed", err);
    }
    return snap;
  }

  function stamp(rec) {
    if (typeof markUpdated === "function") markUpdated(rec);
    else {
      rec.updatedAt = Date.now();
      if (State.currentActor) {
        rec.originDeviceId = State.business?.deviceId || "";
        rec.originDeviceLabel = State.business?.deviceLabel || "";
      }
    }
    return rec;
  }

  function newId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function defaultStateCode() {
    return State.business?.stateCode || "";
  }
  function defaultStateName() {
    return State.business?.stateName || "";
  }

  function applyPartyPreview(preview) {
    takeUndoSnapshot("parties");
    const byId = new Map((State.parties || []).map(p => [p.id, p]));
    let applied = 0;
    preview.rows.forEach(row => {
      if (row.action === "skip") return;
      if (row.action === "update" || row.action === "update_file") {
        const target = row.existingId ? byId.get(row.existingId)
          : (State.parties || []).find(p => String(p.name).trim().toLowerCase() === row.name.toLowerCase());
        if (target) {
          target.name = row.finalName;
          target.phone = row.phone || target.phone;
          target.type = row.type;
          target.balance = row.balance;
          target.balType = row.balType;
          target.group = row.group || target.group || "";
          stamp(target);
          applied++;
          return;
        }
      }
      const party = stamp({
        id: newId("pty"),
        name: row.finalName,
        phone: row.phone || "",
        email: "",
        gstin: "",
        stateCode: defaultStateCode(),
        stateName: defaultStateName(),
        address: "",
        balance: row.balance,
        balType: row.balType,
        type: row.type,
        creditLimit: 0,
        loyaltyPoints: 0,
        group: row.group || ""
      });
      State.parties.push(party);
      applied++;
    });
    if (State.business) State.business.updatedAt = Date.now();
    if (typeof logActivity === "function") logActivity(`Imported ${applied} parties from CSV`);
    saveToStorage();
    return applied;
  }

  function applyItemPreview(preview) {
    takeUndoSnapshot("items");
    const byId = new Map((State.items || []).map(it => [it.id, it]));
    let applied = 0;
    preview.rows.forEach(row => {
      if (row.action === "skip") return;
      if (row.action === "update" || row.action === "update_file") {
        const target = row.existingId ? byId.get(row.existingId)
          : (State.items || []).find(it => String(it.name).trim().toLowerCase() === row.name.toLowerCase());
        if (target) {
          target.name = row.finalName;
          target.category = row.category;
          target.unit = row.unit;
          target.sellingPrice = row.sellingPrice;
          target.costPrice = row.costPrice;
          target.wholesalePrice = Math.round((row.sellingPrice || 0) * 0.92);
          target.code = row.code || target.code || "";
          target.trackSerial = row.trackSerial;
          if (!row.trackSerial) target.stock = row.stock;
          else {
            target.serials = Array.isArray(target.serials) ? target.serials : [];
            target.stock = target.serials.length;
          }
          if (typeof syncItemStock === "function") syncItemStock(target);
          stamp(target);
          applied++;
          return;
        }
      }
      const item = stamp({
        id: newId("itm"),
        name: row.finalName,
        brand: "",
        model: "",
        code: row.code || "",
        hsn: "",
        category: row.category,
        unit: row.unit || "PCS",
        costPrice: row.costPrice,
        sellingPrice: row.sellingPrice,
        wholesalePrice: Math.round((row.sellingPrice || 0) * 0.92),
        gstRate: 18,
        warrantyMonths: 0,
        stock: row.trackSerial ? 0 : row.stock,
        minStock: 0,
        trackSerial: !!row.trackSerial,
        serials: [],
        godownQty: {},
        serialGodown: {},
        custom: {}
      });
      if (!item.trackSerial && typeof defaultGodownId === "function") {
        item.godownQty[defaultGodownId()] = row.stock;
      }
      if (typeof syncItemStock === "function") syncItemStock(item);
      State.items.push(item);
      applied++;
    });
    if (State.business) State.business.updatedAt = Date.now();
    if (typeof logActivity === "function") logActivity(`Imported ${applied} items from CSV`);
    saveToStorage();
    return applied;
  }

  function undoLastImport() {
    let snap;
    try { snap = JSON.parse(localStorage.getItem(UNDO_KEY) || "null"); } catch (_) { snap = null; }
    if (!snap || !Array.isArray(snap.parties) || !Array.isArray(snap.items)) {
      showToast("No import to undo.", "error");
      return false;
    }
    State.parties = snap.parties;
    State.items = snap.items;
    if (State.business) State.business.updatedAt = Date.now();
    localStorage.removeItem(UNDO_KEY);
    if (typeof logActivity === "function") logActivity("Undid last CSV import");
    saveToStorage();
    if (typeof renderParties === "function") renderParties();
    if (typeof renderInventoryTable === "function") renderInventoryTable();
    if (typeof renderDashboard === "function") renderDashboard();
    updateUndoButton();
    showToast("Last import undone.");
    return true;
  }

  function updateUndoButton() {
    const btn = document.getElementById("btn-undo-csv-import");
    if (!btn) return;
    let snap = null;
    try { snap = JSON.parse(localStorage.getItem(UNDO_KEY) || "null"); } catch (_) {}
    const has = !!(snap && snap.at);
    btn.classList.toggle("d-none", !has);
    if (has) {
      const ageMin = Math.round((Date.now() - snap.at) / 60000);
      btn.title = `Undo import from ${ageMin} min ago`;
    }
  }

  function rebuildPreview() {
    if (!session.rows.length) return;
    session.mapping = readMappingFromUi() || session.mapping;
    session.dupPolicy = document.querySelector('input[name="csv-dup-policy"]:checked')?.value || session.dupPolicy;
    if (session.kind === "parties") session.preview = buildPartyPreview(session.rows, session.mapping, session.dupPolicy);
    else if (session.kind === "items") session.preview = buildItemPreview(session.rows, session.mapping, session.dupPolicy);
    else session.preview = null;
    renderPreviewPane();
  }

  function readMappingFromUi() {
    const fields = session.kind === "parties" ? PARTY_FIELDS : ITEM_FIELDS;
    const mapping = {};
    fields.forEach(f => {
      const el = document.getElementById(`csv-map-${f.key}`);
      if (el && el.value) mapping[f.key] = el.value;
    });
    return mapping;
  }

  function renderMappingPane() {
    const host = document.getElementById("csv-mapping-fields");
    if (!host) return;
    const fields = session.kind === "parties" ? PARTY_FIELDS : session.kind === "items" ? ITEM_FIELDS : [];
    const opts = [`<option value="">— skip —</option>`]
      .concat(session.headers.map(h => `<option value="${esc(h)}">${esc(h)}</option>`));
    host.innerHTML = fields.map(f => {
      const selected = session.mapping[f.key] || "";
      const options = session.headers.map(h =>
        `<option value="${esc(h)}" ${h === selected ? "selected" : ""}>${esc(h)}</option>`).join("");
      return `<div class="form-group col-6">
        <label>${esc(f.label)}${f.required ? " *" : ""}</label>
        <select class="form-control" id="csv-map-${f.key}">
          <option value="">— skip —</option>
          ${options}
        </select>
      </div>`;
    }).join("");
    host.querySelectorAll("select").forEach(sel => {
      sel.addEventListener("change", rebuildPreview);
    });
  }

  function renderPreviewPane() {
    const summary = document.getElementById("csv-preview-summary");
    const warnBox = document.getElementById("csv-preview-warnings");
    const confirmBtn = document.getElementById("btn-csv-import-confirm");
    if (!summary || !session.preview) {
      if (summary) summary.textContent = "Choose a CSV to preview.";
      if (confirmBtn) confirmBtn.disabled = true;
      return;
    }
    const c = session.preview.counts;
    if (session.kind === "parties") {
      summary.innerHTML = `<strong>${c.total}</strong> rows · add <strong>${c.add}</strong> · update <strong>${c.update}</strong> · skip <strong>${c.skip}</strong>
        · customers ${c.customers} · suppliers ${c.suppliers}
        <br>Opening To Collect ₹${c.sumRecv.toLocaleString("en-IN")} · To Pay ₹${c.sumPay.toLocaleString("en-IN")}`;
    } else {
      summary.innerHTML = `<strong>${c.total}</strong> rows · add <strong>${c.add}</strong> · update <strong>${c.update}</strong> · skip <strong>${c.skip}</strong>
        · serialized ${c.serialized} · negative stock ${c.negStock} · blank prices ${c.blankPrice}`;
    }
    const warns = session.preview.warnings || [];
    if (warnBox) {
      if (!warns.length) warnBox.innerHTML = `<p class="text-sm text-muted">No warnings.</p>`;
      else {
        const show = warns.slice(0, 40);
        warnBox.innerHTML = `<p class="text-sm"><strong>${warns.length}</strong> warning(s)</p>
          <ul class="csv-warn-list">${show.map(w =>
            `<li class="csv-warn-${w.level}">Row ${w.row}: ${esc(w.msg)}</li>`).join("")}
          ${warns.length > 40 ? `<li>…and ${warns.length - 40} more</li>` : ""}</ul>`;
      }
    }
    if (confirmBtn) {
      const actionable = session.preview.rows.filter(r => r.action !== "skip").length;
      confirmBtn.disabled = actionable === 0;
      confirmBtn.textContent = `Import ${actionable} ${session.kind}`;
    }
  }

  function openModalWithFile(file, forceKind) {
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseCsv(reader.result);
      if (!parsed.headers.length) {
        showToast("That CSV has no header row.", "error");
        return;
      }
      session.headers = parsed.headers;
      session.rows = parsed.records;
      session.kind = forceKind || detectKind(parsed.headers);
      if (session.kind === "unknown") session.kind = "parties";
      session.mapping = autoMap(session.kind, parsed.headers);
      session.dupPolicy = "skip";
      const kindSel = document.getElementById("csv-import-kind");
      if (kindSel) kindSel.value = session.kind;
      const fileLabel = document.getElementById("csv-import-filename");
      if (fileLabel) fileLabel.textContent = file.name || "CSV";
      document.querySelectorAll('input[name="csv-dup-policy"]').forEach(r => {
        r.checked = r.value === "skip";
      });
      renderMappingPane();
      rebuildPreview();
      document.getElementById("modal-csv-import")?.classList.add("open");
    };
    reader.readAsText(file);
  }

  function confirmImport() {
    if (typeof blockedAction === "function" && blockedAction("settings")) return;
    rebuildPreview();
    if (!session.preview) return;
    let n = 0;
    if (session.kind === "parties") n = applyPartyPreview(session.preview);
    else n = applyItemPreview(session.preview);
    document.getElementById("modal-csv-import")?.classList.remove("open");
    updateUndoButton();
    if (typeof renderParties === "function") renderParties();
    if (typeof renderInventoryTable === "function") renderInventoryTable();
    if (typeof renderDashboard === "function") renderDashboard();
    showToast(`Imported ${n} ${session.kind}. Undo is available if needed.`);
  }

  function wireUi() {
    const fileInput = document.getElementById("input-import-csv");
    document.getElementById("btn-import-csv")?.addEventListener("click", () => {
      if (typeof blockedAction === "function" && blockedAction("settings")) return;
      fileInput?.click();
    });
    document.getElementById("btn-import-csv-parties")?.addEventListener("click", () => {
      if (typeof blockedAction === "function" && blockedAction("settings")) return;
      session.forceKind = "parties";
      fileInput?.click();
    });
    document.getElementById("btn-import-csv-items")?.addEventListener("click", () => {
      if (typeof blockedAction === "function" && blockedAction("settings")) return;
      session.forceKind = "items";
      fileInput?.click();
    });
    fileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      const forced = session.forceKind || null;
      session.forceKind = null;
      openModalWithFile(file, forced);
    });
    document.getElementById("csv-import-kind")?.addEventListener("change", (e) => {
      session.kind = e.target.value;
      session.mapping = autoMap(session.kind, session.headers);
      renderMappingPane();
      rebuildPreview();
    });
    document.querySelectorAll('input[name="csv-dup-policy"]').forEach(r => {
      r.addEventListener("change", rebuildPreview);
    });
    document.getElementById("btn-csv-import-confirm")?.addEventListener("click", confirmImport);
    document.getElementById("btn-csv-import-cancel")?.addEventListener("click", () => {
      document.getElementById("modal-csv-import")?.classList.remove("open");
    });
    document.getElementById("btn-undo-csv-import")?.addEventListener("click", undoLastImport);
    updateUndoButton();
  }

  // Test/helpers surface
  global.BillSetuCsvImport = {
    parseCsv,
    detectKind,
    autoMap,
    buildPartyPreview,
    buildItemPreview,
    applyPartyPreview,
    applyItemPreview,
    undoLastImport,
    normalizePhone,
    mapDirection,
    mapPartyType,
    mapItemCategory,
    num,
    wireUi,
    openModalWithFile,
    _session: () => session
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wireUi);
  } else {
    setTimeout(wireUi, 0);
  }
})(typeof window !== "undefined" ? window : globalThis);
