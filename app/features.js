/**
 * Ledgerbay schema 2
 *
 * This file adds six books on top of app.js. It does not replace GST invoicing.
 * Old saves under localStorage key "billsetu_data_v1" still load. migrateSchema()
 * fills anything the old file did not have, then saveToStorage() writes it back.
 *
 * 1. Recurring bills     processRecurringBills, renderRecurring
 * 2. Purchase orders     receivePurchaseOrder
 *    and debit notes     saveDebitNote (replaces the copy in app.js)
 * 3. Godowns             transferStock, renderGodowns, adjustStockLineWithGodown
 * 4. Staff roles         canWrite, roleAllowsView, applyRoleUi
 * 5. Serial history      findSerialHistory
 *    and custom fields   State.customFieldDefs, item.custom
 * 6. Loyalty points      loyaltyConfig, settleLoyaltyOnInvoice
 *
 * Staff PINs are SHA-256 hashes (see hashSecret in app.js). This is a lock for
 * people who share one phone or PC. It is not a server login.
 */

const DEMO_STAFF_SALT = "billsetu-demo-staff-salt";
const DEMO_STAFF_HASH = "613ffcee952e5f90b37ad554274283668fc8e733e1e2e014523e08422c9c2ce2";
const ROLE_LABELS = {
  ADMIN: "Admin",
  SALESMAN: "Salesman",
  STOCK: "Stock Manager",
  CA: "CA / Accountant"
};
const ROLE_VIEWS = {
  SALESMAN: ["dashboard", "pos", "sales", "parties", "recurring"],
  STOCK: ["dashboard", "purchases", "inventory", "godowns"],
  CA: ["dashboard", "sales", "parties", "reports", "accounts"]
};

let idCounter = 0;
let recurringLock = false;
let receivingPoId = "";

function uid(prefix) {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

function canWrite(area) {
  if (State.accounts?.readOnly) return false;
  const role = State.currentActor?.role || "ADMIN";
  if (role === "ADMIN") return true;
  if (role === "SALESMAN") return area === "sales" || area === "party";
  if (role === "STOCK") return area === "stock" || area === "purchase";
  return false;
}

function blockedAction(area) {
  if (canWrite(area)) return false;
  showToast("Your role cannot change that.", "error");
  return true;
}

function roleAllowsView(viewName) {
  const role = State.currentActor?.role || "ADMIN";
  if (role === "ADMIN") return true;
  return (ROLE_VIEWS[role] || []).includes(viewName);
}

function logActivity(action) {
  if (!Array.isArray(State.activityLog)) State.activityLog = [];
  const actor = State.currentActor || { name: "Owner", role: "ADMIN" };
  State.activityLog.push({
    id: uid("log"),
    at: new Date().toISOString(),
    actor: actor.name,
    role: actor.role,
    action
  });
  if (State.activityLog.length > 200) State.activityLog.splice(0, State.activityLog.length - 200);
}

function defaultGodownId() {
  const marked = (State.godowns || []).find(g => g.isDefault);
  return (marked || State.godowns?.[0] || { id: "gd-main" }).id;
}

function godownName(id) {
  return State.godowns.find(g => g.id === id)?.name || "Godown";
}

function godownOptionsHtml(selected) {
  return (State.godowns || []).map(g =>
    `<option value="${escHtml(g.id)}"${g.id === selected ? " selected" : ""}>${escHtml(g.name)}</option>`
  ).join("");
}

function qtyInGodown(item, godownId) {
  if (!item) return 0;
  if (item.trackSerial) {
    return (item.serials || []).filter(code => (item.serialGodown?.[code] || defaultGodownId()) === godownId).length;
  }
  return Number(item.godownQty?.[godownId]) || 0;
}

function syncItemStock(item) {
  if (!item || isServiceCategory(item.category)) return;
  if (item.trackSerial) item.stock = (item.serials || []).length;
  else item.stock = Object.values(item.godownQty || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0);
}

function godownStockHint(item) {
  if (!item || isServiceCategory(item.category)) return "";
  const parts = (State.godowns || []).map(g => {
    const qty = qtyInGodown(item, g.id);
    return qty ? `${g.name} ${qty}` : "";
  }).filter(Boolean);
  return parts.length ? `<div class="text-xs text-muted">${escHtml(parts.join(" · "))}</div>` : "";
}

// 1.13.8 (L1): a stock move changes the item record, so it must sync (godownQty + stockDocs travel together).
function markItemStockDirty(item) {
  if (item && typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(item);
}

function adjustStockLineWithGodown(line, direction) {
  const stockItem = findStockItem(line);
  if (!stockItem || isServiceCategory(stockItem.category)) return;
  const godownId = line.godownId || defaultGodownId();
  if (!stockItem.godownQty || typeof stockItem.godownQty !== "object") stockItem.godownQty = {};
  if (!stockItem.serialGodown || typeof stockItem.serialGodown !== "object") stockItem.serialGodown = {};
  if (stockItem.trackSerial) {
    const serials = line.serials || [];
    if (direction === "out") {
      serials.forEach(code => {
        const at = stockItem.serials.indexOf(code);
        if (at >= 0) stockItem.serials.splice(at, 1);
        delete stockItem.serialGodown[code];
      });
    } else {
      serials.forEach(code => {
        if (code && !stockItem.serials.includes(code)) stockItem.serials.push(code);
        stockItem.serialGodown[code] = godownId;
      });
    }
    stockItem.stock = stockItem.serials.length;
    markItemStockDirty(stockItem);
    return;
  }
  const current = Number(stockItem.godownQty[godownId]) || 0;
  const qty = Number(line.qty) || 0;
  stockItem.godownQty[godownId] = direction === "out" ? Math.max(0, current - qty) : current + qty;
  syncItemStock(stockItem);
  markItemStockDirty(stockItem);
}

function isDemoBooks() {
  const ids = (State.invoices || []).map(inv => inv.id).sort().join(",");
  return ids === "inv-101,inv-102,inv-103";
}

function migrateSchema() {
  if (!Array.isArray(State.godowns)) State.godowns = [];
  if (!State.godowns.length) {
    State.godowns = [
      { id: "gd-main", name: "Main", isDefault: true }
    ];
  }
  if (!State.godowns.some(g => g.isDefault)) State.godowns[0].isDefault = true;
  const main = defaultGodownId();
  (State.items || []).forEach(item => {
    if (!item.godownQty || typeof item.godownQty !== "object") item.godownQty = {};
    if (!item.serialGodown || typeof item.serialGodown !== "object") item.serialGodown = {};
    if (!item.custom || typeof item.custom !== "object") item.custom = {};
    if (!Array.isArray(item.serials)) item.serials = [];
    if (item.trackSerial) {
      item.serials.forEach(code => {
        if (!item.serialGodown[code]) item.serialGodown[code] = main;
      });
      Object.keys(item.serialGodown).forEach(code => {
        if (!item.serials.includes(code)) delete item.serialGodown[code];
      });
    } else if (!isServiceCategory(item.category) && !Object.keys(item.godownQty).length) {
      item.godownQty[main] = Number(item.stock) || 0;
    }
    syncItemStock(item);
  });
  if (!State.business.loyalty) State.business.loyalty = { pointsPerRupee: 0.01, rupeePerPoint: 1 };
  if (!State.business.declaration) {
    State.business.declaration = "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.";
  }
  if (State.business.jurisdiction == null) State.business.jurisdiction = "";
  if (State.business.classicBlankCells == null) State.business.classicBlankCells = true;
  if (State.business.logo == null) State.business.logo = "";
  if (State.business.signatureImage == null) State.business.signatureImage = "";
  if (State.business.signatureName == null) State.business.signatureName = "";
  if (State.business.loyalty.pointsPerRupee == null) State.business.loyalty.pointsPerRupee = 0.01;
  if (State.business.loyalty.rupeePerPoint == null) State.business.loyalty.rupeePerPoint = 1;
  ["recurringBills", "stockTransfers", "staff", "activityLog", "loyaltyLedger", "customFieldDefs"].forEach(key => {
    if (!Array.isArray(State[key])) State[key] = [];
  });
  State.parties.forEach(party => {
    if (party.loyaltyPoints == null) party.loyaltyPoints = 0;
    const known = State.loyaltyLedger.some(entry => entry.partyId === party.id);
    if (!known && party.loyaltyPoints > 0) {
      State.loyaltyLedger.push({
        id: "loy-open-" + party.id,
        date: "2026-10-01",
        partyId: party.id,
        type: "OPENING",
        points: party.loyaltyPoints,
        rupees: 0,
        note: "Points already on this khata"
      });
    }
  });
  maybeSeedDemoExtras();
  cleanupLegacyDemoDefaultsOnce();
  if (typeof ensureAccounts === "function") ensureAccounts();
  State.schemaVersion = 3;
}

/**
 * One-time cleanup for books created/restored by 1.13.1 or older (BUG-V21.2-05).
 * - jurisdiction: cleared ONLY when it is exactly the old app default "Mumbai".
 * - "Main Showroom" / "Andheri Warehouse": renamed (default → "Main") or removed ONLY when the
 *   godown holds no stock and nothing references it (documents, transfers, serials, recurring bills).
 *   Anything in use is left exactly as it is. Stock quantities are never changed.
 */
const LEGACY_GODOWN_NAMES = ["Main Showroom", "Andheri Warehouse"];
function legacyGodownInUse(gid) {
  const holds = (State.items || []).some(item =>
    (Number(item.godownQty && item.godownQty[gid]) || 0) !== 0 ||
    Object.values(item.serialGodown || {}).includes(gid)
  );
  if (holds) return true;
  const needle = JSON.stringify(String(gid));
  return ["invoices", "purchases", "debitNotes", "purchaseOrders", "recurringBills", "stockTransfers", "expenses", "payments"]
    .some(key => (State[key] || []).some(rec => JSON.stringify(rec).includes(needle)));
}

function cleanupLegacyDemoDefaultsOnce() {
  if (!State.business || State.business.legacyDefaultsCleanedV1) return [];
  const done = [];
  const stampRec = rec => {
    if (window.BillSetuSync && typeof window.BillSetuSync.markUpdated === "function") window.BillSetuSync.markUpdated(rec);
    else rec.updatedAt = Date.now();
  };
  if (State.business.jurisdiction === "Mumbai") {
    State.business.jurisdiction = "";
    State.business.updatedAt = Date.now();
    done.push("the sample jurisdiction \"Mumbai\"");
  }
  const gds = Array.isArray(State.godowns) ? State.godowns.slice() : [];
  gds.forEach(g => {
    if (!g || !LEGACY_GODOWN_NAMES.includes(g.name)) return;
    if (legacyGodownInUse(g.id)) return; // in use: leave exactly as it is
    if (g.isDefault) {
      if (gds.some(o => o !== g && o.name === "Main")) return;
      const old = g.name;
      g.name = "Main";
      stampRec(g);
      done.push(`renamed the unused sample godown "${old}" to "Main"`);
    } else {
      if (window.BillSetuSync && typeof window.BillSetuSync.softDelete === "function") window.BillSetuSync.softDelete("godowns", g.id);
      State.godowns = (State.godowns || []).filter(x => x.id !== g.id);
      (State.items || []).forEach(item => {
        if (item.godownQty && Object.prototype.hasOwnProperty.call(item.godownQty, g.id) && !(Number(item.godownQty[g.id]) || 0)) delete item.godownQty[g.id];
      });
      done.push(`removed the unused sample godown "${g.name}"`);
    }
  });
  State.business.legacyDefaultsCleanedV1 = true;
  if (done.length) {
    State.business.legacyCleanupNotice = done.join("; ");
    setTimeout(() => {
      if (typeof saveToStorage === "function") saveToStorage();
      if (typeof showToast === "function") showToast(`Cleaned up sample settings from an older version: ${done.join("; ")}.`, "info", { ttlMs: 8000 });
    }, 1500);
  }
  return done;
}
window.cleanupLegacyDemoDefaultsOnce = cleanupLegacyDemoDefaultsOnce;

function maybeSeedDemoExtras() {
  if (State.demoExtrasSeeded) return;
  if (!isDemoBooks()) {
    State.demoExtrasSeeded = true;
    return;
  }
  State.recurringBills.push({
    id: "rec-demo",
    name: "Monthly service",
    partyId: "pty-1",
    frequency: "monthly",
    startDate: "2026-10-01",
    endDate: "",
    nextRun: "2026-10-01",
    status: "active",
    godownId: "gd-main",
    paymentMode: "UPI",
    notes: "Monthly filter check and gas pressure look.",
    items: [{
      itemId: "itm-install",
      description: "Split AC installation",
      hsn: "9987",
      qty: 1,
      unit: "NOS",
      rate: 1500,
      discPercent: 0,
      gstRate: 18
    }]
  });
  const demoPeople = [];
  demoPeople.forEach(([id, name, role]) => {
    State.staff.push({ id, name, role, salt: DEMO_STAFF_SALT, hash: DEMO_STAFF_HASH, active: true });
  });
  State.demoExtrasSeeded = true;
}

function extraBooksPayload() {
  return {
    schemaVersion: 2,
    recurringBills: State.recurringBills || [],
    godowns: State.godowns || [],
    stockTransfers: State.stockTransfers || [],
    staff: State.staff || [],
    activityLog: State.activityLog || [],
    loyaltyLedger: State.loyaltyLedger || [],
    customFieldDefs: State.customFieldDefs || [],
    bankAccounts: State.bankAccounts || [],
    // Sync tombstones survive a reload, so a delete made offline still reaches other devices.
    _syncTombs: State._syncTombs || {},
    demoExtrasSeeded: !!State.demoExtrasSeeded
  };
}

function restoreExtraBooks(data) {
  State.recurringBills = Array.isArray(data.recurringBills) ? data.recurringBills : [];
  State.godowns = Array.isArray(data.godowns) ? data.godowns : [];
  State.stockTransfers = Array.isArray(data.stockTransfers) ? data.stockTransfers : [];
  State.staff = Array.isArray(data.staff) ? data.staff : [];
  State.activityLog = Array.isArray(data.activityLog) ? data.activityLog : [];
  State.loyaltyLedger = Array.isArray(data.loyaltyLedger) ? data.loyaltyLedger : [];
  State.customFieldDefs = Array.isArray(data.customFieldDefs) ? data.customFieldDefs : [];
  State.bankAccounts = Array.isArray(data.bankAccounts) ? data.bankAccounts : [];
  State._syncTombs = data._syncTombs && typeof data._syncTombs === "object" ? data._syncTombs : {};
  State.demoExtrasSeeded = !!data.demoExtrasSeeded;
  State.schemaVersion = data.schemaVersion || 1;
}

function writeStaffIndex() {
  const index = (State.staff || []).map(person => ({
    id: person.id,
    name: person.name,
    role: person.role,
    salt: person.salt,
    hash: person.hash,
    active: person.active !== false
  }));
  localStorage.setItem("billsetu_staff_index_v1", JSON.stringify(index));
}

function afterDemoReload() {
  State.recurringBills = [];
  State.godowns = [];
  State.stockTransfers = [];
  State.staff = [];
  State.activityLog = [];
  State.loyaltyLedger = [];
  State.customFieldDefs = [];
  State.bankAccounts = [];
  State.demoExtrasSeeded = false;
  migrateSchema();
  const notes = processRecurringBills();
  logActivity("Reloaded the demo shop");
  saveToStorage();
  writeStaffIndex();
  showRecurringNotice(notes);
  applyRoleUi();
}

function loyaltyConfig() {
  const stored = State.business.loyalty || {};
  return {
    pointsPerRupee: Math.max(0, Number(stored.pointsPerRupee ?? 0.01) || 0),
    rupeePerPoint: Math.max(0, Number(stored.rupeePerPoint ?? 1) || 0)
  };
}

function pointsEarnedFor(amount) {
  return Math.floor((Number(amount) || 0) * loyaltyConfig().pointsPerRupee);
}

function loyaltyRedeemQuote(gross, party, requestedPoints) {
  const cfg = loyaltyConfig();
  let points = Math.max(0, Math.floor(Number(requestedPoints) || 0));
  points = Math.min(points, Math.floor(Number(party?.loyaltyPoints) || 0));
  let rupees = Math.round(points * cfg.rupeePerPoint * 100) / 100;
  if (rupees > gross) {
    points = cfg.rupeePerPoint > 0 ? Math.floor(gross / cfg.rupeePerPoint) : 0;
    rupees = Math.min(gross, Math.round(points * cfg.rupeePerPoint * 100) / 100);
  }
  return { points, rupees };
}

function invoiceLoyaltyApplied(party, gross, docType) {
  const blocked = !party || party.type === "SUPPLIER"
    || docType === "CREDIT_NOTE" || docType === "ESTIMATE"
    || docType === "PROFORMA" || docType === "DELIVERY_CHALLAN";
  if (blocked) return { points: 0, rupees: 0, earned: 0 };
  const quote = loyaltyRedeemQuote(gross, party, document.getElementById("inv-loyalty-points")?.value || 0);
  return {
    points: quote.points,
    rupees: quote.rupees,
    earned: pointsEarnedFor(Math.max(0, gross - quote.rupees))
  };
}

function previewLoyaltyRupees(gross) {
  const party = State.parties.find(p => p.id === document.getElementById("inv-party-select")?.value);
  const docType = document.getElementById("inv-doc-type")?.value;
  return invoiceLoyaltyApplied(party, gross, docType).rupees;
}

function settleLoyaltyOnInvoice(party, invoice) {
  if (!party) return;
  const redeemed = Number(invoice.loyaltyPointsRedeemed) || 0;
  const earned = Number(invoice.loyaltyPointsEarned) || 0;
  party.loyaltyPoints = Math.max(0, (Number(party.loyaltyPoints) || 0) - redeemed + earned);
  const date = invoice.date || todayISO();
  if (redeemed) {
    State.loyaltyLedger.push({
      id: uid("loy"),
      date,
      partyId: party.id,
      invoiceId: invoice.id,
      type: "REDEEM",
      points: -redeemed,
      rupees: invoice.loyaltyDiscount || 0,
      note: `Discount on ${invoice.invoiceNo}`
    });
  }
  if (earned) {
    State.loyaltyLedger.push({
      id: uid("loy"),
      date,
      partyId: party.id,
      invoiceId: invoice.id,
      type: "EARN",
      points: earned,
      rupees: invoice.grandTotal,
      note: `Earned on ${invoice.invoiceNo}`
    });
  }
}

function loyaltyPartyNotice(party) {
  const bits = [];
  const limit = Number(party.creditLimit) || 0;
  if (limit > 0) bits.push(`Limit ${formatINR(limit)}`);
  if (party.type !== "SUPPLIER") bits.push(`${party.loyaltyPoints || 0} pts`);
  return bits.join(" · ");
}

function refreshLoyaltyHint() {
  const hint = document.getElementById("inv-loyalty-hint");
  const party = State.parties.find(p => p.id === document.getElementById("inv-party-select")?.value);
  if (!hint) return;
  if (!party || party.type === "SUPPLIER") {
    hint.textContent = "";
    return;
  }
  hint.textContent = `${party.loyaltyPoints || 0} pts available`;
}

function prepareInvoiceExtras() {
  const select = document.getElementById("inv-godown");
  if (select) {
    const current = select.value || defaultGodownId();
    select.innerHTML = godownOptionsHtml(current);
  }
  const points = document.getElementById("inv-loyalty-points");
  if (points && document.activeElement !== points) points.value = points.value || "0";
  refreshLoyaltyHint();
}

function renderPartyLoyalty(party) {
  const box = document.getElementById("party-loyalty-history");
  if (!box || !party) return;
  const notes = State.loyaltyLedger
    .filter(entry => entry.partyId === party.id)
    .map(entry => entry.note)
    .filter(Boolean)
    .map(note => escHtml(note));
  box.innerHTML = `<p class="loyalty-summary">Loyalty ${party.loyaltyPoints || 0} pts${notes.length ? " · " + notes.join(" · ") : ""}</p>`;
}

function customFieldsPrintHtml(line) {
  const defs = (State.customFieldDefs || []).filter(def => def.showOnInvoice);
  if (!defs.length || !line) return "";
  const item = findStockItem(line);
  const bag = { ...(item?.custom || {}), ...(line.custom || {}) };
  const parts = defs.map(def => (bag[def.id] ? `${def.label}: ${bag[def.id]}` : "")).filter(Boolean);
  return parts.length ? `<div class="bsf-serial">${escHtml(parts.join(" · "))}</div>` : "";
}

function renderItemCustomFields(item) {
  const box = document.getElementById("item-custom-fields");
  if (!box) return;
  if (!State.customFieldDefs.length) {
    box.innerHTML = `<p class="text-sm text-muted">No custom fields yet. Add them under Business Settings.</p>`;
    return;
  }
  box.innerHTML = State.customFieldDefs.map(def => `
    <div class="form-group">
      <label>${escHtml(def.label)}${def.showOnInvoice ? " (prints on the bill)" : ""}</label>
      <input type="text" class="form-control item-custom-input" data-field-id="${escHtml(def.id)}" value="${escHtml(item?.custom?.[def.id] || "")}">
    </div>
  `).join("");
}

function readItemCustomFields() {
  const custom = {};
  document.querySelectorAll(".item-custom-input").forEach(input => {
    custom[input.getAttribute("data-field-id")] = input.value.trim();
  });
  return custom;
}

function afterItemSave(item) {
  item.custom = readItemCustomFields();
  if (!item.godownQty || typeof item.godownQty !== "object") item.godownQty = {};
  if (!item.serialGodown || typeof item.serialGodown !== "object") item.serialGodown = {};
  const main = defaultGodownId();
  if (item.trackSerial) {
    (item.serials || []).forEach(code => {
      if (!item.serialGodown[code]) item.serialGodown[code] = main;
    });
    Object.keys(item.serialGodown).forEach(code => {
      if (!(item.serials || []).includes(code)) delete item.serialGodown[code];
    });
    item.stock = (item.serials || []).length;
    return;
  }
  const others = Object.entries(item.godownQty).reduce((sum, [id, qty]) => (
    sum + (id === main ? 0 : (Number(qty) || 0))
  ), 0);
  if (!Object.keys(item.godownQty).length) item.godownQty[main] = Number(item.stock) || 0;
  else item.godownQty[main] = Math.max(0, (Number(item.stock) || 0) - others);
  syncItemStock(item);
}

function renderCustomFieldSettings() {
  const list = document.getElementById("custom-field-list");
  if (!list) return;
  list.innerHTML = State.customFieldDefs.length
    ? State.customFieldDefs.map(def => `
        <div class="party-item-card">
          <div><strong>${escHtml(def.label)}</strong><div class="text-xs text-muted">${def.showOnInvoice ? "Shows on invoices" : "Item form only"}</div></div>
          <button type="button" class="btn btn-outline btn-sm" onclick="removeCustomField('${def.id}')">Remove</button>
        </div>
      `).join("")
    : `<p class="text-sm text-muted">No extra item fields yet. Colour, size, or warranty card number are typical.</p>`;
}

function addCustomField() {
  if (blockedAction("settings")) return;
  const label = document.getElementById("cf-label")?.value.trim();
  if (!label) {
    showToast("Type a field name first.", "error");
    return;
  }
  State.customFieldDefs.push({
    id: uid("cf"),
    label,
    showOnInvoice: !!document.getElementById("cf-on-invoice")?.checked
  });
  document.getElementById("cf-label").value = "";
  logActivity(`Added item field ${label}`);
  saveToStorage();
  renderCustomFieldSettings();
  showToast(`${label} will show on the item form.`);
}

function removeCustomField(id) {
  if (blockedAction("settings")) return;
  State.customFieldDefs = State.customFieldDefs.filter(def => def.id !== id);
  saveToStorage();
  renderCustomFieldSettings();
}

function findSerialHistory(raw) {
  const query = String(raw || "").trim().toLowerCase();
  if (!query) return [];
  const events = [];
  State.items.forEach(item => {
    (item.serials || []).forEach(code => {
      if (code.toLowerCase() !== query) return;
      events.push({
        date: "",
        kind: "In stock",
        detail: `${item.name} · ${godownName(item.serialGodown?.[code] || defaultGodownId())}`
      });
    });
  });
  State.invoices.forEach(inv => {
    (inv.items || []).forEach(line => {
      (line.serials || []).forEach(code => {
        if (code.toLowerCase() !== query) return;
        events.push({
          date: inv.date || "",
          kind: inv.docType === "CREDIT_NOTE" ? "Sales return" : "Sale",
          detail: `${inv.invoiceNo} · ${inv.partyName}`
        });
      });
    });
  });
  State.purchases.forEach(purchase => {
    (purchase.items || []).forEach(line => {
      (line.serials || []).forEach(code => {
        if (code.toLowerCase() !== query) return;
        events.push({
          date: purchase.date || "",
          kind: "Purchase",
          detail: `${purchase.billNo} · ${purchase.supplierName}`
        });
      });
    });
  });
  State.debitNotes.forEach(note => {
    (note.serials || []).forEach(code => {
      if (code.toLowerCase() !== query) return;
      events.push({
        date: note.date || "",
        kind: "Debit note",
        detail: `${note.noteNo} · returned to ${note.supplierName}`
      });
    });
  });
  State.stockTransfers.forEach(move => {
    (move.serials || []).forEach(code => {
      if (code.toLowerCase() !== query) return;
      events.push({
        date: move.date || "",
        kind: "Transfer",
        detail: `${godownName(move.fromGodownId)} → ${godownName(move.toGodownId)}`
      });
    });
  });
  return events.sort((a, b) => String(a.date).localeCompare(String(b.date)));
}

function renderSerialLookup(raw) {
  const box = document.getElementById("serial-lookup-results");
  if (!box) return;
  const code = String(raw || "").trim();
  if (!code) {
    box.innerHTML = `<p class="text-muted">Type a serial or IMEI.</p>`;
    return;
  }
  const events = findSerialHistory(code);
  if (!events.length) {
    box.innerHTML = `<p class="text-muted">No bill, purchase, or godown has ${escHtml(code)}.</p>`;
    return;
  }
  box.innerHTML = `
    <table class="data-table">
      <thead><tr><th>Date</th><th>What happened</th><th>Detail</th></tr></thead>
      <tbody>
        ${events.map(event => `<tr><td>${escHtml(event.date || "—")}</td><td>${escHtml(event.kind)}</td><td>${escHtml(event.detail)}</td></tr>`).join("")}
      </tbody>
    </table>`;
}

function shiftDate(iso, frequency, anchorDay) {
  const [year, month, day] = String(iso || todayISO()).split("-").map(Number);
  if (frequency === "daily") return addDays(iso, 1);
  if (frequency === "weekly") return addDays(iso, 7);
  const step = frequency === "yearly" ? 12 : 1;
  const keep = Number(anchorDay) || day;
  const base = new Date(year, month - 1 + step, 1);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  const clamped = Math.min(keep, last);
  return toIso(new Date(base.getFullYear(), base.getMonth(), clamped));
}

function addDays(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  date.setDate(date.getDate() + days);
  return toIso(date);
}

function toIso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextDocNo(prefix) {
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.peekNextDocNo) {
    return BillSetuDocNumbering.peekNextDocNo(prefix);
  }
  let max = 0;
  State.invoices.forEach(inv => {
    const match = String(inv.invoiceNo || "").match(/(\d+)\s*$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

function computeTaxLines(party, rawItems, godownId) {
  const isInterstate = typeof isInterstateFor === "function"
    ? isInterstateFor(defaultPlaceOfSupply(party))
    : (party?.stateCode || State.business.stateCode) !== State.business.stateCode;
  // 1.13.15 (BUG-4): refuse to price a GST document when the business state is missing.
  if (isInterstate === null) throw new Error(typeof businessStateMissingMessage === "function" ? businessStateMissingMessage("a bill") : "Add your business state in Settings first.");
  const draft = (rawItems || []).map(item => ({
    ...item,
    qty: Number(item.qty) || 0,
    rate: Number(item.rate) || 0,
    discPercent: Number(item.discPercent) || 0,
    gstRate: Number(item.gstRate) || 0,
    rateInclusive: !!item.rateInclusive
  }));
  const priced = (typeof BillSetuMoney !== "undefined" && BillSetuMoney.computeDocument)
    ? BillSetuMoney.computeDocument(draft, { isInterstate, billDiscount: 0, loyaltyRupees: 0 })
    : null;
  if (!priced) {
    throw new Error("BillSetuMoney missing");
  }
  const items = priced.items.map(line => ({
    ...line,
    godownId: godownId || defaultGodownId(),
    serials: line.serials || [],
    batchExp: line.batchExp || ""
  }));
  return {
    items,
    taxableTotal: priced.taxableTotal,
    cgstTotal: priced.cgstTotal,
    sgstTotal: priced.sgstTotal,
    igstTotal: priced.igstTotal,
    roundOff: priced.roundOff,
    grandTotal: priced.grandTotal,
    isInterstate
  };
}

function postGeneratedInvoice(options) {
  const party = options.party;
  const type = options.asEstimate ? "ESTIMATE" : (options.docType || "TAX_INVOICE");
  const priced = computeTaxLines(party, options.items, options.godownId);
  const grandTotal = priced.grandTotal;
  const nonPosting = type === "ESTIMATE" || type === "PROFORMA";
  const received = nonPosting || type === "DELIVERY_CHALLAN" || options.paymentMode === "CREDIT" ? 0 : grandTotal;
  const invoice = {
    id: uid("inv"),
    docType: type,
    invoiceNo: nextDocNo(type === "ESTIMATE" ? "QT" : "INV"),
    date: options.date,
    dueDate: options.dueDate || options.date,
    partyId: party.id,
    partyName: party.name,
    partyGstin: party.gstin || "",
    partyPhone: party.phone || "",
    posStateCode: (typeof defaultPlaceOfSupply === "function" ? defaultPlaceOfSupply(party) : party.stateCode) || "",
    posStateName: (typeof BillSetuGstin !== "undefined" && typeof defaultPlaceOfSupply === "function" ? BillSetuGstin.stateName(defaultPlaceOfSupply(party)) : party.stateName) || "",
    isInterstate: priced.isInterstate,
    items: priced.items,
    taxableTotal: priced.taxableTotal,
    cgstTotal: priced.cgstTotal,
    sgstTotal: priced.sgstTotal,
    igstTotal: priced.igstTotal,
    roundOff: priced.roundOff,
    grandTotal,
    grossTotal: grandTotal,
    loyaltyPointsRedeemed: 0,
    loyaltyDiscount: 0,
    loyaltyPointsEarned: 0,
    amountReceived: received,
    balanceDue: nonPosting || type === "DELIVERY_CHALLAN" ? 0 : Math.max(0, grandTotal - received),
    paymentMode: options.paymentMode || "UPI",
    notes: options.notes || "",
    godownId: options.godownId || defaultGodownId(),
    recurringId: options.recurringId || "",
    ewayBill: "",
    vehicleNo: "",
    transporterName: "",
    transporterId: ""
  };
  if (!nonPosting) {
    if (invoice.balanceDue > 0 && type !== "DELIVERY_CHALLAN") {
      if (typeof partyAddReceivable === "function") partyAddReceivable(party, invoice.balanceDue);
      else { party.balance = (Number(party.balance) || 0) + invoice.balanceDue; party.balType = "RECEIVABLE"; }
    }
    priced.items.forEach(line => adjustStockLine(line, "out"));
    if (type !== "DELIVERY_CHALLAN") {
      invoice.loyaltyPointsEarned = pointsEarnedFor(grandTotal);
      settleLoyaltyOnInvoice(party, invoice);
    }
  }
  State.invoices.push(invoice);
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.commitDocNumber) {
    const series = BillSetuDocNumbering.seriesForDocType
      ? BillSetuDocNumbering.seriesForDocType(type)
      : (type === "ESTIMATE" ? "ESTIMATE" : "TAX_INVOICE");
    BillSetuDocNumbering.commitDocNumber(series, invoice.invoiceNo, invoice.date);
  }
  return invoice;
}

function lineNeedsSerial(line) {
  const item = State.items.find(entry => entry.id === line.itemId);
  return !!item?.trackSerial;
}

function processRecurringBills() {
  if (recurringLock) return [];
  recurringLock = true;
  const notes = [];
  try {
    const today = todayISO();
    // 1.13.15 (BUG-4): never generate bills without the business state. Skip, keep them due, and say so.
    if (typeof businessStateCode === "function" && !businessStateCode()) {
      const due = (State.recurringBills || []).filter(b => b.status === "active" && b.nextRun && b.nextRun <= today).length;
      if (due) notes.push(`${due} recurring bill${due > 1 ? "s are" : " is"} due but not created: add your business state in Settings first. ${due > 1 ? "They" : "It"} will be created once the state is set.`);
      return notes;
    }
    (State.recurringBills || []).forEach(bill => {
      if (bill.status !== "active") return;
      let made = 0;
      while (bill.nextRun && bill.nextRun <= today && made < 24) {
        if (bill.endDate && bill.nextRun > bill.endDate) {
          bill.status = "stopped";
          notes.push(`${bill.name} reached its end date and was stopped.`);
          break;
        }
        const party = State.parties.find(p => p.id === bill.partyId);
        if (!party) {
          bill.status = "paused";
          notes.push(`${bill.name} was paused because the party is missing.`);
          break;
        }
        const serialItem = (bill.items || []).some(lineNeedsSerial);
        const invoice = postGeneratedInvoice({
          party,
          items: bill.items,
          date: bill.nextRun,
          dueDate: bill.nextRun,
          paymentMode: bill.paymentMode || "UPI",
          notes: bill.notes || `Recurring: ${bill.name}`,
          godownId: bill.godownId,
          recurringId: bill.id,
          asEstimate: serialItem
        });
        made += 1;
        notes.push(serialItem
          ? `${invoice.invoiceNo} saved as a quotation because ${bill.name} needs serial numbers.`
          : `${invoice.invoiceNo} created from “${bill.name}” dated ${bill.nextRun}.`);
        const anchor = Number(String(bill.startDate || bill.nextRun).slice(8, 10));
        bill.nextRun = shiftDate(bill.nextRun, bill.frequency || "monthly", anchor);
      }
      if (made === 24 && bill.nextRun && bill.nextRun <= today) {
        bill.nextRun = shiftDate(today, bill.frequency || "monthly");
        notes.push(`${bill.name} was caught up through today.`);
      }
    });
    if (notes.length) {
      logActivity(`Recurring run: ${notes.length} note(s)`);
      saveToStorage();
    }
  } finally {
    recurringLock = false;
  }
  return notes;
}

function showRecurringNotice(lines) {
  const box = document.getElementById("recurring-notice");
  if (!box) return;
  if (!lines || !lines.length) {
    box.classList.add("d-none");
    box.innerHTML = "";
    return;
  }
  box.classList.remove("d-none");
  const text = lines.length === 1 ? lines[0] : `${lines.length} recurring bills were created`;
  box.innerHTML = `<span class="notice-text">${escHtml(text)}</span>
    <button type="button" class="btn-icon" id="btn-dismiss-recurring" aria-label="Dismiss">×</button>`;
  document.getElementById("btn-dismiss-recurring").onclick = () => box.classList.add("d-none");
}

function onBooksOpened() {
  applyRoleUi();
  const notes = processRecurringBills();
  logActivity("Opened the books");
  saveToStorage();
  writeStaffIndex();
  showRecurringNotice(notes);
  renderDashboard();
}

function renderRecurring() {
  const partySelect = document.getElementById("rec-party");
  const itemSelect = document.getElementById("rec-item");
  const godownSelect = document.getElementById("rec-godown");
  if (!partySelect || !itemSelect) return;
  const partyValue = partySelect.value;
  const itemValue = itemSelect.value;
  partySelect.innerHTML = State.parties.filter(p => p.type === "CUSTOMER").map(p =>
    `<option value="${p.id}">${escHtml(p.name)}</option>`
  ).join("");
  itemSelect.innerHTML = State.items.map(item => `<option value="${item.id}">${escHtml(item.name)}</option>`).join("");
  if (godownSelect) {
    const current = godownSelect.value || defaultGodownId();
    godownSelect.innerHTML = godownOptionsHtml(current);
  }
  if ([...partySelect.options].some(option => option.value === partyValue)) partySelect.value = partyValue;
  if ([...itemSelect.options].some(option => option.value === itemValue)) itemSelect.value = itemValue;
  if (!document.getElementById("rec-start").value) document.getElementById("rec-start").value = todayISO();
  const body = document.getElementById("recurring-table-body");
  if (!State.recurringBills.length) {
    body.innerHTML = `<tr><td colspan="6" class="text-muted" style="padding:16px;">No recurring bills yet. A schedule creates a real invoice each time it falls due.</td></tr>`;
    return;
  }
  body.innerHTML = State.recurringBills.map(bill => {
    const party = State.parties.find(p => p.id === bill.partyId);
    const buttons = bill.status === "stopped"
      ? `<span class="text-xs text-muted">Stopped</span>`
      : `${bill.status === "active"
        ? `<button class="btn btn-outline btn-sm" onclick="setRecurringStatus('${bill.id}','paused')">Pause</button>`
        : `<button class="btn btn-outline btn-sm" onclick="setRecurringStatus('${bill.id}','active')">Resume</button>`}
        <button class="btn btn-outline btn-sm" onclick="setRecurringStatus('${bill.id}','stopped')">Stop</button>`;
    return `<tr>
      <td><strong>${escHtml(bill.name)}</strong><div class="text-xs text-muted">${escHtml(bill.frequency)}</div></td>
      <td>${escHtml(party?.name || "Missing party")}</td>
      <td>${escHtml(bill.nextRun || "—")}</td>
      <td>${escHtml(bill.endDate || "No end")}</td>
      <td><span class="badge ${bill.status === "active" ? "badge-paid" : bill.status === "paused" ? "badge-partial" : "badge-unpaid"}">${escHtml(bill.status)}</span></td>
      <td class="d-flex gap-2">${buttons}</td>
    </tr>`;
  }).join("");
}

function saveRecurringFromForm() {
  if (blockedAction("sales")) return;
  const party = State.parties.find(p => p.id === document.getElementById("rec-party").value);
  const start = document.getElementById("rec-start").value;
  const end = document.getElementById("rec-end").value;
  const name = document.getElementById("rec-name").value.trim();
  if (!party || !start || !name) {
    showToast("Name, customer, and start date are required.", "error");
    return;
  }
  if (end && end < start) {
    showToast("End date cannot be before the start date.", "error");
    return;
  }
  let items = State.pendingRecurringItems;
  if (!items || !items.length) {
    const item = State.items.find(entry => entry.id === document.getElementById("rec-item").value);
    const qty = Number(document.getElementById("rec-qty").value);
    const rate = Number(document.getElementById("rec-rate").value);
    if (!item || !qty || qty <= 0) {
      showToast("Pick an item and a quantity.", "error");
      return;
    }
    items = [{
      itemId: item.id,
      description: item.name,
      hsn: item.hsn,
      qty,
      unit: item.unit,
      rate: rate || item.sellingPrice,
      discPercent: 0,
      gstRate: item.gstRate,
      custom: { ...(item.custom || {}) }
    }];
  }
  const bill = {
    id: uid("rec"),
    name,
    partyId: party.id,
    frequency: document.getElementById("rec-frequency").value,
    startDate: start,
    endDate: end,
    nextRun: start,
    status: "active",
    godownId: document.getElementById("rec-godown")?.value || defaultGodownId(),
    paymentMode: document.getElementById("rec-pay-mode")?.value || "UPI",
    notes: document.getElementById("rec-notes")?.value.trim() || "",
    items
  };
  State.recurringBills.push(bill);
  State.pendingRecurringItems = null;
  const notes = processRecurringBills();
  logActivity(`Created recurring bill ${name}`);
  saveToStorage();
  showRecurringNotice(notes);
  const skipped = notes.some(n => /due but not created/.test(n));
  showToast(skipped ? "Recurring bill saved. Due bills were not created: add your business state in Settings first." : notes.length ? "Schedule saved and due bills were created." : "Recurring bill saved.", skipped ? "warning" : "success");
  renderRecurring();
  renderDashboard();
}

function setRecurringStatus(id, status) {
  if (blockedAction("sales")) return;
  const bill = State.recurringBills.find(entry => entry.id === id);
  if (!bill) return;
  if (bill.status === "stopped") {
    showToast("Stopped schedules stay stopped. Create a new one if it should run again.", "error");
    return;
  }
  if (status === "stopped" && !confirm(`Stop “${bill.name}”? It will not create more bills.`)) return;
  if (status === "active" && bill.status === "paused") {
    const today = todayISO();
    if (bill.nextRun && bill.nextRun < today) bill.nextRun = today;
  }
  bill.status = status;
  let notes = [];
  if (status === "active") notes = processRecurringBills();
  logActivity(`${status} recurring ${bill.name}`);
  saveToStorage();
  showRecurringNotice(notes);
  renderRecurring();
  if (notes.length) renderDashboard();
}

function startRecurringFromInvoice(invoiceId) {
  if (blockedAction("sales")) return;
  const inv = State.invoices.find(entry => entry.id === invoiceId);
  if (!inv) return;
  switchView("recurring");
  document.getElementById("rec-name").value = `Repeat ${inv.invoiceNo}`;
  document.getElementById("rec-party").value = inv.partyId;
  document.getElementById("rec-frequency").value = "monthly";
  document.getElementById("rec-start").value = todayISO();
  document.getElementById("rec-end").value = "";
  document.getElementById("rec-notes").value = inv.notes || "";
  if (document.getElementById("rec-godown")) document.getElementById("rec-godown").value = inv.godownId || defaultGodownId();
  State.pendingRecurringItems = (inv.items || []).map(line => ({
    itemId: line.itemId,
    description: line.description,
    hsn: line.hsn,
    qty: line.qty,
    unit: line.unit,
    rate: line.rate,
    discPercent: line.discPercent || 0,
    gstRate: line.gstRate,
    custom: { ...(line.custom || {}) }
  }));
  const first = State.pendingRecurringItems[0];
  if (first?.itemId) document.getElementById("rec-item").value = first.itemId;
  if (first) {
    document.getElementById("rec-qty").value = first.qty;
    document.getElementById("rec-rate").value = first.rate;
  }
  showToast("Review the schedule, then save it. Serial numbers are not copied onto a repeat bill.");
}

function parseSerialList(text) {
  return [...new Set(String(text || "").split(/[\s,]+/).map(code => code.trim()).filter(Boolean))];
}

function fillGodownSelect(id, selected) {
  const select = document.getElementById(id);
  if (!select) return;
  select.innerHTML = godownOptionsHtml(selected || select.value || defaultGodownId());
}

function openPurchaseBillModal() {
  if (blockedAction("purchase")) return;
  fillSupplierSelect("pur-supplier");
  fillItemSelect("pur-item");
  fillGodownSelect("pur-godown");
  document.getElementById("pur-date").value = todayISO();
  document.getElementById("pur-bill").value = "SUP-" + String(State.purchases.length + 1).padStart(3, "0");
  document.getElementById("pur-qty").value = 1;
  document.getElementById("pur-serials").value = "";
  const item = State.items.find(entry => entry.id === document.getElementById("pur-item").value) || State.items[0];
  if (item) document.getElementById("pur-rate").value = item.costPrice;
  syncPurchaseSerialBox();
  renderPurchaseTaxPreview();
  document.getElementById("modal-purchase").classList.add("open");
}

/** 1.13.16: tax preview in the purchase window, matching the invoice form and POS cart. Without the
 *  business state it shows "Set business state" instead of a CGST/SGST guess. */
function renderPurchaseTaxPreview() {
  const box = document.getElementById("pur-tax-preview");
  if (!box) return;
  const supplier = State.parties.find(p => p.id === document.getElementById("pur-supplier")?.value);
  const item = State.items.find(entry => entry.id === document.getElementById("pur-item")?.value);
  const qty = Number(document.getElementById("pur-qty")?.value) || 0;
  const rate = Number(document.getElementById("pur-rate")?.value) || 0;
  const totals = orderTotals([{ qty, rate, gstRate: item ? item.gstRate : 0 }]);
  const split = isInterstateFor(supplier ? partyStateCode(supplier) : "");
  const row = (label, value, id) => `<div class="calc-row"${id ? ` id="${id}"` : ""}><span>${label}</span><span>${value}</span></div>`;
  let gstRows;
  let notice;
  if (split === null) {
    gstRows = row("GST", "Set business state", "pur-gst-missing");
    notice = "Set business state in Settings to decide CGST+SGST or IGST. Purchases can't be saved until then.";
  } else {
    const gstP = Math.round((Number(totals.gst) || 0) * 100);
    if (split) {
      gstRows = row("IGST", formatINR(gstP / 100), "pur-igst");
      notice = "Inter-state purchase: IGST input credit.";
    } else {
      const c = Math.floor(gstP / 2);
      gstRows = row("CGST", formatINR(c / 100), "pur-cgst") + row("SGST", formatINR((gstP - c) / 100), "pur-sgst");
      notice = "Intra-state purchase: CGST + SGST input credit.";
    }
  }
  box.innerHTML = row("Taxable", formatINR(totals.taxable)) + gstRows + row("Total", formatINR(totals.total), "pur-total")
    + `<p class="text-xs text-muted" id="pur-tax-notice">${escHtml(notice)}</p>`;
}
window.renderPurchaseTaxPreview = renderPurchaseTaxPreview;

function syncPurchaseSerialBox() {
  const item = State.items.find(entry => entry.id === document.getElementById("pur-item")?.value);
  document.getElementById("pur-serial-wrap")?.classList.toggle("d-none", !item?.trackSerial);
}

function savePurchaseBill() {
  if (blockedAction("purchase")) return;
  if (!requireBusinessState("a purchase")) return;
  const supplier = State.parties.find(p => p.id === document.getElementById("pur-supplier").value);
  const item = State.items.find(entry => entry.id === document.getElementById("pur-item").value);
  const qty = Number(document.getElementById("pur-qty").value);
  const rate = Number(document.getElementById("pur-rate").value);
  const billNo = document.getElementById("pur-bill").value.trim();
  const godownId = document.getElementById("pur-godown").value || defaultGodownId();
  if (!supplier || !item || !billNo || !qty || qty <= 0) {
    showToast("Supplier, bill number, item, and quantity are required.", "error");
    return;
  }
  const serials = parseSerialList(document.getElementById("pur-serials").value);
  if (State.purchases.some(entry => String(entry.billNo || "").toLowerCase() === billNo.toLowerCase())) {
    showToast("That supplier bill number is already recorded.", "error");
    return;
  }
  if (item.trackSerial && serials.length !== qty) {
    showToast(`Enter ${qty} serial number(s), one per piece.`, "error");
    return;
  }
  const duplicate = serials.find(code => State.items.some(entry => (entry.serials || []).includes(code)));
  if (duplicate) {
    showToast(`Serial ${duplicate} is already in stock.`, "error");
    return;
  }
  const totals = orderTotals([{ qty, rate, gstRate: item.gstRate }]);
  const paid = document.getElementById("pur-paid")?.checked;
  const accountId = paid
    ? (document.getElementById("pur-account-id")?.value
      || (typeof defaultAccountIdForMode === "function" ? defaultAccountIdForMode("BANK") : "l-bank"))
    : "";
  if (paid && typeof rememberAccountId === "function") rememberAccountId(accountId);
  const purDate = document.getElementById("pur-date").value || todayISO();
  const purchaseNo = (typeof BillSetuDocNumbering !== "undefined")
    ? BillSetuDocNumbering.previewNextNumber("PURCHASE", purDate)
    : ("PUR-" + String((State.purchases || []).length + 1).padStart(4, "0"));
  const purchase = {
    id: uid("pur"),
    billNo,
    purchaseNo,
    date: purDate,
    supplierId: supplier.id,
    supplierName: supplier.name,
    supplierGstin: supplier.gstin || "",
    taxableAmount: totals.taxable,
    gstAmount: totals.gst,
    ...(typeof purchaseGstFields === "function" ? purchaseGstFields(supplier, totals.gst) : {}),
    totalBill: totals.total,
    paidAmount: paid ? totals.total : 0,
    balanceDue: paid ? 0 : totals.total,
    status: paid ? "PAID" : "UNPAID",
    paymentMode: paid ? "BANK" : "CREDIT",
    accountId,
    godownId,
    items: [{ itemId: item.id, description: item.name, qty, rate, gstRate: item.gstRate, serials, godownId }]
  };
  adjustStockLine({ itemId: item.id, description: item.name, qty, serials, godownId }, "in");
  if (!paid) applySupplierBill(supplier, totals.total);
  State.purchases.push(purchase);
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.commitDocNumber) {
    BillSetuDocNumbering.commitDocNumber("PURCHASE", purchaseNo, purDate);
  }
  if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(purchase);
  logActivity(`Recorded purchase ${billNo}`);
  saveToStorage();
  document.getElementById("modal-purchase").classList.remove("open");
  showToast(`Inward bill ${billNo} added stock in ${godownName(godownId)}.`);
  renderPurchasesTable();
  renderDashboard();
}

function openReceivePurchaseOrder(poId) {
  if (blockedAction("purchase")) return;
  const po = State.purchaseOrders.find(entry => entry.id === poId);
  if (!po || po.status !== "OPEN") return;
  receivingPoId = poId;
  const totals = orderTotals(po.items);
  document.getElementById("recv-summary").textContent = `${po.poNo} · ${po.supplierName} · ${formatINR(totals.total)}`;
  document.getElementById("recv-bill").value = "PB-" + po.poNo.replace(/^PO-/, "");
  fillGodownSelect("recv-godown", defaultGodownId());
  document.getElementById("recv-serials").value = "";
  const needsSerial = (po.items || []).some(lineNeedsSerial);
  document.getElementById("recv-serial-wrap")?.classList.toggle("d-none", !needsSerial);
  document.getElementById("modal-receive").classList.add("open");
}

function receivePurchaseOrder() {
  if (blockedAction("purchase")) return;
  if (!requireBusinessState("a purchase")) return;
  const po = State.purchaseOrders.find(entry => entry.id === receivingPoId);
  if (!po || po.status !== "OPEN") return;
  const godownId = document.getElementById("recv-godown").value || defaultGodownId();
  const typed = parseSerialList(document.getElementById("recv-serials").value);
  let cursor = 0;
  const lines = [];
  for (const line of po.items || []) {
    const item = State.items.find(entry => entry.id === line.itemId);
    if (!item) {
      showToast("That purchase order points at a missing item.", "error");
      return;
    }
    let serials = [];
    if (item.trackSerial) {
      serials = typed.slice(cursor, cursor + Number(line.qty));
      cursor += Number(line.qty);
      if (serials.length !== Number(line.qty)) {
        showToast(`Enter ${line.qty} serial(s) for ${item.name}.`, "error");
        return;
      }
      const duplicate = serials.find(code => State.items.some(entry => (entry.serials || []).includes(code)));
      if (duplicate) {
        showToast(`Serial ${duplicate} is already in stock.`, "error");
        return;
      }
    }
    lines.push({ ...line, description: line.description || item.name, serials, godownId, gstRate: line.gstRate || item.gstRate });
  }
  if (cursor !== typed.length) {
    showToast("There are more serial numbers than the order quantity.", "error");
    return;
  }
  const totals = orderTotals(lines);
  const supplier = State.parties.find(p => p.id === po.supplierId);
  const billNo = document.getElementById("recv-bill").value.trim() || ("PB-" + po.poNo);
  State.purchases.push({
    id: uid("pur"),
    billNo,
    date: todayISO(),
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    supplierGstin: supplier?.gstin || "",
    taxableAmount: Math.round(totals.taxable),
    gstAmount: Math.round(totals.gst),
    ...(typeof purchaseGstFields === "function" ? purchaseGstFields(supplier, Math.round(totals.gst)) : {}),
    totalBill: totals.total,
    paidAmount: 0,
    balanceDue: totals.total,
    status: "UNPAID",
    godownId,
    poId: po.id,
    items: lines.map(line => ({
      itemId: line.itemId,
      description: line.description,
      qty: line.qty,
      rate: line.rate,
      gstRate: line.gstRate,
      serials: line.serials,
      godownId
    }))
  });
  lines.forEach(line => adjustStockLine(line, "in"));
  if (supplier) {
    supplier.balance = (Number(supplier.balance) || 0) + totals.total;
    supplier.balType = "PAYABLE";
  }
  po.status = "RECEIVED";
  logActivity(`Received ${po.poNo} as ${billNo}`);
  saveToStorage();
  document.getElementById("modal-receive").classList.remove("open");
  showToast(`${po.poNo} is now purchase ${billNo}. Stock is in ${godownName(godownId)}.`);
  renderPurchasesTable();
  renderDashboard();
}

function returnedQty(purchaseId, itemId) {
  return State.debitNotes
    .filter(note => note.purchaseId === purchaseId && note.itemId === itemId)
    .reduce((sum, note) => sum + (Number(note.qty) || 0), 0);
}

function fillDebitPurchases() {
  const select = document.getElementById("dn-purchase");
  if (!select) return;
  const rows = State.purchases.map(purchase =>
    `<option value="${purchase.id}">${escHtml(purchase.billNo)} · ${escHtml(purchase.supplierName)}</option>`
  );
  select.innerHTML = `<option value="">No linked bill — type one below</option>${rows.join("")}`;
}

function onDebitPurchaseChange() {
  const purchase = State.purchases.find(entry => entry.id === document.getElementById("dn-purchase").value);
  if (!purchase) return;
  document.getElementById("dn-against").value = purchase.billNo;
  if (purchase.supplierId) document.getElementById("dn-supplier").value = purchase.supplierId;
  if (purchase.godownId) document.getElementById("dn-godown").value = purchase.godownId;
  const itemSelect = document.getElementById("dn-item");
  if (purchase.items?.length) {
    itemSelect.innerHTML = purchase.items.map(line =>
      `<option value="${line.itemId}">${escHtml(line.description)} · bought ${line.qty}</option>`
    ).join("");
    const line = purchase.items[0];
    document.getElementById("dn-rate").value = line.rate;
    document.getElementById("dn-qty").value = Math.max(1, line.qty - returnedQty(purchase.id, line.itemId));
  } else if (itemSelect) {
    const godownId = document.getElementById("dn-godown")?.value || defaultGodownId();
    const fallback = State.items.find(entry => !entry.trackSerial && !isServiceCategory(entry.category) && qtyInGodown(entry, godownId) > 0)
      || State.items.find(entry => !entry.trackSerial && !isServiceCategory(entry.category));
    if (fallback) {
      itemSelect.value = fallback.id;
      document.getElementById("dn-rate").value = fallback.costPrice || fallback.sellingPrice || 0;
    }
  }
  syncDebitSerialBox();
}

function syncDebitSerialBox() {
  const item = State.items.find(entry => entry.id === document.getElementById("dn-item")?.value);
  document.getElementById("dn-serial-wrap")?.classList.toggle("d-none", !item?.trackSerial);
}

let editingDebitNoteId = null;

/** 1.13.17: keep a debit note's stored or linked-purchase split; never re-decide from the current state on edit. */
function debitNoteSplitToKeep(note, purchase) {
  if (typeof note?.isInterstate === "boolean") return note.isInterstate;
  if (typeof purchase?.isInterstate === "boolean") return purchase.isInterstate;
  const linkedId = note?.purchaseId || "";
  const linked = linkedId && !purchase ? (State.purchases || []).find(p => p.id === linkedId) : purchase;
  if (typeof linked?.isInterstate === "boolean") return linked.isInterstate;
  return undefined;
}
window.debitNoteSplitToKeep = debitNoteSplitToKeep;

window.editDebitNote = function editDebitNote(noteId) {
  if (blockedAction("purchase")) return;
  const note = (State.debitNotes || []).find(n => n.id === noteId);
  if (!note) {
    showToast("Debit note not found.", "error");
    return;
  }
  editingDebitNoteId = note.id;
  openDebitNoteModal._keepEditing = true;
  openDebitNoteModal();
  const setVal = (id, v) => { const f = document.getElementById(id); if (f) f.value = v == null ? "" : v; };
  if (note.purchaseId) setVal("dn-purchase", note.purchaseId);
  if (typeof onDebitPurchaseChange === "function" && note.purchaseId) onDebitPurchaseChange();
  setVal("dn-against", note.againstBill || "");
  if (note.supplierId) setVal("dn-supplier", note.supplierId);
  if (note.itemId) setVal("dn-item", note.itemId);
  setVal("dn-qty", note.qty);
  setVal("dn-rate", note.rate);
  if (note.godownId) setVal("dn-godown", note.godownId);
  setVal("dn-date", note.date || todayISO());
  setVal("dn-serials", (note.serials || []).join("\n"));
  if (typeof syncDebitSerialBox === "function") syncDebitSerialBox();
};

function saveDebitNote() {
  if (blockedAction("purchase")) return;
  if (!requireBusinessState("a debit note")) return;
  const supplier = State.parties.find(p => p.id === document.getElementById("dn-supplier").value);
  const item = State.items.find(entry => entry.id === document.getElementById("dn-item").value);
  const qty = Number(document.getElementById("dn-qty").value);
  const rate = Number(document.getElementById("dn-rate").value);
  const godownId = document.getElementById("dn-godown")?.value || defaultGodownId();
  const purchase = State.purchases.find(entry => entry.id === document.getElementById("dn-purchase")?.value);
  const existing = editingDebitNoteId ? (State.debitNotes || []).find(n => n.id === editingDebitNoteId) : null;
  if (!supplier || !item || !qty || qty <= 0) {
    showToast("Supplier, item, and quantity are required.", "error");
    return;
  }
  if (purchase?.items?.length) {
    const bought = purchase.items.find(line => line.itemId === item.id);
    const already = existing && existing.purchaseId === purchase.id && existing.itemId === item.id ? (Number(existing.qty) || 0) : 0;
    const allowed = bought ? bought.qty - returnedQty(purchase.id, item.id) + already : 0;
    if (!bought || qty > allowed) {
      showToast(`Only ${allowed || 0} left to return on ${purchase.billNo}.`, "error");
      return;
    }
  }
  const serials = parseSerialList(document.getElementById("dn-serials")?.value || "");
  const existingQtySame = existing && existing.itemId === item.id && (existing.godownId || "") === (godownId || "") ? (Number(existing.qty) || 0) : 0;
  const existingSerials = existing && existing.itemId === item.id ? (existing.serials || []) : [];
  if (item.trackSerial) {
    if (serials.length !== qty) {
      showToast(`Enter the ${qty} serial number(s) going back to the supplier.`, "error");
      return;
    }
    const inHandOrThisNote = code => (item.serials || []).includes(code) || existingSerials.includes(code);
    const missing = serials.find(code => !inHandOrThisNote(code));
    if (missing) {
      showToast(`Serial ${missing} is not in stock, so it cannot be returned.`, "error");
      return;
    }
    const wrongGodown = serials.find(code => !existingSerials.includes(code) && (item.serialGodown?.[code] || defaultGodownId()) !== godownId);
    if (wrongGodown) {
      showToast(`Serial ${wrongGodown} is not in ${godownName(godownId)}.`, "error");
      return;
    }
  } else if (qtyInGodown(item, godownId) + existingQtySame < qty) {
    showToast(`Only ${qtyInGodown(item, godownId)} in ${godownName(godownId)}.`, "error");
    return;
  }
  const totals = orderTotals([{ qty, rate, gstRate: item.gstRate }]);
  const dnDate = document.getElementById("dn-date").value || todayISO();
  if (existing) {
    // Keep the posted split (own flag, else linked purchase). Never re-split from the current state.
    const kept = debitNoteSplitToKeep(existing, purchase);
    const sameCore = existing.itemId === item.id
      && existing.supplierId === supplier.id
      && Number(existing.qty) === qty
      && Number(existing.rate) === rate
      && (existing.godownId || "") === (godownId || "")
      && JSON.stringify(existing.serials || []) === JSON.stringify(serials);
    if (!sameCore) {
      showToast("Change the quantity or item on a new debit note. This edit keeps the original GST split.", "error");
      return;
    }
    existing.date = dnDate;
    existing.againstBill = document.getElementById("dn-against").value.trim() || purchase?.billNo || existing.againstBill || "";
    if (purchase?.id && !existing.purchaseId) existing.purchaseId = purchase.id;
    if (typeof kept === "boolean") existing.isInterstate = kept;
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(existing);
    logActivity(`Edited debit note ${existing.noteNo}`);
    saveToStorage();
    editingDebitNoteId = null;
    document.getElementById("modal-debit").classList.remove("open");
    showToast(`${existing.noteNo} updated.`);
    renderPurchasesTable();
    renderDashboard();
    return;
  }
  const noteNo = (typeof BillSetuDocNumbering !== "undefined")
    ? BillSetuDocNumbering.previewNextNumber("DEBIT_NOTE", dnDate)
    : (typeof nextDocNo === "function" ? nextDocNo("DN") : ("DN-" + String((State.debitNotes || []).length + 1).padStart(4, "0")));
  const note = {
    id: uid("dn"),
    noteNo,
    date: dnDate,
    supplierId: supplier.id,
    supplierName: supplier.name,
    purchaseId: purchase?.id || "",
    againstBill: document.getElementById("dn-against").value.trim() || purchase?.billNo || "",
    itemId: item.id,
    itemName: item.name,
    qty,
    rate,
    serials,
    godownId,
    taxableAmount: totals.taxable,
    total: totals.total,
    gstAmount: totals.gst,
    // 1.13.16: a purchase return mirrors its purchase's stored split; otherwise the supplier's state.
    isInterstate: (purchase && typeof purchase.isInterstate === "boolean")
      ? purchase.isInterstate
      : !!isInterstateFor(partyStateCode(supplier))
  };
  adjustStockLine({ itemId: item.id, description: item.name, qty, serials, godownId }, "out");
  if (purchase) {
    purchase.balanceDue = Math.max(0, Math.round(((purchase.balanceDue ?? purchase.totalBill) - totals.total) * 100) / 100);
    if (purchase.balanceDue <= 0.009) purchase.status = "PAID";
  }
  const owed = supplier.balType === "RECEIVABLE" ? 0 : (Number(supplier.balance) || 0);
  if (owed + 0.009 >= totals.total && supplier.balType !== "RECEIVABLE") {
    supplier.balance = Math.max(0, Math.round((owed - totals.total) * 100) / 100);
  } else {
    const extra = Math.round((totals.total - owed) * 100) / 100;
    supplier.balance = extra;
    supplier.balType = "RECEIVABLE";
  }
  State.debitNotes.push(note);
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.commitDocNumber) {
    BillSetuDocNumbering.commitDocNumber("DEBIT_NOTE", note.noteNo, note.date);
  }
  if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(note);
  logActivity(`Debit note ${note.noteNo} reduced stock and ITC`);
  saveToStorage();
  document.getElementById("modal-debit").classList.remove("open");
  showToast(`${note.noteNo} removed stock and reduced what you owe ${supplier.name}. ITC is lower by ${formatINR(note.gstAmount)}.`);
  renderPurchasesTable();
  renderDashboard();
}

function renderGodowns() {
  const list = document.getElementById("godown-list");
  if (list) {
    list.innerHTML = State.godowns.map(g => `
      <div class="party-item-card">
        <div><strong>${escHtml(g.name)}</strong><div class="text-xs text-muted">${g.isDefault ? "Default for new stock" : "Extra location"}</div></div>
        ${g.isDefault ? "" : `<button class="btn btn-outline btn-sm" onclick="deleteGodown('${g.id}')">Remove</button>`}
      </div>
    `).join("");
  }
  ["tr-from", "tr-to"].forEach(id => fillGodownSelect(id));
  const itemSelect = document.getElementById("tr-item");
  if (itemSelect) {
    const current = itemSelect.value;
    itemSelect.innerHTML = State.items.filter(item => !isServiceCategory(item.category)).map(item =>
      `<option value="${item.id}">${escHtml(item.name)}</option>`
    ).join("");
    if ([...itemSelect.options].some(option => option.value === current)) itemSelect.value = current;
  }
  renderGodownReport();
  const history = document.getElementById("transfer-history-body");
  if (history) {
    history.innerHTML = State.stockTransfers.length
      ? State.stockTransfers.slice().reverse().map(move => `<tr>
          <td>${escHtml(move.date)}</td>
          <td>${escHtml(move.itemName)}</td>
          <td>${escHtml(String(move.qty))}${(move.serials || []).length ? `<div class="text-xs text-muted">${escHtml(move.serials.join(", "))}</div>` : ""}</td>
          <td>${escHtml(godownName(move.fromGodownId))}</td>
          <td>${escHtml(godownName(move.toGodownId))}</td>
        </tr>`).join("")
      : `<tr><td colspan="5" class="text-muted">No transfers yet.</td></tr>`;
  }
}

function fillGodownTable(headId, bodyId) {
  const head = document.getElementById(headId);
  const body = document.getElementById(bodyId);
  if (!head || !body) return;
  const cols = (State.godowns || []).length + 2;
  head.innerHTML = `<tr><th>Item</th>${State.godowns.map(g => `<th>${escHtml(g.name)}</th>`).join("")}<th>Total</th></tr>`;
  const items = State.items.filter(item => !isServiceCategory(item.category));
  body.innerHTML = items.map(item => `<tr>
    <td>${escHtml(item.name)}</td>
    ${State.godowns.map(g => `<td>${qtyInGodown(item, g.id)}</td>`).join("")}
    <td><strong>${item.trackSerial ? (item.serials || []).length : item.stock}</strong></td>
  </tr>`).join("") || `<tr><td colspan="${cols}" class="text-muted">No stock items.</td></tr>`;
}

function renderGodownReport() {
  fillGodownTable("godown-report-head", "godown-report-body");
  fillGodownTable("report-godown-head", "report-godown-body");
}

function addGodown() {
  if (blockedAction("stock")) return;
  const name = document.getElementById("godown-name")?.value.trim();
  if (!name) {
    showToast("Type a godown name.", "error");
    return;
  }
  State.godowns.push({ id: uid("gd"), name, isDefault: false });
  document.getElementById("godown-name").value = "";
  logActivity(`Added godown ${name}`);
  saveToStorage();
  renderGodowns();
  showToast(`${name} can now hold stock.`);
}

function deleteGodown(id) {
  if (blockedAction("stock")) return;
  const godown = State.godowns.find(g => g.id === id);
  if (!godown || godown.isDefault) return;
  const holding = State.items.some(item => qtyInGodown(item, id) > 0);
  if (holding) {
    showToast("Transfer the stock out before removing this godown.", "error");
    return;
  }
  State.godowns = State.godowns.filter(g => g.id !== id);
  logActivity(`Removed godown ${godown.name}`);
  saveToStorage();
  renderGodowns();
}

function transferStock() {
  if (blockedAction("stock")) return;
  const item = State.items.find(entry => entry.id === document.getElementById("tr-item").value);
  const fromId = document.getElementById("tr-from").value;
  const toId = document.getElementById("tr-to").value;
  const qty = Number(document.getElementById("tr-qty").value);
  if (!item || isServiceCategory(item.category)) {
    showToast("Pick a stock item.", "error");
    return;
  }
  if (!fromId || fromId === toId) {
    showToast("Pick two different godowns.", "error");
    return;
  }
  const serials = parseSerialList(document.getElementById("tr-serials").value);
  if (item.trackSerial) {
    if (!serials.length) {
      showToast("Enter the serial numbers to move.", "error");
      return;
    }
    const bad = serials.find(code => (item.serialGodown?.[code] || defaultGodownId()) !== fromId || !(item.serials || []).includes(code));
    if (bad) {
      showToast(`Serial ${bad} is not in ${godownName(fromId)}.`, "error");
      return;
    }
    serials.forEach(code => { item.serialGodown[code] = toId; });
  } else {
    if (!qty || qty <= 0) {
      showToast("Enter a quantity.", "error");
      return;
    }
    if (qtyInGodown(item, fromId) < qty) {
      showToast(`Only ${qtyInGodown(item, fromId)} in ${godownName(fromId)}.`, "error");
      return;
    }
    item.godownQty[fromId] = qtyInGodown(item, fromId) - qty;
    item.godownQty[toId] = qtyInGodown(item, toId) + qty;
    syncItemStock(item);
  }
  markItemStockDirty(item);
  State.stockTransfers.push({
    id: uid("tr"),
    date: todayISO(),
    itemId: item.id,
    itemName: item.name,
    qty: item.trackSerial ? serials.length : qty,
    serials,
    fromGodownId: fromId,
    toGodownId: toId,
    notes: document.getElementById("tr-notes")?.value.trim() || ""
  });
  document.getElementById("tr-serials").value = "";
  logActivity(`Transferred ${item.name} to ${godownName(toId)}`);
  saveToStorage();
  showToast(`Moved ${item.name} to ${godownName(toId)}.`);
  renderGodowns();
  renderInventoryTable();
}

function renderStaff() {
  const body = document.getElementById("staff-table-body");
  if (body) {
    body.innerHTML = State.staff.length
      ? State.staff.map(person => `<tr>
          <td><strong>${escHtml(person.name)}</strong></td>
          <td>${escHtml(ROLE_LABELS[person.role] || person.role)}</td>
          <td>${person.active === false ? "Disabled" : "Active"}</td>
          <td><button class="btn btn-outline btn-sm" onclick="toggleStaff('${person.id}')">${person.active === false ? "Enable" : "Disable"}</button></td>
        </tr>`).join("")
      : `<tr><td colspan="4" class="text-muted">No staff yet. The owner signs in with the password from the lock screen.</td></tr>`;
  }
  const log = document.getElementById("activity-log-body");
  if (log) {
    const rows = State.activityLog.slice().reverse().slice(0, 40);
    log.innerHTML = rows.length
      ? rows.map(entry => `<tr>
          <td>${escHtml(entry.at.replace("T", " ").slice(0, 16))}</td>
          <td>${escHtml(entry.actor)}</td>
          <td>${escHtml(ROLE_LABELS[entry.role] || entry.role || "")}</td>
          <td>${escHtml(entry.action)}</td>
        </tr>`).join("")
      : `<tr><td colspan="4" class="text-muted">No activity yet.</td></tr>`;
  }
}

async function addStaffMember() {
  if (blockedAction("staff")) return;
  const name = document.getElementById("staff-name").value.trim();
  const role = document.getElementById("staff-role").value;
  const pin = document.getElementById("staff-pin").value;
  if (!name || pin.length < 4) {
    showToast("Name and a PIN of at least 4 characters are required.", "error");
    return;
  }
  if (name.toLowerCase() === "owner" || State.staff.some(person => person.name.toLowerCase() === name.toLowerCase())) {
    showToast("That name is already used.", "error");
    return;
  }
  const salt = randomSalt();
  State.staff.push({ id: uid("stf"), name, role, salt, hash: await hashSecret(pin, salt), active: true });
  document.getElementById("staff-name").value = "";
  document.getElementById("staff-pin").value = "";
  logActivity(`Added staff ${name} (${ROLE_LABELS[role] || role})`);
  saveToStorage();
  writeStaffIndex();
  renderStaff();
  showToast(`${name} can lock the app and sign in with this PIN.`);
}

function toggleStaff(id) {
  if (blockedAction("staff")) return;
  const person = State.staff.find(entry => entry.id === id);
  if (!person) return;
  person.active = person.active === false;
  logActivity(`${person.active ? "Enabled" : "Disabled"} ${person.name}`);
  saveToStorage();
  writeStaffIndex();
  renderStaff();
}

function applySupplierBill(supplier, total) {
  const bill = Number(total) || 0;
  if (supplier.balType === "RECEIVABLE" && (Number(supplier.balance) || 0) > 0) {
    const advance = Number(supplier.balance) || 0;
    if (advance + 0.009 >= bill) {
      supplier.balance = Math.round((advance - bill) * 100) / 100;
      return;
    }
    supplier.balance = Math.round((bill - advance) * 100) / 100;
    supplier.balType = "PAYABLE";
    return;
  }
  supplier.balance = Math.round(((Number(supplier.balance) || 0) + bill) * 100) / 100;
  supplier.balType = "PAYABLE";
}

function applyRoleUi() {
  const role = State.currentActor?.role || "ADMIN";
  const allowed = role === "ADMIN" ? null : (ROLE_VIEWS[role] || []);
  document.querySelectorAll(".nav-item, #bottom-nav [data-view]").forEach(button => {
    const view = button.getAttribute("data-view");
    button.classList.toggle("role-hidden", !!allowed && !allowed.includes(view));
  });
  const areas = {
    sales: ["btn-new-invoice-top", "btn-create-sale-modal", "act-new-sale", "btn-pos-checkout", "btn-save-invoice", "btn-save-print-invoice", "btn-party-redeem-loyalty"],
    purchase: ["btn-create-purchase-modal", "btn-open-po", "btn-open-debit", "act-new-purchase"],
    stock: ["btn-add-item-modal", "act-add-item"],
    party: ["btn-add-party-modal", "act-add-party", "btn-party-record-payment", "btn-party-create-bill"],
    expense: ["btn-add-expense-modal"],
    settings: ["btn-save-settings", "btn-quick-sample", "btn-import-data", "btn-import-trigger", "btn-change-lock"]
  };
  Object.entries(areas).forEach(([area, ids]) => {
    const hide = !canWrite(area);
    ids.forEach(id => document.getElementById(id)?.classList.toggle("role-hidden", hide));
  });
  document.getElementById("btn-export-data")?.classList.toggle("role-hidden", role !== "ADMIN");
  const nameEl = document.querySelector(".sidebar-footer .user-name");
  if (nameEl && State.currentActor) nameEl.textContent = State.currentActor.name;
  const avatar = document.querySelector(".sidebar-footer .avatar-circle");
  if (avatar && State.currentActor?.name) avatar.textContent = State.currentActor.name.slice(0, 2).toUpperCase();
}

function applyStockCount(item, qty) {
  if (!item.godownQty) item.godownQty = {};
  const count = Number(qty);
  if (!(count > 0)) {
    Object.keys(item.godownQty).forEach(id => { item.godownQty[id] = 0; });
    (State.godowns || []).forEach(godown => { item.godownQty[godown.id] = 0; });
    item.stock = 0;
    syncItemStock(item);
    markItemStockDirty(item);
    return;
  }
  const main = defaultGodownId();
  const others = Object.entries(item.godownQty).reduce((sum, [id, held]) => sum + (id === main ? 0 : (Number(held) || 0)), 0);
  item.godownQty[main] = Math.max(0, count - others);
  syncItemStock(item);
  markItemStockDirty(item);
}

function billShareText(inv) {
  const itemsText = (inv.items || []).map(item => `• ${item.description} (Qty: ${item.qty}) - ₹${Number(item.total || 0).toFixed(2)}`).join("\n");
  return `Namaste ${inv.partyName},\nHere is your bill${typeof bizName === "function" && bizName() ? ` from *${bizName()}*` : ""}:\n\n*Invoice #:* ${inv.invoiceNo}\n*Date:* ${inv.date}\n*Total Amount:* ₹${inv.grandTotal}\n*Paid:* ₹${inv.amountReceived}\n*Balance Due:* ₹${inv.balanceDue}\n\n*Items:*\n${itemsText}${typeof paymentInstructionText === "function" && paymentInstructionText() ? "\n\n" + paymentInstructionText() : ""}`;
}

async function shareTextNative(title, text) {
  try {
    if (window.Capacitor?.registerPlugin) {
      const Share = window.Capacitor.registerPlugin("Share");
      await Share.share({ title, text, dialogTitle: title });
      return true;
    }
  } catch (err) {
    console.warn("Capacitor share failed", err);
  }
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return true;
    }
  }
  return false;
}

function keepSelectValue(select, html) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = html;
  if ([...select.options].some(option => option.value === current)) select.value = current;
}

adjustStockLine = function (line, direction) {
  adjustStockLineWithGodown(line, direction);
};

const _getAvailableSerialsForLine = getAvailableSerialsForLine;
getAvailableSerialsForLine = function (stockItem, lineIndex) {
  const all = _getAvailableSerialsForLine(stockItem, lineIndex);
  if (document.getElementById("inv-doc-type")?.value === "CREDIT_NOTE") return all;
  const godownId = document.getElementById("inv-godown")?.value || defaultGodownId();
  return all.filter(code => (stockItem.serialGodown?.[code] || defaultGodownId()) === godownId);
};

const _serialLinesValid = serialLinesValid;
serialLinesValid = function (lines, isReturn) {
  if (!_serialLinesValid(lines, isReturn)) return false;
  if (isReturn) return true;
  for (const line of lines) {
    const item = findStockItem(line);
    if (!item?.trackSerial) continue;
    const godownId = line.godownId || document.getElementById("inv-godown")?.value || document.getElementById("pos-godown")?.value || defaultGodownId();
    for (const code of line.serials || []) {
      const at = item.serialGodown?.[code] || defaultGodownId();
      if (at !== godownId) {
        showToast(`Serial ${code} is in ${godownName(at)}, not ${godownName(godownId)}.`, "error");
        return false;
      }
    }
  }
  return true;
};

const _catalogLine = catalogLine;
catalogLine = function (item, serial) {
  const line = _catalogLine(item, serial);
  line.custom = { ...(item.custom || {}) };
  return line;
};

const _fillItemForm = fillItemForm;
fillItemForm = function (item) {
  _fillItemForm(item);
  renderItemCustomFields(item);
};

const _posScanSerial = posScanSerial;
posScanSerial = function (raw) {
  const code = String(raw || "").trim();
  const godownId = document.getElementById("pos-godown")?.value || defaultGodownId();
  const item = State.items.find(entry => entry.trackSerial && (entry.serials || []).includes(code));
  if (item && (item.serialGodown?.[code] || defaultGodownId()) !== godownId) {
    showToast(`Serial ${code} is in ${godownName(item.serialGodown?.[code] || defaultGodownId())}.`, "error");
    return;
  }
  _posScanSerial(raw);
};

const _renderPos = renderPos;
renderPos = function () {
  _renderPos();
  const select = document.getElementById("pos-godown");
  if (select) {
    const current = select.value || defaultGodownId();
    select.innerHTML = godownOptionsHtml(current);
  }
};

const _bookSearchHits = bookSearchHits;
bookSearchHits = function (query, itemsOnly) {
  const hits = _bookSearchHits(query, itemsOnly);
  if (itemsOnly || !String(query || "").trim()) return hits;
  const history = findSerialHistory(query);
  if (history.length) {
    hits.unshift({
      kind: "serial",
      id: String(query).trim(),
      serial: String(query).trim(),
      kindLabel: "Serial",
      title: String(query).trim(),
      meta: history.map(event => event.kind).join(" · ")
    });
  }
  return hits;
};

const _chooseSearchHit = chooseSearchHit;
chooseSearchHit = function (event) {
  const button = event.target.closest?.(".search-hit") || event.target;
  if (button?.dataset?.kind === "serial") {
    const code = button.dataset.serial || button.dataset.id;
    hideSearchPanels();
    switchView("inventory");
    const input = document.getElementById("serial-lookup-input");
    if (input) input.value = code;
    renderSerialLookup(code);
    return;
  }
  _chooseSearchHit(event);
};

const _shareWhatsAppInvoice = shareWhatsAppInvoice;
shareWhatsAppInvoice = async function (invoiceId) {
  const inv = State.invoices.find(entry => entry.id === invoiceId);
  if (!inv) return;
  const text = billShareText(inv);
  const phone = String(inv.partyPhone || "").replace(/\D/g, "").slice(-10);
  const waUrl = phone
    ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`
    : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  const onPhone = window.Capacitor || (navigator.share && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
  if (onPhone && await shareTextNative(`Invoice ${inv.invoiceNo}`, text)) return;
  window.open(waUrl, "_blank");
};

const _openDebit = openDebitNoteModal;
openDebitNoteModal = function () {
  if (blockedAction("purchase")) return;
  if (!openDebitNoteModal._keepEditing) editingDebitNoteId = null;
  openDebitNoteModal._keepEditing = false;
  _openDebit();
  fillDebitPurchases();
  fillGodownSelect("dn-godown");
  const box = document.getElementById("dn-serials");
  if (box) box.value = "";
  syncDebitSerialBox();
};

const _openPo = openPurchaseOrderModal;
openPurchaseOrderModal = function () {
  if (blockedAction("purchase")) return;
  _openPo();
};

convertPurchaseOrder = function (poId) {
  openReceivePurchaseOrder(poId);
};

redeemLoyalty = function () {
  if (blockedAction("sales")) return;
  const party = State.parties.find(p => p.id === State.selectedPartyId);
  if (!party) return;
  const points = Math.floor(Number(party.loyaltyPoints) || 0);
  const cfg = loyaltyConfig();
  if (points < 1 || cfg.rupeePerPoint <= 0) {
    showToast("This party has no points to redeem.", "error");
    return;
  }
  if (party.balType !== "RECEIVABLE" || party.balance <= 0) {
    showToast("Redeem against an open balance, or use points as a discount on the next bill.", "error");
    return;
  }
  const maxPoints = Math.min(points, Math.floor(party.balance / cfg.rupeePerPoint));
  const rupees = Math.round(maxPoints * cfg.rupeePerPoint * 100) / 100;
  party.loyaltyPoints -= maxPoints;
  party.balance = Math.max(0, party.balance - rupees);
  State.loyaltyLedger.push({
    id: uid("loy"),
    date: todayISO(),
    partyId: party.id,
    type: "REDEEM",
    points: -maxPoints,
    rupees,
    note: "Redeemed against khata balance"
  });
  State.payments.push({
    id: uid("pay"),
    receiptNo: (typeof BillSetuDocNumbering !== "undefined"
      ? BillSetuDocNumbering.previewNextNumber("RECEIPT", todayISO())
      : (typeof nextDocNo === "function" ? nextDocNo("RCT") : ("LOY-" + String((State.payments || []).length + 1).padStart(4, "0")))),
    date: todayISO(),
    partyId: party.id,
    partyName: party.name,
    direction: "LOYALTY",
    amount: rupees,
    mode: "LOYALTY",
    notes: `${maxPoints} points`
  });
  logActivity(`Redeemed ${maxPoints} points for ${party.name}`);
  saveToStorage();
  showToast(`${maxPoints} points cleared ${formatINR(rupees)}. ${party.name} now owes ${formatINR(party.balance)}.`);
  renderParties();
  selectParty(party.id);
  renderDashboard();
};

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("menu-toggle")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.toggle("open");
    document.getElementById("sidebar-backdrop")?.classList.toggle("show");
  });
  document.getElementById("sidebar-backdrop")?.addEventListener("click", () => {
    document.getElementById("sidebar")?.classList.remove("open");
    document.getElementById("sidebar-backdrop")?.classList.remove("show");
  });
  document.getElementById("btn-save-recurring")?.addEventListener("click", saveRecurringFromForm);
  document.getElementById("rec-item")?.addEventListener("change", () => {
    State.pendingRecurringItems = null;
    const item = State.items.find(entry => entry.id === document.getElementById("rec-item").value);
    if (item) document.getElementById("rec-rate").value = item.sellingPrice;
  });
  document.getElementById("inv-godown")?.addEventListener("change", () => {
    renderInvoiceLineItems();
    recalculateInvoice();
  });
  document.getElementById("inv-loyalty-points")?.addEventListener("input", () => {
    State.invoiceAmountReceivedTouched = false;
    recalculateInvoice();
    refreshLoyaltyHint();
  });
  document.getElementById("btn-save-purchase")?.addEventListener("click", savePurchaseBill);
  document.getElementById("pur-paid")?.addEventListener("change", () => {
    const group = document.getElementById("pur-account-group");
    const on = document.getElementById("pur-paid")?.checked;
    group?.classList.toggle("d-none", !on);
    if (on && typeof fillAccountSelect === "function") {
      fillAccountSelect(document.getElementById("pur-account-id"), { mode: "BANK" });
    }
  });
  document.getElementById("btn-close-purchase")?.addEventListener("click", () => document.getElementById("modal-purchase").classList.remove("open"));
  document.getElementById("btn-cancel-purchase")?.addEventListener("click", () => document.getElementById("modal-purchase").classList.remove("open"));
  document.getElementById("pur-item")?.addEventListener("change", () => {
    const item = State.items.find(entry => entry.id === document.getElementById("pur-item").value);
    if (item) document.getElementById("pur-rate").value = item.costPrice;
    syncPurchaseSerialBox();
    renderPurchaseTaxPreview();
  });
  document.getElementById("pur-supplier")?.addEventListener("change", renderPurchaseTaxPreview);
  document.getElementById("pur-qty")?.addEventListener("input", renderPurchaseTaxPreview);
  document.getElementById("pur-rate")?.addEventListener("input", renderPurchaseTaxPreview);
  document.getElementById("btn-confirm-receive")?.addEventListener("click", receivePurchaseOrder);
  document.getElementById("btn-close-receive")?.addEventListener("click", () => document.getElementById("modal-receive").classList.remove("open"));
  document.getElementById("btn-cancel-receive")?.addEventListener("click", () => document.getElementById("modal-receive").classList.remove("open"));
  document.getElementById("dn-purchase")?.addEventListener("change", onDebitPurchaseChange);
  document.getElementById("dn-item")?.addEventListener("change", syncDebitSerialBox);
  document.getElementById("btn-add-godown")?.addEventListener("click", addGodown);
  document.getElementById("btn-transfer")?.addEventListener("click", transferStock);
  document.getElementById("btn-add-staff")?.addEventListener("click", () => addStaffMember());
  document.getElementById("btn-add-custom-field")?.addEventListener("click", addCustomField);
  document.getElementById("btn-serial-lookup")?.addEventListener("click", () => {
    renderSerialLookup(document.getElementById("serial-lookup-input").value);
  });
  document.getElementById("serial-lookup-input")?.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    renderSerialLookup(event.target.value);
  });
  if ("serviceWorker" in navigator && !window.Capacitor && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
