/**
 * Ledgerbay - Indian GST Billing & MSME Business Management Application
 * Complete Engine: Invoicing, Inventory, Khata (Parties), Reports, UPI QR & WhatsApp
 */

// Initial State & Configuration
const CATEGORY_PRESETS = {
  GENERAL: { label: "General goods", hsn: "", gst: 18, unit: "PCS", serial: false },
  SERVICES: { label: "Services", hsn: "", gst: 18, unit: "NOS", serial: false },
  RAW_MATERIAL: { label: "Raw material", hsn: "", gst: 18, unit: "KG", serial: false },
  PACKAGING: { label: "Packaging", hsn: "", gst: 18, unit: "PCS", serial: false },
  OTHER: { label: "Other", hsn: "", gst: 18, unit: "PCS", serial: false }
};

/** Service lines (legacy SERVICE or store SERVICES) carry no stock. */
function isServiceCategory(cat) { return cat === "SERVICE" || cat === "SERVICES"; }

/** Labels for older category codes so restored / personal books still read cleanly. */
const LEGACY_CATEGORY_LABELS = {
  AIR_CONDITIONER: "Air Conditioner",
  REFRIGERATOR: "Refrigerator",
  WASHING_MACHINE: "Washing Machine",
  TELEVISION: "Television",
  KITCHEN_APPLIANCE: "Kitchen Appliance",
  CANE: "Cane / rattan",
  LIGHTING: "Lighting",
  SERVICE: "Service"
};


/** Build variant helpers (dev keeps demo; store/personal ship empty). */
function lbVariant() {
  try { return (window.LEDGERBAY_BUILD && LEDGERBAY_BUILD.VARIANT) || "dev"; } catch (_) { return "dev"; }
}
function lbIsProd() { const v = lbVariant(); return v === "store" || v === "personal"; }
function lbIsPersonal() { return lbVariant() === "personal"; }

const EMPTY_BUSINESS = {
  name: "",
  tradeName: "",
  gstin: "",
  pan: "",
  stateCode: "",
  stateName: "",
  address: "",
  phone: "",
  email: "",
  bankName: "",
  bankAcc: "",
  bankIfsc: "",
  bankBranch: "",
  upiId: "",
  terms: "1. Goods once sold will not be taken back without the original bill.\n2. Subject to local jurisdiction.",
  logo: "",
  signatureImage: "",
  signatureName: "",
  declaration: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
  jurisdiction: "",
  classicBlankCells: true
};

const DEFAULT_BUSINESS = { ...EMPTY_BUSINESS };

const SAMPLE_PARTIES = [];

const SAMPLE_ITEMS = [];

const SAMPLE_INVOICES = [];

const SAMPLE_PURCHASES = [];

const SAMPLE_EXPENSES = [];


const SAMPLE_PAYMENTS = [];

const SAMPLE_ORDERS = [];

// App Store State
const State = {
  business: { ...(lbIsProd() ? EMPTY_BUSINESS : DEFAULT_BUSINESS) },
  parties: lbIsProd() ? [] : [...SAMPLE_PARTIES],
  items: lbIsProd() ? [] : [...SAMPLE_ITEMS],
  invoices: lbIsProd() ? [] : [...SAMPLE_INVOICES],
  purchases: lbIsProd() ? [] : [...SAMPLE_PURCHASES],
  expenses: lbIsProd() ? [] : [...SAMPLE_EXPENSES],
  purchaseOrders: lbIsProd() ? [] : JSON.parse(JSON.stringify(SAMPLE_ORDERS)),
  debitNotes: [],
  payments: lbIsProd() ? [] : [...SAMPLE_PAYMENTS],
  recurringBills: [],
  godowns: [],
  stockTransfers: [],
  staff: [],
  activityLog: [],
  loyaltyLedger: [],
  customFieldDefs: [],
  schemaVersion: 1,
  currentActor: { id: "owner", name: "Owner", role: "ADMIN" },
  posCart: [],
  itemSerialDraft: [],
  editingItemId: null,
  serialScanStream: null,
  serialScanFrame: null,
  currentView: "dashboard",
  selectedPartyId: null,
  activeInvoiceForPrint: null,
  invoiceDraftItems: [],
  invoiceAmountReceivedTouched: false,
  editingInvoiceId: null,
  invoiceMirrorSplit: null // 1.13.17/18: edit of a saved sales doc (and credit notes) re-mirrors the stored split until party/POS changes
};

function isPostedSale(inv) {
  return !!inv && inv.docType !== "ESTIMATE" && inv.docType !== "PROFORMA" && inv.docType !== "DELIVERY_CHALLAN" && inv.docType !== "CREDIT_NOTE";
}

function ensureBooks() {
  if (!Array.isArray(State.purchaseOrders)) State.purchaseOrders = [];
  if (!Array.isArray(State.debitNotes)) State.debitNotes = [];
  if (!Array.isArray(State.payments)) State.payments = [];
  if (!Array.isArray(State.bankAccounts)) State.bankAccounts = [];
  if (!Array.isArray(State.posCart)) State.posCart = [];
  const demoLimits = { "pty-1": 75000, "pty-2": 100000, "pty-3": 8000 };
  const demoPoints = { "pty-1": 277, "pty-2": 532, "pty-3": 53 };
  State.parties.forEach(p => {
    if (p.creditLimit == null) p.creditLimit = demoLimits[p.id] || 0;
    if (p.loyaltyPoints == null) p.loyaltyPoints = demoPoints[p.id] || 0;
  });
  State.items.forEach(item => {
    if (item.wholesalePrice == null) item.wholesalePrice = Math.round((item.sellingPrice || 0) * 0.92);
    if (!Array.isArray(item.serials)) item.serials = [];
    if (item.trackSerial == null) item.trackSerial = false;
    if (item.brand == null) item.brand = "";
    if (item.model == null) item.model = "";
    if (item.warrantyMonths == null) item.warrantyMonths = 0;
    if (!item.category) item.category = "GENERAL";
  });
  migrateGstStates();
  if (typeof migrateSchema === "function") migrateSchema();
}

/**
 * Old books: fill a missing / legacy / name-only GST state on the business and parties from the
 * canonical list (code, else name, else GSTIN prefix; retired 25 → 26). Parties with no state and
 * no GSTIN stay blank and bill with the business state as place of supply. Idempotent.
 */
function migrateGstStates() {
  const G = typeof BillSetuGstin !== "undefined" ? BillSetuGstin : null;
  if (!G) return 0;
  let changed = 0;
  const fix = rec => {
    if (!rec || typeof rec !== "object") return;
    const code = G.normalizeStateCode(rec.stateCode, rec.stateName) || G.gstinStateCode(rec.gstin);
    if (!code) return;
    const name = G.stateName(code);
    if (rec.stateCode !== code || rec.stateName !== name) {
      rec.stateCode = code;
      rec.stateName = name;
      changed++;
    }
  };
  fix(State.business);
  (State.parties || []).forEach(fix);
  return changed;
}
window.migrateGstStates = migrateGstStates;

/** A stored code with no preset or legacy label (e.g. an old FURNITURE item) still reads cleanly: "FURNITURE" -> "Furniture". */
function storedCategoryLabel(code) {
  const t = String(code || "").replace(/_/g, " ").trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : "";
}
function categoryLabel(code) {
  return CATEGORY_PRESETS[code]?.label || LEGACY_CATEGORY_LABELS[code] || storedCategoryLabel(code);
}

function productMeta(item) {
  if (!item) return { brand: "", model: "", warrantyMonths: 0 };
  return {
    brand: item.brand || "",
    model: item.model || "",
    warrantyMonths: Number(item.warrantyMonths) || 0
  };
}

function blankInvoiceLine() {
  return {
    itemId: "",
    description: "",
    brand: "",
    model: "",
    warrantyMonths: 0,
    hsn: "",
    batchExp: "",
    qty: 1,
    unit: "PCS",
    rate: 0,
    discPercent: 0,
    rateInclusive: false,
    gstRate: 18,
    serials: []
  };
}

function catalogLine(item, serial) {
  const line = {
    itemId: item.id,
    description: item.name,
    ...productMeta(item),
    hsn: item.hsn || "",
    batchExp: "",
    qty: 1,
    unit: item.unit || "PCS",
    rate: Number(item.sellingPrice) || 0,
    discPercent: 0,
    gstRate: Number(item.gstRate) || 0,
    rateInclusive: !!item.rateInclusive,
    serials: []
  };
  if (serial) {
    line.serials = [serial];
    line.qty = 1;
  }
  return line;
}

function getAvailableSerialsForLine(stockItem, lineIndex = -1) {
  if (!stockItem || !stockItem.trackSerial) return [];
  const isReturn = document.getElementById("inv-doc-type")?.value === "CREDIT_NOTE";
  const usedOnDraft = new Set(
    (State.invoiceDraftItems || []).flatMap(entry => entry.serials || [])
  );
  if (isReturn) {
    const soldSerials = (State.invoices || [])
      .filter(inv => inv.docType !== "CREDIT_NOTE")
      .flatMap(inv => inv.items || [])
      .filter(line => line.itemId === stockItem.id || String(line.description || "").toLowerCase() === stockItem.name.toLowerCase())
      .flatMap(line => line.serials || []);
    const pool = [...new Set([...soldSerials, ...(stockItem.serials || [])])];
    return pool.filter(code => code && !usedOnDraft.has(code));
  }
  return (stockItem.serials || []).filter(code => code && !usedOnDraft.has(code));
}

function findCatalogItem(query, allowPartial = false) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  const exact = State.items.find(item => item.name.toLowerCase() === q)
    || State.items.find(item => (item.code || "").toLowerCase() === q)
    || State.items.find(item => (item.serials || []).some(code => code.toLowerCase() === q));
  if (exact || !allowPartial) return exact || null;
  return State.items.find(item =>
    item.name.toLowerCase().includes(q)
    || (item.brand && item.brand.toLowerCase().includes(q))
    || (item.model && item.model.toLowerCase().includes(q))
    || (item.code && item.code.toLowerCase().includes(q))
  ) || null;
}

function refreshCatalogDatalist() {
  const list = document.getElementById("catalog-items-list");
  if (!list) return;
  list.innerHTML = State.items.map(item => {
    const extra = [item.code, item.model, `HSN ${item.hsn}`, `${item.gstRate}%`, item.warrantyMonths ? `${item.warrantyMonths} mo` : ""].filter(Boolean).join(" · ");
    return `<option value="${escHtml(item.name)}">${escHtml(extra)}</option>`;
  }).join("");
}

let searchCursor = -1;

function hideSearchPanels() {
  document.querySelectorAll(".search-results").forEach(panel => {
    panel.classList.add("d-none");
    panel.innerHTML = "";
  });
  searchCursor = -1;
}

function bookSearchHits(query, itemsOnly) {
  const q = String(query || "").trim().toLowerCase();
  const invoiceModalOpen = document.getElementById("modal-invoice")?.classList.contains("open");
  if (!document.body.classList.contains("books-open") && !invoiceModalOpen) return [];
  if (!q && !itemsOnly) return [];
  const exactSerialItem = q ? State.items.find(item => (item.serials || []).some(code => code.toLowerCase() === q)) : null;
  let pool = State.items.filter(item => !q || [item.name, item.brand, item.model, item.code, item.hsn, ...(item.serials || [])].join(" ").toLowerCase().includes(q));
  if (exactSerialItem) pool = [exactSerialItem, ...pool.filter(item => item.id !== exactSerialItem.id)];
  const items = pool
    .slice(0, itemsOnly ? 8 : 5)
    .map(item => {
      const serial = q ? ((item.serials || []).find(code => code.toLowerCase() === q) || "") : "";
      if (exactSerialItem && item.id !== exactSerialItem.id && itemsOnly) return false;
      const serialInfo = item.trackSerial ? `${(item.serials || []).length} serial(s) in stock` : "";
      return {
        kind: "item",
        id: item.id,
        serial,
        kindLabel: "Item",
        title: item.name,
        meta: [item.model, item.hsn ? `HSN ${item.hsn}` : "", `${formatINR(item.sellingPrice)} + ${item.gstRate}%`, item.warrantyMonths ? `${item.warrantyMonths} mo warranty` : "", serial ? `Serial ${serial}` : serialInfo].filter(Boolean).join(" · ")
      };
    }).filter(Boolean);
  if (exactSerialItem) {
    items.sort((a, b) => (b.serial ? 1 : 0) - (a.serial ? 1 : 0));
  }
  if (itemsOnly) return items;
  const parties = State.parties.filter(party => [party.name, party.phone, party.gstin, party.address, party.stateName].join(" ").toLowerCase().includes(q))
    .slice(0, 3)
    .map(party => ({
      kind: "party",
      id: party.id,
      serial: "",
      kindLabel: party.type === "SUPPLIER" ? "Supplier" : "Customer",
      title: party.name,
      meta: [party.phone, party.gstin || "Unregistered", party.stateName, party.address].filter(Boolean).join(" · ")
    }));
  const bills = State.invoices.filter(inv => [inv.invoiceNo, inv.partyName, inv.partyPhone].join(" ").toLowerCase().includes(q))
    .slice(0, 3)
    .map(inv => ({
      kind: "invoice",
      id: inv.id,
      serial: "",
      kindLabel: "Bill",
      title: `${inv.invoiceNo} · ${inv.partyName}`,
      meta: `${formatINR(inv.grandTotal)} · ${inv.date || ""}`
    }));
  return [...items, ...parties, ...bills];
}

function renderSearchPanel(panelId, query, itemsOnly) {
  const panel = document.getElementById(panelId);
  if (!panel) return;
  document.querySelectorAll(".search-results").forEach(other => {
    if (other !== panel) {
      other.classList.add("d-none");
      other.innerHTML = "";
    }
  });
  const hits = bookSearchHits(query, itemsOnly);
  searchCursor = hits.length ? 0 : -1;
  if (!hits.length) {
    panel.classList.add("d-none");
    panel.innerHTML = "";
    return;
  }
  panel.classList.remove("d-none");
  panel.innerHTML = hits.map((hit, index) => `
    <button type="button" class="search-hit${index === searchCursor ? " active" : ""}" data-kind="${escHtml(hit.kind)}" data-id="${escHtml(hit.id)}" data-serial="${escHtml(hit.serial)}">
      <span class="search-kind">${escHtml(hit.kindLabel)}</span>
      <span class="search-title">${escHtml(hit.title)}</span>
      <span class="search-meta">${escHtml(hit.meta)}</span>
    </button>
  `).join("");
}

function moveSearchCursor(event, panelId) {
  const panel = document.getElementById(panelId);
  const hits = panel ? [...panel.querySelectorAll(".search-hit")] : [];
  if (!hits.length) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    searchCursor = event.key === "ArrowDown"
      ? Math.min(hits.length - 1, searchCursor + 1)
      : Math.max(0, searchCursor - 1);
    hits.forEach((hit, index) => hit.classList.toggle("active", index === searchCursor));
    hits[searchCursor].scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter") {
    event.preventDefault();
    chooseSearchHit({ target: hits[Math.max(0, searchCursor)] });
  }
}

function applyItemToDraft(itemId, serial) {
  const item = State.items.find(entry => entry.id === itemId);
  if (!item) return;
  const wasOpen = document.getElementById("modal-invoice").classList.contains("open");
  if (!wasOpen) openNewInvoiceModal();
  const line = catalogLine(item, serial);
  if (!wasOpen) State.invoiceDraftItems = [line];
  else {
    const blank = State.invoiceDraftItems.findIndex(entry => !String(entry.description || "").trim());
    if (blank >= 0) State.invoiceDraftItems[blank] = line;
    else State.invoiceDraftItems.push(line);
  }
  renderInvoiceLineItems();
  recalculateInvoice();
}

function applyPartyToDraft(partyId) {
  const wasOpen = document.getElementById("modal-invoice").classList.contains("open");
  if (!wasOpen) openNewInvoiceModal();
  const select = document.getElementById("inv-party-select");
  select.value = partyId;
  updateInvoicePartyMeta();
}

function chooseSearchHit(event) {
  const button = event.target.closest?.(".search-hit") || event.target;
  if (!button?.dataset?.kind) return;
  const kind = button.dataset.kind;
  const id = button.dataset.id;
  const serial = button.dataset.serial || "";
  hideSearchPanels();
  const globalSearch = document.getElementById("global-search");
  const invoiceSearch = document.getElementById("invoice-item-search");
  if (globalSearch) globalSearch.value = "";
  if (invoiceSearch) invoiceSearch.value = "";
  if (kind === "item") {
    applyItemToDraft(id, serial);
    showToast("HSN, price, GST, and warranty are filled on the bill.");
  } else if (kind === "party") {
    applyPartyToDraft(id);
    showToast("Customer, phone, GSTIN, and place of supply are filled.");
  } else if (kind === "invoice") {
    if (typeof openInvoiceDetail === "function") openInvoiceDetail(id);
    else openPrintModal(id);
  }
}

function oldCatalogHits() {
  return State.items.filter(item => /Gaming Monitor|SanDisk|Egyptian Cotton|Fastrack Reflex|Logitech MK270|Microtek 1050/.test(item.name || "")).length;
}

function adoptLegacyShopDefaults() {
  const oldTrade = State.business?.tradeName === "Wholesale & Retail Electronics Hub";
  if (!oldTrade) return false;
  State.business.tradeName = DEFAULT_BUSINESS.tradeName || State.business.name || "";
  if (!State.business.terms) State.business.terms = DEFAULT_BUSINESS.terms;
  saveToStorage();
  return true;
}

function safeImageUrl(value) {
  const text = String(value || "").trim();
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(text)) return text;
  return "";
}


/** Compact list-table helpers. Desktop uses Print + closed ⋯ menu (opens on click). */
function rowMenuOpenAttr() {
  return "";
}
function syncRowMenusForViewport() {
  /* Menus stay user-controlled; no force-open (that caused sticky/overlay layouts). */
}
function formatShortDate(iso) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return escHtml(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mon = months[Number(m[2]) - 1] || m[2];
  return `${Number(m[3])} ${mon} ${m[1]}`;
}
function docTypeChip(docType) {
  if (docType === "BILL_OF_SUPPLY") return '<span class="type-chip supply">Supply</span>';
  if (docType === "ESTIMATE") return '<span class="type-chip quote">Quote</span>';
  if (docType === "PROFORMA") return '<span class="type-chip proforma">Proforma</span>';
  if (docType === "DELIVERY_CHALLAN") return '<span class="type-chip challan">Challan</span>';
  if (docType === "CREDIT_NOTE") return '<span class="type-chip credit">Credit</span>';
  return '<span class="type-chip">Tax Inv</span>';
}

function escHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

function findStockItem(line) {
  if (!line) return null;
  return State.items.find(i => i.id === line.itemId)
    || State.items.find(i => i.name.toLowerCase() === String(line.description || "").toLowerCase());
}

function serialLinesValid(lines, isReturn) {
  for (const line of lines) {
    const stockItem = findStockItem(line);
    if (!stockItem?.trackSerial) continue;
    const serials = line.serials || [];
    if (!serials.length) {
      showToast(`${stockItem.name} is tracked by serial. Scan each unit before saving.`, "error");
      return false;
    }
    if (serials.length !== Number(line.qty)) {
      showToast(`${stockItem.name} has ${serials.length} serial(s) for quantity ${line.qty}.`, "error");
      return false;
    }
    if (!isReturn) {
      const missing = serials.find(code => !(stockItem.serials || []).includes(code));
      if (missing) {
        showToast(`Serial ${missing} is not in stock for ${stockItem.name}.`, "error");
        return false;
      }
    }
  }
  return true;
}

function adjustStockLine(line, direction) {
  const stockItem = findStockItem(line);
  if (!stockItem) return;
  if (stockItem.trackSerial) {
    const serials = line.serials || [];
    if (direction === "out") {
      serials.forEach(code => {
        const at = stockItem.serials.indexOf(code);
        if (at >= 0) stockItem.serials.splice(at, 1);
      });
    } else {
      serials.forEach(code => {
        if (code && !stockItem.serials.includes(code)) stockItem.serials.push(code);
      });
    }
    stockItem.stock = stockItem.serials.length;
    return;
  }
  if (direction === "out") stockItem.stock = Math.max(0, stockItem.stock - (Number(line.qty) || 0));
  else stockItem.stock += Number(line.qty) || 0;
}

// Storage Management
function loadFromStorage() {
  const saved = localStorage.getItem("billsetu_data_v1");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.business) {
        State.business = parsed.business;
        State.business.logo = safeImageUrl(State.business.logo);
        State.business.signatureImage = safeImageUrl(State.business.signatureImage);
      }
      if (parsed.parties) State.parties = parsed.parties;
      if (parsed.items) State.items = parsed.items;
      if (parsed.invoices) State.invoices = parsed.invoices;
      if (parsed.purchases) State.purchases = parsed.purchases;
      if (parsed.expenses) State.expenses = parsed.expenses;
      State.purchaseOrders = Array.isArray(parsed.purchaseOrders) ? parsed.purchaseOrders : [];
      State.debitNotes = Array.isArray(parsed.debitNotes) ? parsed.debitNotes : [];
      State.payments = Array.isArray(parsed.payments) ? parsed.payments : [];
      if (typeof restoreExtraBooks === "function") restoreExtraBooks(parsed);
      ensureBooks();
      adoptLegacyShopDefaults();
      return true;
    } catch (e) {
      console.error("Failed to parse saved state", e);
    }
  }
  return false;
}

function saveToStorage() {
  const data = {
    business: State.business,
    parties: State.parties,
    items: State.items,
    invoices: State.invoices,
    purchases: State.purchases,
    expenses: State.expenses,
    purchaseOrders: State.purchaseOrders,
    debitNotes: State.debitNotes,
    payments: State.payments,
    ...(typeof extraBooksPayload === "function" ? extraBooksPayload() : {})
  };
  localStorage.setItem("billsetu_data_v1", JSON.stringify(data));
}

// Utility: Format currency in Indian numbering (e.g. ₹1,23,456.78)
function formatINR(val) {
  if (val === null || val === undefined || isNaN(val)) return "₹0.00";
  const num = Number(val);
  const isNegative = num < 0;
  const absNum = Math.abs(num);
  
  const parts = absNum.toFixed(2).split(".");
  let intPart = parts[0];
  const decPart = parts[1];

  let lastThree = intPart.substring(intPart.length - 3);
  const otherNumbers = intPart.substring(0, intPart.length - 3);
  if (otherNumbers !== '') {
    lastThree = ',' + lastThree;
  }
  const formattedInt = otherNumbers.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  return (isNegative ? "-₹" : "₹") + formattedInt + "." + decPart;
}

// Utility: Convert Number to Indian English Words (Crore, Lakh, Thousand)
function convertNumberToWords(amount) {
  const words = [
    '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
    'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'
  ];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function numToWords(n) {
    n = Math.floor(Number(n) || 0);
    if (n === 0) return "";
    if (n < 20) return words[n];
    if (n < 100) return words[n % 10] ? `${tens[Math.floor(n / 10)]}-${words[n % 10]}` : tens[Math.floor(n / 10)];
    if (n < 1000) return [words[Math.floor(n / 100)] + " Hundred", numToWords(n % 100)].filter(Boolean).join(" ");
    if (n < 100000) return [numToWords(Math.floor(n / 1000)) + " Thousand", numToWords(n % 1000)].filter(Boolean).join(" ");
    if (n < 10000000) return [numToWords(Math.floor(n / 100000)) + " Lakh", numToWords(n % 100000)].filter(Boolean).join(" ");
    return [numToWords(Math.floor(n / 10000000)) + " Crore", numToWords(n % 10000000)].filter(Boolean).join(" ");
  }

  const value = Math.abs(Number(amount) || 0);
  const rupees = Math.floor(value + 1e-8);
  let paise = Math.round((value - rupees) * 100);
  let rupeeWords = rupees;
  if (paise === 100) {
    rupeeWords += 1;
    paise = 0;
  }
  if (!rupeeWords && !paise) return "Rupees Zero Only";
  let result = "Rupees " + (rupeeWords ? numToWords(rupeeWords) : "Zero");
  if (paise) result += " and " + numToWords(paise) + " Paise";
  return result + " Only";
}

// Generate Simple High-Contrast SVG QR Pattern for UPI
/**
 * Single source of truth for the business UPI VPA used on every print template,
 * for BOTH the QR payload and the printed "UPI ID" text (they can never differ).
 * Settings → UPI ID is authoritative; the show-on-invoice bank account's VPA is a mirror
 * derived from it by deriveUpiVpaCopies (load, Settings save, bank modal, sync pull) and never read back.
 */
function currentUpiVpa(business, account) { // eslint-disable-line no-unused-vars
  // Settings → UPI ID is the ONLY source. The bank-account copy (account.upiId) is never read
  // for printing: it is kept equal to Settings on save, on bank-modal save, and by the load migration.
  const b = business || State.business || {};
  return String(b.upiId || "").trim();
}

/**
 * Derive the bank-account VPA copies from Settings → UPI ID (the only source, including empty).
 * The show-on-invoice account's copy (bankAccounts row + its ledger) always equals Settings;
 * copies are never read back into Settings. Records are stamped only when they actually change,
 * so sync carries real edits and never ping-pongs.
 */
function deriveUpiVpaCopies() {
  const vpa = currentUpiVpa();
  const invAcc = typeof invoiceBankAccount === "function" ? invoiceBankAccount() : null;
  if (!invAcc || invAcc.isCash) return false;
  let changed = false;
  const stampRec = rec => {
    if (window.BillSetuSync && typeof window.BillSetuSync.markUpdated === "function") window.BillSetuSync.markUpdated(rec);
    else rec.updatedAt = Date.now();
  };
  const rec = (State.bankAccounts || []).find(a => a.id === invAcc.id);
  if (rec && String(rec.upiId || "").trim() !== vpa) { rec.upiId = vpa; stampRec(rec); changed = true; }
  const led = (State.accounts?.ledgers || []).find(l => l.id === invAcc.id);
  if (led && String(led.upiId || "").trim() !== vpa) { led.upiId = vpa; stampRec(led); changed = true; }
  return changed;
}

/** Settings save: Settings is the source; just re-derive the copies (old signature kept for callers). */
function syncUpiVpaToAccounts(oldVpa, newVpa) { // eslint-disable-line no-unused-vars
  return deriveUpiVpaCopies();
}

/**
 * Load-time VPA migration (BUG-V21.2-03). Settings → UPI ID wins, even when empty:
 * a stale bank copy is never copied into Settings. If an empty Settings VPA clears a bank copy,
 * that old value is kept on the account as upiIdOwn (never printed) and a one-time notice says so.
 */
function migrateUpiVpaOnce() {
  if (!State.business) return false;
  const settingsVpa = currentUpiVpa();
  const invAcc = typeof invoiceBankAccount === "function" ? invoiceBankAccount() : null;
  let notice = "";
  if (!State.business.upiVpaSource2 && !settingsVpa && invAcc && !invAcc.isCash) {
    const rec = (State.bankAccounts || []).find(a => a.id === invAcc.id);
    const led = (State.accounts?.ledgers || []).find(l => l.id === invAcc.id);
    const stale = String((rec && rec.upiId) || (led && led.upiId) || "").trim();
    if (stale && rec && !rec.upiIdOwn) { rec.upiIdOwn = stale; notice = stale; }
  }
  const changed = deriveUpiVpaCopies();
  if (!State.business.upiVpaSource2) {
    State.business.upiVpaSource2 = true; // flag only; not a profile edit, so updatedAt is untouched
    if (notice) {
      State.business.upiVpaNotice = notice;
      setTimeout(() => {
        if (typeof saveToStorage === "function") saveToStorage();
        if (typeof showToast === "function") {
          showToast(`Invoices print no UPI QR because Settings → UPI ID is empty. Your bank account had ${notice}; add it in Settings if you want a QR.`, "warn", { ttlMs: 9000 });
        }
      }, 1200);
    }
  }
  return changed;
}

/**
 * Payment sentence for WhatsApp texts (BUG-V21.2-06). One builder for bill share, overdue and
 * party reminders: the UPI part uses Settings → UPI ID; the bank part uses the show-on-invoice
 * account. Empty parts are left out, so no "**" or "()" placeholders ever appear.
 */
function paymentInstructionText(opts) {
  const o = opts || {};
  const vpa = currentUpiVpa();
  let bank = "";
  if (o.bank) {
    const d = typeof invoiceBankDetails === "function" ? invoiceBankDetails() : {
      bankAcc: State.business?.bankAcc || "", bankIfsc: State.business?.bankIfsc || "", bankName: State.business?.bankName || ""
    };
    const acc = String(d.bankAcc || "").trim();
    const ifsc = String(d.bankIfsc || "").trim();
    const name = String(d.bankName || "").trim();
    if (acc) bank = `Bank A/C ${acc}${name ? ` (${name}${ifsc ? `, IFSC ${ifsc}` : ""})` : (ifsc ? ` (IFSC ${ifsc})` : "")}`;
  }
  const lead = o.lead || "You can pay";
  if (vpa && bank) return `${lead} via UPI: *${vpa}* or to ${bank}.`;
  if (vpa) return `${lead} via UPI: *${vpa}*.`;
  if (bank) return `${lead} to ${bank}.`;
  return "";
}
window.paymentInstructionText = paymentInstructionText;

/** 1.13.11 (BR2/BR4): business name, or "" — callers drop the piece when it is empty. */
function bizName() {
  const b = State.business || {};
  return String(b.name || b.tradeName || "").trim();
}
window.bizName = bizName;

function generateUPIQR(upiId, payeeName, amount, invoiceNo) {
  if (!String(upiId || "").trim()) return "";
  const upiString = `upi://pay?pa=${encodeURIComponent(upiId || "")}&pn=${encodeURIComponent(payeeName || "")}&am=${Number(amount || 0).toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoiceNo || "")}`;
  if (typeof qrSvg === "function") return qrSvg(upiString, 96);
  // Generate authentic crisp vector QR code grid visually
  return `
    <div style="display:flex;flex-direction:column;align-items:center;padding:4px;background:#fff;border-radius:4px;">
      <svg width="78" height="78" viewBox="0 0 100 100" style="shape-rendering:crispEdges;">
        <rect width="100" height="100" fill="#fff" />
        <!-- Corner Finder Patterns -->
        <rect x="5" y="5" width="28" height="28" fill="#000" />
        <rect x="9" y="9" width="20" height="20" fill="#fff" />
        <rect x="13" y="13" width="12" height="12" fill="#000" />

        <rect x="67" y="5" width="28" height="28" fill="#000" />
        <rect x="71" y="9" width="20" height="20" fill="#fff" />
        <rect x="75" y="13" width="12" height="12" fill="#000" />

        <rect x="5" y="67" width="28" height="28" fill="#000" />
        <rect x="9" y="71" width="20" height="20" fill="#fff" />
        <rect x="13" y="75" width="12" height="12" fill="#000" />

        <!-- Sync Dots & Data Cells -->
        <rect x="38" y="10" width="6" height="6" fill="#000" />
        <rect x="48" y="10" width="6" height="6" fill="#000" />
        <rect x="56" y="10" width="6" height="6" fill="#000" />
        <rect x="38" y="24" width="6" height="6" fill="#000" />
        <rect x="48" y="24" width="6" height="6" fill="#000" />
        <rect x="56" y="24" width="6" height="6" fill="#000" />

        <rect x="10" y="38" width="6" height="6" fill="#000" />
        <rect x="24" y="38" width="6" height="6" fill="#000" />
        <rect x="38" y="38" width="8" height="8" fill="#2563EB" />
        <rect x="50" y="38" width="6" height="6" fill="#000" />
        <rect x="64" y="38" width="6" height="6" fill="#000" />
        <rect x="78" y="38" width="6" height="6" fill="#000" />

        <rect x="10" y="48" width="6" height="6" fill="#000" />
        <rect x="24" y="48" width="6" height="6" fill="#000" />
        <rect x="38" y="50" width="6" height="6" fill="#000" />
        <rect x="50" y="50" width="8" height="8" fill="#10B981" />
        <rect x="64" y="50" width="6" height="6" fill="#000" />
        <rect x="78" y="50" width="6" height="6" fill="#000" />

        <rect x="38" y="68" width="6" height="6" fill="#000" />
        <rect x="48" y="68" width="6" height="6" fill="#000" />
        <rect x="56" y="68" width="6" height="6" fill="#000" />
        <rect x="38" y="80" width="6" height="6" fill="#000" />
        <rect x="48" y="80" width="6" height="6" fill="#000" />
        <rect x="56" y="80" width="6" height="6" fill="#000" />
      </svg>
      <span style="font-size:7px;font-weight:700;color:#0f172a;margin-top:2px;letter-spacing:0.02em;">SCAN WITH ANY UPI APP</span>
    </div>
  `;
}

// Toast Notifications

/** Visible notice when sync renumbers a conflicting bill (e.g. offline dup). */
function showDocConflictBanner(notices) {
  if (!notices || !notices.length) return;
  const hostId = "doc-conflict-banner";
  let host = document.getElementById(hostId);
  if (!host) {
    host = document.createElement("div");
    host.id = hostId;
    host.className = "doc-conflict-banner";
    host.setAttribute("role", "status");
    const mount = document.getElementById("app-main") || document.getElementById("main-content") || document.body;
    mount.insertBefore(host, mount.firstChild);
  }
  const lines = notices.map(n => n.message || `${n.from} → ${n.to}`);
  host.innerHTML = `<div class="doc-conflict-inner">
    <strong>Number conflict fixed</strong>
    <ul>${lines.map(l => `<li>${typeof escHtml === "function" ? escHtml(l) : l}</li>`).join("")}</ul>
    <button type="button" class="btn btn-sm btn-ghost" id="doc-conflict-dismiss">Dismiss</button>
  </div>`;
  host.classList.add("show");
  host.querySelector("#doc-conflict-dismiss")?.addEventListener("click", () => {
    host.classList.remove("show");
    host.innerHTML = "";
  });
}

function showToast(message, type = "success", opts) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const options = (opts && typeof opts === "object") ? opts : {};
  const ttl = Number(options.ttlMs);
  const duration = Number.isFinite(ttl) && ttl >= 0 ? ttl : 3500;
  // Newer toasts replace older ones so a sticky welcome cannot hide money/back copy.
  container.querySelectorAll(".toast").forEach(el => el.remove());
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2.5" fill="none">
      ${type === "success" 
        ? '<polyline points="20 6 9 17 4 12"/>' 
        : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
    </svg>
    <span></span>
  `;
  toast.querySelector("span").textContent = String(message ?? "");
  container.appendChild(toast);
  if (duration === 0) return toast;
  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateX(100%)";
    toast.style.transition = "all 0.2s ease";
    setTimeout(() => toast.remove(), 200);
  }, duration);
  return toast;
}

// View Switching
function switchView(viewName) {
  if (typeof roleAllowsView === "function" && !roleAllowsView(viewName)) {
    showToast("Your role cannot open that screen.", "error");
    return;
  }
  State.currentView = viewName;
  if (viewName !== "parties") document.body.classList.remove("party-detail-open");
  if (typeof closeInvoiceDetail === "function" && typeof isInvoiceDetailOpen === "function" && isInvoiceDetailOpen()) closeInvoiceDetail();
  document.querySelectorAll(".nav-item").forEach(item => {
    item.classList.toggle("active", item.getAttribute("data-view") === viewName);
  });
  document.querySelectorAll(".view-panel").forEach(panel => {
    panel.classList.toggle("active", panel.id === `view-view-${viewName}` || panel.id === `view-${viewName}`);
  });

  // Render active view
  if (viewName === "dashboard") renderDashboard();
  else if (viewName === "sales") renderSalesTable();
  else if (viewName === "pos") renderPos();
  else if (viewName === "purchases") renderPurchasesTable();
  else if (viewName === "parties") renderParties();
  else if (viewName === "inventory") renderInventoryTable();
  else if (viewName === "expenses") renderExpensesTable();
  else if (viewName === "reports") renderReports();
  else if (viewName === "settings") {
    populateSettingsForm();
    if (typeof renderCustomFieldSettings === "function") renderCustomFieldSettings();
  } else if (viewName === "recurring" && typeof renderRecurring === "function") renderRecurring();
  else if (viewName === "godowns" && typeof renderGodowns === "function") renderGodowns();
  else if (viewName === "staff" && typeof renderStaff === "function") renderStaff();
  else if (viewName === "cashbank" && typeof renderCashBank === "function") renderCashBank();
  else if (viewName === "accounts" && typeof renderAccounts === "function") renderAccounts();
  document.getElementById("sidebar")?.classList.remove("open");
  document.getElementById("sidebar-backdrop")?.classList.remove("show");
  if (typeof syncBottomNav === "function") syncBottomNav(viewName);
  if (typeof stampTableLabels === "function") stampTableLabels();
  if (typeof BillSetuHistory !== "undefined" && BillSetuHistory.push && !window.__billsetuHistApplying) {
    BillSetuHistory.push({ type: "view", view: viewName });
  }
}

// ----------------------------------------------------
// 1. Dashboard View Logic
// ----------------------------------------------------
function renderDashboard() {
  // Update Business Name & State
  document.getElementById("sidebar-business-name").textContent = State.business.name;
  const roleName = { ADMIN: "Admin", SALESMAN: "Salesman", STOCK: "Stock Manager", CA: "CA / Accountant" }[State.currentActor?.role] || "Admin";
  document.getElementById("sidebar-gstin").textContent = `${roleName} · ${State.business.gstin}`;
  document.getElementById("banner-biz-name").textContent = State.business.name;
  const chipState = document.getElementById("chip-state");
  if (chipState) {
    const sc = String(State.business.stateCode || "").trim();
    const sn = String(State.business.stateName || "").trim();
    chipState.textContent = sc ? `${sc} - ${sn || sc}` : "Select state";
  }
  document.getElementById("chip-gstin").textContent = State.business.gstin;

  // Total Sales & Invoices Count
  const postedSales = State.invoices.filter(isPostedSale);
  const totalSales = postedSales.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
  const today = todayISO();
  const todaySales = postedSales.filter(inv => inv.date === today);
  const todayTotal = todaySales.reduce((sum, inv) => sum + (inv.grandTotal || 0), 0);
  document.getElementById("kpi-total-sales").textContent = formatINR(todayTotal);
  document.getElementById("kpi-invoices-count").textContent = todaySales.length
    ? `${todaySales.length} today · ${formatINR(totalSales)} across ${postedSales.length} bills`
    : `No bills yet today · ${formatINR(totalSales)} across ${postedSales.length} bills`;

  // Receivables (Udhar from Customers)
  const toReceive = State.parties
    .filter(p => p.type === "CUSTOMER" && p.balType === "RECEIVABLE")
    .reduce((sum, p) => sum + (p.balance || 0), 0);
  document.getElementById("kpi-to-receive").textContent = formatINR(toReceive);

  // Payables (To Suppliers)
  const toPay = State.parties
    .filter(p => p.type === "SUPPLIER" && p.balType === "PAYABLE")
    .reduce((sum, p) => sum + (p.balance || 0), 0);
  document.getElementById("kpi-to-pay").textContent = formatINR(toPay);

  // Inventory Value
  const stockVal = State.items.reduce((sum, item) => sum + (item.stock * item.costPrice), 0);
  const lowStockCount = State.items.filter(item => !isServiceCategory(item.category) && Number(item.minStock) >= 0 && Number(item.stock) <= Number(item.minStock)).length;
  const stockValue = document.getElementById("kpi-stock-value");
  stockValue.textContent = formatINR(stockVal);
  stockValue.classList.remove("text-amber");
  document.getElementById("kpi-low-stock-alert").textContent = lowStockCount
    ? `${lowStockCount} low on stock`
    : "All items above minimum";
  const lowBadge = document.getElementById("badge-low-stock");
  lowBadge.textContent = lowStockCount;
  lowBadge.classList.toggle("alert", lowStockCount > 0);
  lowBadge.classList.toggle("is-zero", !(lowStockCount > 0));
  document.getElementById("badge-sales-count").textContent = postedSales.length;
  renderOverdueFollowups();

  // Recent activity — all transaction types (sales, receipts, payments, purchases, expenses, …)
  if (typeof renderDashRecentActivity === "function") renderDashRecentActivity();
  else {
    const recentTable = document.getElementById("dash-recent-invoices");
    if (recentTable) {
      const recentInvoices = [...State.invoices].slice(-5).reverse();
      recentTable.innerHTML = recentInvoices.length ? recentInvoices.map(inv => `
        <tr class="inv-row" data-invoice-id="${escHtml(inv.id)}" onclick="openInvoiceDetailFromRow(event)">
          <td class="m-title"><strong class="m-party">${escHtml(inv.partyName)}</strong></td>
          <td><strong>${escHtml(inv.invoiceNo)}</strong></td>
          <td class="num">${formatShortDate(inv.date)}</td>
          <td class="m-amt num"><strong>${formatINR(inv.grandTotal)}</strong></td>
          <td class="m-status"><span class="badge">Sale</span></td>
          <td class="m-actions"></td>
        </tr>`).join("") : `<tr><td colspan="6" class="empty-state-message">No bills yet.</td></tr>`;
    }
  }

  // Top Pending Debtors
  const debtorList = document.getElementById("dash-top-debtors");
  const debtors = State.parties
    .filter(p => p.balance > 0 && p.balType === "RECEIVABLE")
    .slice(0, 4);

  if (debtors.length === 0) {
    debtorList.innerHTML = `<p class="empty-state-message">Nothing to collect right now.</p>`;
  } else {
    debtorList.innerHTML = debtors.map(p => `
      <div class="party-item-card" style="margin-bottom:8px;" onclick="selectParty('${p.id}'); switchView('parties');">
        <div>
          <div class="party-name-h">${escHtml(p.name)}</div>
          <div class="party-phone-s">${p.phone}</div>
        </div>
        <div class="party-bal-badge">
          <div class="party-bal-amount receive">${formatINR(p.balance)}</div>
          <span class="text-xs text-muted">To Receive</span>
        </div>
      </div>
    `).join("");
  }
}


// ----------------------------------------------------
// 2. Sales & Invoices Logic
// ----------------------------------------------------
function renderSalesTable() {
  const tbody = document.getElementById("sales-table-body");
  const searchTerm = (document.getElementById("sales-search-input").value || "").toLowerCase();
  const filterType = document.getElementById("sales-filter-type").value;
  const filterStatus = document.getElementById("sales-filter-status").value;

  const filtered = State.invoices.filter(inv => {
    const matchesSearch = inv.invoiceNo.toLowerCase().includes(searchTerm) ||
      inv.partyName.toLowerCase().includes(searchTerm) ||
      (inv.partyPhone && inv.partyPhone.includes(searchTerm));
    const matchesType = filterType === "ALL" || inv.docType === filterType;
    let matchesStatus = true;
    if (filterStatus === "PAID") matchesStatus = inv.balanceDue <= 0;
    else if (filterStatus === "UNPAID") matchesStatus = inv.balanceDue >= inv.grandTotal;
    else if (filterStatus === "PARTIAL") matchesStatus = inv.balanceDue > 0 && inv.balanceDue < inv.grandTotal;
    return matchesSearch && matchesType && matchesStatus;
  });

  const grandSum = filtered.reduce((acc, i) => acc + (i.grandTotal || 0), 0);
  document.getElementById("sales-filtered-total").textContent = formatINR(grandSum);

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted" style="padding:24px;">No invoices match your filter criteria.</td></tr>`;
    return;
  }

  tbody.innerHTML = sortDocsDefault(filtered, "sales", ["invoiceNo"]).map(inv => {
    const stInfo = typeof invoiceStatusInfo === "function" ? invoiceStatusInfo(inv) : null;
    let statusClass = stInfo ? stInfo.className : "badge-paid";
    let statusLabel = stInfo ? stInfo.label : "Paid";
    if (!stInfo) {
      if (inv.balanceDue >= inv.grandTotal) {
        statusClass = "badge-unpaid";
        statusLabel = "Unpaid";
      } else if (inv.balanceDue > 0) {
        statusClass = "badge-partial";
        statusLabel = "Partial";
      }
    }

    const gstTotal = Number(inv.igstTotal || 0) + Number(inv.cgstTotal || 0) + Number(inv.sgstTotal || 0);
    const gstTip = inv.isInterstate
      ? `IGST ${formatINR(inv.igstTotal)}`
      : `CGST ${formatINR(inv.cgstTotal)} · SGST ${formatINR(inv.sgstTotal)}`;
    const gstSub = inv.isInterstate
      ? `IGST`
      : `C ${Math.round(Number(inv.cgstTotal || 0))} · S ${Math.round(Number(inv.sgstTotal || 0))}`;
    const stateTip = inv.posStateCode ? `State code ${escHtml(inv.posStateCode)}` : "";

    const convertBtn = (inv.docType === 'ESTIMATE' || inv.docType === 'PROFORMA')
      ? `<button type="button" class="btn btn-primary btn-sm act-convert-gst" onclick="event.stopPropagation(); convertEstimateToTaxInvoice('${inv.id}')" title="Convert to Tax Invoice">Convert to GST Bill</button>`
      : '';
    const repeatBtn = (typeof canWrite !== "function" || canWrite("sales"))
      ? `<button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); startRecurringFromInvoice('${inv.id}')">Repeat</button>`
      : "";

    return `
      <tr class="inv-row" data-invoice-id="${escHtml(inv.id)}" onclick="openInvoiceDetailFromRow(event)">
        <td title="${stateTip}"><strong>${escHtml(inv.invoiceNo)}</strong>${docTypeChip(inv.docType)}</td>
        <td class="num">${formatShortDate(inv.date)}</td>
        <td class="m-title"><strong class="m-party">${escHtml(inv.partyName)}</strong><div class="phone-sub">${escHtml(inv.invoiceNo)} · ${formatShortDate(inv.date)}</div></td>
        <td class="num col-taxable">${formatINR(inv.taxableTotal)}</td>
        <td class="num col-gst" title="${gstTip}"><strong>${formatINR(gstTotal)}</strong><span class="gst-sub">${gstSub}</span></td>
        <td class="m-amt num"><strong>${formatINR(inv.grandTotal)}</strong><div class="phone-sub">${inv.balanceDue > 0 ? formatINR(inv.balanceDue) + " due" : "Settled"}</div></td>
        <td class="num ${inv.balanceDue > 0 ? 'text-amber' : ''}"><strong>${formatINR(inv.balanceDue)}</strong></td>
        <td class="m-status"><span class="badge ${statusClass}">${statusLabel}</span></td>
        <td class="m-actions" onclick="event.stopPropagation()"><span class="m-mode">${statusLabel}</span><div class="row-actions">
          <button type="button" class="act-btn act-btn-print" onclick="event.stopPropagation(); openPrintModal('${inv.id}')" title="Print" aria-label="Print"><svg class="act-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg></button>
          ${convertBtn}
          <details class="row-menu" onclick="event.stopPropagation()"><summary aria-label="More actions">⋯</summary><div class="row-menu-pop">
            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); editInvoice('${inv.id}')">Edit</button>
            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); shareWhatsAppInvoice('${inv.id}')" title="Share via WhatsApp">Share</button>
            ${repeatBtn}
            <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openInvoiceDetail('${inv.id}')">View</button>
          </div></details>
        </div></td>
      </tr>
    `;
  }).join("");
}

/** 1.13.16 (BUG-6): re-price a quotation/proforma as a tax invoice with the same engine as the invoice
 *  form (invoiceMoney → BillSetuMoney.computeDocument): every line's split, the totals and the round-off
 *  come from the CURRENT business state and the document's place of supply. The stored split is never
 *  reused. Amount in words is derived from grandTotal when the bill is shown/printed. Returns the fields
 *  to assign and a short note when the split changed. Caller must have checked requireBusinessState(). */
function repriceSaleForConversion(doc, party) {
  const posCode = normStateCode(doc.posStateCode) || defaultPlaceOfSupply(party) || "";
  const isInterstate = isInterstateFor(posCode);
  if (isInterstate === null) throw new Error(businessStateMissingMessage("a bill"));
  const draft = (doc.items || []).map(line => ({ ...line }));
  const mode = doc.discountMode === "afterTax" ? "afterTax" : "beforeTax";
  const billDiscount = Number(doc.billDiscount) || 0;
  const loyaltyRupees = Number(doc.loyaltyDiscount) || 0;
  const gross = invoiceMoney(draft, isInterstate, billDiscount, 0, false, mode);
  const priced = loyaltyRupees ? invoiceMoney(draft, isInterstate, billDiscount, loyaltyRupees, false, mode) : gross;
  const items = priced.items.map((line, i) => ({ ...(doc.items[i] || {}), ...line }));
  const wasInter = doc.isInterstate === true || ((Number(doc.igstTotal) || 0) > 0 && !(Number(doc.cgstTotal) || 0));
  const hadTax = (Number(doc.cgstTotal) || 0) + (Number(doc.sgstTotal) || 0) + (Number(doc.igstTotal) || 0) > 0;
  const nowTax = priced.cgstTotal + priced.sgstTotal + priced.igstTotal;
  let note = "";
  if (hadTax && wasInter !== !!isInterstate) {
    note = isInterstate
      ? `GST recalculated: IGST ${formatINR(priced.igstTotal)} instead of CGST+SGST.`
      : `GST recalculated: CGST ${formatINR(priced.cgstTotal)} + SGST ${formatINR(priced.sgstTotal)} instead of IGST.`;
  } else if (Math.abs((Number(doc.grandTotal) || 0) - priced.grandTotal) > 0.009) {
    note = `GST recalculated: total ${formatINR(priced.grandTotal)}.`;
  }
  const G = gstStatesApi();
  return {
    fields: {
      posStateCode: posCode,
      posStateName: (G && G.stateName(posCode)) || doc.posStateName || "",
      isInterstate: !!isInterstate,
      items,
      taxableTotal: priced.taxableTotal,
      cgstTotal: priced.cgstTotal,
      sgstTotal: priced.sgstTotal,
      igstTotal: priced.igstTotal,
      roundOff: priced.roundOff,
      grandTotal: priced.grandTotal,
      grossTotal: gross.grandTotal,
      billDiscount: priced.billDiscount,
      discountMode: mode
    },
    note,
    taxChanged: hadTax && Math.abs(nowTax - ((Number(doc.cgstTotal) || 0) + (Number(doc.sgstTotal) || 0) + (Number(doc.igstTotal) || 0))) > 0.009
  };
}
window.repriceSaleForConversion = repriceSaleForConversion;

// 1-Click Convert Estimate to Tax Invoice (MyBillBook Signature Feature)
function convertEstimateToTaxInvoice(estimateId) {
  if (typeof blockedAction === "function" && blockedAction("sales")) return;
  if (!requireBusinessState("a bill")) return;
  const est = State.invoices.find(i => i.id === estimateId);
  if (!est) return;

  if (!serialLinesValid(est.items, false)) return;

  // 1.13.16 (BUG-6): re-price for the current business state and place of supply before anything changes.
  const party0 = State.parties.find(p => p.id === est.partyId);
  const repriced = repriceSaleForConversion(est, party0);

  const wasProforma = est.docType === "PROFORMA";
  Object.assign(est, repriced.fields);
  est.docType = "TAX_INVOICE";
  est.invoiceNo = (typeof BillSetuDocNumbering !== "undefined")
    ? BillSetuDocNumbering.previewNextNumber("TAX_INVOICE", est.date)
    : (typeof nextDocNo === "function" ? nextDocNo("INV") : ("INV-" + String(Date.now()).slice(-4)));
  if (typeof BillSetuDocNumbering !== "undefined") {
    BillSetuDocNumbering.commitDocNumber("TAX_INVOICE", est.invoiceNo, est.date);
  }
  est.date = todayISO();
  // 1.13.19: carry money already collected on the quote/proforma, or already linked as a receipt.
  // Do not zero it, and do not post it twice. Party is debited only the remaining due.
  const applied = Math.min(saleAmountApplied(est), Number(est.grandTotal) || 0);
  est.collectedOnBill = invoiceCollectedOnBill(est);
  // If collectedOnBill was never stored, keep the on-bill share after subtracting linked receipts.
  if (est.collectedOnBill == null) est.collectedOnBill = Math.max(0, applied - receiptsAppliedToBill(est.id, "invoiceId"));
  // Cap on-bill so on-bill + receipts === applied (no double count).
  const linkedReceipts = receiptsAppliedToBill(est.id, "invoiceId");
  if (est.collectedOnBill + linkedReceipts - applied > 0.009) {
    est.collectedOnBill = Math.max(0, Math.round((applied - linkedReceipts) * 100) / 100);
  }
  est.amountReceived = applied;
  est.paidAmount = applied;
  est.balanceDue = Math.max(0, Math.round(((Number(est.grandTotal) || 0) - applied) * 100) / 100);
  est.status = est.balanceDue <= 0.009 ? "PAID" : (applied > 0.009 ? "PARTIAL" : "UNPAID");
  (State.payments || []).forEach(pay => {
    if (!pay || pay.deletedAt || !Array.isArray(pay.settlements)) return;
    let touched = false;
    pay.settlements.forEach(s => {
      if (s && s.invoiceId === est.id) {
        s.invoiceNo = est.invoiceNo;
        touched = true;
      }
    });
    if (touched && typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(pay);
  });

  // Deduct inventory
  est.items.forEach(line => adjustStockLine(line, "out"));

  // Update customer ledger — remaining due only
  const party = State.parties.find(p => p.id === est.partyId);
  if (party && est.balanceDue > 0) {
    partyAddReceivable(party, est.balanceDue);
  }

  if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(est);
  saveToStorage();
  const collectedNote = applied > 0.009
    ? ` ${formatINR(applied)} already received is carried onto the bill${est.balanceDue > 0.009 ? `; ${formatINR(est.balanceDue)} remains due` : " (fully settled)"}.`
    : "";
  showToast(`${wasProforma ? "Proforma" : "Quotation"} converted to GST Tax Invoice #${est.invoiceNo}!${repriced.note ? " " + repriced.note : ""}${collectedNote}`);
  renderDashboard();
  renderSalesTable();
}

// ----------------------------------------------------
// 3. Invoice Modal & Calculation Engine
// ----------------------------------------------------
function setInvoiceModalOpen(open) {
  const modal = document.getElementById("modal-invoice");
  if (open) {
    modal?.classList.add("open");
    document.body.classList.add("invoice-modal-open");
  } else {
    modal?.classList.remove("open");
    document.body.classList.remove("invoice-modal-open");
  }
}

function clearInvoicePayExtras() {
  ["inv-upi-ref", "inv-card-ref", "inv-bank-ref", "inv-cheque-no", "inv-cheque-date", "inv-cheque-bank"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });
}

function syncInvoicePayModeFields() {
  const mode = document.querySelector('input[name="inv-pay-mode"]:checked')?.value || "UPI";
  document.querySelectorAll("#inv-pay-extras .inv-pay-extra").forEach(box => {
    const modes = (box.dataset.modes || "").split(/\s+/).filter(Boolean);
    box.classList.toggle("d-none", !modes.includes(mode));
  });
  return mode;
}

function syncFullyPaidToggle(payable) {
  const received = Number(document.getElementById("inv-amount-received")?.value) || 0;
  const toggle = document.getElementById("inv-fully-paid");
  if (!toggle) return;
  const total = Math.round((Number(payable) || 0) * 100) / 100;
  const got = Math.round(received * 100) / 100;
  // Empty draft (₹0): do not fight the user's checkbox click.
  if (total <= 0) return;
  toggle.checked = got + 0.001 >= total;
}

function applyFullyPaid(checked) {
  const amountEl = document.getElementById("inv-amount-received");
  if (!amountEl) return;
  if (checked) {
    const totalText = document.getElementById("calc-grand-total")?.textContent || "0";
    const payable = Number(String(totalText).replace(/[^0-9.-]/g, "")) || 0;
    // Prefer live recalculation path
    State.invoiceAmountReceivedTouched = true;
    const credit = document.querySelector('input[name="inv-pay-mode"][value="CREDIT"]');
    if (credit?.checked) {
      const cash = document.querySelector('input[name="inv-pay-mode"][value="CASH"]');
      if (cash) cash.checked = true;
      syncInvoicePayModeFields();
    }
    amountEl.value = String(payable);
  }
  State.invoiceAmountReceivedTouched = true;
  recalculateInvoice();
}

function readInvoicePaymentExtras() {
  const mode = document.querySelector('input[name="inv-pay-mode"]:checked')?.value || "CASH";
  return {
    paymentMode: mode,
    upiRef: document.getElementById("inv-upi-ref")?.value.trim() || "",
    cardRef: document.getElementById("inv-card-ref")?.value.trim() || "",
    bankRef: document.getElementById("inv-bank-ref")?.value.trim() || "",
    chequeNo: document.getElementById("inv-cheque-no")?.value.trim() || "",
    chequeDate: document.getElementById("inv-cheque-date")?.value || "",
    chequeBank: document.getElementById("inv-cheque-bank")?.value.trim() || ""
  };
}


/** Date desc → numeric-aware doc no desc → createdAt desc. Honours State.uiSort[listKey] if set. */
function compareDocsByDateDesc(a, b, noKeys) {
  const keys = noKeys || ["invoiceNo", "billNo", "receiptNo", "poNo", "noteNo", "id"];
  const da = String(a.date || "");
  const db = String(b.date || "");
  if (da !== db) return db.localeCompare(da);
  let na = "", nb = "";
  for (const k of keys) {
    if (a[k] != null && a[k] !== "") { na = String(a[k]); break; }
  }
  for (const k of keys) {
    if (b[k] != null && b[k] !== "") { nb = String(b[k]); break; }
  }
  const ncmp = nb.localeCompare(na, undefined, { numeric: true, sensitivity: "base" });
  if (ncmp) return ncmp;
  const ca = Number(a.createdAt) || (typeof a.createdAt === "string" ? Date.parse(a.createdAt) || 0 : 0);
  const cb = Number(b.createdAt) || (typeof b.createdAt === "string" ? Date.parse(b.createdAt) || 0 : 0);
  return cb - ca;
}

function sortDocsDefault(list, listKey, noKeys) {
  const arr = (list || []).slice();
  const pref = (State.uiSort && listKey && State.uiSort[listKey]) || null;
  if (pref && typeof pref === "object" && pref.fn === "docNo") {
    return arr.sort((a, b) => {
      const keys = noKeys || ["invoiceNo", "billNo", "receiptNo", "poNo", "noteNo", "id"];
      let na = "", nb = "";
      for (const k of keys) { if (a[k]) { na = String(a[k]); break; } }
      for (const k of keys) { if (b[k]) { nb = String(b[k]); break; } }
      const dir = pref.dir === "asc" ? 1 : -1;
      return dir * na.localeCompare(nb, undefined, { numeric: true, sensitivity: "base" });
    });
  }
  if (pref && typeof pref === "object" && pref.fn === "amount") {
    const dir = pref.dir === "asc" ? 1 : -1;
    return arr.sort((a, b) => dir * ((Number(a.grandTotal || a.totalBill || a.amount || 0)) - (Number(b.grandTotal || b.totalBill || b.amount || 0))));
  }
  return arr.sort((a, b) => compareDocsByDateDesc(a, b, noKeys));
}

function isInvoiceFormOpen() {
  return !!document.getElementById("modal-invoice")?.classList.contains("open");
}

function isInvoiceDraftDirty() {
  if (!isInvoiceFormOpen()) return false;
  if (State.editingInvoiceId) return true;
  const items = State.invoiceDraftItems || [];
  if (items.some(line =>
    String(line.description || "").trim() ||
    Number(line.rate) > 0 ||
    (Number(line.qty) || 0) > 1 ||
    (line.serials && line.serials.length)
  )) return true;
  if ((document.getElementById("inv-notes")?.value || "").trim()) return true;
  if (Number(document.getElementById("inv-amount-received")?.value) > 0) return true;
  if (Number(document.getElementById("inv-bill-discount")?.value) > 0) return true;
  return false;
}

let __discardDraftResolver = null;
function askDiscardDraft() {
  return new Promise(resolve => {
    const modal = document.getElementById("modal-discard-draft");
    if (!modal) {
      const ok = confirm("Discard draft?");
      resolve(!!ok);
      return;
    }
    __discardDraftResolver = resolve;
    modal.classList.add("open");
    if (typeof ensureOverlaysOnBody === "function") ensureOverlaysOnBody();
  });
}

function finishDiscardDraft(discard) {
  const modal = document.getElementById("modal-discard-draft");
  if (modal) modal.classList.remove("open");
  const r = __discardDraftResolver;
  __discardDraftResolver = null;
  if (r) r(!!discard);
}

async function confirmLeaveInvoiceForm() {
  if (!isInvoiceDraftDirty()) return true;
  return askDiscardDraft();
}

function moneyToAccountToast(accountId, amount, direction) {
  if (!(Number(amount) > 0) || !accountId) return;
  const acc = (typeof cashBankAccounts === "function" ? cashBankAccounts() : [])
    .find(a => a.id === accountId);
  const name = acc?.displayName || acc?.name || (accountId === "l-cash" ? "Cash in Hand" : "Account");
  const bal = typeof ledgerBalance === "function" ? ledgerBalance(accountId) : null;
  const amt = typeof formatINR === "function" ? formatINR(amount) : ("₹" + amount);
  const balTxt = bal != null && typeof formatINR === "function" ? formatINR(bal) : null;
  const verb = direction === "OUT" ? "paid from" : "added to";
  const msg = balTxt != null
    ? `${amt} ${verb} ${name} · Balance ${balTxt}`
    : `${amt} ${verb} ${name}`;
  if (typeof showToast === "function") showToast(msg);
}

async function openNewInvoiceModal() {
  if (typeof blockedAction === "function" && blockedAction("sales")) return;
  if (isInvoiceFormOpen() && isInvoiceDraftDirty()) {
    const discard = await askDiscardDraft();
    if (!discard) return;
  }
  State.editingInvoiceId = null;
  State.invoiceMirrorSplit = null;
  const modal = document.getElementById("modal-invoice");
  document.getElementById("invoice-modal-title").textContent = "Create Tax Invoice (Sales)";
  
  // Auto Generate Next Invoice Number
  document.getElementById("inv-doc-type").value = "TAX_INVOICE";
  syncInvoiceNumberPrefix();
  
  const today = todayISO();
  document.getElementById("inv-date").value = today;
  document.getElementById("inv-due-date").value = today;

  // Clear Transport & E-Way Fields
  if (document.getElementById("inv-eway-bill")) document.getElementById("inv-eway-bill").value = "";
  if (document.getElementById("inv-vehicle-no")) document.getElementById("inv-vehicle-no").value = "";
  if (document.getElementById("inv-transporter-name")) document.getElementById("inv-transporter-name").value = "";
  if (document.getElementById("inv-transporter-id")) document.getElementById("inv-transporter-id").value = "";
  if (document.getElementById("inv-irn")) document.getElementById("inv-irn").value = "";
  if (document.getElementById("inv-ack-no")) document.getElementById("inv-ack-no").value = "";
  if (document.getElementById("inv-ack-date")) document.getElementById("inv-ack-date").value = "";
  ["inv-delivery-note", "inv-payment-terms", "inv-reference-no", "inv-reference-date", "inv-other-ref", "inv-buyer-order", "inv-buyer-order-date", "inv-dispatch-doc", "inv-delivery-note-date", "inv-dispatched-through", "inv-destination", "inv-terms-delivery"].forEach(id => {
    const field = document.getElementById(id);
    if (field) field.value = "";
  });
  if (document.getElementById("inv-bill-discount")) document.getElementById("inv-bill-discount").value = "0";

  // Populate Customer Select
  const partySelect = document.getElementById("inv-party-select");
  partySelect.innerHTML = State.parties.map(p => `
    <option value="${escHtml(p.id)}">${escHtml(p.name)} (${p.type === 'CUSTOMER' ? 'Customer' : 'Supplier'})${partyStateLabel(p) ? ' - ' + escHtml(partyStateLabel(p)) : ''}</option>
  `).join("");

  State.invoiceDraftItems = [blankInvoiceLine()];
  State.invoiceAmountReceivedTouched = false;
  if (document.getElementById("inv-amount-received")) document.getElementById("inv-amount-received").value = "";
  if (document.getElementById("inv-notes")) document.getElementById("inv-notes").value = "";
  if (document.getElementById("invoice-item-search")) document.getElementById("invoice-item-search").value = "";
  const upiRadio = document.querySelector('input[name="inv-pay-mode"][value="UPI"]');
  if (upiRadio) upiRadio.checked = true;
  clearInvoicePayExtras();
  const fullyPaid = document.getElementById("inv-fully-paid");
  if (fullyPaid) fullyPaid.checked = false;
  syncInvoicePayModeFields();
  refreshCatalogDatalist();
  const loyaltyInput = document.getElementById("inv-loyalty-points");
  if (loyaltyInput) loyaltyInput.value = "0";
  if (typeof prepareInvoiceExtras === "function") prepareInvoiceExtras();

  renderInvoiceLineItems();
  refreshPosStateOptions("");
  updateInvoicePartyMeta();
  recalculateInvoice();
  setInvoiceModalOpen(true);
}
window.openNewInvoice = openNewInvoiceModal;
window.openNewInvoiceModal = openNewInvoiceModal;
window.isInvoiceDraftDirty = isInvoiceDraftDirty;
window.askDiscardDraft = askDiscardDraft;
window.sortDocsDefault = sortDocsDefault;
window.compareDocsByDateDesc = compareDocsByDateDesc;
window.moneyToAccountToast = moneyToAccountToast;

/* ---------- GST state helpers (single source: BillSetuGstin canonical list) ---------- */
function gstStatesApi() {
  return typeof BillSetuGstin !== "undefined" ? BillSetuGstin : null;
}
function normStateCode(code, name) {
  const G = gstStatesApi();
  if (G && G.normalizeStateCode) return G.normalizeStateCode(code, name);
  return String(code || "").split("|")[0].trim();
}
/** The business's GST state: its saved state, else its GSTIN prefix. */
function businessStateCode() {
  const b = State.business || {};
  const G = gstStatesApi();
  return normStateCode(b.stateCode, b.stateName) || (G ? G.gstinStateCode(b.gstin) : "");
}
/** A party's GST state: its saved state, else its GSTIN prefix ("" when unknown). */
function partyStateCode(party) {
  if (!party) return "";
  const G = gstStatesApi();
  return normStateCode(party.stateCode, party.stateName) || (G ? G.gstinStateCode(party.gstin) : "");
}
function partyStateLabel(party) {
  const code = partyStateCode(party);
  const G = gstStatesApi();
  return code ? ((G && G.stateName(code)) || party.stateName || code) : "";
}
/** Place of supply default: the party's state, or the business state for B2C / cash / no-state parties. */
function defaultPlaceOfSupply(party) {
  return partyStateCode(party) || businessStateCode();
}
/** Inter-state iff the business state and the place of supply are both known and differ. */
// 1.13.15 (BUG-4): with no business state the split can't be decided. isInterstateFor returns null
// ("missing") instead of false (intra-state); previews show "Set business state" and every save path
// calls requireBusinessState() first. computeTaxLines and purchaseGstFields refuse (throw) on null.
function isInterstateFor(posCode) {
  const biz = businessStateCode();
  if (!biz) return null;
  const pos = normStateCode(posCode);
  if (!pos) return false;
  return biz !== pos;
}
/** 1.13.15 (BUG-4): the one guard for every save that carries GST. False (and an error toast) when the
 *  business state is missing. */
function businessStateMissingMessage(what) {
  return `Add your business state in Settings before saving ${what || "a bill"}. It decides CGST+SGST or IGST.`;
}
function requireBusinessState(what) {
  if (businessStateCode()) return true;
  showToast(businessStateMissingMessage(what), "error");
  return false;
}
window.requireBusinessState = requireBusinessState;
window.businessStateMissingMessage = businessStateMissingMessage;
/** 1.13.6 (S1): move a party's balance by a signed amount (+ = they owe us more).
 *  A bill for a customer who holds an advance (PAYABLE) nets against it instead of adding. */
function partyAddReceivable(party, delta) {
  if (!party) return;
  const signed = (party.balType === "PAYABLE" ? -(Number(party.balance) || 0) : (Number(party.balance) || 0)) + (Number(delta) || 0);
  const v = Math.round(signed * 100) / 100;
  if (v < -0.004) { party.balance = -v; party.balType = "PAYABLE"; }
  else { party.balance = Math.max(0, v); party.balType = "RECEIVABLE"; }
}
window.partyAddReceivable = partyAddReceivable;
/** 1.13.6 (S1): the part of a receipt / supplier payment that settled bills (its settlements).
 *  The rest (amount - applied) is an advance or went against the opening balance. */
function receiptAppliedToBills(pay) {
  if (!pay) return 0;
  const amount = Number(pay.amount) || 0;
  const list = Array.isArray(pay.settlements) ? pay.settlements : [];
  let applied = list.reduce((sum, s) => sum + (Number(s && s.amount) || 0), 0);
  if (!list.length && pay.applied != null) applied = Number(pay.applied) || 0;
  return Math.round(Math.max(0, Math.min(amount, applied)) * 100) / 100;
}
window.receiptAppliedToBills = receiptAppliedToBills;
/** Total that later receipts / payments applied to one bill (field: "invoiceId" or "purchaseId"). */
function receiptsAppliedToBill(billId, field) {
  if (!billId) return 0;
  const key = field || "invoiceId";
  let total = 0;
  (State.payments || []).forEach(pay => {
    if (!pay || pay.deletedAt || !Array.isArray(pay.settlements)) return;
    pay.settlements.forEach(s => { if (s && s[key] === billId) total += Number(s.amount) || 0; });
  });
  return Math.round(total * 100) / 100;
}
window.receiptsAppliedToBill = receiptsAppliedToBill;
/** Amount paid on the purchase bill itself (later supplier payments are separate payment records). */
function purchasePaidOnBill(p) {
  if (!p) return 0;
  if (p.paidOnBill != null) return Number(p.paidOnBill) || 0;
  // Older data: paidAmount already includes payments applied later; take those out.
  const paid = Number(p.paidAmount) || 0;
  return Math.max(0, Math.round((paid - receiptsAppliedToBill(p.id, "purchaseId")) * 100) / 100);
}
window.purchasePaidOnBill = purchasePaidOnBill;
/** Money collected on the sale bill itself. Later receipts settle the bill and raise
 *  amountReceived/paidAmount, but they are counted from their own payment records. */
function invoiceCollectedOnBill(inv) {
  if (!inv) return 0;
  if (inv.collectedOnBill != null) return Number(inv.collectedOnBill) || 0;
  const received = Number(inv.amountReceived) || 0;
  return Math.max(0, Math.round((received - receiptsAppliedToBill(inv.id, "invoiceId")) * 100) / 100);
}
window.invoiceCollectedOnBill = invoiceCollectedOnBill;
/** 1.13.19: money already applied to a quotation, proforma or bill — on-bill collection plus
 *  later receipts, without counting the same rupee twice when both were stored. */
function saleAmountApplied(inv) {
  if (!inv) return 0;
  const receipts = receiptsAppliedToBill(inv.id, "invoiceId");
  const onBill = invoiceCollectedOnBill(inv);
  let raw = Math.round((onBill + receipts) * 100) / 100;
  const recorded = Number(inv.amountReceived) || 0;
  if (recorded > 0.009 && raw - recorded > 0.009) raw = recorded;
  return raw;
}
window.saleAmountApplied = saleAmountApplied;
/** 1.13.7 (C1): take every receipt / supplier payment settlement off one bill (field:
 *  "invoiceId" or "purchaseId"). The money stays on the payment, now unapplied (an advance).
 *  Returns the amount released. The changed payments are marked for sync. */
function detachReceiptsFromBill(billId, field) {
  if (!billId) return 0;
  const key = field || "invoiceId";
  const round = v => Math.round((Number(v) || 0) * 100) / 100;
  let total = 0;
  (State.payments || []).forEach(pay => {
    if (!pay || pay.deletedAt || !Array.isArray(pay.settlements)) return;
    const hit = pay.settlements.filter(s => s && s[key] === billId);
    if (!hit.length) return;
    const amt = round(hit.reduce((sum, s) => sum + (Number(s.amount) || 0), 0));
    pay.settlements = pay.settlements.filter(s => !(s && s[key] === billId));
    pay.applied = round(Math.max(0, (Number(pay.applied) || 0) - amt));
    if (!pay.settlements.length) pay.applied = 0;
    pay.releasedFrom = (Array.isArray(pay.releasedFrom) ? pay.releasedFrom : []).concat(hit.map(s => ({ ...s, releasedAt: new Date().toISOString() })));
    total += amt;
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(pay);
  });
  return round(total);
}
window.detachReceiptsFromBill = detachReceiptsFromBill;
/** 1.13.7 (C1): a sale / purchase bill is cancelled or deleted. The party loses the whole bill:
 *  - money collected / paid on the bill itself becomes an advance record (same date, mode and
 *    account), so cash / bank do not move and the party keeps credit for it;
 *  - receipts / payments that settled the bill are detached and become unapplied advances;
 *  - the still-due part simply goes away.
 *  kind: "invoice" | "purchase"; action: "cancelled" | "deleted". */
function releaseBillMoney(doc, kind, party, action) {
  if (!doc) return null;
  const round = v => Math.round((Number(v) || 0) * 100) / 100;
  const sale = kind !== "purchase";
  const total = round(sale ? doc.grandTotal : doc.totalBill);
  const onBill = round(Math.max(0, Math.min(sale ? invoiceCollectedOnBill(doc) : purchasePaidOnBill(doc), total)));
  const due = round(Math.max(0, Number(doc.balanceDue) || 0));
  const applied = detachReceiptsFromBill(doc.id, sale ? "invoiceId" : "purchaseId");
  const ref = sale ? doc.invoiceNo : (doc.billNo || doc.purchaseNo || "");
  let advanceId = null;
  if (onBill > 0.009) {
    const mode = doc.paymentMode && doc.paymentMode !== "CREDIT" ? doc.paymentMode : (sale ? "CASH" : "BANK");
    const adv = {
      id: "pay-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      partyId: party ? party.id : (sale ? doc.partyId : doc.supplierId),
      partyName: party ? party.name : (doc.partyName || doc.supplierName || ""),
      receiptNo: (sale ? "ADV-" : "ADVP-") + ref,
      date: doc.date,
      direction: sale ? "IN" : "OUT",
      amount: onBill,
      mode,
      accountId: doc.accountId || undefined,
      notes: `${sale ? "Received" : "Paid"} on ${ref} (${action}); kept as advance`,
      applied: 0,
      settlements: [],
      sourceBillId: doc.id,
      createdAt: new Date().toISOString()
    };
    if (!Array.isArray(State.payments)) State.payments = [];
    State.payments.push(adv);
    advanceId = adv.id;
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(adv);
  }
  if (sale) doc.collectedOnBill = 0; else doc.paidOnBill = 0;
  doc.releasedOnCancel = { onBill, applied, due, advancePaymentId: advanceId, action };
  if (party) {
    const whole = round(due + applied + onBill);
    partyAddReceivable(party, sale ? -whole : whole);
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(party);
  }
  doc.balanceDue = 0;
  return doc.releasedOnCancel;
}
window.releaseBillMoney = releaseBillMoney;
/** Dev / test builds (or localStorage lb-dev-checks=1) run extra consistency warnings. */
function lbDevChecksOn() {
  try { return lbVariant() === "dev" || localStorage.getItem("lb-dev-checks") === "1"; } catch (_) { return false; }
}

/** GST split for a purchase: inter-state when the supplier's state differs from the business state. */
function purchaseGstFields(supplier, gstAmount) {
  const supplierState = partyStateCode(supplier);
  const isInterstate = isInterstateFor(supplierState);
  if (isInterstate === null) throw new Error(businessStateMissingMessage("a purchase"));
  const gst = Math.round((Number(gstAmount) || 0) * 100);
  const cgst = isInterstate ? 0 : Math.floor(gst / 2);
  const sgst = isInterstate ? 0 : gst - cgst;
  return {
    supplierStateCode: supplierState || "",
    isInterstate,
    cgstAmount: cgst / 100,
    sgstAmount: sgst / 100,
    igstAmount: isInterstate ? gst / 100 : 0
  };
}
window.purchaseGstFields = purchaseGstFields;
window.businessStateCode = businessStateCode;
window.partyStateCode = partyStateCode;
window.defaultPlaceOfSupply = defaultPlaceOfSupply;
window.isInterstateFor = isInterstateFor;

/** (Re)build the place-of-supply dropdown with intra/inter labels relative to the business state. */
function refreshPosStateOptions(selectedCode) {
  const G = gstStatesApi();
  const posSelect = document.getElementById("inv-pos-state");
  if (!G || !posSelect) return;
  const biz = businessStateCode();
  const keep = selectedCode !== undefined ? selectedCode : posSelect.value;
  G.populateStateSelect(posSelect, keep || "", {
    placeholder: "Select place of supply",
    suffix: code => (!biz ? "" : code === biz ? " (Intra-state: CGST+SGST)" : " (Inter-state: IGST)")
  });
}
function setInvoicePos(code) {
  const G = gstStatesApi();
  const posSelect = document.getElementById("inv-pos-state");
  if (!posSelect) return;
  if (!posSelect.dataset.gstPopulated) refreshPosStateOptions("");
  if (G) G.selectState(posSelect, code || "");
}

function updateInvoicePartyMeta(opts) {
  opts = opts || {};
  const partyId = document.getElementById("inv-party-select").value;
  const party = State.parties.find(p => p.id === partyId);
  if (!party) {
    // B2C / cash bill: place of supply is the business's own state.
    if (!opts.keepPos) setInvoicePos(businessStateCode());
    evaluateTaxType();
    return;
  }

  document.getElementById("inv-party-meta").value = party.gstin
    ? `${party.gstin} · ${party.phone}`
    : `Unregistered · ${party.phone}`;

  // Place of supply defaults to the party's state (or the business state when the party has none).
  if (!opts.keepPos) setInvoicePos(defaultPlaceOfSupply(party));

  const creditNotice = document.getElementById("inv-credit-notice");
  if (creditNotice) {
    const points = party.loyaltyPoints || 0;
    const notice = typeof loyaltyPartyNotice === "function"
      ? loyaltyPartyNotice(party)
      : (points > 0 ? `${points} pts` : "");
    creditNotice.textContent = notice;
    creditNotice.classList.toggle("d-none", !notice);
  }

  evaluateTaxType();
}

function syncQuoteReceivedVisibility() {
  const type = document.getElementById("inv-doc-type")?.value || "";
  const hide = type === "ESTIMATE" || type === "PROFORMA";
  const panel = document.querySelector("#modal-invoice .inv-pay-panel");
  const note = document.getElementById("inv-quote-pay-note");
  if (panel) panel.classList.toggle("d-none", hide);
  if (note) {
    note.classList.toggle("d-none", !hide);
    note.textContent = "Quotations and proformas do not record a receipt here. Convert to a GST bill to carry any amount already collected, or record it then.";
  }
  if (hide) {
    const amt = document.getElementById("inv-amount-received");
    const fp = document.getElementById("inv-fully-paid");
    if (amt) amt.value = "";
    if (fp) fp.checked = false;
  }
}
window.syncQuoteReceivedVisibility = syncQuoteReceivedVisibility;

function syncInvoiceNumberPrefix() {
  const type = document.getElementById("inv-doc-type").value;
  const dateIso = document.getElementById("inv-date")?.value || new Date().toISOString().slice(0, 10);
  let next;
  let series = null;
  if (typeof BillSetuDocNumbering !== "undefined") {
    series = BillSetuDocNumbering.seriesForDocType(type);
    // Peek locally first (sync) so the modal is ready immediately.
    next = BillSetuDocNumbering.previewNextNumber(series, dateIso);
  } else {
    const prefix = {
      TAX_INVOICE: "INV",
      BILL_OF_SUPPLY: "BOS",
      ESTIMATE: "QT",
      PROFORMA: "PI",
      DELIVERY_CHALLAN: "DC",
      CREDIT_NOTE: "CN"
    }[type] || "INV";
    next = typeof nextDocNo === "function"
      ? nextDocNo(prefix)
      : `${prefix}-${String((State.invoices || []).length + 1).padStart(4, "0")}`;
  }
  document.getElementById("inv-number").value = next;
  const titles = {
    TAX_INVOICE: "Create Tax Invoice (Sales)",
    BILL_OF_SUPPLY: "Create Bill of Supply",
    ESTIMATE: "Create Quotation / Estimate",
    PROFORMA: "Create Proforma Invoice",
    DELIVERY_CHALLAN: "Create Delivery Challan",
    CREDIT_NOTE: "Create Credit Note (Sales Return)"
  };
  document.getElementById("invoice-modal-title").textContent = titles[type] || "Create Bill";
  syncQuoteReceivedVisibility();
  // When sync is connected, reserve atomically and upgrade the field if the
  // user has not edited away from the peeked value.
  if (series && typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.reserveOnServer) {
    const peeked = next;
    BillSetuDocNumbering.reserveOnServer(series, dateIso).then(reserved => {
      if (!reserved) return;
      const el = document.getElementById("inv-number");
      if (el && (el.value === peeked || !el.value)) el.value = reserved;
    }).catch(() => {});
  }
}

function evaluateTaxType() {
  const posValue = document.getElementById("inv-pos-state")?.value || "";
  const posCode = normStateCode(posValue);
  const posName = (gstStatesApi() && gstStatesApi().stateName(posCode)) || posValue.split("|")[1] || "";
  const bizCode = businessStateCode();
  const notice = document.getElementById("tax-determination-notice");
  const noticeText = document.getElementById("tax-type-text");
  // 1.13.15 (BUG-4): no business state, no split: show "Set business state" instead of CGST/SGST.
  const missing = !bizCode;
  // 1.13.16: a Bill of Supply carries no GST, so it needs no split and can be saved without the state.
  const supplyOnly = (document.getElementById("inv-doc-type")?.value || "") === "BILL_OF_SUPPLY";
  document.getElementById("calc-gst-missing-wrap")?.classList.toggle("d-none", !missing || supplyOnly);
  if (missing) {
    if (noticeText) noticeText.textContent = supplyOnly
      ? "Bill of Supply: no GST is charged, so it can be saved without the business state. Set the state in Settings for tax bills."
      : "Set business state in Settings to decide CGST+SGST or IGST. Bills can't be saved until then.";
    ["calc-cgst-wrap", "calc-sgst-wrap", "calc-igst-wrap"].forEach(id => document.getElementById(id)?.classList.add("d-none"));
    recalculateInvoice();
    return;
  }
  if (!posCode) {
    if (noticeText) noticeText.textContent = "Select your business state and place of supply to determine CGST/SGST vs IGST.";
    document.getElementById("calc-cgst-wrap")?.classList.remove("d-none");
    document.getElementById("calc-sgst-wrap")?.classList.remove("d-none");
    document.getElementById("calc-igst-wrap")?.classList.add("d-none");
    recalculateInvoice();
    return;
  }
  const isInterstate = invoiceFormIsInterstate(posCode);

  if (isInterstate) {
    noticeText.textContent = `Inter-State Supply to ${posName || posCode}: Integrated GST (IGST) will apply automatically.`;
    document.getElementById("calc-cgst-wrap").classList.add("d-none");
    document.getElementById("calc-sgst-wrap").classList.add("d-none");
    document.getElementById("calc-igst-wrap").classList.remove("d-none");
  } else {
    const bizState = (gstStatesApi() && gstStatesApi().stateName(bizCode)) || State.business?.stateName || bizCode || "your state";
    noticeText.textContent = `Intra-State Supply (${bizState}): Central GST (CGST) + State GST (SGST) will apply.`;
    document.getElementById("calc-cgst-wrap").classList.remove("d-none");
    document.getElementById("calc-sgst-wrap").classList.remove("d-none");
    document.getElementById("calc-igst-wrap").classList.add("d-none");
  }

  // 1.13.18: if an edit would change the posted split (party or POS changed), say so before save.
  const editing = State.editingInvoiceId ? (State.invoices || []).find(i => i.id === State.editingInvoiceId) : null;
  const savedSplit = editing && typeof gstSplitFromSavedDoc === "function" ? gstSplitFromSavedDoc(editing) : null;
  if (noticeText && savedSplit && typeof savedSplit.isInterstate === "boolean" && isInterstate !== null
      && savedSplit.isInterstate !== isInterstate) {
    const from = savedSplit.isInterstate ? "IGST" : "CGST+SGST";
    const to = isInterstate ? "IGST" : "CGST+SGST";
    noticeText.textContent = `GST will be recalculated from ${from} to ${to} because the party or place of supply changed. Confirm when you save.`;
  }

  recalculateInvoice();
}

function renderInvoiceLineItems() {
  const tbody = document.getElementById("line-items-body");
  tbody.innerHTML = State.invoiceDraftItems.map((item, index) => {
    const stockItem = findStockItem(item);
    const tracksSerial = Boolean(stockItem?.trackSerial);
    const availableSerials = tracksSerial ? getAvailableSerialsForLine(stockItem, index) : [];
    const selectedCount = (item.serials || []).length;
    const neededCount = Math.max(0, (Number(item.qty) || 1) - selectedCount);
    const serialPlaceholder = availableSerials.length
      ? (neededCount > 0
          ? `Select serial no. (${availableSerials.length} available, choose ${neededCount} more)...`
          : `Add another serial (${availableSerials.length} available)...`)
      : "No more serials in stock";

    return `
    <tr data-index="${index}">
      <td>
        <input type="text" class="form-control item-desc-input" value="${escHtml(item.description)}" list="catalog-items-list" placeholder="Select or type item...">
        <div class="line-serials ${tracksSerial ? "" : "d-none"}">
          ${(item.serials || []).map((code, serialIndex) => `<button type="button" class="serial-chip" onclick="removeLineSerial(${index}, ${serialIndex})">${escHtml(code)} ×</button>`).join("")}
          <div class="serial-picker-row">
            <select class="form-control item-serial-select" aria-label="Choose available serial number">
              <option value="">${escHtml(serialPlaceholder)}</option>
              ${availableSerials.map(code => `<option value="${escHtml(code)}">${escHtml(code)}</option>`).join("")}
            </select>
            <div class="scan-row">
              <input type="text" class="form-control item-serial-input" placeholder="Or scan / type serial + Enter" autocomplete="off">
              <button type="button" class="btn btn-outline scan-btn" data-scan-mode="line" data-scan-line="${index}">Scan</button>
            </div>
          </div>
        </div>
      </td>
      <td>
        <input type="text" class="form-control item-hsn-input" value="${escHtml(item.hsn || '')}" placeholder="HSN">
      </td>
      <td>
        <input type="text" class="form-control item-batchexp-input" value="${escHtml(item.batchExp || '')}" placeholder="B-101 / 12-28">
      </td>
      <td>
        <input type="number" inputmode="decimal" class="form-control item-qty-input" value="${item.qty}" min="0" step="any">
      </td>
      <td>
        <input type="text" class="form-control item-unit-input" value="${escHtml(item.unit || 'PCS')}" placeholder="PCS">
      </td>
      <td>
        <input type="number" inputmode="decimal" class="form-control item-rate-input" value="${item.rate}" step="0.01">
      </td>
      <td>
        <input type="number" class="form-control item-disc-input" value="${item.discPercent}" min="0" max="100">
      </td>
      <td>
        <select class="form-control item-gst-select">
          <option value="18" ${Number(item.gstRate) === 18 ? 'selected' : ''}>18%</option>
          <option value="12" ${Number(item.gstRate) === 12 ? 'selected' : ''}>12%</option>
          <option value="5" ${Number(item.gstRate) === 5 ? 'selected' : ''}>5%</option>
          <option value="28" ${Number(item.gstRate) === 28 ? 'selected' : ''}>28%</option>
          <option value="0" ${Number(item.gstRate) === 0 ? 'selected' : ''}>0%</option>
        </select>
        <label class="text-xs item-incl-label" title="Rate includes GST"><input type="checkbox" class="item-inclusive-check" ${item.rateInclusive ? "checked" : ""}> Incl.</label>
      </td>
      <td class="text-right">
        <strong class="item-line-total">₹0.00</strong>
      </td>
      <td>
        <button type="button" class="btn-icon text-muted" onclick="removeLineItem(${index})" title="Remove item">✕</button>
      </td>
    </tr>
  `;
  }).join("");

  attachLineItemEventListeners();
}

function attachLineItemEventListeners() {
  const tbody = document.getElementById("line-items-body");
  tbody.querySelectorAll("tr").forEach(tr => {
    const idx = Number(tr.getAttribute("data-index"));
    const descInput = tr.querySelector(".item-desc-input");

    const applyCatalogMatch = (raw, allowPartial) => {
      const matched = findCatalogItem(raw, allowPartial);
      if (!matched) return false;
      const serial = (matched.serials || []).find(code => code.toLowerCase() === raw.trim().toLowerCase()) || "";
      State.invoiceDraftItems[idx] = catalogLine(matched, serial);
      renderInvoiceLineItems();
      recalculateInvoice();
      return true;
    };

    descInput.addEventListener("input", e => {
      const raw = e.target.value;
      State.invoiceDraftItems[idx].description = raw;
      applyCatalogMatch(raw, false);
    });

    descInput.addEventListener("change", e => {
      const raw = e.target.value;
      const current = State.invoiceDraftItems[idx];
      if (!current.itemId || Number(current.rate) === 0) {
        applyCatalogMatch(raw, true);
      }
    });

    const serialSelect = tr.querySelector(".item-serial-select");
    if (serialSelect) {
      serialSelect.addEventListener("change", e => {
        if (!e.target.value) return;
        addLineSerial(idx, e.target.value);
      });
    }

    const serialInput = tr.querySelector(".item-serial-input");
    if (serialInput) {
      serialInput.addEventListener("keydown", e => {
        if (e.key !== "Enter") return;
        e.preventDefault();
        addLineSerial(idx, e.target.value);
      });
    }

    tr.querySelector(".item-hsn-input").addEventListener("input", e => {
      State.invoiceDraftItems[idx].hsn = e.target.value;
    });

    tr.querySelector(".item-qty-input").addEventListener("input", e => {
      const val = Number(e.target.value);
      State.invoiceDraftItems[idx].qty = val > 0 ? val : 0;
      recalculateInvoice();
    });

    const batchInput = tr.querySelector(".item-batchexp-input");
    if (batchInput) {
      batchInput.addEventListener("input", e => {
        State.invoiceDraftItems[idx].batchExp = e.target.value;
      });
    }

    tr.querySelector(".item-unit-input").addEventListener("input", e => {
      State.invoiceDraftItems[idx].unit = e.target.value;
    });

    tr.querySelector(".item-rate-input").addEventListener("input", e => {
      State.invoiceDraftItems[idx].rate = Number(e.target.value) || 0;
      recalculateInvoice();
    });

    tr.querySelector(".item-disc-input").addEventListener("input", e => {
      State.invoiceDraftItems[idx].discPercent = Number(e.target.value) || 0;
      recalculateInvoice();
    });

        tr.querySelector(".item-inclusive-check")?.addEventListener("change", e => {
      State.invoiceDraftItems[idx].rateInclusive = !!e.target.checked;
      State.invoiceAmountReceivedTouched = false;
      recalculateInvoice();
    });
    tr.querySelector(".item-gst-select").addEventListener("change", e => {
      State.invoiceDraftItems[idx].gstRate = Number(e.target.value) || 0;
      recalculateInvoice();
    });
  });
}

function addLineItem() {
  State.invoiceDraftItems.push(blankInvoiceLine());
  renderInvoiceLineItems();
  recalculateInvoice();
}

function removeLineItem(index) {
  if (State.invoiceDraftItems.length <= 1) {
    State.invoiceDraftItems = [blankInvoiceLine()];
    renderInvoiceLineItems();
    recalculateInvoice();
    return;
  }
  State.invoiceDraftItems.splice(index, 1);
  renderInvoiceLineItems();
  recalculateInvoice();
}

function roundMoney(n) {
  if (typeof BillSetuMoney !== "undefined") return BillSetuMoney.roundMoney(n);
  return Math.round((Number(n) || 0) * 100) / 100;
}

function invoiceDiscountMode() {
  const el = document.getElementById("inv-discount-mode");
  return el && el.value === "afterTax" ? "afterTax" : "beforeTax";
}

function invoiceMoney(draftItems, isInterstate, billDiscount, loyaltyRupees, zeroGst, discountMode) {
  if (typeof BillSetuMoney !== "undefined" && BillSetuMoney.computeDocument) {
    return BillSetuMoney.computeDocument(draftItems, {
      isInterstate: !!isInterstate,
      billDiscount: billDiscount || 0,
      loyaltyRupees: loyaltyRupees || 0,
      zeroGst: !!zeroGst,
      discountMode: discountMode || invoiceDiscountMode()
    });
  }
  // Fallback (should not run once money.js loads)
  const lines = (draftItems || []).map(item => {
    const qty = Number(item.qty) || 0;
    const rate = Number(item.rate) || 0;
    const discPercent = Number(item.discPercent) || 0;
    const gstRate = zeroGst ? 0 : (Number(item.gstRate) || 0);
    const raw = qty * rate;
    const taxable = raw - raw * (discPercent / 100);
    const tax = taxable * (gstRate / 100);
    return { item, taxable, tax, gstRate };
  });
  const rawGrand = lines.reduce((sum, line) => sum + line.taxable + line.tax, 0);
  return { items: draftItems || [], taxableTotal: 0, cgstTotal: 0, sgstTotal: 0, igstTotal: 0,
    roundOff: 0, grandTotal: Math.round(rawGrand), billDiscount: 0, loyaltyRupees: 0, rawGrand };
}

/** 1.13.17: the GST split a saved document was posted with (stored flag, else its tax lines). */
function gstSplitFromSavedDoc(doc) {
  if (!doc) return null;
  const posStateCode = doc.posStateCode || "";
  if (typeof doc.isInterstate === "boolean") {
    return { isInterstate: doc.isInterstate, posStateCode };
  }
  const igst = Number(doc.igstTotal) || 0;
  const cgst = Number(doc.cgstTotal) || 0;
  const sgst = Number(doc.sgstTotal) || 0;
  if (igst > 0.009 && cgst < 0.009 && sgst < 0.009) return { isInterstate: true, posStateCode };
  if ((cgst > 0.009 || sgst > 0.009) && igst < 0.009) return { isInterstate: false, posStateCode };
  const items = Array.isArray(doc.items) ? doc.items : [];
  const iIgst = items.reduce((s, l) => s + (Number(l.igstVal) || 0), 0);
  const iCgst = items.reduce((s, l) => s + (Number(l.cgstVal) || 0), 0);
  const iSgst = items.reduce((s, l) => s + (Number(l.sgstVal) || 0), 0);
  if (iIgst > 0.009 && iCgst < 0.009 && iSgst < 0.009) return { isInterstate: true, posStateCode };
  if ((iCgst > 0.009 || iSgst > 0.009) && iIgst < 0.009) return { isInterstate: false, posStateCode };
  return null;
}
window.gstSplitFromSavedDoc = gstSplitFromSavedDoc;

/** 1.13.17: re-mirror a credit note on edit from the linked invoice, or from its own saved lines if unlinked. */
function creditNoteMirrorFrom(inv) {
  if (!inv || inv.docType !== "CREDIT_NOTE") return null;
  const linkedId = inv.linkedInvoiceId || "";
  const linked = linkedId ? (State.invoices || []).find(i => i.id === linkedId && i.docType !== "CREDIT_NOTE") : null;
  const fromLinked = gstSplitFromSavedDoc(linked);
  if (fromLinked) {
    return { ...fromLinked, invoiceId: linked.id, invoiceNo: linked.invoiceNo || "" };
  }
  const own = gstSplitFromSavedDoc(inv);
  if (own) {
    return { ...own, invoiceId: linkedId, invoiceNo: inv.referenceNo || "" };
  }
  return null;
}
window.creditNoteMirrorFrom = creditNoteMirrorFrom;

/** 1.13.16: the split the sales form uses. A credit note started from a bill mirrors that bill's stored
 *  split (it must reverse the tax as charged) while its place of supply is unchanged; everything else is
 *  decided from the current business state and place of supply (null = business state missing).
 *  1.13.17: the mirror is stored on the credit note (linkedInvoiceId + split) and restored on edit. */
function invoiceFormIsInterstate(posValue) {
  const mirror = State.invoiceMirrorSplit;
  const docType = document.getElementById("inv-doc-type")?.value || "TAX_INVOICE";
  if (mirror && typeof mirror.isInterstate === "boolean" && businessStateCode()
      && normStateCode(posValue) === normStateCode(mirror.posStateCode)) {
    // 1.13.17: a credit note keeps the linked (or own) split while POS is unchanged.
    // 1.13.18 (BUG-8): any other saved sales doc also keeps its own split until the user
    // changes the party or the place of supply (then the current state decides).
    if (docType === "CREDIT_NOTE") return mirror.isInterstate;
    const partyId = document.getElementById("inv-party-select")?.value || "";
    if (!mirror.partyId || partyId === mirror.partyId) return mirror.isInterstate;
  }
  return isInterstateFor(posValue);
}
window.invoiceFormIsInterstate = invoiceFormIsInterstate;

function recalculateInvoice() {
  const posValue = document.getElementById("inv-pos-state").value;
  const isInterstate = invoiceFormIsInterstate(posValue);

  let taxableTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;

  const rows = document.querySelectorAll("#line-items-body tr");

  State.invoiceDraftItems.forEach((item, idx) => {
    // Do not coerce qty 0/negative to 1 — show inline error; 0 rows are excluded from money.
    const qtyRaw = rows[idx]?.querySelector(".item-qty-input")?.value;
    const qtyNum = qtyRaw === "" || qtyRaw == null ? Number(item.qty) : Number(qtyRaw);
    if (rows[idx]) {
      const qtyInput = rows[idx].querySelector(".item-qty-input");
      let err = rows[idx].querySelector(".item-qty-error");
      if (!err && qtyInput) {
        err = document.createElement("div");
        err.className = "item-qty-error text-xs";
        err.style.color = "var(--accent-red, #b91c1c)";
        qtyInput.parentElement?.appendChild(err);
      }
      if (err) {
        if (qtyRaw !== "" && qtyRaw != null && !Number.isFinite(qtyNum)) {
          err.textContent = "Enter a valid quantity";
          qtyInput.classList.add("input-invalid");
        } else if (Number.isFinite(qtyNum) && qtyNum < 0) {
          err.textContent = "Quantity cannot be negative";
          qtyInput.classList.add("input-invalid");
        } else {
          err.textContent = "";
          qtyInput.classList.remove("input-invalid");
        }
      }
      if (Number.isFinite(qtyNum)) item.qty = qtyNum;
    }
    const qty = Number(item.qty) || 0;
    const rate = Number(item.rate) || 0;
    const rawTotal = qty * rate;
    const discAmount = rawTotal * ((Number(item.discPercent) || 0) / 100);
    const taxableVal = rawTotal - discAmount;
    const taxVal = taxableVal * ((Number(item.gstRate) || 0) / 100);
    const lineGrandTotal = taxableVal + taxVal;

    item.taxableVal = taxableVal;
    item.total = lineGrandTotal;

    taxableTotal += taxableVal;

    if (isInterstate) {
      item.cgstVal = 0;
      item.sgstVal = 0;
      item.igstVal = taxVal;
      igstTotal += taxVal;
    } else {
      const halfTax = taxVal / 2;
      item.cgstVal = halfTax;
      item.sgstVal = halfTax;
      item.igstVal = 0;
      cgstTotal += halfTax;
      sgstTotal += halfTax;
    }

    if (rows[idx]) {
      rows[idx].querySelector(".item-line-total").textContent = formatINR(lineGrandTotal);
    }
  });

  const docTypeNow = document.getElementById("inv-doc-type")?.value || "TAX_INVOICE";
  const billDiscountInput = Math.max(0, Number(document.getElementById("inv-bill-discount")?.value) || 0);
  const preview = invoiceMoney(State.invoiceDraftItems, isInterstate, billDiscountInput, 0, docTypeNow === "BILL_OF_SUPPLY");
  const loyaltyRupees = typeof previewLoyaltyRupees === "function" ? previewLoyaltyRupees(preview.grandTotal) : 0;
  const priced = loyaltyRupees
    ? invoiceMoney(State.invoiceDraftItems, isInterstate, billDiscountInput, loyaltyRupees, docTypeNow === "BILL_OF_SUPPLY")
    : preview;
  taxableTotal = priced.taxableTotal;
  cgstTotal = priced.cgstTotal;
  sgstTotal = priced.sgstTotal;
  igstTotal = priced.igstTotal;
  priced.items.forEach((line, idx) => {
    Object.assign(State.invoiceDraftItems[idx], {
      taxableVal: line.taxableVal,
      cgstVal: line.cgstVal,
      sgstVal: line.sgstVal,
      igstVal: line.igstVal,
      total: line.total,
      gstRate: line.gstRate,
      preBillTaxableVal: line.preBillTaxableVal
    });
    if (rows[idx]) rows[idx].querySelector(".item-line-total").textContent = formatINR(line.total);
  });
  const roundOff = priced.roundOff;
  const payable = priced.grandTotal;

  document.getElementById("calc-taxable-total").textContent = formatINR(taxableTotal);
  document.getElementById("calc-cgst-val").textContent = formatINR(cgstTotal);
  document.getElementById("calc-sgst-val").textContent = formatINR(sgstTotal);
  document.getElementById("calc-igst-val").textContent = formatINR(igstTotal);
  document.getElementById("calc-roundoff-val").textContent = (roundOff >= 0 ? "+" : "") + roundOff.toFixed(2);
  const loyaltyLabel = document.getElementById("calc-loyalty-val");
  if (loyaltyLabel) loyaltyLabel.textContent = loyaltyRupees ? ("-" + formatINR(loyaltyRupees)) : formatINR(0);
  document.getElementById("calc-grand-total").textContent = formatINR(payable);
  document.getElementById("calc-words-val").textContent = convertNumberToWords(payable);

  // Auto calculate balance due + Fully paid / mode extras
  const amountReceivedInput = document.getElementById("inv-amount-received");
  const selectedPayMode = document.querySelector('input[name="inv-pay-mode"]:checked')?.value || "UPI";
  if (!State.invoiceAmountReceivedTouched) {
    amountReceivedInput.value = selectedPayMode === "CREDIT" ? 0 : payable;
  } else if (selectedPayMode === "CREDIT") {
    amountReceivedInput.value = 0;
  }
  const amtReceived = Number(amountReceivedInput.value) || 0;
  const balDue = Math.max(0, Math.round((payable - amtReceived) * 100) / 100);
  const balField = document.getElementById("inv-balance-due");
  if (balField) balField.value = formatINR(balDue);
  const balLive = document.getElementById("inv-balance-due-live");
  if (balLive) {
    balLive.innerHTML = `Balance due: <strong>${formatINR(balDue)}</strong>`;
    balLive.classList.toggle("is-due", balDue > 0.009);
    balLive.classList.toggle("is-clear", balDue <= 0.009);
  }
  syncFullyPaidToggle(payable);
  syncInvoicePayModeFields();
}

function saveCurrentInvoice(printAfter = false) {
  try {
    return saveCurrentInvoiceNow(printAfter);
  } catch (err) {
    console.error(err);
    showToast((err && err.message) || "Could not save this bill.", "error");
  }
}

function saveCurrentInvoiceNow(printAfter = false) {
  if (typeof blockedAction === "function" && blockedAction("sales")) return;
  // 1.13.14 (BUG-2) / 1.13.15 (BUG-4): without the business state the GST split can't be decided.
  // 1.13.16: a Bill of Supply has no GST lines (zero tax), so nothing is decided and it may be saved.
  const supplyOnlyDoc = document.getElementById("inv-doc-type")?.value === "BILL_OF_SUPPLY";
  if (!supplyOnlyDoc && !requireBusinessState("a bill")) return;
  const invoiceNo = document.getElementById("inv-number").value.trim();
  if (!invoiceNo) {
    showToast("Invoice number is required", "error");
    return;
  }
  const editingId = State.editingInvoiceId || null;
  if (State.invoices.some(inv => inv.id !== editingId && String(inv.invoiceNo || "").toLowerCase() === invoiceNo.toLowerCase())) {
    showToast("That invoice number already exists. Pick another number.", "error");
    return;
  }

  // Commit any pending serial typed or chosen in the row inputs before saving
  document.querySelectorAll("#line-items-body tr").forEach(tr => {
    const idx = Number(tr.getAttribute("data-index"));
    const pendingSelect = tr.querySelector(".item-serial-select")?.value?.trim();
    if (pendingSelect) addLineSerial(idx, pendingSelect);
    const pendingTyped = tr.querySelector(".item-serial-input")?.value?.trim();
    if (pendingTyped) addLineSerial(idx, pendingTyped);
  });

  // Drop empty trailing rows if at least one valid row exists
  const badQty = State.invoiceDraftItems.find(line => {
    const hasContent = String(line.description || "").trim() || Number(line.rate) > 0 || line.itemId;
    if (!hasContent) return false;
    const q = Number(line.qty);
    return !Number.isFinite(q) || q < 0;
  });
  if (badQty) {
    showToast("Fix quantity on line items (no negatives)", "error");
    return;
  }
  const zeroOnly = State.invoiceDraftItems.filter(line => (String(line.description || "").trim() || Number(line.rate) > 0 || line.itemId) && !(Number(line.qty) > 0));
  if (zeroOnly.length && !State.invoiceDraftItems.some(line => Number(line.qty) > 0 && (String(line.description || "").trim() || Number(line.rate) > 0))) {
    showToast("Add a quantity greater than zero", "error");
    return;
  }
  const nonEmptyLines = State.invoiceDraftItems.filter(line => (String(line.description || "").trim() || Number(line.rate) > 0) && Number(line.qty) > 0);
  if (!nonEmptyLines.length) {
    showToast("Please select or enter at least one item on the invoice.", "error");
    return;
  }
  State.invoiceDraftItems = nonEmptyLines;

  const partyId = document.getElementById("inv-party-select").value;
  const party = State.parties.find(p => p.id === partyId);
  const posValue = document.getElementById("inv-pos-state").value;
  // Empty place of supply (e.g. old books with no state) → the business state (intra-state).
  const posCode = normStateCode(posValue) || defaultPlaceOfSupply(party);
  const posName = (gstStatesApi() && gstStatesApi().stateName(posCode)) || posValue.split("|")[1] || "";
  const splitNow = invoiceFormIsInterstate(posCode);
  // Only a Bill of Supply gets here without a state; it carries no GST, so store "not inter-state".
  const isInterstate = splitNow === null ? false : splitNow;
  const existingForSplit = editingId ? State.invoices.find(i => i.id === editingId) : null;
  const savedSplit = existingForSplit && typeof gstSplitFromSavedDoc === "function" ? gstSplitFromSavedDoc(existingForSplit) : null;
  let gstRecalcNote = "";
  if (savedSplit && typeof savedSplit.isInterstate === "boolean" && savedSplit.isInterstate !== isInterstate) {
    gstRecalcNote = isInterstate
      ? "GST will be recalculated from CGST+SGST to IGST because the party or place of supply changed. Save anyway?"
      : "GST will be recalculated from IGST to CGST+SGST because the party or place of supply changed. Save anyway?";
    if (!confirm(gstRecalcNote)) return;
  }

  const docType = document.getElementById("inv-doc-type").value;
  const ewayBill = document.getElementById("inv-eway-bill")?.value.trim() || "";
  const vehicleNo = document.getElementById("inv-vehicle-no")?.value.trim() || "";
  const transporterName = document.getElementById("inv-transporter-name")?.value.trim() || "";
  const transporterId = document.getElementById("inv-transporter-id")?.value.trim() || "";
  const irn = document.getElementById("inv-irn")?.value.trim() || "";
  const ackNo = document.getElementById("inv-ack-no")?.value.trim() || "";
  const ackDate = document.getElementById("inv-ack-date")?.value || "";
  const nonPosting = docType === "ESTIMATE" || docType === "PROFORMA";

  // Link catalog items and ensure serial-tracked items have serials assigned or synced
  State.invoiceDraftItems.forEach((line, idx) => {
    if (!line.itemId && line.description) {
      const matched = findCatalogItem(line.description, true);
      if (matched) {
        line.itemId = matched.id;
        if (!line.rate) line.rate = Number(matched.sellingPrice) || 0;
        if (!line.hsn) line.hsn = matched.hsn || "";
        if (line.gstRate === undefined) line.gstRate = Number(matched.gstRate) || 0;
        Object.assign(line, productMeta(matched));
      }
    }
    const stockItem = findStockItem(line);
    if (!nonPosting && stockItem?.trackSerial) {
      line.serials = line.serials || [];
      if (line.serials.length > (Number(line.qty) || 0)) {
        line.qty = line.serials.length;
      } else if (line.serials.length < (Number(line.qty) || 1)) {
        const needed = (Number(line.qty) || 1) - line.serials.length;
        const avail = getAvailableSerialsForLine(stockItem, idx);
        if (avail.length >= needed) {
          line.serials.push(...avail.slice(0, needed));
        }
      }
    }
  });

  renderInvoiceLineItems();
  recalculateInvoice();

  const godownId = document.getElementById("inv-godown")?.value || (typeof defaultGodownId === "function" ? defaultGodownId() : "");
  const payMode = document.querySelector('input[name="inv-pay-mode"]:checked')?.value || "CASH";
  if (!party && payMode === "CREDIT" && docType !== "DELIVERY_CHALLAN") {
    showToast("Pick a customer for a credit bill, or choose cash.", "error");
    return;
  }
  const billDiscountInput = Math.max(0, Number(document.getElementById("inv-bill-discount")?.value) || 0);
  const zeroGst = docType === "BILL_OF_SUPPLY";
  const preview = invoiceMoney(State.invoiceDraftItems, isInterstate, billDiscountInput, 0, zeroGst);
  const loyalty = typeof invoiceLoyaltyApplied === "function"
    ? invoiceLoyaltyApplied(party, preview.grandTotal, docType)
    : { points: 0, rupees: 0, earned: 0 };
  const priced = invoiceMoney(State.invoiceDraftItems, isInterstate, billDiscountInput, loyalty.rupees || 0, zeroGst);
  const items = priced.items.map(item => ({ ...item, godownId }));
  const taxableTotal = priced.taxableTotal;
  const cgstTotal = priced.cgstTotal;
  const sgstTotal = priced.sgstTotal;
  const igstTotal = priced.igstTotal;
  const roundOff = priced.roundOff;
  const billDiscount = priced.billDiscount;
  const grossTotal = preview.grandTotal;
  const grandTotal = priced.grandTotal;
  let amtReceived = Number(document.getElementById("inv-amount-received").value) || 0;
  let balanceDue = Math.max(0, grandTotal - amtReceived);
  if (nonPosting || docType === "DELIVERY_CHALLAN") {
    amtReceived = 0;
    balanceDue = nonPosting ? grandTotal : 0;
  }

  if (ewayBill && !/^\d{12}$/.test(ewayBill)) {
    showToast("E-way bill number must be 12 digits.", "error");
    return;
  }
  if (!nonPosting && docType !== "DELIVERY_CHALLAN" && isInterstate && grandTotal > 50000 && !/^\d{12}$/.test(ewayBill)) {
    showToast("An e-way bill number (12 digits) is required on this inter-state bill.", "error");
    return;
  }

  const existing = editingId ? State.invoices.find(i => i.id === editingId) : null;
  if (editingId && !existing) {
    showToast("That invoice is no longer available to edit.", "error");
    State.editingInvoiceId = null;
    return;
  }

  // Money that was already collected on this bill (before the edit): an edit only ever
  // posts / announces the DIFFERENCE, never the whole amount again.
  const prevMoney = existing ? {
    accountId: existing.accountId || "",
    onBill: Number(existing.collectedOnBill != null ? existing.collectedOnBill : existing.amountReceived) || 0,
    received: Number(existing.amountReceived) || 0
  } : null;

  // Edit: reverse old stock/party/loyalty first so serials & qty are available again
  if (existing) {
    if (typeof reverseInvoiceEffects === "function") reverseInvoiceEffects(existing);
    else {
      showToast("Edit engine missing — reload the app.", "error");
      return;
    }
  }

  if (!nonPosting && !serialLinesValid(items, docType === "CREDIT_NOTE")) {
    if (existing && typeof applyInvoiceEffects === "function") applyInvoiceEffects(existing);
    return;
  }

  if (!nonPosting && docType !== "CREDIT_NOTE") {
    for (const line of items) {
      const stockItem = findStockItem(line);
      if (!stockItem || isServiceCategory(stockItem.category)) continue;
      const need = Number(line.qty) || 0;
      const have = typeof qtyInGodown === "function" ? qtyInGodown(stockItem, line.godownId) : Number(stockItem.stock) || 0;
      if (need > have + 1e-9) {
        if (existing && typeof applyInvoiceEffects === "function") applyInvoiceEffects(existing);
        showToast(`Not enough stock of ${stockItem.name}. Only ${have} in this godown.`, "error");
        return;
      }
    }
  }

  if (party && !nonPosting && docType !== "CREDIT_NOTE" && docType !== "DELIVERY_CHALLAN" && Number(party.creditLimit) > 0) {
    const priorDue = 0; // already reversed from party when editing
    const projected = (party.balance || 0) - priorDue + balanceDue;
    if (projected > Number(party.creditLimit)) {
      const proceed = confirm(`${party.name} has a credit limit of ${formatINR(party.creditLimit)}. This bill takes outstanding to ${formatINR(projected)}. Save anyway?`);
      if (!proceed) {
        if (existing && typeof applyInvoiceEffects === "function") applyInvoiceEffects(existing);
        return;
      }
    }
  }

  const printTemplate = existing?.printTemplate
    || document.getElementById("print-template-select")?.value
    || "GOLD";

  const payload = {
    id: existing ? existing.id : ("inv-" + Date.now()),
    docType,
    invoiceNo,
    date: document.getElementById("inv-date").value,
    dueDate: document.getElementById("inv-due-date").value,
    partyId: party?.id || "",
    partyName: party?.name || "Cash",
    partyGstin: party?.gstin || "",
    partyPhone: party?.phone || "",
    posStateCode: posCode,
    posStateName: posName,
    isInterstate,
    linkedInvoiceId: docType === "CREDIT_NOTE"
      ? (existing?.linkedInvoiceId || (State.invoiceMirrorSplit && State.invoiceMirrorSplit.invoiceId) || "")
      : undefined,
    items,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    roundOff,
    grandTotal,
    amountReceived: amtReceived,
    // Later receipts stay separate: only a change of the received amount on the form
    // changes what was collected on the bill itself.
    collectedOnBill: prevMoney
      ? Math.max(0, Math.min(amtReceived, Math.round((prevMoney.onBill + (amtReceived - prevMoney.received)) * 100) / 100))
      : amtReceived,
    paidAmount: amtReceived,
    balanceDue,
    paymentMode: payMode,
    accountId: (function () {
      const amt = Number(document.getElementById("inv-amount-received")?.value) || 0;
      if (amt <= 0 || payMode === "CREDIT") return "";
      const sel = document.getElementById("inv-account-id")?.value;
      if (sel) {
        if (typeof rememberAccountId === "function") rememberAccountId(sel);
        return sel;
      }
      return typeof defaultAccountIdForMode === "function" ? defaultAccountIdForMode(payMode) : (payMode === "CASH" ? "l-cash" : "l-bank");
    })(),
    upiRef: document.getElementById("inv-upi-ref")?.value.trim() || "",
    cardRef: document.getElementById("inv-card-ref")?.value.trim() || "",
    bankRef: document.getElementById("inv-bank-ref")?.value.trim() || "",
    chequeNo: document.getElementById("inv-cheque-no")?.value.trim() || "",
    chequeDate: document.getElementById("inv-cheque-date")?.value || "",
    chequeBank: document.getElementById("inv-cheque-bank")?.value.trim() || "",
    notes: document.getElementById("inv-notes").value,
    godownId,
    grossTotal,
    loyaltyPointsRedeemed: loyalty.points || 0,
    loyaltyDiscount: loyalty.rupees || 0,
    loyaltyPointsEarned: loyalty.earned || 0,
    billDiscount,
    discountMode: typeof invoiceDiscountMode === "function" ? invoiceDiscountMode() : "beforeTax",
    deliveryNote: document.getElementById("inv-delivery-note")?.value.trim() || "",
    paymentTerms: document.getElementById("inv-payment-terms")?.value.trim() || "",
    referenceNo: document.getElementById("inv-reference-no")?.value.trim() || "",
    referenceDate: document.getElementById("inv-reference-date")?.value || "",
    otherReferences: document.getElementById("inv-other-ref")?.value.trim() || "",
    buyerOrderNo: document.getElementById("inv-buyer-order")?.value.trim() || "",
    buyerOrderDate: document.getElementById("inv-buyer-order-date")?.value || "",
    dispatchDocNo: document.getElementById("inv-dispatch-doc")?.value.trim() || "",
    deliveryNoteDate: document.getElementById("inv-delivery-note-date")?.value || "",
    dispatchedThrough: document.getElementById("inv-dispatched-through")?.value.trim() || "",
    destination: document.getElementById("inv-destination")?.value.trim() || "",
    termsOfDelivery: document.getElementById("inv-terms-delivery")?.value.trim() || "",
    ewayBill,
    vehicleNo,
    transporterName,
    transporterId,
    irn,
    ackNo,
    ackDate,
    printTemplate,
    cancelled: false,
    status: balanceDue <= 0.009 ? "PAID" : (amtReceived > 0.009 ? "PARTIAL" : "UNPAID"),
    createdAt: existing?.createdAt || Date.now(),
    edited: !!existing,
    editedAt: existing ? Date.now() : undefined
  };

  if (payload.linkedInvoiceId === undefined) delete payload.linkedInvoiceId;

  if (existing) {
    Object.keys(existing).forEach(k => { if (!(k in payload) && k !== "deletedAt") delete existing[k]; });
    Object.assign(existing, payload);
    if (typeof applyInvoiceEffects === "function") applyInvoiceEffects(existing);
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(existing);
    if (typeof logActivity === "function") logActivity(`Edited ${invoiceNo}`);
    if (gstRecalcNote) {
      const note = isInterstate
        ? `GST recalculated: IGST ${formatINR(igstTotal)} instead of CGST+SGST.`
        : `GST recalculated: CGST ${formatINR(cgstTotal)} + SGST ${formatINR(sgstTotal)} instead of IGST.`;
      showToast(`${docTypeLabelSafe(docType)} ${invoiceNo} updated. ${note}`);
    } else {
      showToast(`${docTypeLabelSafe(docType)} ${invoiceNo} updated.`);
    }
  } else {
    if (docType === "CREDIT_NOTE") {
      if (typeof applyInvoiceEffects === "function") applyInvoiceEffects(payload);
      else {
        if (party) {
          if (party.balType === "PAYABLE") party.balance = (Number(party.balance) || 0) + grandTotal;
          else {
            party.balance = (Number(party.balance) || 0) - grandTotal;
            if (party.balance < -0.001) {
              party.balance = roundMoney(-party.balance);
              party.balType = "PAYABLE";
            } else party.balance = Math.max(0, roundMoney(party.balance));
          }
          const reversePts = typeof pointsEarnedFor === "function" ? pointsEarnedFor(grandTotal) : Math.floor(grandTotal / 100);
          party.loyaltyPoints = Math.max(0, (Number(party.loyaltyPoints) || 0) - reversePts);
        }
        items.forEach(line => adjustStockLine(line, "in"));
      }
      showToast(`Credit Note ${invoiceNo} issued: ${formatINR(grandTotal)} adjusted to ${party?.name || "Cash"}.`);
    } else if (nonPosting) {
      showToast(`${docType === "PROFORMA" ? "Proforma" : "Quotation"} ${invoiceNo} saved. Convert it when the buyer confirms.`);
    } else {
      if (typeof applyInvoiceEffects === "function") applyInvoiceEffects(payload);
      else {
        if (party && balanceDue > 0 && docType !== "DELIVERY_CHALLAN") {
          partyAddReceivable(party, balanceDue);
        }
        items.forEach(line => adjustStockLine(line, "out"));
        if (party && docType !== "DELIVERY_CHALLAN") {
          if (typeof settleLoyaltyOnInvoice === "function") settleLoyaltyOnInvoice(party, payload);
          else party.loyaltyPoints = (party.loyaltyPoints || 0) + Math.floor(grandTotal / 100);
        }
      }
      showToast(`${docType === "DELIVERY_CHALLAN" ? "Delivery Challan" : "Invoice"} ${invoiceNo} generated!`);
    }
    State.invoices.push(payload);
    if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.commitDocNumber) {
      BillSetuDocNumbering.commitDocNumber(
        BillSetuDocNumbering.seriesForDocType(docType),
        invoiceNo,
        payload.date || document.getElementById("inv-date")?.value
      );
    }
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(payload);
    if (typeof logActivity === "function") logActivity(`Saved ${invoiceNo}`);
  }

  if (typeof BillSetuSync !== "undefined" && BillSetuSync.loadSyncConfig) {
    const cfg = BillSetuSync.loadSyncConfig();
    if (cfg.enabled) setTimeout(() => BillSetuSync.runSync("auto"), 400);
  }

  const saved = existing || payload;
  State.editingInvoiceId = null;
  saveToStorage();
  if (saved.accountId && saved.docType !== "ESTIMATE" && saved.docType !== "PROFORMA") {
    const nowOnBill = Number(saved.collectedOnBill != null ? saved.collectedOnBill : saved.amountReceived) || 0;
    if (!prevMoney) {
      if (nowOnBill > 0) moneyToAccountToast(saved.accountId, nowOnBill, "IN");
    } else if (prevMoney.accountId !== saved.accountId) {
      if (nowOnBill > 0) moneyToAccountToast(saved.accountId, nowOnBill, "IN");
    } else {
      const delta = Math.round((nowOnBill - prevMoney.onBill) * 100) / 100;
      if (delta > 0.009) moneyToAccountToast(saved.accountId, delta, "IN");
      else if (delta < -0.009) moneyToAccountToast(saved.accountId, -delta, "OUT");
    }
  }

  setInvoiceModalOpen(false);
  renderDashboard();
  renderSalesTable();

  if (printAfter) {
    openPrintModal(saved.id);
  } else if (existing) {
    if (typeof openInvoiceDetail === "function") openInvoiceDetail(saved.id);
  } else {
    try { showInvoiceCreated(saved); } catch (err) { console.warn(err); }
  }
}

function docTypeLabelSafe(docType) {
  const map = {
    TAX_INVOICE: "Tax Invoice",
    BILL_OF_SUPPLY: "Bill of Supply",
    ESTIMATE: "Quotation",
    PROFORMA: "Proforma",
    CREDIT_NOTE: "Credit Note",
    DELIVERY_CHALLAN: "Delivery Challan"
  };
  return map[docType] || "Invoice";
}

function showInvoiceCreated(inv) {
  const modal = document.getElementById("modal-invoice-created");
  if (!modal || !inv) return;
  modal.dataset.invoiceId = inv.id;
  const partyEl = document.getElementById("created-party");
  const phoneEl = document.getElementById("created-phone");
  const amountEl = document.getElementById("created-amount");
  const statusEl = document.getElementById("created-status");
  if (partyEl) partyEl.textContent = inv.partyName || "Cash sale";
  if (phoneEl) phoneEl.textContent = inv.partyPhone || "";
  if (amountEl) amountEl.textContent = formatINR(inv.grandTotal);
  if (statusEl) {
    const paid = !(Number(inv.balanceDue) > 0);
    statusEl.textContent = paid ? "Paid" : "Unpaid";
    statusEl.className = "badge " + (paid ? "badge-paid" : "badge-unpaid");
  }
  const preview = document.getElementById("created-preview");
  if (preview) {
    State.activeInvoiceForPrint = inv;
    preview.innerHTML = typeof renderInvoiceTemplate === "function" ? renderInvoiceTemplate(inv, "GOLD") : "";
  }
  modal.classList.add("open");
}

function createdInvoiceId() {
  return document.getElementById("modal-invoice-created")?.dataset.invoiceId || "";
}

function closeInvoiceCreated() {
  document.getElementById("modal-invoice-created")?.classList.remove("open");
}

// ----------------------------------------------------
// 4. Print & PDF Preview Templates
// ----------------------------------------------------
function openPrintModal(invoiceId) {
  const inv = State.invoices.find(i => i.id === invoiceId);
  if (!inv) return;
  State.activeInvoiceForPrint = inv;
  // Settings default is the starting template. Per-print overrides apply only for this
  // modal session (or become the new default when "Make default" is ticked).
  if (typeof applyPrintPrefsToUi === "function") {
    applyPrintPrefsToUi(inv.docType || "DEFAULT");
  }
  renderPrintableCanvas();
  document.getElementById("modal-print-preview").classList.add("open");
}

function renderPrintableCanvas() {
  const inv = State.activeInvoiceForPrint;
  if (!inv) return;
  const template = document.getElementById("print-template-select")?.value || "GOLD";
  const container = document.getElementById("printable-invoice-container");
  const thermal = typeof isThermalTemplate === "function" ? isThermalTemplate(template) : template === "THERMAL_80";
  container.classList.toggle("bsf-print", !thermal);
  container.innerHTML = typeof renderInvoiceTemplate === "function"
    ? renderInvoiceTemplate(inv, template)
    : (thermal ? generateThermalSlip(inv) : generateStandardA4Invoice(inv));
  if (typeof renderThemePicker === "function") renderThemePicker();
  if (typeof syncThemeChrome === "function") syncThemeChrome();
}

/**
 * printInvoiceNow — injects clean invoice HTML into #print-root at body level,
 * so @media print shows ONLY the invoice on A4 paper (no modal chrome / clipping).
 */
function printInvoiceNow() {
  if (typeof runPrintAction === "function") {
    runPrintAction("print");
    return;
  }
  const inv = State.activeInvoiceForPrint;
  if (!inv) { window.print(); return; }

  const template = document.getElementById("print-template-select")?.value || "A4_GST";
  const isA4 = template !== "THERMAL_80";

  const invoiceHtml = isA4
    ? generateStandardA4Invoice(inv)
    : generateThermalSlip(inv);

  // Get (or create) the dedicated print root div
  let printRoot = document.getElementById("print-root");
  if (!printRoot) {
    printRoot = document.createElement("div");
    printRoot.id = "print-root";
    document.body.appendChild(printRoot);
  }

  // Inject invoice HTML and mark body so @media print CSS knows what to show
  printRoot.innerHTML = invoiceHtml;
  document.body.classList.add("is-printing");
  // Clear leftover report landscape @page; force A4/thermal portrait for this job.
  if (typeof applyInvoicePrintPageStyle === "function") {
    applyInvoicePrintPageStyle(isA4 ? "a4" : "thermal80");
  } else if (typeof clearReportPrintStyle === "function") {
    clearReportPrintStyle();
  }

  // Give browser 2 full animation frames + a small buffer to layout/paint the new DOM
  // before opening the print dialog (requestAnimationFrame alone is not enough)
  setTimeout(async () => {
    if (typeof setPrintTitle === "function") setPrintTitle(inv.invoiceNo || "Invoice");
    if (window.Capacitor && typeof shareTextNative === "function" && typeof billShareText === "function") {
      const shared = await shareTextNative(`Bill ${inv.invoiceNo}`, billShareText(inv));
      if (!shared) window.print();
    } else {
      window.print();
    }
  }, 300);

  // Clean up after the print dialog closes (works in Chrome, Firefox, Edge)
  const cleanup = () => {
    document.body.classList.remove("is-printing");
    printRoot.innerHTML = "";
    if (typeof clearInvoicePrintPageStyle === "function") clearInvoicePrintPageStyle();
    window.removeEventListener("afterprint", cleanup);
    if (typeof restorePrintTitle === "function") restorePrintTitle();
  };
  window.addEventListener("afterprint", cleanup);
}


function formatInvoiceDate(iso) {
  const parts = String(iso || "").split("-");
  if (parts.length !== 3) return iso || "";
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function formatAmount(val) {
  const num = Number(val) || 0;
  const negative = num < 0;
  const [intPart, decPart] = Math.abs(num).toFixed(2).split(".");
  let lastThree = intPart.slice(-3);
  const other = intPart.slice(0, -3);
  if (other) lastThree = "," + lastThree;
  const grouped = other.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + lastThree;
  return (negative ? "-" : "") + grouped + "." + decPart;
}

function generateStandardA4Invoice(inv) {
  const chunker = typeof chunkWithFooter === "function" ? chunkWithFooter : (items, bodyMax, lastMax) => {
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
  };
  const chunks = chunker(inv.items || [], 14, 6);
  return chunks.map((items, pageIndex) => standardA4Page(inv, items, pageIndex, chunks.length)).join("");
}

function standardA4Page(inv, items, pageIndex, pageCount) {
  const b = (typeof themeBusinessBank === "function") ? themeBusinessBank() : State.business; // 1.13.11: show-on-invoice bank account
  const party = State.parties.find(p => p.id === inv.partyId);
  const partyAddress = inv.partyAddress || party?.address || "";
  const last = pageIndex === pageCount - 1;
  const upiVpa = currentUpiVpa();
  const upiQrSvg = (last && upiVpa) ? generateUPIQR(upiVpa, b.name, inv.grandTotal, inv.invoiceNo) : "";

  let docTitle = "TAX INVOICE";
  let copyLabel = "ORIGINAL FOR RECIPIENT";
  if (inv.docType === "BILL_OF_SUPPLY") docTitle = "BILL OF SUPPLY";
  else if (inv.docType === "ESTIMATE") { docTitle = "ESTIMATE"; copyLabel = "QUOTATION"; }
  else if (inv.docType === "PROFORMA") { docTitle = "PROFORMA INVOICE"; copyLabel = "NOT A TAX INVOICE"; }
  else if (inv.docType === "DELIVERY_CHALLAN") { docTitle = "DELIVERY CHALLAN"; copyLabel = "NOT A TAX INVOICE"; }
  else if (inv.docType === "CREDIT_NOTE") { docTitle = "CREDIT NOTE"; copyLabel = "ORIGINAL FOR RECIPIENT"; }

  const rates = [...new Set((inv.items || []).map(item => Number(item.gstRate) || 0))];
  const halfRate = !inv.isInterstate && rates.length === 1 ? rates[0] / 2 : null;
  const fullRate = inv.isInterstate && rates.length === 1 ? rates[0] : null;
  const gstRows = inv.isInterstate
    ? `<tr><td>IGST${fullRate != null ? ` @${fullRate}%` : ""}</td><td>₹ ${formatAmount(inv.igstTotal)}</td></tr>`
    : `<tr><td>CGST${halfRate != null ? ` @${halfRate}%` : ""}</td><td>₹ ${formatAmount(inv.cgstTotal)}</td></tr>
       <tr><td>SGST${halfRate != null ? ` @${halfRate}%` : ""}</td><td>₹ ${formatAmount(inv.sgstTotal)}</td></tr>`;

  const discount = (typeof billLevelDiscountRupees === "function")
    ? billLevelDiscountRupees(inv)
    : ((Number(inv.billDiscount) || 0) + (Number(inv.loyaltyDiscount) || 0));
  const qtyTotal = (inv.items || []).reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
  const taxTotal = (Number(inv.cgstTotal) || 0) + (Number(inv.sgstTotal) || 0) + (Number(inv.igstTotal) || 0);
  const linePre = (item) => (typeof linePreBillTaxable === "function")
    ? linePreBillTaxable(item)
    : ((Number(item.preBillTaxableVal) != null && item.preBillTaxableVal !== "")
      ? Number(item.preBillTaxableVal) || 0
      : (Number(item.qty) || 0) * (Number(item.rate) || 0) * (1 - (Number(item.discPercent) || 0) / 100));
  const lineTotal = (inv.items || []).reduce((sum, item) => sum + linePre(item), 0);
  const words = convertNumberToWords(inv.grandTotal);

  const extraNotes = [
    inv.ewayBill ? `E-Way Bill: ${inv.ewayBill}` : "",
    inv.vehicleNo ? `Vehicle: ${inv.vehicleNo}` : "",
    inv.transporterName ? `Transporter: ${inv.transporterName}` : "",
    inv.irn ? `IRN: ${inv.irn}` : "",
    inv.godownId && typeof godownName === "function" ? `Godown: ${godownName(inv.godownId)}` : ""
  ].filter(Boolean).join(" · ");

  const startIndex = (inv.items || []).indexOf(items[0]);
  const rows = items.map((item, idx) => {
    const tax = (Number(item.cgstVal ?? item.cgstAmt) || 0) + (Number(item.sgstVal ?? item.sgstAmt) || 0) + (Number(item.igstVal ?? item.igstAmt) || 0);
    const unitRate = Number(item.rate) || 0;
    const serials = item.serials || [];
    return `<tr>
      <td>${startIndex + idx + 1}</td>
      <td>
        <div>${escHtml(item.description)}</div>
        ${[item.brand, item.model].filter(Boolean).length ? `<div class="bsf-serial">${escHtml([item.brand, item.model].filter(Boolean).join(" · "))}</div>` : ""}
        ${item.warrantyMonths ? `<div class="bsf-serial">Warranty ${escHtml(String(item.warrantyMonths))} months</div>` : ""}
        ${serials.length ? `<div class="bsf-serial">Serial No:<br>${serials.map(code => escHtml(code)).join("<br>")}</div>` : ""}
        ${item.batchExp ? `<div class="bsf-serial">Batch: ${escHtml(item.batchExp)}</div>` : ""}
        ${typeof customFieldsPrintHtml === "function" ? customFieldsPrintHtml(item) : ""}
      </td>
      <td>${escHtml(item.hsn || "")}</td>
      <td>${escHtml(String(item.qty))} ${escHtml(item.unit || "")}</td>
      <td class="c-rate">${formatAmount(unitRate)}</td>
      <td class="c-tax">${formatAmount(tax)}<div class="bsf-tax-rate">(${escHtml(String(item.gstRate || 0))}%)</div></td>
      <td class="c-total">${formatAmount(linePre(item))}</td>
    </tr>`;
  }).join("");

  const header = pageIndex === 0 ? `
      <table class="bsf-head">
        <tr>
          <td>
            <div style="display:flex;gap:10px;align-items:center;justify-content:center;">
              ${typeof logoMarkHtml === "function" ? logoMarkHtml(48) : ""}
              ${String(b.name || "").trim() ? `<h1>${escHtml(b.name)}</h1>` : ""}
            </div>
            ${b.gstin ? `<div class="bsf-center">GSTIN <strong>${escHtml(b.gstin)}</strong></div>` : ""}
            ${b.phone || b.email ? `<div class="bsf-center">${[b.phone, b.email].filter(Boolean).map(escHtml).join(" · ")}</div>` : ""}
            ${b.address ? `<div class="bsf-center">${escHtml(b.address)}</div>` : ""}
          </td>
          <td class="bsf-doc">
            <div class="bsf-doc-title">${escHtml(docTitle)}</div>
            <div class="bsf-doc-copy">${escHtml(copyLabel)}</div>
          </td>
        </tr>
      </table>
      <table class="bsf-meta">
        <tr>
          <td><div class="label">Invoice No.</div><div>${escHtml(inv.invoiceNo || "")}</div></td>
          <td><div class="label">Invoice Date</div><div>${escHtml(formatInvoiceDate(inv.date))}</div></td>
        </tr>
      </table>
      <table class="bsf-parties">
        <tr>
          <td>
            <h3>Bill To</h3>
            <div class="party-name">${escHtml(inv.partyName || "")}</div>
            <div>${escHtml(partyAddress)}</div>
            ${inv.partyGstin ? `<div>GSTIN ${escHtml(inv.partyGstin)}</div>` : ""}
            <div><span class="label">Mobile</span> ${escHtml(inv.partyPhone || party?.phone || "")}</div>
            <div><span class="label">Place of Supply</span> ${escHtml(inv.posStateName || "")}</div>
          </td>
          <td>
            <h3>Ship To</h3>
            <div class="party-name">${escHtml(inv.shipName || inv.partyName || "")}</div>
            <div>${escHtml(inv.shipAddress || partyAddress)}</div>
          </td>
        </tr>
      </table>
      ${extraNotes ? `<div class="bsf-extra">${escHtml(extraNotes)}</div>` : ""}`
    : `<div class="bsf-continued-banner"><strong>${escHtml(b.name || "")}</strong> · ${escHtml(inv.invoiceNo || "")} · Continued</div>`;

  const foot = last ? `
      <table class="bsf-foot">
        <tr>
          <td>
            <h3>Terms &amp; Conditions</h3>
            <pre class="bsf-terms">${escHtml(b.terms || "")}</pre>
            <h3>Bank Details</h3>
            <table class="bsf-bank">
              <tr><td>Name</td><td>${escHtml(b.name)}</td></tr>
              <tr><td>IFSC</td><td>${escHtml(b.bankIfsc || "")}</td></tr>
              <tr><td>Account No</td><td>${escHtml(b.bankAcc || "")}</td></tr>
              <tr><td>Bank Name</td><td>${escHtml([b.bankName, b.bankBranch].filter(Boolean).join(", "))}</td></tr>
            </table>
          </td>
          <td>
            <table class="bsf-sum">
              <tr><td>Subtotal</td><td>₹ ${formatAmount(lineTotal)}</td></tr>
              ${discount ? `<tr><td>Less: Discount</td><td>- ₹ ${formatAmount(discount)}</td></tr>` : ""}
              <tr><td>Taxable Amount</td><td>₹ ${formatAmount(inv.taxableTotal)}</td></tr>
              ${gstRows}
              ${Math.abs(Number(inv.roundOff) || 0) >= 0.01 ? `<tr><td>Round Off</td><td>${Number(inv.roundOff) > 0 ? "" : "- "}₹ ${formatAmount(Math.abs(inv.roundOff))}</td></tr>` : ""}
              <tr class="grand"><td>Total Amount</td><td>₹ ${formatAmount(inv.grandTotal)}</td></tr>
              <tr><td>Received Amount</td><td>₹ ${formatAmount(inv.amountReceived)}</td></tr>
              <tr class="balance"><td>Balance</td><td>₹ ${formatAmount(inv.balanceDue)}</td></tr>
            </table>
            <div class="bsf-words">
              <div class="label">Total Amount (in words)</div>
              <div>${escHtml(words)}</div>
            </div>
            ${taxTotal > 0.0001 ? `<div class="bsf-words">
              <div class="label">Tax Amount (in words)</div>
              <div>${escHtml((typeof amountInWords === "function" ? amountInWords(taxTotal) : (typeof convertNumberToWords === "function" ? convertNumberToWords(taxTotal) : "")))}</div>
            </div>` : ""}
          </td>
        </tr>
        <tr class="bsf-end">
          <td>
            ${upiQrSvg ? `<div class="bsf-qr">
              <div class="label">Payment QR Code</div>
              ${upiQrSvg}
              <div>UPI ID: ${escHtml(upiVpa)}</div>
            </div>` : ""}
          </td>
          <td>
            <div class="bsf-sign">
              <div class="label">Signature</div>
              <div class="sign-gap"></div>
              <div>${escHtml(b.name)}</div>
            </div>
          </td>
        </tr>
      </table>` : `
      <div class="carry-foot">Continued on next page</div>`;

  return `
    <div class="bsf-sheet sheet-page sheet-a4" style="background:#ffffff" data-width-mm="210" data-height-mm="297">
      ${header}
      <div class="bsf-items">
        <table class="bsf-table">
          <colgroup>
            <col class="c-no"><col><col class="c-hsn"><col class="c-qty"><col class="c-rate"><col class="c-tax"><col class="c-total">
          </colgroup>
          <thead>
            <tr>
              <th class="c-no">No</th>
              <th>Items</th>
              <th class="c-hsn">HSN No.</th>
              <th class="c-qty">Qty.</th>
              <th class="c-rate">Rate</th>
              <th class="c-tax">Tax</th>
              <th class="c-total">Total</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            ${last ? `<tr class="bsf-fill" aria-hidden="true"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>
            <tr class="bsf-subtotal">
              <td></td>
              <td>SUBTOTAL</td>
              <td></td>
              <td>${qtyTotal}</td>
              <td></td>
              <td class="c-tax">₹ ${formatAmount(taxTotal)}</td>
              <td class="c-total">₹ ${formatAmount(lineTotal)}</td>
            </tr>` : `<tr class="bsf-fill" aria-hidden="true"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>`}
          </tbody>
        </table>
        ${foot}
      </div>
    </div>
  `;
}

function generateThermalSlip(inv) {
  const b = State.business;
  const title = typeof docHeading === "function" ? docHeading(inv) : (inv.docType === "CREDIT_NOTE" ? "CREDIT NOTE" : "RETAIL CASH MEMO");
  const logo = typeof safeImageUrl === "function" ? safeImageUrl(b.logo) : "";
  const words = convertNumberToWords(inv.grandTotal);
  const taxAmt = (Number(inv.cgstTotal) || 0) + (Number(inv.sgstTotal) || 0) + (Number(inv.igstTotal) || 0);
  const taxWords = taxAmt > 0.0001
    ? (typeof amountInWords === "function" ? amountInWords(taxAmt) : convertNumberToWords(taxAmt))
    : "";
  return `
    <div class="thermal-slip">
      <div class="slip-header">
        ${logo ? `<img class="slip-logo" src="${logo}" alt="">` : ""}
        ${String(b.name || "").trim() ? `<h3 style="margin:0;font-size:14px;">${escHtml(b.name)}</h3>` : ""}
        ${b.address ? `<div>${escHtml(b.address)}</div>` : ""}
        ${b.gstin || b.phone ? `<div>${[b.gstin ? `GSTIN: ${escHtml(b.gstin)}` : "", b.phone ? `Ph: ${escHtml(b.phone)}` : ""].filter(Boolean).join(" | ")}</div>` : ""}
        <div style="margin-top:4px;font-weight:700;">${escHtml(title)}</div>
      </div>
      <div class="slip-row">
        <span>Bill #: ${escHtml(inv.invoiceNo || "")}</span>
        <span>Date: ${escHtml(formatInvoiceDate(inv.date))}</span>
      </div>
      <div class="slip-row" style="border-bottom:1px dashed #000;padding-bottom:4px;margin-bottom:6px;">
        <span>Customer: ${escHtml(inv.partyName || "")}</span>
      </div>
      <table style="width:100%;font-size:10px;margin-bottom:6px;">
        <thead>
          <tr style="border-bottom:1px solid #000;">
            <th align="left">Item</th>
            <th align="center">Qty</th>
            <th align="right">Rate</th>
            <th align="right">Total</th>
          </tr>
        </thead>
        <tbody>
          ${(inv.items || []).map(i => {
            const amt = (typeof linePreBillTaxable === "function") ? linePreBillTaxable(i)
              : ((Number(i.preBillTaxableVal) != null && i.preBillTaxableVal !== "") ? Number(i.preBillTaxableVal) : Number(i.total) || 0);
            return `
            <tr>
              <td>${escHtml(String(i.description || "").substring(0, 24))}</td>
              <td align="center">${escHtml(String(i.qty))}</td>
              <td align="right">${escHtml(String(i.rate))}</td>
              <td align="right">${formatINR(amt)}</td>
            </tr>`;
          }).join("")}
        </tbody>
      </table>
      <div style="border-top:1px dashed #000;padding-top:4px;">
        ${((Number(inv.billDiscount)||0)+(Number(inv.loyaltyDiscount)||0)) ? `<div class="slip-row"><span>Less: Discount:</span><span>-${formatINR((Number(inv.billDiscount)||0)+(Number(inv.loyaltyDiscount)||0))}</span></div>` : ""}
        <div class="slip-row"><span>Taxable:</span><span>${formatINR(inv.taxableTotal)}</span></div>
        <div class="slip-row"><span>GST (${inv.isInterstate ? "IGST" : "CGST+SGST"}):</span><span>${formatINR(inv.isInterstate ? inv.igstTotal : ((inv.cgstTotal || 0) + (inv.sgstTotal || 0)))}</span></div>
        ${Math.abs(Number(inv.roundOff) || 0) >= 0.005 ? `<div class="slip-row"><span>Round off:</span><span>${formatINR(inv.roundOff)}</span></div>` : `<div class="slip-row"><span>Round off:</span><span>${formatINR(0)}</span></div>`}
        <div class="slip-row" style="font-size:13px;font-weight:800;border-top:1px solid #000;padding-top:2px;"><span>TOTAL:</span><span>${formatINR(inv.grandTotal)}</span></div>
        <div class="slip-words" style="font-size:10px;margin-top:4px;">${escHtml(words)}</div>
        ${taxWords ? `<div class="slip-words" style="font-size:10px;">Tax: ${escHtml(taxWords)}</div>` : ""}
        <div class="slip-row"><span>Paid Via ${escHtml(inv.paymentMode || "")}:</span><span>${formatINR(inv.amountReceived)}</span></div>
      </div>
      <div style="text-align:center;margin-top:10px;font-size:9px;">
        <div>*** Thank You Visit Again ***</div>
        ${currentUpiVpa() ? `<div>UPI: ${escHtml(currentUpiVpa())}</div>` : ""}
      </div>
    </div>
  `;
}

function shareWhatsAppInvoice(invoiceId) {
  const inv = State.invoices.find(i => i.id === invoiceId);
  if (!inv) return;

  const phone = (inv.partyPhone || "").replace(/\D/g, '');
  const itemsText = inv.items.map(i => `• ${i.description} (Qty: ${i.qty}) - ₹${i.total.toFixed(2)}`).join("\n");
  const text = `Namaste ${inv.partyName},\nHere is your Tax Invoice${bizName() ? ` from *${bizName()}*` : ""}:\n\n*Invoice #:* ${inv.invoiceNo}\n*Date:* ${inv.date}\n*Total Amount:* ₹${inv.grandTotal}\n*Paid:* ₹${inv.amountReceived}\n*Balance Due:* ₹${inv.balanceDue}\n\n*Items:*\n${itemsText}\n\n${paymentInstructionText({ lead: "You can pay directly" }) ? paymentInstructionText({ lead: "You can pay directly" }) + "\n" : ""}Thank you for doing business with us!`;

  const encoded = encodeURIComponent(text);
  const waUrl = phone ? `https://wa.me/91${phone}?text=${encoded}` : `https://api.whatsapp.com/send?text=${encoded}`;
  window.open(waUrl, '_blank');
}

// ----------------------------------------------------
// 5. Parties & Khata Ledger Logic
// ----------------------------------------------------
function renderParties() {
  const directory = document.getElementById("parties-directory");
  const searchTerm = (document.getElementById("party-search-input").value || "").toLowerCase();
  const filterType = document.querySelector("#party-type-filter .active").getAttribute("data-filter");

  const filtered = State.parties.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(searchTerm) ||
      p.phone.includes(searchTerm) ||
      (p.address && p.address.toLowerCase().includes(searchTerm));
    const matchesType = filterType === "ALL" || p.type === filterType;
    return matchesSearch && matchesType;
  });

  if (filtered.length === 0) {
    directory.innerHTML = `<div class="empty-state-message">No parties found</div>`;
    return;
  }

  directory.innerHTML = filtered.map(p => {
    let balClass = "zero";
    let balLabel = "Settled";
    if (p.balance > 0) {
      balClass = p.balType === "RECEIVABLE" ? "receive" : "pay";
      balLabel = p.balType === "RECEIVABLE" ? "To Receive" : "To Pay";
    }

    return `
      <div class="party-item-card ${State.selectedPartyId === p.id ? 'active' : ''}" onclick="selectParty('${p.id}')">
        <div>
          <div class="party-name-h">${escHtml(p.name)}</div>
          <div class="party-phone-s">${escHtml(p.phone || "")}${p.stateName ? ` · ${escHtml(p.stateName)}` : ""}</div>
        </div>
        <div class="party-bal-badge">
          <div class="party-bal-amount ${balClass}">${formatINR(p.balance)}</div>
          <span class="text-xs text-muted">${balLabel}</span>
        </div>
      </div>
    `;
  }).join("");

  const phoneList = window.matchMedia("(max-width: 800px)").matches;
  if (!phoneList && !State.selectedPartyId && filtered.length > 0) selectParty(filtered[0].id);
}

function closePartyDetail() {
  document.body.classList.remove("party-detail-open");
  if (typeof syncAppBar === "function") syncAppBar(State.currentView || "parties");
}

/** 1.13.6 (S1): one party statement used by the Transactions table, print / PDF and share.
 *  Signed amounts: positive = the party owes us (Dr), negative = we owe the party (Cr).
 *  Opening + Dr - Cr always equals the closing balance; for the full range that is the
 *  party balance. The opening is the party balance less every recorded transaction, so a
 *  receipt that settled a bill is never added back (only its real effect is removed once). */
function partyStatementEvents(party) {
  const events = [];
  const round = v => Math.round((Number(v) || 0) * 100) / 100;
  const cancelled = d => !!d && (d.cancelled || String(d.status || "").toUpperCase() === "CANCELLED");
  let seq = 0;
  const push = ev => { ev.seq = seq++; if (ev.dr || ev.cr) events.push(ev); };
  (State.invoices || []).forEach(inv => {
    if (!inv || inv.partyId !== party.id || inv.deletedAt || cancelled(inv)) return;
    if (inv.docType === "CREDIT_NOTE") {
      push({ date: inv.date, created: inv.createdAt, kind: "credit-note", label: "Credit Note:", ref: inv.invoiceNo, invoiceId: inv.id, dr: 0, cr: round(inv.grandTotal) });
      return;
    }
    if (!isPostedSale(inv)) return;
    push({ date: inv.date, created: inv.createdAt, kind: "sale", label: "Sale Bill:", ref: inv.invoiceNo, invoiceId: inv.id, dr: round(inv.grandTotal), cr: 0,
      note: (Number(inv.balanceDue) || 0) > 0.009 ? `(${formatINR(inv.balanceDue)} due)` : "(paid)" });
    const onBill = round(Math.min(invoiceCollectedOnBill(inv), Number(inv.grandTotal) || 0));
    if (onBill > 0) push({ date: inv.date, created: inv.createdAt, kind: "on-bill-receipt", label: `Receipt on bill: ${inv.paymentMode || "CASH"}`, ref: inv.invoiceNo, dr: 0, cr: onBill });
  });
  (State.purchases || []).forEach(pur => {
    if (!pur || pur.supplierId !== party.id || pur.deletedAt || cancelled(pur)) return;
    const total = round(pur.totalBill);
    push({ date: pur.date, created: pur.createdAt, kind: "purchase", label: "Purchase Bill:", ref: pur.billNo || pur.purchaseNo, dr: 0, cr: total,
      note: (Number(pur.balanceDue) || 0) > 0.009 ? `(${formatINR(pur.balanceDue)} due)` : "(paid)" });
    const paid = round(Math.min(purchasePaidOnBill(pur), total));
    if (paid > 0) push({ date: pur.date, created: pur.createdAt, kind: "on-bill-payment", label: `Paid on bill: ${pur.paymentMode || "BANK"}`, ref: pur.billNo || pur.purchaseNo, dr: paid, cr: 0 });
  });
  (State.debitNotes || []).forEach(dn => {
    if (!dn || dn.supplierId !== party.id || dn.deletedAt || cancelled(dn)) return;
    push({ date: dn.date, created: dn.createdAt, kind: "debit-note", label: "Debit Note:", ref: dn.noteNo, dr: round(dn.total), cr: 0 });
  });
  (State.payments || []).forEach(pay => {
    if (!pay || pay.partyId !== party.id || pay.deletedAt) return;
    const amt = round(pay.amount);
    const applied = receiptAppliedToBills(pay);
    const rest = round(amt - applied);
    const note = applied > 0.009 && rest > 0.009
      ? `(${formatINR(applied)} to bills, ${formatINR(rest)} on account)`
      : (applied > 0.009 ? "(to bills)" : "(on account)");
    if (pay.direction === "OUT") push({ date: pay.date, created: pay.createdAt, kind: "payment", label: "Payment", ref: pay.receiptNo || "", note, dr: amt, cr: 0, paymentId: pay.id });
    else if (pay.direction === "LOYALTY") push({ date: pay.date, created: pay.createdAt, kind: "loyalty", label: "Loyalty redeemed", ref: pay.receiptNo || "", dr: 0, cr: amt, paymentId: pay.id });
    else push({ date: pay.date, created: pay.createdAt, kind: "receipt", label: "Receipt", ref: pay.receiptNo || "", note, dr: 0, cr: amt, paymentId: pay.id });
  });
  // 1.13.7: same-day rows follow entry time (createdAt is a number or an ISO string).
  const ts = v => typeof v === "number" ? v : (Date.parse(v) || 0);
  events.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || (ts(a.created) - ts(b.created)) || a.seq - b.seq);
  return events;
}

function partyStatement(partyOrId, opts) {
  const party = typeof partyOrId === "object" ? partyOrId : (State.parties || []).find(p => p.id === partyOrId);
  if (!party) return null;
  const round = v => Math.round((Number(v) || 0) * 100) / 100;
  const from = (opts && opts.from) || "";
  let to = (opts && opts.to) || "";
  if (from && to && to < from) to = from;
  const signedNow = round(party.balType === "PAYABLE" ? -(Number(party.balance) || 0) : (Number(party.balance) || 0));
  const events = partyStatementEvents(party);
  const net = events.reduce((s, e) => s + e.dr - e.cr, 0);
  const baseOpening = round(signedNow - net);
  // 1.13.7 dev check: a party entered with an opening balance should derive the same opening.
  if (party.openingSigned != null && Math.abs(baseOpening - Number(party.openingSigned)) > 0.009 && lbDevChecksOn()) {
    const w = { partyId: party.id, partyName: party.name, entered: Number(party.openingSigned), derived: baseOpening };
    (window.__lbStatementWarnings = window.__lbStatementWarnings || []).push(w);
    try { console.warn("[ledgerbay dev] statement opening differs from the entered opening", w); } catch (_) {}
  }
  let opening = baseOpening;
  events.forEach(e => { if (from && String(e.date || "") < from) opening += e.dr - e.cr; });
  opening = round(opening);
  let running = opening, totalDr = 0, totalCr = 0;
  const rows = [];
  events.forEach(e => {
    const d = String(e.date || "");
    if (from && d < from) return;
    if (to && d > to) return;
    running = round(running + e.dr - e.cr);
    totalDr += e.dr; totalCr += e.cr;
    rows.push({ ...e, balance: running });
  });
  totalDr = round(totalDr); totalCr = round(totalCr);
  const closing = round(opening + totalDr - totalCr);
  const periodLabel = from || to
    ? `Period: ${from || "start"} to ${to || "today"}`
    : "Period: all transactions";
  return { partyId: party.id, partyName: party.name, from, to, baseOpening, opening, rows, totalDr, totalCr, closing, balance: signedNow, periodLabel };
}
window.partyStatement = partyStatement;

/** Plain-text statement for Share; built from the same rows as the table and print. */
function partyStatementText(stmt) {
  if (!stmt) return "";
  const drCr = v => `${formatINR(Math.abs(v))} ${v < -0.004 ? "Cr" : "Dr"}`;
  const lines = [
    `Statement of account: ${stmt.partyName}`,
    ...(bizName() ? [`From *${bizName()}*`] : []),
    stmt.periodLabel,
    "",
    `Opening Balance: ${drCr(stmt.opening)}`
  ];
  stmt.rows.forEach(r => {
    lines.push(`${r.date} ${r.label}${r.ref ? " " + r.ref : ""} | ${r.dr ? "Dr " + formatINR(r.dr) : "Cr " + formatINR(r.cr)} | Bal ${drCr(r.balance)}`);
  });
  lines.push("", `Total Dr: ${formatINR(stmt.totalDr)}`, `Total Cr: ${formatINR(stmt.totalCr)}`, `Closing Balance: ${drCr(stmt.closing)}`);
  return lines.join("\n");
}
window.partyStatementText = partyStatementText;

function selectParty(partyId) {
  State.selectedPartyId = partyId;
  const party = State.parties.find(p => p.id === partyId);
  if (!party) return;

  // Highlight card
  document.querySelectorAll(".party-item-card").forEach(el => el.classList.remove("active"));

  document.getElementById("party-none-selected").classList.add("d-none");
  document.getElementById("party-ledger-content").classList.remove("d-none");
  if (typeof setPartyTab === "function") setPartyTab("tx");
  document.getElementById("party-lead-name").textContent = party.name;
  if (window.matchMedia("(max-width: 800px)").matches) {
    document.body.classList.add("party-detail-open");
    if (typeof syncAppBar === "function") syncAppBar("parties");
  }
  document.getElementById("party-lead-type").textContent = party.type === "CUSTOMER" ? "Customer" : "Supplier";
  document.getElementById("party-lead-phone").textContent = `📞 ${party.phone}`;
  document.getElementById("party-lead-gstin").textContent = party.gstin ? `GSTIN: ${party.gstin}` : `Unregistered Party`;
  const extra = document.getElementById("party-lead-extra");
  if (extra) {
    const limit = Number(party.creditLimit) || 0;
    extra.textContent = `Loyalty ${party.loyaltyPoints || 0} pts${limit ? ` · Limit ${formatINR(limit)}` : ""}`;
  }
  const payLabel = document.getElementById("pay-btn-label");
  if (payLabel) payLabel.textContent = party.balType === "PAYABLE" ? "Payment Made" : "Receive Payment";

  const balEl = document.getElementById("party-lead-balance");
  const balLabel = document.getElementById("party-lead-status-label");
  balEl.textContent = formatINR(party.balance);

  if (party.balance === 0) {
    balEl.className = "";
    balLabel.textContent = "All dues settled";
  } else if (party.balType === "RECEIVABLE") {
    balEl.className = "balance-positive text-amber";
    balLabel.textContent = "You will receive from party";
  } else {
    balEl.className = "balance-negative text-red";
    balLabel.textContent = "You need to pay to supplier";
  }

  // Find party invoices & payments for statement
  const partyInvoices = State.invoices.filter(i => i.partyId === party.id);
  const ledgerTbody = document.getElementById("party-transactions-list");

  const fromEl = document.getElementById("party-stmt-from");
  const toEl = document.getElementById("party-stmt-to");
  if (State._stmtPartyId !== party.id) {
    // A new party starts with the full statement.
    if (fromEl) fromEl.value = "";
    if (toEl) toEl.value = "";
    State._stmtPartyId = party.id;
  }
  const stmt = partyStatement(party.id, { from: fromEl?.value || "", to: toEl?.value || "" });
  const periodEl = document.getElementById("party-stmt-period");
  if (periodEl) periodEl.textContent = stmt.periodLabel;
  const drCr = v => `${formatINR(Math.abs(v))} ${v < -0.004 ? "Cr" : "Dr"}`;
  let rowsHtml = `
    <tr class="stmt-opening">
      <td>${escHtml(stmt.from || "Opening")}</td>
      <td>Opening Balance</td>
      <td>${stmt.opening > 0.004 ? formatINR(stmt.opening) : "-"}</td>
      <td>${stmt.opening < -0.004 ? formatINR(-stmt.opening) : "-"}</td>
      <td><strong>${drCr(stmt.opening)}</strong></td>
    </tr>
  `;
  stmt.rows.forEach(row => {
    const open = row.invoiceId ? ` class="inv-row stmt-row" data-invoice-id="${escHtml(row.invoiceId)}" onclick="openInvoiceDetailFromRow(event)" title="Open bill detail"` : ` class="stmt-row"`;
    rowsHtml += `
      <tr${open} data-kind="${escHtml(row.kind)}">
        <td>${escHtml(row.date || "")}</td>
        <td>${escHtml(row.label)}${row.ref ? ` <strong>${escHtml(row.ref)}</strong>` : ""}${row.note ? ` <span class="text-muted text-xs">${escHtml(row.note)}</span>` : ""}</td>
        <td>${row.dr ? formatINR(row.dr) : "-"}</td>
        <td>${row.cr ? formatINR(row.cr) : "-"}</td>
        <td><strong>${drCr(row.balance)}</strong></td>
      </tr>
    `;
  });
  rowsHtml += `
    <tr class="stmt-total">
      <td></td>
      <td><strong>Total</strong></td>
      <td><strong>${formatINR(stmt.totalDr)}</strong></td>
      <td><strong>${formatINR(stmt.totalCr)}</strong></td>
      <td></td>
    </tr>
    <tr class="stmt-closing">
      <td>${escHtml(stmt.to || "")}</td>
      <td><strong>Closing Balance</strong></td>
      <td></td>
      <td></td>
      <td><strong>${drCr(stmt.closing)}</strong></td>
    </tr>
  `;

  ledgerTbody.innerHTML = rowsHtml;
  if (typeof renderPartyLoyalty === "function") renderPartyLoyalty(party);
}

function bindPartyGstinField() {
  if (typeof BillSetuGstin === "undefined") return null;
  return BillSetuGstin.bindGstinField(document.getElementById("party-input-gstin"), {
    stateSelect: document.getElementById("party-input-state"),
    hintEl: document.getElementById("party-gstin-hint")
  });
}

/** Fill the party form: blank for a new party, prefilled for edit. */
function fillPartyForm(party) {
  const val = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  const type = party ? party.type : "CUSTOMER";
  const radio = document.querySelector(`input[name="party-type-radio"][value="${type === "SUPPLIER" ? "SUPPLIER" : "CUSTOMER"}"]`);
  if (radio) radio.checked = true;
  val("party-input-name", party ? party.name || "" : "");
  val("party-input-phone", party ? party.phone || "" : "");
  val("party-input-email", party ? party.email || "" : "");
  val("party-input-gstin", party ? party.gstin || "" : "");
  val("party-input-address", party ? party.address || "" : "");
  val("party-input-balance", party ? (Number(party.balance) || 0) : "0.00");
  val("party-input-bal-type", party ? (party.balType || "RECEIVABLE") : "RECEIVABLE");
  val("party-input-credit-limit", party ? (Number(party.creditLimit) || 0) : 0);
  // Balance comes from bills and payments once a party exists, so it is read-only on edit.
  ["party-input-balance", "party-input-bal-type"].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.disabled = !!party; el.title = party ? "The balance changes through bills and payments." : ""; }
  });
  const stateSel = document.getElementById("party-input-state");
  if (typeof BillSetuGstin !== "undefined") {
    const code = party ? partyStateCode(party) : businessStateCode();
    BillSetuGstin.populateStateSelect(stateSel, code || "");
  }
  if (stateSel) stateSel.dataset.userTouched = party ? "1" : "";
  const hint = document.getElementById("party-gstin-hint");
  if (hint) { hint.textContent = ""; hint.className = "gstin-hint text-xs"; }
  const run = bindPartyGstinField();
  if (run && party && party.gstin) run(false); // shows a mismatch warning straight away if any
}

function openAddPartyModal() {
  State.editingPartyId = null;
  const title = document.getElementById("party-modal-title");
  if (title) title.textContent = "Add New Party";
  fillPartyForm(null);
  document.getElementById("modal-party").classList.add("open");
}

function openEditPartyModal(partyId) {
  if (typeof blockedAction === "function" && blockedAction("party")) return;
  const party = State.parties.find(p => p.id === (partyId || State.selectedPartyId));
  if (!party) return;
  State.editingPartyId = party.id;
  const title = document.getElementById("party-modal-title");
  if (title) title.textContent = `Edit Party · ${party.name}`;
  fillPartyForm(party);
  document.getElementById("modal-party").classList.add("open");
}
window.openEditPartyModal = openEditPartyModal;

const USAGE_LABELS = {
  invoices: ["sales invoice / note", "sales invoices / notes"], purchases: ["purchase bill", "purchase bills"], payments: ["payment / receipt", "payments / receipts"],
  purchaseOrders: ["purchase order", "purchase orders"], salesOrders: ["sales order", "sales orders"], quotations: ["quotation", "quotations"], estimates: ["estimate", "estimates"],
  deliveryChallans: ["delivery challan", "delivery challans"], creditNotes: ["credit note", "credit notes"], debitNotes: ["debit note", "debit notes"],
  recurringBills: ["recurring bill", "recurring bills"], expenses: ["expense", "expenses"], stockTransfers: ["stock transfer", "stock transfers"],
  loyaltyLedger: ["loyalty entry", "loyalty entries"], vouchers: ["ledger entry", "ledger entries"], stockAdjustments: ["stock adjustment", "stock adjustments"]
};
const USAGE_SKIP = new Set(["parties", "items", "activityLog", "posCart", "itemSerialDraft", "invoiceDraftItems", "staff", "godowns", "customFieldDefs", "bankAccounts"]);

/** Where is a party / item used? Returns [{ key, label, count }] (empty = unused). */
function findRecordUsage(kind, id) {
  const hits = {};
  const add = key => { hits[key] = (hits[key] || 0) + 1; };
  const lineUses = rec => ["items", "lines", "rows"].some(k => Array.isArray(rec[k]) && rec[k].some(l => l && (l.itemId === id || l.id === id && kind === "item")));
  const uses = rec => {
    if (!rec || typeof rec !== "object") return false;
    if (kind === "party") return rec.partyId === id || rec.supplierId === id || rec.customerId === id;
    return rec.itemId === id || lineUses(rec);
  };
  Object.keys(State).forEach(key => {
    if (USAGE_SKIP.has(key) || key.startsWith("_")) return;
    const list = State[key];
    if (!Array.isArray(list)) return;
    list.forEach(rec => { if (uses(rec)) add(key); });
  });
  if (kind === "party") {
    const ledgerIds = new Set(((State.accounts && State.accounts.ledgers) || []).filter(l => l.partyId === id).map(l => l.id));
    ledgerIds.add("l-party-" + id);
    ((State.accounts && State.accounts.vouchers) || []).forEach(v => {
      if ((v.lines || []).some(l => ledgerIds.has(l.ledgerId))) add("vouchers");
    });
  }
  return Object.entries(hits).map(([key, count]) => { const l = USAGE_LABELS[key] || [key, key]; return { key, label: count === 1 ? l[0] : l[1], count }; });
}
window.findRecordUsage = findRecordUsage;

function usageSentence(usage) {
  return usage.map(u => `${u.count} ${u.label}`).join(", ");
}

function deleteParty(partyId) {
  if (typeof blockedAction === "function" && blockedAction("party")) return;
  const party = State.parties.find(p => p.id === (partyId || State.selectedPartyId));
  if (!party) return;
  const usage = findRecordUsage("party", party.id);
  const balance = Number(party.balance) || 0;
  if (usage.length || Math.abs(balance) >= 0.005) {
    const why = usage.length
      ? `${party.name} is used in ${usageSentence(usage)}.`
      : `${party.name} still has a balance of ${formatINR(Math.abs(balance))}.`;
    const msg = `${why} Parties with transactions or a balance can't be deleted, so your books and GST returns stay complete. You can still edit the name, phone, GSTIN and state.`;
    showToast(msg, "error", { ttlMs: 9000 });
    return { blocked: true, usage, message: msg };
  }
  if (!confirm(`Delete party "${party.name}"? This cannot be undone.`)) return { cancelled: true };
  if (typeof BillSetuSync !== "undefined" && typeof BillSetuSync.softDelete === "function") BillSetuSync.softDelete("parties", party.id);
  State.parties = State.parties.filter(p => p.id !== party.id);
  const led = (State.accounts && State.accounts.ledgers || []).find(l => l.partyId === party.id);
  if (led) { led.inactive = true; if (typeof stamp === "function") stamp(led); else led.updatedAt = new Date().toISOString(); }
  if (State.selectedPartyId === party.id) State.selectedPartyId = null;
  if (typeof logActivity === "function") logActivity(`Deleted party ${party.name}`);
  saveToStorage();
  document.getElementById("party-ledger-content")?.classList.add("d-none");
  document.getElementById("party-none-selected")?.classList.remove("d-none");
  document.body.classList.remove("party-detail-open");
  showToast(`Party ${party.name} deleted.`);
  renderParties();
  return { deleted: true };
}
window.deleteParty = deleteParty;

function saveNewParty() {
  if (typeof blockedAction === "function" && blockedAction("party")) return;
  const name = document.getElementById("party-input-name").value.trim();
  const phone = document.getElementById("party-input-phone").value.trim();
  if (!name || !phone) {
    showToast("Party Name and Phone are required", "error");
    return;
  }

  const gstinRaw = document.getElementById("party-input-gstin").value.trim().toUpperCase();
  let gstin = gstinRaw;
  if (gstin) {
    const v = (typeof BillSetuGstin !== "undefined")
      ? BillSetuGstin.validateGstin(gstin)
      : { ok: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin), message: "That GSTIN is not valid.", gstin };
    if (!v.ok) {
      showToast(v.message || "That GSTIN is not valid.", "error");
      return;
    }
    gstin = v.gstin || gstin;
  }
  const G = typeof BillSetuGstin !== "undefined" ? BillSetuGstin : null;
  let stateCode = normStateCode(document.getElementById("party-input-state").value);
  if (!stateCode && gstin && G) stateCode = G.gstinStateCode(gstin); // auto-fill from the GSTIN prefix
  const stateName = (G && G.stateName(stateCode)) || "";
  // Non-blocking: a GSTIN / state mismatch is saved as chosen, with a clear warning.
  const mismatch = G && gstin ? G.stateMismatchMessage(gstin, stateCode) : "";
  const type = document.querySelector('input[name="party-type-radio"]:checked').value;
  const email = document.getElementById("party-input-email").value.trim();
  const address = document.getElementById("party-input-address").value.trim();
  const creditLimit = Number(document.getElementById("party-input-credit-limit")?.value) || 0;

  if (State.editingPartyId) {
    const party = State.parties.find(p => p.id === State.editingPartyId);
    State.editingPartyId = null;
    if (!party) return;
    const oldName = party.name;
    Object.assign(party, { name, phone, email, gstin, stateCode, stateName, address, type, creditLimit });
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(party);
    else party.updatedAt = new Date().toISOString();
    const led = (State.accounts && State.accounts.ledgers || []).find(l => l.partyId === party.id);
    if (led && led.name !== name) { led.name = name; if (typeof stamp === "function") stamp(led); }
    if (typeof logActivity === "function") logActivity(`Edited party ${oldName === name ? name : `${oldName} → ${name}`}`);
    saveToStorage();
    document.getElementById("modal-party").classList.remove("open");
    if (mismatch) showToast(`Saved ${name}. Warning: ${mismatch}`, "warning", { ttlMs: 8000 });
    else showToast(`Party ${name} updated.`);
    renderParties();
    selectParty(party.id);
    return;
  }

  const balance = Number(document.getElementById("party-input-balance").value) || 0;
  const balType = document.getElementById("party-input-bal-type").value;

  const newParty = {
    id: "pty-" + Date.now(),
    name,
    phone,
    email,
    gstin,
    stateCode,
    stateName,
    address,
    balance,
    balType,
    openingSigned: balType === "PAYABLE" ? -balance : balance,
    type,
    creditLimit,
    loyaltyPoints: 0
  };

  State.parties.push(newParty);
  if (typeof logActivity === "function") logActivity(`Added party ${name}`);
  saveToStorage();
  document.getElementById("modal-party").classList.remove("open");
  if (mismatch) showToast(`Party ${name} added. Warning: ${mismatch}`, "warning", { ttlMs: 8000 });
  else showToast(`Party ${name} added to Khata!`);
  renderParties();
  selectParty(newParty.id);
}

// ----------------------------------------------------
// 6. Inventory & Stock Management
// ----------------------------------------------------
function renderInventoryTable() {
  const tbody = document.getElementById("inventory-table-body");
  const searchTerm = (document.getElementById("inventory-search-input").value || "").toLowerCase();
  const catFilter = document.getElementById("inventory-category-filter").value;

  const filtered = State.items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchTerm) ||
      (item.brand && item.brand.toLowerCase().includes(searchTerm)) ||
      (item.model && item.model.toLowerCase().includes(searchTerm)) ||
      (item.code && item.code.toLowerCase().includes(searchTerm)) ||
      (item.hsn && item.hsn.includes(searchTerm)) ||
      (item.serials || []).some(code => code.toLowerCase().includes(searchTerm));
    const matchesCat = catFilter === "ALL" || item.category === catFilter;
    const low = !isServiceCategory(item.category) && Number(item.minStock) >= 0 && Number(item.stock) <= Number(item.minStock);
    return matchesSearch && matchesCat && (!State.lowStockOnly || low);
  });

  document.getElementById("inv-total-items-count").textContent = filtered.length;

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center text-muted" style="padding:24px;">No items found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const isService = isServiceCategory(item.category);
    const isLowStock = !isService && Number(item.minStock) >= 0 && Number(item.stock) <= Number(item.minStock);
    const stockLabel = isService ? "Service" : `${item.stock} in stock`;
    return `
      <tr>
        <td class="m-title"><strong class="item-card-name">${escHtml(item.name)}</strong></td>
        <td class="m-prices"><span>Sale ${formatINR(item.sellingPrice)}</span><span class="purchase-price">Purchase ${formatINR(item.costPrice)}</span></td>
        <td><code>${escHtml(item.code || "-")}</code></td>
        <td>${escHtml(item.hsn)}</td>
        <td><span class="badge">${escHtml(categoryLabel(item.category))}</span></td>
        <td><strong class="${isLowStock ? 'text-red' : ''}">${isService ? "—" : item.stock}</strong>${item.trackSerial ? `<div class="text-xs text-muted">${(item.serials || []).length} serials</div>` : ""}${typeof godownStockHint === "function" ? godownStockHint(item) : ""}</td>
        <td>${item.unit}</td>
        <td>${formatINR(item.costPrice)}</td>
        <td class="m-amt ${isLowStock ? "text-red" : ""}"><strong class="desk-only">${formatINR(item.sellingPrice)}</strong><span class="stock-chip${isLowStock ? " low" : ""}">${escHtml(stockLabel)}</span></td>
        <td>${item.gstRate}%</td>
        <td class="m-status">
          <span class="badge ${isLowStock ? 'badge-unpaid' : 'badge-paid'}">
            ${isLowStock ? 'Low Stock' : 'In Stock'}
          </span>
        </td>
        <td class="m-actions"><div class="row-actions">
          <details class="row-menu"><summary aria-label="More actions">⋯</summary><div class="row-menu-pop">
            <button class="btn btn-outline btn-sm" data-item-edit="${escHtml(item.id)}" onclick="openEditItemModal('${item.id}')">Edit</button>
            <button class="btn btn-outline btn-sm" onclick="adjustStockModal('${item.id}')">Adjust Qty</button>
            <button class="btn btn-outline btn-sm" onclick="openItemSerials('${item.id}')">Serials</button>
            <button class="btn btn-outline btn-sm btn-danger-outline" data-item-delete="${escHtml(item.id)}" onclick="deleteItem('${item.id}')">Delete</button>
          </div></details>
        </div></td>
      </tr>
    `;
  }).join("");
}

function itemTracksSerial(line) {
  return !!findStockItem(line)?.trackSerial;
}

function closeItemModal() {
  stopSerialScan();
  document.getElementById("modal-item").classList.remove("open");
}

function fillItemForm(item) {
  document.getElementById("item-input-name").value = item?.name || "";
  document.getElementById("item-input-brand").value = item?.brand || "";
  document.getElementById("item-input-model").value = item?.model || "";
  document.getElementById("item-input-warranty").value = item?.warrantyMonths || "";
  document.getElementById("item-input-code").value = item?.code || "";
  document.getElementById("item-input-hsn").value = item?.hsn || "";
  {
    // 1.13.11: an item keeps its stored category even when it is no longer offered (e.g. old FURNITURE items).
    const catSel = document.getElementById("item-input-cat");
    catSel.querySelectorAll("option[data-stored-cat]").forEach(o => o.remove());
    const cat = item?.category || "";
    if (cat && !CATEGORY_PRESETS[cat]) {
      const o = document.createElement("option");
      o.value = cat; o.textContent = categoryLabel(cat); o.dataset.storedCat = "1";
      catSel.appendChild(o);
    }
    catSel.value = cat;
  }
  document.getElementById("item-input-unit").value = item?.unit || "PCS";
  document.getElementById("item-input-cost").value = item?.costPrice ?? "";
  document.getElementById("item-input-price").value = item?.sellingPrice ?? "";
  const incl = document.getElementById("item-input-rate-inclusive");
  if (incl) incl.checked = !!item?.rateInclusive;
  document.getElementById("item-input-gst").value = String(item?.gstRate ?? 18);
  document.getElementById("item-input-stock").value = item?.stock ?? 0;
  document.getElementById("item-input-minstock").value = item?.minStock ?? 5;
  document.getElementById("item-track-serial").checked = !!item?.trackSerial;
  State.itemSerialDraft = [...(item?.serials || [])];
  if (!item) applyCategoryPreset();
  syncSerialTools();
}

function applyCategoryPreset() {
  const preset = CATEGORY_PRESETS[document.getElementById("item-input-cat").value];
  if (!preset) return;
  // HSN left for manual entry — category presets do not force a code
  if (preset.hsn) document.getElementById("item-input-hsn").value = preset.hsn;
  document.getElementById("item-input-gst").value = String(preset.gst);
  document.getElementById("item-input-unit").value = preset.unit;
  if (!State.itemSerialDraft.length) {
    document.getElementById("item-track-serial").checked = preset.serial;
  }
}

function fillCategorySelects() {
  const options = ['<option value="">Select category (optional)</option>']
    .concat(Object.entries(CATEGORY_PRESETS).map(([value, preset]) =>
      `<option value="${value}">${preset.label}</option>`
    )).join("");
  const filter = document.getElementById("inventory-category-filter");
  const current = filter.value || "ALL";
  filter.innerHTML = `<option value="ALL">All categories</option>${options}`;
  filter.value = [...filter.options].some(option => option.value === current) ? current : "ALL";
  document.getElementById("item-input-cat").innerHTML = options;
}

function openAddItemModal() {
  if (typeof blockedAction === "function" && blockedAction("stock")) return;
  State.editingItemId = null;
  document.getElementById("item-modal-title").textContent = "Add Product / Item";
  fillItemForm(null);
  document.getElementById("modal-item").classList.add("open");
}

function openEditItemModal(itemId) {
  if (typeof blockedAction === "function" && blockedAction("stock")) return;
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  State.editingItemId = itemId;
  document.getElementById("item-modal-title").textContent = `Edit Item · ${item.name}`;
  fillItemForm(item);
  document.getElementById("item-track-serial").checked = !!item.trackSerial;
  document.getElementById("modal-item").classList.add("open");
  if (typeof syncSerialTools === "function") syncSerialTools();
}
window.openEditItemModal = openEditItemModal;

function deleteItem(itemId) {
  if (typeof blockedAction === "function" && blockedAction("stock")) return;
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  const usage = findRecordUsage("item", item.id);
  if (usage.length) {
    const msg = `${item.name} is used in ${usageSentence(usage)}. Items with transactions can't be deleted, so old bills, stock history and GST returns stay complete. You can still edit its name, price and details.`;
    showToast(msg, "error", { ttlMs: 9000 });
    return { blocked: true, usage, message: msg };
  }
  const stockNote = Number(item.stock) > 0 ? ` Its ${item.stock} ${item.unit || "unit(s)"} of opening stock will be removed too.` : "";
  if (!confirm(`Delete item "${item.name}"?${stockNote} This cannot be undone.`)) return { cancelled: true };
  if (typeof BillSetuSync !== "undefined" && typeof BillSetuSync.softDelete === "function") BillSetuSync.softDelete("items", item.id);
  State.items = State.items.filter(i => i.id !== item.id);
  if (typeof logActivity === "function") logActivity(`Deleted item ${item.name}`);
  saveToStorage();
  if (typeof refreshCatalogDatalist === "function") refreshCatalogDatalist();
  showToast(`Item ${item.name} deleted.`);
  renderInventoryTable();
  return { deleted: true };
}
window.deleteItem = deleteItem;

function openItemSerials(itemId) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  State.editingItemId = itemId;
  document.getElementById("item-modal-title").textContent = `Serials · ${item.name}`;
  fillItemForm(item);
  document.getElementById("item-track-serial").checked = !!item.trackSerial;
  document.getElementById("modal-item").classList.add("open");
  syncSerialTools();
  document.getElementById("serial-scan-input").focus();
}

function syncSerialTools() {
  const on = document.getElementById("item-track-serial").checked;
  document.getElementById("serial-tools").classList.toggle("d-none", !on);
  const stockInput = document.getElementById("item-input-stock");
  stockInput.readOnly = on;
  if (on) stockInput.value = State.itemSerialDraft.length;
  document.getElementById("serial-chip-list").innerHTML = State.itemSerialDraft.map((code, index) =>
    `<button type="button" class="serial-chip" onclick="removeDraftSerial(${index})">${escHtml(code)} ×</button>`
  ).join("") || `<span class="text-sm text-muted">No serials yet.</span>`;
}

function addDraftSerial(raw) {
  const code = String(raw || "").trim();
  if (!code) return false;
  if (State.itemSerialDraft.some(entry => entry.toLowerCase() === code.toLowerCase())) {
    showToast("Already scanned. Skipped.");
    return false;
  }
  const taken = State.items.find(item => item.id !== State.editingItemId && (item.serials || []).some(entry => entry.toLowerCase() === code.toLowerCase()));
  if (taken) {
    showToast(`Serial ${code} already belongs to ${taken.name}.`, "error");
    return false;
  }
  State.itemSerialDraft.push(code);
  const box = document.getElementById("serial-scan-input");
  if (box) box.value = "";
  syncSerialTools();
  if (typeof noteImei === "function") noteImei(code);
  return true;
}

function removeDraftSerial(index) {
  State.itemSerialDraft.splice(index, 1);
  syncSerialTools();
}

function addLineSerial(index, raw) {
  const line = State.invoiceDraftItems[index];
  const code = String(raw || "").trim();
  if (!line || !code) return false;
  const stockItem = findStockItem(line);
  if (!stockItem?.trackSerial) {
    showToast("Turn on serial tracking for this item first.", "error");
    return false;
  }
  const isReturn = document.getElementById("inv-doc-type")?.value === "CREDIT_NOTE";
  const inStock = (stockItem.serials || []).find(entry => entry.toLowerCase() === code.toLowerCase());
  if (!isReturn && !inStock) {
    showToast(`Serial ${code} is not in stock.`, "error");
    return false;
  }
  const stored = inStock || code;
  if ((line.serials || []).some(entry => entry.toLowerCase() === stored.toLowerCase()) || State.invoiceDraftItems.some((other, i) => i !== index && (other.serials || []).some(entry => entry.toLowerCase() === stored.toLowerCase()))) {
    showToast("Already scanned. Skipped.");
    return false;
  }
  line.itemId = stockItem.id;
  line.serials = [...(line.serials || []), stored];
  line.qty = Math.max(1, line.serials.length);
  renderInvoiceLineItems();
  recalculateInvoice();
  if (typeof noteImei === "function") noteImei(stored);
  return true;
}

function removeLineSerial(index, serialIndex) {
  const line = State.invoiceDraftItems[index];
  if (!line?.serials) return;
  line.serials.splice(serialIndex, 1);
  line.qty = Math.max(1, line.serials.length);
  renderInvoiceLineItems();
  recalculateInvoice();
}

async function startSerialScan() {
  if (typeof openBarcodeScan === "function") {
    openBarcodeScan({ mode: "draft", continuous: true });
    return;
  }
  if (!("BarcodeDetector" in window)) {
    showToast("This browser has no camera barcode reader. Use a USB scanner or type the serial.");
    document.getElementById("serial-scan-input").focus();
    return;
  }
  const video = document.getElementById("serial-scan-video");
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    State.serialScanStream = stream;
    video.srcObject = stream;
    video.classList.remove("d-none");
    document.getElementById("btn-serial-stop").classList.remove("d-none");
    await video.play();
    let detector;
    try {
      detector = new BarcodeDetector({
        formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "codabar", "itf", "data_matrix"]
      });
    } catch (err) {
      detector = new BarcodeDetector();
    }
    const canvas = document.createElement("canvas");
    const tick = async () => {
      if (!State.serialScanStream) return;
      if (video.readyState >= 2 && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        try {
          const codes = await detector.detect(canvas);
          if (codes.length && codes[0].rawValue) {
            addDraftSerial(codes[0].rawValue);
            stopSerialScan();
            return;
          }
        } catch (err) {
          // The next frame tries again while the camera stays open.
        }
      }
      State.serialScanFrame = requestAnimationFrame(tick);
    };
    State.serialScanFrame = requestAnimationFrame(tick);
  } catch (err) {
    showToast("Camera could not start. Type the serial or use a USB scanner.", "error");
    stopSerialScan();
  }
}

function stopSerialScan() {
  if (typeof stopBarcodeScan === "function") stopBarcodeScan();
  if (State.serialScanFrame) cancelAnimationFrame(State.serialScanFrame);
  State.serialScanFrame = null;
  if (State.serialScanStream) {
    State.serialScanStream.getTracks().forEach(track => track.stop());
    State.serialScanStream = null;
  }
  const video = document.getElementById("serial-scan-video");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.add("d-none");
  }
  document.getElementById("btn-serial-stop")?.classList.add("d-none");
}

function saveNewItem() {
  if (typeof blockedAction === "function" && blockedAction("stock")) return;
  const name = document.getElementById("item-input-name").value.trim();
  const price = Number(document.getElementById("item-input-price").value) || 0;
  if (!name || price <= 0) {
    showToast("Valid Item Name and Selling Price are required", "error");
    return;
  }

  const trackSerial = document.getElementById("item-track-serial").checked;
  const serials = trackSerial ? [...State.itemSerialDraft] : [];
  const fields = {
    name,
    brand: document.getElementById("item-input-brand").value.trim(),
    model: document.getElementById("item-input-model").value.trim(),
    warrantyMonths: Number(document.getElementById("item-input-warranty").value) || 0,
    code: document.getElementById("item-input-code").value.trim(),
    hsn: document.getElementById("item-input-hsn").value.trim(),
    category: document.getElementById("item-input-cat").value,
    unit: document.getElementById("item-input-unit").value,
    costPrice: Number(document.getElementById("item-input-cost").value) || 0,
    sellingPrice: price,
    rateInclusive: !!document.getElementById("item-input-rate-inclusive")?.checked,
    gstRate: Number(document.getElementById("item-input-gst").value),
    stock: trackSerial ? serials.length : (Number(document.getElementById("item-input-stock").value) || 0),
    minStock: document.getElementById("item-input-minstock").value === "" ? 5 : Number(document.getElementById("item-input-minstock").value),
    trackSerial,
    serials
  };

  let savedItem;
  if (State.editingItemId) {
    savedItem = State.items.find(i => i.id === State.editingItemId);
    if (!savedItem) return;
    Object.assign(savedItem, fields);
  } else {
    savedItem = {
      id: "itm-" + Date.now(),
      wholesalePrice: Math.round(price * 0.92),
      ...fields
    };
    State.items.push(savedItem);
  }
  if (typeof afterItemSave === "function") afterItemSave(savedItem);

  const wasEdit = !!State.editingItemId;
  State.editingItemId = null;
  saveToStorage();
  closeItemModal();
  refreshCatalogDatalist();
  showToast(wasEdit ? `${name} saved.` : `Item ${name} added to catalog!`);
  renderInventoryTable();
}

function adjustStockModal(itemId) {
  if (typeof blockedAction === "function" && blockedAction("stock")) return;
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.trackSerial) {
    openItemSerials(itemId);
    showToast("This item is counted by serial. Scan or remove a serial to change stock.");
    return;
  }
  const newQty = prompt(`Update stock count for "${item.name}":`, item.stock);
  if (newQty !== null && !isNaN(newQty)) {
    item.stock = Number(newQty);
    if (typeof applyStockCount === "function") applyStockCount(item, Number(newQty));
    saveToStorage();
    renderInventoryTable();
    showToast(`Stock updated to ${newQty} ${item.unit}`);
  }
}

// ----------------------------------------------------
// 7. Purchases & Inward Supplies
// ----------------------------------------------------
function renderPurchasesTable() {
  const tbody = document.getElementById("purchases-table-body");
  const total = State.purchases.reduce((s, p) => s + (p.totalBill || 0), 0);
  document.getElementById("purchases-total-stat").textContent = formatINR(total);

  renderOrdersAndDebits();

  tbody.innerHTML = sortDocsDefault(State.purchases, "purchases", ["billNo"]).map(pur => `
    <tr class="pur-row" data-purchase-id="${escHtml(pur.id)}" onclick="openPurchaseDetailFromRow(event)">
      <td><strong>${escHtml(pur.billNo)}</strong></td>
      <td class="num">${formatShortDate(pur.date)}</td>
      <td class="m-title" title="${pur.supplierGstin ? 'GSTIN ' + escHtml(pur.supplierGstin) : ''}"><strong class="m-party">${escHtml(pur.supplierName)}</strong><div class="phone-sub">${escHtml(pur.billNo)} · ${formatShortDate(pur.date)}</div><span class="cell-sub desk-only">${pur.supplierGstin ? escHtml(pur.supplierGstin) : ''}</span></td>
      <td class="num col-taxable">${formatINR(pur.taxableAmount)}</td>
      <td class="num col-gst text-amber" title="GST">${formatINR(pur.gstAmount)}</td>
      <td class="m-amt num"><strong>${formatINR(pur.totalBill)}</strong></td>
      <td class="num">${formatINR(pur.paidAmount)}</td>
      <td class="m-status"><span class="badge ${pur.status === 'PAID' ? 'badge-paid' : 'badge-unpaid'}">${pur.status}</span></td>
      <td class="m-actions" onclick="event.stopPropagation()"><span class="m-mode">${pur.status}</span><div class="row-actions">
        <button type="button" class="act-btn act-btn-print" onclick="event.stopPropagation(); openPurchaseDetail('${pur.id}')" title="Details" aria-label="Details"><svg class="act-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <details class="row-menu" onclick="event.stopPropagation()"><summary aria-label="More actions">⋯</summary><div class="row-menu-pop">
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); openPurchaseDetail('${pur.id}')">Details</button>
        </div></details>
      </div></td>
    </tr>
  `).join("");
}

// ----------------------------------------------------
// 8. Expenses Management
// ----------------------------------------------------
function renderExpensesTable() {
  const tbody = document.getElementById("expenses-table-body");
  const total = State.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  document.getElementById("expenses-total-stat").textContent = formatINR(total);

  const sortedExpenses = sortDocsDefault(State.expenses, "expenses", ["id"]);
  tbody.innerHTML = sortedExpenses.map((exp, idx) => `
    <tr class="txn-row" data-expense-id="${escHtml(exp.id)}" onclick="if(!event.target.closest('.row-actions,button,summary,details')) openExpenseDetail('${exp.id}')">
      <td>EXP-${String(idx + 1).padStart(3, '0')}</td>
      <td class="num">${formatShortDate(exp.date)}</td>
      <td class="m-status"><span class="badge">${escHtml(exp.category)}</span></td>
      <td class="m-title"><strong>${escHtml(exp.notes || exp.category)}</strong><div class="phone-sub">${formatShortDate(exp.date)} · ${escHtml(exp.mode || "")}</div></td>
      <td>${escHtml(exp.mode || "")}</td>
      <td class="m-amt num txn-out"><strong>${formatINR(exp.amount)}</strong></td>
      <td class="m-actions" onclick="event.stopPropagation()"><div class="row-actions">
        <button type="button" class="act-btn act-btn-print" onclick="event.stopPropagation(); openExpenseDetail('${exp.id}')" title="Details" aria-label="Details"><svg class="act-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
        <details class="row-menu"><summary aria-label="More actions">⋯</summary><div class="row-menu-pop">
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); editExpense('${exp.id}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteExpense('${exp.id}')">Delete</button>
        </div></details>
      </div></td>
    </tr>
  `).join("");
}

function openAddExpenseModal() {
  document.getElementById("exp-date").value = todayISO();
  if (typeof fillAccountSelect === "function") {
    fillAccountSelect(document.getElementById("exp-account-id"), {
      mode: document.getElementById("exp-mode")?.value || "CASH"
    });
  }
  document.getElementById("modal-expense").classList.add("open");
}

function saveNewExpense() {
  if (typeof blockedAction === "function" && blockedAction("expense")) return;
  const amt = Number(document.getElementById("exp-amount").value);
  if (!amt || amt <= 0) {
    showToast("Please enter a valid expense amount", "error");
    return;
  }

  const editId = State._editingExpenseId;
  State._editingExpenseId = null;
  if (editId) {
    State.expenses = State.expenses.filter(e => e.id !== editId);
  }
  const expMode = document.getElementById("exp-mode").value;
  const expAccountId = document.getElementById("exp-account-id")?.value
    || (typeof defaultAccountIdForMode === "function" ? defaultAccountIdForMode(expMode) : (expMode === "CASH" ? "l-cash" : "l-bank"));
  if (typeof rememberAccountId === "function") rememberAccountId(expAccountId);
  const newExp = {
    id: editId || ("exp-" + Date.now()),
    date: document.getElementById("exp-date").value,
    category: document.getElementById("exp-category").value,
    amount: amt,
    mode: expMode,
    accountId: expAccountId,
    notes: document.getElementById("exp-notes").value,
    createdAt: new Date().toISOString()
  };

  State.expenses.push(newExp);
  if (typeof renderDashboard === "function") renderDashboard();
  if (typeof logActivity === "function") logActivity(`Recorded expense ${formatINR(amt)}`);
  saveToStorage();
  document.getElementById("modal-expense").classList.remove("open");
  if (expAccountId) moneyToAccountToast(expAccountId, amt, "OUT");
  else showToast(`Expense of ${formatINR(amt)} recorded.`);
  renderExpensesTable();
}

function deleteExpense(id) {
  if (typeof blockedAction === "function" && blockedAction("expense")) return;
  // 1.13.5: tombstone so the delete reaches other devices.
  if (typeof BillSetuSync !== "undefined" && typeof BillSetuSync.softDelete === "function") BillSetuSync.softDelete("expenses", id);
  else State.expenses = State.expenses.filter(e => e.id !== id);
  saveToStorage();
  renderExpensesTable();
}

// ----------------------------------------------------
// 9. Indian GST & Financial Reports (GSTR-1, P&L, Daybook)
// ----------------------------------------------------
function gstOfInvoice(inv) {
  return (Number(inv.cgstTotal) || 0) + (Number(inv.sgstTotal) || 0) + (Number(inv.igstTotal) || 0);
}

function renderReports() {
  const period = document.getElementById("gstr-month")?.value || "";
  const inPeriod = row => !period || String(row.date || "").slice(0, 7) === period;
  const outward = State.invoices.filter(isPostedSale).filter(inPeriod);
  // GSTR-1 Metrics — posted tax invoices and bills of supply only
  const b2bInvoices = outward.filter(i => !!i.partyGstin);
  const b2cInvoices = outward.filter(i => !i.partyGstin);

  const b2bTaxable = b2bInvoices.reduce((s, i) => s + i.taxableTotal, 0);
  const b2bTax = b2bInvoices.reduce((s, i) => s + (i.cgstTotal + i.sgstTotal + i.igstTotal), 0);
  document.getElementById("gstr-b2b-count").textContent = b2bInvoices.length;
  document.getElementById("gstr-b2b-taxable").textContent = formatINR(b2bTaxable);
  document.getElementById("gstr-b2b-tax").textContent = formatINR(b2bTax);

  const b2cTaxable = b2cInvoices.reduce((s, i) => s + i.taxableTotal, 0);
  const b2cTax = b2cInvoices.reduce((s, i) => s + (i.cgstTotal + i.sgstTotal + i.igstTotal), 0);
  document.getElementById("gstr-b2c-count").textContent = b2cInvoices.length;
  document.getElementById("gstr-b2c-taxable").textContent = formatINR(b2cTaxable);
  document.getElementById("gstr-b2c-tax").textContent = formatINR(b2cTax);

  // HSN Breakdown
  const hsnMap = {};
  outward.forEach(inv => {
    inv.items.forEach(line => {
      const hsn = line.hsn || "8528";
      if (!hsnMap[hsn]) {
        hsnMap[hsn] = {
          hsn,
          desc: line.description,
          qty: 0,
          totalVal: 0,
          taxableVal: 0,
          cgst: 0,
          sgst: 0,
          igst: 0,
          tax: 0
        };
      }
      hsnMap[hsn].qty += (line.qty || 0);
      hsnMap[hsn].totalVal += (line.total || 0);
      hsnMap[hsn].taxableVal += (line.taxableVal || 0);
      hsnMap[hsn].cgst += (line.cgstVal || 0);
      hsnMap[hsn].sgst += (line.sgstVal || 0);
      hsnMap[hsn].igst += (line.igstVal || 0);
      hsnMap[hsn].tax += (line.cgstVal || 0) + (line.sgstVal || 0) + (line.igstVal || 0);
    });
  });

  const hsnList = Object.values(hsnMap);
  document.getElementById("gstr-hsn-count").textContent = hsnList.length;
  const creditTax = State.invoices
    .filter(inv => inv.docType === "CREDIT_NOTE" && inPeriod(inv))
    .reduce((sum, inv) => sum + gstOfInvoice(inv), 0);
  document.getElementById("gstr-total-gst").textContent = formatINR(Math.max(0, b2bTax + b2cTax - creditTax));

  document.getElementById("gstr-hsn-table").innerHTML = hsnList.map(h => `
    <tr>
      <td><strong>${h.hsn}</strong></td>
      <td>${h.desc}</td>
      <td>${h.qty}</td>
      <td>${formatINR(h.totalVal)}</td>
      <td>${formatINR(h.taxableVal)}</td>
      <td>${formatINR(h.cgst)}</td>
      <td>${formatINR(h.sgst)}</td>
      <td>${formatINR(h.igst)}</td>
      <td><strong>${formatINR(h.tax)}</strong></td>
    </tr>
  `).join("");

  // Profit & Loss — credit notes reduce sales, debit notes reduce purchases
  const creditTaxable = State.invoices.filter(inv => inv.docType === "CREDIT_NOTE").reduce((s, inv) => s + (inv.taxableTotal || 0), 0);
  const debitTaxable = State.debitNotes.reduce((s, note) => s + (Number(note.taxableAmount) || Math.max(0, (Number(note.total) || 0) - (Number(note.gstAmount) || 0))), 0);
  const totalRevenue = State.invoices.filter(isPostedSale).reduce((s, i) => s + (i.taxableTotal || 0), 0) - creditTaxable;
  const totalPurchases = State.purchases.reduce((s, p) => s + (p.taxableAmount || 0), 0) - debitTaxable;
  const grossMargin = totalRevenue - totalPurchases;
  const totalExpenses = State.expenses.reduce((s, e) => s + (e.amount || 0), 0);
  const netProfit = grossMargin - totalExpenses;

  const pnlH = document.querySelector("#report-panel-pnl h3");
  if (pnlH) {
    const fyLab = (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.fyLabel)
      ? BillSetuDocNumbering.fyLabel()
      : (typeof BillSetuDocNumbering !== "undefined" ? BillSetuDocNumbering.financialYearParts().fy : "26-27");
    pnlH.textContent = `Profit & Loss Summary (FY ${fyLab})`;
  }
  document.getElementById("pnl-revenue").textContent = formatINR(totalRevenue);
  document.getElementById("pnl-purchases").textContent = formatINR(totalPurchases);
  document.getElementById("pnl-gross-margin").textContent = formatINR(grossMargin);
  document.getElementById("pnl-expenses").textContent = formatINR(totalExpenses);

  const netProfitEl = document.getElementById("pnl-net-profit");
  netProfitEl.textContent = formatINR(netProfit);
  document.getElementById("pnl-net-profit-row").style.background = netProfit >= 0 ? "#064e3b" : "#7f1d1d";

  // Day Book
  const today = todayISO();
  const dayPicker = document.getElementById("daybook-date-picker");
  if (!dayPicker.value) dayPicker.value = today;

  renderDaybook(dayPicker.value);
  renderExtendedReports();
  if (typeof renderGodownReport === "function") renderGodownReport();
}

function renderDaybook(dateStr) {
  const tbody = document.getElementById("daybook-table-body");
  const salesOnDay = State.invoices.filter(i => i.date === dateStr && isPostedSale(i));
  const expensesOnDay = State.expenses.filter(e => e.date === dateStr);
  const paymentsOnDay = (State.payments || []).filter(p => p.date === dateStr);

  const rows = [];
  salesOnDay.forEach(inv => {
    const onBill = invoiceCollectedOnBill(inv);
    if (onBill > 0) {
      rows.push({
        time: inv.date,
        ref: inv.invoiceNo,
        desc: `Sales Receipt - ${inv.partyName}`,
        mode: inv.paymentMode,
        inVal: onBill,
        outVal: 0
      });
    }
  });

  expensesOnDay.forEach(exp => {
    rows.push({
      time: exp.date,
      ref: exp.category,
      desc: exp.notes || `Operating Expense`,
      mode: exp.mode,
      inVal: 0,
      outVal: exp.amount
    });
  });

  paymentsOnDay.filter(pay => pay.direction !== "LOYALTY").forEach(pay => {
    const inbound = pay.direction !== "OUT";
    rows.push({
      time: pay.date,
      ref: pay.receiptNo || "PMT",
      desc: pay.notes || (inbound ? "Payment received" : "Payment made"),
      mode: pay.mode,
      inVal: inbound ? pay.amount : 0,
      outVal: inbound ? 0 : pay.amount
    });
  });
  State.purchases.filter(p => p.date === dateStr && purchasePaidOnBill(p) > 0).forEach(p => {
    rows.push({
      time: p.date,
      ref: p.billNo || "Purchase",
      desc: `Purchase ${p.billNo || ""}`.trim(),
      mode: "CASH",
      inVal: 0,
      outVal: purchasePaidOnBill(p)
    });
  });

  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">No cash or bank transactions on ${dateStr}</td></tr>`;
    return;
  }

  tbody.innerHTML = rows.map(r => `
    <tr>
      <td>${escHtml(r.time)}</td>
      <td><strong>${escHtml(r.ref)}</strong></td>
      <td>${escHtml(r.desc)}</td>
      <td>${escHtml(r.mode)}</td>
      <td class="text-green">${r.inVal > 0 ? formatINR(r.inVal) : '-'}</td>
      <td class="text-red">${r.outVal > 0 ? formatINR(r.outVal) : '-'}</td>
    </tr>
  `).join("");
  filterDaybookRows();
}

function filterDaybookRows() {
  const mode = document.getElementById("daybook-flow")?.value || "ALL";
  document.querySelectorAll("#daybook-table-body tr").forEach(tr => {
    if (tr.querySelector("[colspan]")) { tr.hidden = false; return; }
    const inn = tr.children[4]?.textContent || "";
    const out = tr.children[5]?.textContent || "";
    const hasIn = /\d/.test(inn);
    const hasOut = /\d/.test(out);
    tr.hidden = mode === "IN" ? !hasIn : mode === "OUT" ? !hasOut : false;
  });
}

function setPartyTab(tab) {
  document.getElementById("party-pane-tx")?.classList.toggle("d-none", tab !== "tx");
  document.getElementById("party-pane-details")?.classList.toggle("d-none", tab !== "details");
  document.getElementById("party-tab-tx")?.classList.toggle("active", tab === "tx");
  document.getElementById("party-tab-details")?.classList.toggle("active", tab === "details");
}

// ----------------------------------------------------
// 10. Business Settings & Backup
// ----------------------------------------------------
/** Settings save: the typed UPI ID, or the current one when the field was left as loaded. */
function settingsFormUpiValue() {
  const typed = String(document.getElementById("set-upi-id")?.value || "").trim();
  const base = window.__settingsUpiBaseline;
  if (typeof base === "string" && typed === base) return currentUpiVpa();
  return typed;
}

function populateSettingsForm() {
  window.__lbSettingsFormLoaded = true; // 1.13.12: saveSettingsForm only writes a form that was filled from the saved company
  const b = State.business;
  document.getElementById("set-biz-name").value = b.name;
  document.getElementById("set-trade-name").value = b.tradeName;
  document.getElementById("set-gstin").value = b.gstin;
  document.getElementById("set-pan").value = b.pan;
  if (typeof BillSetuGstin !== "undefined") {
    BillSetuGstin.populateStateSelect(document.getElementById("set-state"), b.stateCode || "");
    BillSetuGstin.bindGstinField(document.getElementById("set-gstin"), {
      stateSelect: document.getElementById("set-state"),
      panInput: document.getElementById("set-pan"),
      hintEl: document.getElementById("set-gstin-hint")
    });
  }
  document.getElementById("set-address").value = b.address;
  document.getElementById("set-phone").value = b.phone;
  document.getElementById("set-email").value = b.email;
  document.getElementById("set-bank-name").value = b.bankName;
  document.getElementById("set-bank-acc").value = b.bankAcc;
  document.getElementById("set-bank-ifsc").value = b.bankIfsc;
  document.getElementById("set-bank-branch").value = b.bankBranch;
  document.getElementById("set-upi-id").value = currentUpiVpa(b);
  // Baseline of what the form showed: an untouched UPI field never overwrites a newer value
  // that arrived meanwhile (sync from another device, Cash & Bank edit) — BUG-V21.2-04.
  window.__settingsUpiBaseline = currentUpiVpa(b);
  document.getElementById("set-terms").value = b.terms;
  const signName = document.getElementById("set-sign-name");
  if (signName) signName.value = b.signatureName || "";
  const declaration = document.getElementById("set-declaration");
  if (declaration) declaration.value = b.declaration || "";
  const jurisdiction = document.getElementById("set-jurisdiction");
  if (jurisdiction) jurisdiction.value = b.jurisdiction || "";
  const blankCells = document.getElementById("set-blank-cells");
  if (blankCells) blankCells.checked = b.classicBlankCells !== false;
  if (typeof refreshBrandPreviews === "function") refreshBrandPreviews();
  const earnInput = document.getElementById("set-loyalty-earn");
  const redeemInput = document.getElementById("set-loyalty-value");
  if (earnInput) earnInput.value = b.loyalty?.pointsPerRupee ?? 0.01;
  if (redeemInput) redeemInput.value = b.loyalty?.rupeePerPoint ?? 1;
  if (typeof BillSetuDocNumbering !== "undefined") {
    BillSetuDocNumbering.ensureDocNumbering();
    BillSetuDocNumbering.ensurePrintDefaults();
    BillSetuDocNumbering.renderNumberingSettings();
    BillSetuDocNumbering.renderDefaultTemplatePicker();
  }

  // Select the saved state (never default to the first option when it is missing).
  if (typeof BillSetuGstin !== "undefined") {
    const setState = document.getElementById("set-state");
    BillSetuGstin.selectState(setState, businessStateCode());
    if (setState) setState.dataset.userTouched = b.stateCode ? "1" : "";
    const runSet = document.getElementById("set-gstin")?._gstinRun;
    if (runSet && b.gstin) runSet(false);
  }
}

function saveSettingsForm() {
  if (typeof blockedAction === "function" && blockedAction("settings")) return;
  // 1.13.12 (NM11b audit): never save a Settings form that was not filled from the saved company first,
  // or its blank inputs would wipe the saved GSTIN, address, phone, bank and so on.
  if (!window.__lbSettingsFormLoaded) {
    populateSettingsForm();
    showToast("Settings were reloaded from your saved company. Check them and save again.", "warning");
    return;
  }
  // Persist numbering + default template from the Settings UI first so a GSTIN
  // validation error cannot silently drop Next-number / template changes (BUG-V21-02).
  if (typeof BillSetuDocNumbering !== "undefined") {
    BillSetuDocNumbering.saveNumberingFromSettings();
    BillSetuDocNumbering.savePrintDefaultsFromSettings();
  }
  let stateCode = normStateCode(document.getElementById("set-state").value);
  const gstinRaw = document.getElementById("set-gstin").value.trim().toUpperCase();
  let gstinWarning = "";
  let gstin = gstinRaw;
  let pan = document.getElementById("set-pan").value.trim().toUpperCase();
  let gstinError = "";
  if (gstin) {
    const v = (typeof BillSetuGstin !== "undefined")
      ? BillSetuGstin.validateGstin(gstin)
      : { ok: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin), message: "That GSTIN is not valid.", gstin };
    if (!v.ok) {
      gstinError = v.message || "That GSTIN is not valid.";
    } else {
      gstin = v.gstin || gstin;
      if (v.pan && (!pan || pan === v.pan)) pan = v.pan;
      // Auto-fill the state from the GSTIN prefix; a disagreement is a warning, not a block.
      if (v.stateCode && !stateCode) stateCode = normStateCode(v.stateCode);
      if (typeof BillSetuGstin !== "undefined") gstinWarning = BillSetuGstin.stateMismatchMessage(gstin, stateCode);
    }
  }
  const stateName = (typeof BillSetuGstin !== "undefined" && BillSetuGstin.stateName(stateCode)) || "";
  // 1.13.11 (BR4): the business name is required. Clearing a set name is blocked; an older book
  // that never had one still saves its other settings and gets a prompt.
  const nameInput = document.getElementById("set-biz-name");
  const newName = nameInput.value.trim();
  const hadName = !!String(State.business?.name || "").trim();
  if (!newName && hadName) {
    nameInput.value = State.business.name;
    nameInput.focus();
    showToast("Business name is required. It prints on your invoices and receipts.", "error");
    return;
  }
  // 1.13.13 (N3): the required (*) address, phone and state cannot be cleared once saved. GSTIN is
  // optional (unregistered businesses), so it has no asterisk and can be cleared.
  const savedState = businessStateCode();
  const requiredCleared = [
    ["set-address", "address", "Business address"],
    ["set-phone", "phone", "Phone / WhatsApp"]
  ].filter(([id, k]) => !document.getElementById(id).value.trim() && String(State.business?.[k] || "").trim());
  if (!stateCode && savedState) requiredCleared.push(["set-state", "stateCode", "State"]);
  if (requiredCleared.length) {
    requiredCleared.forEach(([id, k]) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === "set-state" && typeof BillSetuGstin !== "undefined") BillSetuGstin.populateStateSelect(el, savedState);
      else el.value = State.business[k];
    });
    document.getElementById(requiredCleared[0][0])?.focus();
    showToast(requiredCleared.map(r => r[2]).join(", ") + (requiredCleared.length > 1 ? " are" : " is") + " required and can't be cleared. You can change it instead.", "error");
    return;
  }
  // 1.13.14 (BUG-2): a book with no state (and no GSTIN to take it from) must pick one; it decides CGST/SGST or IGST.
  if (!stateCode) {
    document.getElementById("set-state")?.focus();
    showToast("Select your business state. It decides CGST+SGST or IGST on your bills.", "error");
    return;
  }
  const prevUpiVpa = currentUpiVpa();
  State.business = {
    ...State.business,
    name: newName,
    tradeName: document.getElementById("set-trade-name").value.trim() || newName,
    gstin: gstinError ? (State.business.gstin || "") : gstin,
    pan: gstinError ? (State.business.pan || pan) : pan,
    stateCode,
    stateName,
    address: document.getElementById("set-address").value.trim(),
    phone: document.getElementById("set-phone").value.trim(),
    email: document.getElementById("set-email").value.trim(),
    bankName: document.getElementById("set-bank-name").value.trim(),
    bankAcc: document.getElementById("set-bank-acc").value.trim(),
    bankIfsc: document.getElementById("set-bank-ifsc").value.trim(),
    bankBranch: document.getElementById("set-bank-branch").value.trim(),
    upiId: settingsFormUpiValue(),
    terms: document.getElementById("set-terms").value.trim(),
    signatureName: document.getElementById("set-sign-name") ? document.getElementById("set-sign-name").value.trim() : (State.business.signatureName || ""),
    declaration: document.getElementById("set-declaration")?.value.trim() || State.business.declaration || "",
    jurisdiction: document.getElementById("set-jurisdiction") ? document.getElementById("set-jurisdiction").value.trim() : (State.business.jurisdiction || ""),
    classicBlankCells: document.getElementById("set-blank-cells") ? document.getElementById("set-blank-cells").checked : true,
    loyalty: {
      pointsPerRupee: Math.max(0, Number(document.getElementById("set-loyalty-earn")?.value ?? State.business.loyalty?.pointsPerRupee ?? 0.01) || 0),
      rupeePerPoint: Math.max(0, Number(document.getElementById("set-loyalty-value")?.value ?? State.business.loyalty?.rupeePerPoint ?? 1) || 0)
    }
  };
  // Re-apply numbering after business object replace (spread kept the ref, but be explicit)
  if (typeof BillSetuDocNumbering !== "undefined") {
    BillSetuDocNumbering.saveNumberingFromSettings();
    BillSetuDocNumbering.savePrintDefaultsFromSettings();
  }
  if (typeof syncUpiVpaToAccounts === "function") syncUpiVpaToAccounts(prevUpiVpa, State.business.upiId);
  State.business.updatedAt = Date.now();
  saveToStorage();
  if (gstinError) {
    showToast(gstinError + " Numbering & template were saved.", "error");
  } else if (gstinWarning) {
    showToast("Business profile saved. Warning: " + gstinWarning, "warning", { ttlMs: 8000 });
  } else if (!newName) {
    showToast("Settings saved. Add your business name: it prints on your invoices and receipts.", "warning", { ttlMs: 8000 });
  } else {
    showToast("Business profile & GST settings updated!");
  }
  renderDashboard();
}


function partyDedupeKey(p) {
  const gst = String(p.gstin || "").trim().toUpperCase();
  if (gst) return "g:" + gst;
  const phone = String(p.phone || "").replace(/\D/g, "").slice(-10);
  if (phone.length === 10) return "p:" + phone;
  return "n:" + String(p.name || "").trim().toLowerCase();
}
function itemDedupeKey(it) {
  const sku = String(it.sku || it.code || "").trim().toLowerCase();
  if (sku) return "s:" + sku;
  return "n:" + String(it.name || "").trim().toLowerCase();
}
function pickNonBlankBusiness(b) {
  const out = {};
  Object.entries(b || {}).forEach(([k, v]) => { if (v != null && !(typeof v === "string" && !v.trim())) out[k] = v; });
  return out;
}
/** Replace-mode restore (default). Clears then loads the file — no duplicates. */
function applyBackupReplace(data) {
  const fileBiz = data.business && typeof data.business === "object" ? data.business : null;
  const fileBlank = !fileBiz || (!String(fileBiz.name || "").trim() && !businessHasSavedData(fileBiz));
  // 1.13.13 (BUG-1): a file company with some blank fields is merged field by field: non-blank file
  // values win, blank ones keep the saved values, and GSTIN/state/PAN stay consistent as a set.
  State.business = fileBlank ? { ...EMPTY_BUSINESS, ...(State.business || {}), ...(fileBiz || {}), ...pickNonBlankBusiness(State.business) } : mergeRestoredBusiness(State.business, fileBiz);
  const prevRegistry = typeof readRegistry === "function" ? readRegistry() : null;
  const prevEntry = prevRegistry && Array.isArray(prevRegistry.companies) ? prevRegistry.companies.find(c => c && c.id === prevRegistry.activeId) : null;
  State.business.logo = safeImageUrl(State.business.logo);
  State.business.signatureImage = safeImageUrl(State.business.signatureImage);
  State.parties = Array.isArray(data.parties) ? data.parties : [];
  State.items = Array.isArray(data.items) ? data.items : [];
  State.invoices = Array.isArray(data.invoices) ? data.invoices : [];
  State.purchases = Array.isArray(data.purchases) ? data.purchases : [];
  State.expenses = Array.isArray(data.expenses) ? data.expenses : [];
  State.purchaseOrders = Array.isArray(data.purchaseOrders) ? data.purchaseOrders : [];
  State.debitNotes = Array.isArray(data.debitNotes) ? data.debitNotes : [];
  State.payments = Array.isArray(data.payments) ? data.payments : [];
  if (typeof restoreExtraBooks === "function") restoreExtraBooks(data);
  if (typeof restoreCompanyBackup === "function") restoreCompanyBackup(data);
  fixRestoredBooksListName(prevEntry);
}
/** Placeholder company names that must never become the books-list name ("tmp", "Company", ...). */
function isPlaceholderCompanyName(name) {
  const n = String(name == null ? "" : name).trim();
  return !n || /^(tmp|temp|test|company|untitled|new company|my company|your business name|business)$/i.test(n);
}
/** 1.13.13 (BUG-1): the books-list entry of the open book shows the merged business name, never a blank or placeholder. */
function fixRestoredBooksListName(prevEntry) {
  if (typeof readRegistry !== "function" || typeof writeRegistry !== "function") return;
  const reg = readRegistry();
  if (!reg || !Array.isArray(reg.companies)) return;
  const entry = reg.companies.find(c => c && c.id === reg.activeId);
  if (!entry) return;
  const name = String(State.business?.name || "").trim();
  if (name) entry.name = name;
  else if (isPlaceholderCompanyName(entry.name)) entry.name = prevEntry && !isPlaceholderCompanyName(prevEntry.name) ? prevEntry.name : "Company";
  entry.gstin = State.business?.gstin || "";
  writeRegistry(reg);
}
/**
 * 1.13.13 (BUG-1): when a backup's company clearly differs from the open one (a different non-blank
 * name or GSTIN, or a GSTIN from another state), return the confirm text; otherwise "".
 */
function restoreBusinessChangeMessage(saved, file) {
  const nb = v => String(v == null ? "" : v).trim();
  const key = v => nb(v).toUpperCase().replace(/\s+/g, " ");
  const s = saved || {}, f = file || {};
  if (!f || typeof f !== "object") return "";
  const G = gstStatesApi();
  const fG = key(f.gstin), sG = key(s.gstin);
  const sState = normStateCode(s.stateCode, s.stateName) || (G && sG ? G.gstinStateCode(sG) : "");
  const fGState = G && fG ? G.gstinStateCode(fG) : "";
  const merged = mergeRestoredBusiness(s, f);
  const nameDiff = nb(f.name) && nb(s.name) && key(f.name) !== key(s.name);
  const gstinDiff = fG && sG && fG !== sG;
  // 1.13.14 (BUG-3): compare the resulting state even without a GSTIN (state-only files too).
  const mState = normStateCode(merged.stateCode, merged.stateName) || fGState;
  const stateDiff = !!(sState && mState && mState !== sState);
  if (!nameDiff && !gstinDiff && !stateDiff) return "";
  const label = (b, g) => `${nb(b.name) || "(no name)"}${g ? " · GSTIN " + g : ""}${normStateCode(b.stateCode, b.stateName) ? " · state " + normStateCode(b.stateCode, b.stateName) : ""}`;
  const changed = businessChangedFields(s, merged);
  return `This backup is for a different business. Your business details will change:\n\nNow: ${label(s, sG)}\nAfter restore: ${label(merged, key(merged.gstin))}${changed.length ? "\nChanges: " + changed.join(", ") : ""}\n\nRestore this backup and change the business details?`;
}
/** Merge with dedupe by GSTIN/phone/name (parties) and sku/name (items). Incoming wins on match. */
function applyBackupMergeDedupe(data) {
  if (data.business && data.business.name) {
    State.business = mergeBusinessKeepSaved(State.business, data.business);
    State.business.logo = safeImageUrl(State.business.logo);
    State.business.signatureImage = safeImageUrl(State.business.signatureImage);
  }
  const pMap = new Map(State.parties.map(p => [partyDedupeKey(p), p]));
  (data.parties || []).forEach(p => { pMap.set(partyDedupeKey(p), { ...pMap.get(partyDedupeKey(p)), ...p }); });
  State.parties = [...pMap.values()];
  const iMap = new Map(State.items.map(it => [itemDedupeKey(it), it]));
  (data.items || []).forEach(it => { iMap.set(itemDedupeKey(it), { ...iMap.get(itemDedupeKey(it)), ...it }); });
  State.items = [...iMap.values()];
  // Documents: replace by id if present, else append
  const mergeById = (cur, incoming) => {
    const m = new Map((cur || []).map(x => [x.id, x]));
    (incoming || []).forEach(x => { if (x && x.id) m.set(x.id, x); else if (x) m.set("gen-" + m.size, x); });
    return [...m.values()];
  };
  State.invoices = mergeById(State.invoices, data.invoices);
  State.purchases = mergeById(State.purchases, data.purchases);
  State.expenses = mergeById(State.expenses, data.expenses);
  State.purchaseOrders = mergeById(State.purchaseOrders, data.purchaseOrders);
  State.debitNotes = mergeById(State.debitNotes, data.debitNotes);
  State.payments = mergeById(State.payments, data.payments);
  if (typeof restoreExtraBooks === "function") restoreExtraBooks(data);
  if (typeof restoreCompanyBackup === "function") restoreCompanyBackup(data);
}
function isLedgerbayOrBillSetuBackup(data) {
  if (!data || typeof data !== "object") return false;
  if (!data.business || !Array.isArray(data.parties) || !Array.isArray(data.items)) return false;
  const app = String(data.app || "").toLowerCase();
  if (app && app !== "ledgerbay" && app !== "billsetu") return false;
  return true;
}

function exportJSONBackup() {
  const data = {
    app: "Ledgerbay",
    version: 3,
    business: State.business,
    parties: State.parties,
    items: State.items,
    invoices: State.invoices,
    purchases: State.purchases,
    expenses: State.expenses,
    purchaseOrders: State.purchaseOrders || [],
    debitNotes: State.debitNotes || [],
    payments: State.payments || [],
    ...(typeof extraBooksPayload === "function" ? extraBooksPayload() : {}),
    ...(typeof companyBackupPayload === "function" ? companyBackupPayload() : {}),
    exportedAt: new Date().toISOString()
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Ledgerbay_Backup_${new Date().toISOString().split("T")[0]}.json`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Backup JSON file downloaded successfully!");
}

function triggerImportJSON() {
  if (typeof blockedAction === "function" && blockedAction("settings")) return;
  document.getElementById("input-import-json").click();
}

function handleImportJSON(event) {
  const file = event.target.files[0];
  event.target.value = "";
  if (!file) return;
  // Replace mode avoids duplicates after a personal seed or prior CSV import.
  if (!confirm("Replace the parties, items, bills, and payments on this device with this file? A Ledgerbay or BillSetu (v19/v20) backup works. This does not create duplicates.")) return;

  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!isLedgerbayOrBillSetuBackup(data)) {
        showToast("That file is not a Ledgerbay (or BillSetu) export.", "error");
        return;
      }
      // 1.13.13 (BUG-1): a backup of a clearly different business asks before changing the business details.
      const change = restoreBusinessChangeMessage(State.business, data.business);
      if (change && !confirm(change)) {
        showToast("Restore cancelled. Nothing was changed.");
        return;
      }
      const bizBefore = { ...(State.business || {}) };
      applyBackupReplace(data);
      const bizChanged = businessChangedFields(bizBefore, State.business);
      ensureBooks();
      if (typeof writeStaffIndex === "function") writeStaffIndex();
      saveToStorage();
      showToast(bizChanged.length ? `Books restored. Business details updated from backup: ${bizChanged.join(", ")}.` : "Books restored.");
      switchView(State.currentView || "dashboard");
      // A restored book with no business name gets the name prompt right away, not after a restart.
      if ((!String(State.business?.name || "").trim() || !businessStateCode()) && typeof openCompanySetupWizard === "function") openCompanySetupWizard({ existing: true });
    } catch (err) {
      showToast("That file could not be read.", "error");
    }
  };
  reader.readAsText(file);
}

const AUTH_KEY = "billsetu_lock_v1";
const SESSION_KEY = "billsetu_open";
let appReady = false;

function readLock() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
  } catch (err) {
    return null;
  }
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function hashSecret(password, salt) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${password}`));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function showAuthGate() {
  const creating = !readLock();
  document.body.classList.remove("books-open");
  document.getElementById("auth-lead").textContent = creating
    ? "Choose a password. It stays on this browser and opens your books."
    : "Owner: leave the name blank. Staff: type the name and PIN.";
  document.getElementById("auth-name-label")?.classList.toggle("d-none", creating);
  document.getElementById("auth-confirm-label").classList.toggle("d-none", !creating);
  document.getElementById("auth-submit").textContent = creating ? "Save password and open" : "Open books";
  document.getElementById("auth-password").autocomplete = creating ? "new-password" : "current-password";
  document.getElementById("auth-error").textContent = "";
  document.getElementById("auth-password").value = "";
  document.getElementById("auth-confirm").value = "";
}

function enterApp() {
  document.body.classList.add("books-open");
  const passwordField = document.getElementById("auth-password");
  const confirmField = document.getElementById("auth-confirm");
  if (passwordField) passwordField.value = "";
  if (confirmField) confirmField.value = "";
  if (!appReady) {
    const hadSave = loadFromStorage();
    if (!hadSave) ensureBooks();
    appReady = true;
  }
  try {
    State.currentActor = JSON.parse(sessionStorage.getItem("billsetu_actor") || "") || { id: "owner", name: "Owner", role: "ADMIN" };
  } catch (err) {
    State.currentActor = { id: "owner", name: "Owner", role: "ADMIN" };
  }
  if (!State.currentActor?.role) State.currentActor = { id: "owner", name: "Owner", role: "ADMIN" };
  if (typeof onBooksOpened === "function") onBooksOpened();
  else renderDashboard();
  if (State.currentActor && State.currentActor.role && State.currentActor.role !== "ADMIN") {
    const homes = { SALESMAN: "pos", STOCK: "inventory", CA: "reports" };
    const home = homes[State.currentActor.role] || "dashboard";
    const cur = State.currentView || "dashboard";
    if (typeof roleAllowsView === "function" && !roleAllowsView(cur)) switchView(home);
    else if (cur === "staff" || cur === "settings") switchView(home);
  } else if (typeof roleAllowsView === "function" && !roleAllowsView(State.currentView || "dashboard")) {
    const homes = { SALESMAN: "pos", STOCK: "inventory", CA: "reports" };
    switchView(homes[State.currentActor.role] || "dashboard");
  }
  // Production: empty company → setup wizard; personal: seed if still empty
  try {
    // 1.13.12 (NM11b): only a true first run gets the blank setup wizard. An existing book (any saved
    // company detail or any records) with no business name gets the name prompt, prefilled from the
    // saved company, and saving it merges, never blanking saved fields.
    // 1.13.14 (BUG-2): a missing state also opens it (the state decides CGST+SGST or IGST).
    if (lbIsProd() && (!(State.business && String(State.business.name || "").trim()) || !businessStateCode())) {
      if (typeof openCompanySetupWizard === "function") openCompanySetupWizard({ existing: bookIsExisting() });
    } else if (lbIsPersonal() && typeof maybePersonalSeed === "function") {
      maybePersonalSeed();
    }
    // Outside production (or if the wizard is not there) a nameless book gets a toast prompt.
    promptMissingBusinessName();
  } catch (err) { console.warn("post-enter setup", err); }
  // Hide demo controls in store/personal
  try {
    if (lbIsProd()) {
      document.querySelectorAll("#btn-quick-sample, [data-demo-only]").forEach(el => {
        el.classList.add("d-none");
        el.setAttribute("hidden", "true");
      });
      const demoCard = document.getElementById("backup-demo-card");
      if (demoCard) {
        const h = demoCard.querySelector("h4");
        if (h) h.textContent = "Backup";
        const p = demoCard.querySelector("p.text-sm");
        if (p) p.textContent = "Download every party, item, bill, purchase, and payment, or replace the books on this device from that file.";
      }
    }
  } catch (_) {}

}

async function submitAuth(event) {
  event.preventDefault();
  const password = document.getElementById("auth-password").value;
  const confirmValue = document.getElementById("auth-confirm").value;
  const staffName = document.getElementById("auth-name")?.value.trim() || "";
  const error = document.getElementById("auth-error");
  const lock = readLock();
  if (password.length < 4) {
    error.textContent = "Use at least 4 characters.";
    return;
  }
  if (!lock) {
    if (password !== confirmValue) {
      error.textContent = "Those passwords do not match.";
      return;
    }
    const salt = randomSalt();
    localStorage.setItem(AUTH_KEY, JSON.stringify({ salt, hash: await hashSecret(password, salt) }));
    sessionStorage.setItem("billsetu_actor", JSON.stringify({ id: "owner", name: "Owner", role: "ADMIN" }));
  } else if (staffName && staffName.toLowerCase() !== "owner") {
    let index = [];
    try { index = JSON.parse(localStorage.getItem("billsetu_staff_index_v1") || "[]"); } catch (err) { index = []; }
    const person = index.find(s => s.active !== false && String(s.name).toLowerCase() === staffName.toLowerCase());
    if (!person) {
      error.textContent = "No active staff member by that name. Leave the name blank for the owner.";
      return;
    }
    if (await hashSecret(password, person.salt) !== person.hash) {
      error.textContent = "That PIN is not right.";
      return;
    }
    sessionStorage.setItem("billsetu_actor", JSON.stringify({ id: person.id, name: person.name, role: person.role }));
  } else if (await hashSecret(password, lock.salt) !== lock.hash) {
    error.textContent = "That password is not right.";
    return;
  } else {
    sessionStorage.setItem("billsetu_actor", JSON.stringify({ id: "owner", name: "Owner", role: "ADMIN" }));
  }
  sessionStorage.setItem(SESSION_KEY, "1");
  enterApp();
}

function lockApp() {
  sessionStorage.removeItem(SESSION_KEY);
  sessionStorage.removeItem("billsetu_actor");
  showAuthGate();
}

async function changeLockPassword() {
  const current = document.getElementById("lock-current").value;
  const next = document.getElementById("lock-next").value;
  const lock = readLock();
  if (!lock) {
    showToast("Set a password from the sign-in screen first.", "error");
    return;
  }
  if (next.length < 4) {
    showToast("Use at least 4 characters.", "error");
    return;
  }
  if (await hashSecret(current, lock.salt) !== lock.hash) {
    showToast("Current password is not right.", "error");
    return;
  }
  const salt = randomSalt();
  localStorage.setItem(AUTH_KEY, JSON.stringify({ salt, hash: await hashSecret(next, salt) }));
  document.getElementById("lock-current").value = "";
  document.getElementById("lock-next").value = "";
  showToast("Password updated.");
}

// ----------------------------------------------------
// 10B. Barcode Sticker Generator (MyBillBook Feature)
// ----------------------------------------------------
function openBarcodeModal() {
  const select = document.getElementById("barcode-item-select");
  select.innerHTML = State.items.map(i => `<option value="${i.id}">${i.name} (Code: ${i.code || '-'}) - MRP: ${formatINR(i.sellingPrice)}</option>`).join("");
  renderBarcodeStickers();
  document.getElementById("modal-barcode").classList.add("open");
}

function renderBarcodeStickers() {
  const select = document.getElementById("barcode-item-select");
  const count = Number(document.getElementById("barcode-sticker-count").value) || 8;
  const grid = document.getElementById("barcode-preview-grid");

  const itemId = select.value;
  const item = State.items.find(i => i.id === itemId);
  if (!item) {
    grid.innerHTML = `<p class="text-muted p-3">Select an item to preview barcode stickers.</p>`;
    return;
  }

  const code = item.code || ("ITM" + item.hsn + "99");
  const storeName = State.business.name;
  const size = document.getElementById("barcode-label-size")?.value || "standard";
  const widths = { compact: 120, standard: 168, large: 240 };
  const labelWidth = widths[size] || 168;
  let x = 2;
  const bars = [];
  for (let i = 0; i < code.length; i += 1) {
    const n = code.charCodeAt(i);
    const w = 1 + (n % 4);
    bars.push(`<rect x="${x}" y="0" width="${w}" height="32" fill="#000"/>`);
    x += w + 1 + ((n >> 2) % 2);
  }
  const barcode = `<svg class="barcode-lines-svg" width="${Math.max(labelWidth - 16, x)}" height="32" viewBox="0 0 ${Math.max(x + 2, 40)} 32">${bars.join("")}</svg>`;

  let stickersHtml = "";
  for (let i = 0; i < count; i++) {
    stickersHtml += `
      <div class="barcode-sticker barcode-${size}" style="width:${labelWidth}px">
        <div class="barcode-store-title">${escHtml(storeName)}</div>
        <div class="barcode-item-title">${escHtml(item.name)}</div>
        ${barcode}
        <div class="barcode-code-text">${escHtml(code)}</div>
        <div class="barcode-price-tag">MRP: ${formatINR(item.sellingPrice)}</div>
        <div style="font-size:7px;color:#64748b;">(Incl. of all taxes)</div>
      </div>
    `;
  }

  grid.innerHTML = stickersHtml;
}

// ----------------------------------------------------
// 10C. Payment Receipt Voucher (MyBillBook Feature)
// ----------------------------------------------------
function openReceiptVoucher(voucherData) {
  const b = State.business;
  const container = document.getElementById("receipt-voucher-content");
  
  container.innerHTML = `
    <div class="receipt-voucher-card">
      <div class="voucher-header">
        ${String(b.name || "").trim() ? `<h2 style="margin:0;font-size:20px;">${escHtml(b.name)}</h2>` : ""}
        ${[b.tradeName, b.address].filter(x => String(x || "").trim()).length ? `<div style="font-size:12px;color:#475569;">${[b.tradeName, b.address].filter(x => String(x || "").trim()).map(escHtml).join(" | ")}</div>` : ""}
        ${b.gstin || b.phone ? `<div style="font-size:12px;">${[b.gstin ? `<strong>GSTIN:</strong> ${escHtml(b.gstin)}` : "", b.phone ? `<strong>Phone:</strong> ${escHtml(b.phone)}` : ""].filter(Boolean).join(" | ")}</div>` : ""}
        <div class="voucher-title" style="margin-top:8px;">OFFICIAL PAYMENT RECEIPT</div>
      </div>
      
      <div class="voucher-row">
        <span><strong>Receipt No:</strong> ${voucherData.receiptNo}</span>
        <span><strong>Date:</strong> ${voucherData.date}</span>
      </div>

      <div class="voucher-row" style="margin-top:10px;">
        <span><strong>Received With Thanks From:</strong> ${escHtml(voucherData.partyName)}</span>
      </div>
      <div class="voucher-row">
        <span><strong>Phone:</strong> ${voucherData.partyPhone || 'N/A'}</span>
        <span><strong>Payment Mode:</strong> ${voucherData.mode}</span>
      </div>

      <div class="voucher-amount-highlight">
        <span style="font-size:16px;font-weight:700;">Amount Received:</span>
        <span style="font-size:22px;font-weight:800;color:#059669;">${formatINR(voucherData.amount)}</span>
      </div>

      <div style="font-size:12px;font-style:italic;margin-bottom:14px;">
        <strong>In Words:</strong> ${convertNumberToWords(voucherData.amount)}
      </div>

      <div style="font-size:12px;margin-bottom:20px;">
        <strong>Remarks / Towards:</strong> ${voucherData.notes || 'Full / On-Account payment settlement'}
      </div>

      <div style="display:flex;justify-content:space-between;margin-top:40px;border-top:1px dashed #94a3b8;padding-top:8px;font-size:11px;">
        <div>Customer Signature / Acknowledgement</div>
        <div style="text-align:right;">
          ${String(b.name || "").trim() ? `<div>For <strong>${escHtml(b.name)}</strong></div>` : ""}
          <div style="height:35px;"></div>
          <div>Authorized Signatory</div>
        </div>
      </div>
    </div>
  `;

  document.getElementById("btn-voucher-whatsapp").onclick = () => {
    const phone = (voucherData.partyPhone || '').replace(/\D/g, '');
    const text = `Namaste ${voucherData.partyName},\nWe have received payment of *${formatINR(voucherData.amount)}* (${voucherData.mode}) on ${voucherData.date}.\nReceipt No: *${voucherData.receiptNo}*.\nThank you for doing business with ${bizName() ? `*${bizName()}*` : "us"}!`;
    const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  };

  document.getElementById("modal-receipt-voucher").classList.add("open");
}

// ----------------------------------------------------
// 11. Initial Event Listeners Setup
// ----------------------------------------------------
function setupEventListeners() {
  fillCategorySelects();
  document.getElementById("item-input-cat").addEventListener("change", () => {
    applyCategoryPreset();
    syncSerialTools();
  });
  // Navigation
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => switchView(btn.getAttribute("data-view")));
  });

  // Topbar
  document.getElementById("btn-new-invoice-top").addEventListener("click", openNewInvoiceModal);
  document.getElementById("btn-create-sale-modal").addEventListener("click", openNewInvoiceModal);
  document.getElementById("act-new-sale").addEventListener("click", openNewInvoiceModal);
  document.getElementById("act-new-purchase").addEventListener("click", () => switchView("purchases"));
  document.getElementById("act-add-party").addEventListener("click", openAddPartyModal);
  document.getElementById("act-add-item").addEventListener("click", openAddItemModal);

  document.getElementById("link-view-all-sales").addEventListener("click", () => switchView("sales"));
  document.getElementById("link-view-all-parties").addEventListener("click", () => switchView("parties"));

  document.getElementById("btn-quick-sample")?.addEventListener("click", () => {
    if (lbIsProd()) { showToast("Demo data is not available in this build.", "error"); return; }
    if (typeof blockedAction === "function" && blockedAction("settings")) return;
    if (!confirm("Load demo data? Bills you added in this company will be replaced.")) return;
    localStorage.removeItem("billsetu_data_v1");
    State.business = { ...DEFAULT_BUSINESS };
    State.parties = JSON.parse(JSON.stringify(SAMPLE_PARTIES));
    State.items = JSON.parse(JSON.stringify(SAMPLE_ITEMS));
    State.invoices = JSON.parse(JSON.stringify(SAMPLE_INVOICES));
    State.purchases = JSON.parse(JSON.stringify(SAMPLE_PURCHASES));
    State.payments = JSON.parse(JSON.stringify(SAMPLE_PAYMENTS));
    State.expenses = JSON.parse(JSON.stringify(SAMPLE_EXPENSES));
    State.expenses = JSON.parse(JSON.stringify(SAMPLE_EXPENSES));
    State.purchaseOrders = JSON.parse(JSON.stringify(SAMPLE_ORDERS));
    State.debitNotes = [];
    State.payments = [];
    State.posCart = [];
    if (typeof afterDemoReload === "function") afterDemoReload();
    else saveToStorage();
    showToast("Loaded demo data.");
    renderDashboard();
  });

  // Invoice Modal
  document.getElementById("btn-close-invoice-modal").addEventListener("click", async () => {
    if (!(await confirmLeaveInvoiceForm())) return;
    State.editingInvoiceId = null;
    setInvoiceModalOpen(false);
  });
  document.getElementById("btn-cancel-invoice").addEventListener("click", async () => {
    if (!(await confirmLeaveInvoiceForm())) return;
    State.editingInvoiceId = null;
    setInvoiceModalOpen(false);
  });
  document.getElementById("btn-discard-keep")?.addEventListener("click", () => finishDiscardDraft(false));
  document.getElementById("btn-discard-confirm")?.addEventListener("click", () => finishDiscardDraft(true));
  document.getElementById("inv-party-select").addEventListener("change", updateInvoicePartyMeta);
  document.getElementById("inv-pos-state").addEventListener("change", evaluateTaxType);
  document.getElementById("btn-add-line-row").addEventListener("click", addLineItem);
  document.getElementById("inv-bill-discount")?.addEventListener("input", () => {
    State.invoiceAmountReceivedTouched = false;
    recalculateInvoice();
  });
  document.getElementById("inv-discount-mode")?.addEventListener("change", () => {
    State.invoiceAmountReceivedTouched = false;
    recalculateInvoice();
  });
  document.getElementById("inv-amount-received").addEventListener("input", () => {
    State.invoiceAmountReceivedTouched = true;
    recalculateInvoice();
  });
  document.getElementById("inv-fully-paid")?.addEventListener("change", (e) => {
    applyFullyPaid(!!e.target.checked);
  });
  document.getElementById("inv-amount-received")?.addEventListener("input", () => {
    if (typeof updateReceivedInVisibility === "function") updateReceivedInVisibility();
  });
  document.querySelectorAll('input[name="inv-pay-mode"]').forEach(radio => {
    radio.addEventListener("change", () => {
      const mode = radio.value;
      if (mode === "CREDIT") {
        State.invoiceAmountReceivedTouched = true;
        const amt = document.getElementById("inv-amount-received");
        if (amt) amt.value = "0";
        const fp = document.getElementById("inv-fully-paid");
        if (fp) fp.checked = false;
      } else {
        State.invoiceAmountReceivedTouched = false;
      }
      syncInvoicePayModeFields();
      recalculateInvoice();
    });
  });
  document.getElementById("inv-doc-type").addEventListener("change", () => {
    syncInvoiceNumberPrefix();
    renderInvoiceLineItems();
    evaluateTaxType(); // 1.13.16: refreshes the tax notice (Bill of Supply vs GST bill) and recalculates
  });
  document.getElementById("btn-save-invoice").addEventListener("click", () => saveCurrentInvoice(false));
  document.getElementById("btn-save-print-invoice").addEventListener("click", () => saveCurrentInvoice(true));

  // Transport Collapsible
  document.getElementById("transport-toggle-btn")?.addEventListener("click", () => {
    const container = document.getElementById("transport-inputs-container");
    const text = document.getElementById("transport-toggle-text");
    if (container.classList.contains("d-none")) {
      container.classList.remove("d-none");
      text.textContent = "- Collapse";
    } else {
      container.classList.add("d-none");
      text.textContent = "+ Expand";
    }
  });

  // Print Modal
  document.getElementById("btn-close-print-modal").addEventListener("click", () => {
    document.getElementById("modal-print-preview").classList.remove("open");
  });
  document.getElementById("print-template-select").addEventListener("change", renderPrintableCanvas);
  document.getElementById("print-theme-select")?.addEventListener("change", renderPrintableCanvas);
  document.getElementById("btn-print-whatsapp").addEventListener("click", () => {
    if (State.activeInvoiceForPrint) shareWhatsAppInvoice(State.activeInvoiceForPrint.id);
  });

  // Barcode Modal
  document.getElementById("btn-open-barcode-modal")?.addEventListener("click", openBarcodeModal);
  document.getElementById("btn-close-barcode-modal")?.addEventListener("click", () => {
    document.getElementById("modal-barcode").classList.remove("open");
  });
  document.getElementById("btn-cancel-barcode")?.addEventListener("click", () => {
    document.getElementById("modal-barcode").classList.remove("open");
  });
  document.getElementById("barcode-item-select")?.addEventListener("change", renderBarcodeStickers);
  document.getElementById("barcode-sticker-count")?.addEventListener("input", renderBarcodeStickers);
  document.getElementById("barcode-label-size")?.addEventListener("change", renderBarcodeStickers);

  // Voucher Modal
  document.getElementById("btn-close-voucher-modal")?.addEventListener("click", () => {
    document.getElementById("modal-receipt-voucher").classList.remove("open");
  });
  document.getElementById("btn-close-voucher-btn")?.addEventListener("click", () => {
    document.getElementById("modal-receipt-voucher").classList.remove("open");
  });

  // Parties View & Payment
  document.getElementById("btn-party-record-payment")?.addEventListener("click", () => {
    const party = State.parties.find(p => p.id === State.selectedPartyId);
    if (!party) return;
    document.getElementById("pay-party-name").value = `${party.name} (Due: ${formatINR(party.balance)})`;
    document.getElementById("pay-date").value = todayISO();
    document.getElementById("pay-amount").value = party.balance > 0 ? party.balance : "";
    window.__payDirection = party.balType === "PAYABLE" ? "OUT" : "IN";
    const payLabel = document.getElementById("pay-account-label");
    if (payLabel) payLabel.textContent = window.__payDirection === "OUT" ? "Paid from" : "Received in";
    if (typeof fillAccountSelect === "function") {
      fillAccountSelect(document.getElementById("pay-account-id"), {
        mode: document.getElementById("pay-mode")?.value || "UPI"
      });
    }

    document.getElementById("modal-payment").classList.add("open");
  });

  document.getElementById("btn-close-payment-modal")?.addEventListener("click", () => {
    document.getElementById("modal-payment").classList.remove("open");
  });
  document.getElementById("btn-cancel-payment")?.addEventListener("click", () => {
    document.getElementById("modal-payment").classList.remove("open");
  });

  document.getElementById("btn-voucher-print")?.addEventListener("click", () => {
    const last = [...(State.payments || [])].reverse().find(p => p.direction !== "LOYALTY");
    if (last && typeof printPaymentReceipt === "function") printPaymentReceipt(last.id, "a4");
    else window.print();
  });
  document.getElementById("btn-close-voucher-modal")?.addEventListener("click", () => {
    document.getElementById("modal-receipt-voucher")?.classList.remove("open");
  });
  document.getElementById("btn-close-voucher-btn")?.addEventListener("click", () => {
    document.getElementById("modal-receipt-voucher")?.classList.remove("open");
  });

  document.getElementById("btn-save-payment")?.addEventListener("click", () => {
    const amt = Number(document.getElementById("pay-amount").value);
    if (!amt || amt <= 0) {
      showToast("Please enter a valid amount", "error");
      return;
    }
    const party = State.parties.find(p => p.id === State.selectedPartyId);
    if (!party) return;

    const direction = party.balType === "PAYABLE" ? "OUT" : "IN";
    const mode = document.getElementById("pay-mode").value;
    const notes = document.getElementById("pay-notes").value;
    const seriesKey = direction === "OUT" ? "PAYMENT" : "RECEIPT";
    const payDate = document.getElementById("pay-date")?.value || new Date().toISOString().slice(0, 10);
    let rcvNo;
    if (typeof BillSetuDocNumbering !== "undefined") {
      rcvNo = BillSetuDocNumbering.previewNextNumber(seriesKey, payDate);
    } else {
      const prefix = direction === "OUT" ? "PMT" : "RCT";
      let seq = 0;
      State.payments.forEach(pay => {
        if (!String(pay.receiptNo || "").startsWith(prefix)) return;
        const match = String(pay.receiptNo).match(/(\d+)\s*$/);
        if (match) seq = Math.max(seq, Number(match[1]));
      });
      rcvNo = `${prefix}-${String(seq + 1).padStart(4, "0")}`;
    }
    if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.isDuplicateReceiptNo(rcvNo)) {
      showToast("That receipt number already exists. Update numbering in Settings.", "error");
      return;
    }
    let left = Math.round(amt * 100) / 100;
    const settlements = [];
    if (direction === "IN") {
      const openBills = State.invoices.filter(inv =>
        inv.partyId === party.id &&
        isPostedSale(inv) &&
        (Number(inv.balanceDue) || 0) > 0.009
      ).sort((a, b) => String(a.date).localeCompare(String(b.date)));
      openBills.forEach(inv => {
        if (left <= 0.009) return;
        if (inv.collectedOnBill == null) inv.collectedOnBill = invoiceCollectedOnBill(inv);
        const due = Number(inv.balanceDue) || 0;
        const appliedAmt = Math.min(due, left);
        inv.paidAmount = Math.round(((Number(inv.paidAmount) || Number(inv.amountReceived) || 0) + appliedAmt) * 100) / 100;
        inv.amountReceived = inv.paidAmount;
        inv.balanceDue = Math.max(0, Math.round((due - appliedAmt) * 100) / 100);
        inv.status = inv.balanceDue <= 0.009 ? "PAID" : "PARTIAL";
        // 1.13.5 (B3): the settled bill must sync to other devices, like supplier bills do.
        if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(inv);
        settlements.push({ invoiceId: inv.id, invoiceNo: inv.invoiceNo, date: inv.date, amount: appliedAmt });
        left = Math.round((left - appliedAmt) * 100) / 100;
      });
    }
    if (direction === "OUT") {
      // Payment on account to a supplier: settle its open purchase bills oldest-first, like sales.
      const openPurchases = (State.purchases || []).filter(pur =>
        pur.supplierId === party.id &&
        !pur.cancelled && String(pur.status || "").toUpperCase() !== "CANCELLED" &&
        (Number(pur.balanceDue) || 0) > 0.009
      ).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || a.id).localeCompare(String(b.createdAt || b.id)));
      openPurchases.forEach(pur => {
        if (left <= 0.009) return;
        // Keep what was paid on the bill itself, so books / day book never count a settlement twice.
        if (pur.paidOnBill == null) pur.paidOnBill = purchasePaidOnBill(pur);
        const due = Number(pur.balanceDue) || 0;
        const appliedAmt = Math.min(due, left);
        pur.paidAmount = Math.round(((Number(pur.paidAmount) || 0) + appliedAmt) * 100) / 100;
        pur.balanceDue = Math.max(0, Math.round((due - appliedAmt) * 100) / 100);
        pur.status = pur.balanceDue <= 0.009 ? "PAID" : "PARTIAL";
        if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(pur);
        settlements.push({ purchaseId: pur.id, billNo: pur.billNo, date: pur.date, amount: appliedAmt });
        left = Math.round((left - appliedAmt) * 100) / 100;
      });
    }
    const applied = Math.round((amt - left) * 100) / 100;
    if (direction === "OUT") {
      const owed = Number(party.balance) || 0;
      if (amt >= owed - 0.009) {
        const extra = Math.round((amt - owed) * 100) / 100;
        party.balance = extra;
        party.balType = extra > 0.009 ? "RECEIVABLE" : "PAYABLE";
      } else party.balance = Math.round((owed - amt) * 100) / 100;
    } else if ((party.balType || "RECEIVABLE") !== "PAYABLE") {
      const owed = Number(party.balance) || 0;
      const cover = Math.min(owed, amt);
      const extra = Math.round((amt - cover) * 100) / 100;
      if (extra > 0.009) {
        party.balance = extra;
        party.balType = "PAYABLE";
      } else party.balance = Math.max(0, Math.round((owed - cover) * 100) / 100);
    } else {
      party.balance = Math.round(((Number(party.balance) || 0) + amt) * 100) / 100;
    }
    // 1.13.5 (B3): the party's new balance must sync too.
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(party);
    const payId = State._editingPaymentId || ("pay-" + Date.now());
    State._editingPaymentId = null;
    const accountId = document.getElementById("pay-account-id")?.value
      || (typeof defaultAccountIdForMode === "function" ? defaultAccountIdForMode(mode) : (mode === "CASH" ? "l-cash" : "l-bank"));
    if (typeof rememberAccountId === "function") rememberAccountId(accountId);
    State.payments.push({
      id: payId,
      receiptNo: rcvNo,
      date: document.getElementById("pay-date").value,
      partyId: party.id,
      partyName: party.name,
      direction,
      amount: amt,
      mode,
      accountId,
      notes,
      applied,
      settlements,
      createdAt: new Date().toISOString()
    });
    if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(State.payments[State.payments.length - 1]);
    if (typeof BillSetuDocNumbering !== "undefined") {
      BillSetuDocNumbering.commitDocNumber(seriesKey, rcvNo, payDate);
    }
    if (typeof logActivity === "function") logActivity(direction === "OUT" ? `Payment ${formatINR(amt)}` : `Receipt ${formatINR(amt)}`);
    saveToStorage();
    document.getElementById("modal-payment").classList.remove("open");
    if (accountId) moneyToAccountToast(accountId, amt, direction === "OUT" ? "OUT" : "IN");
    else showToast(`Payment of ${formatINR(amt)} recorded for ${party.name}`);
    selectParty(party.id);
    renderDashboard();

    // Show Printable Payment Receipt Voucher
    openReceiptVoucher({
      id: payId,
      receiptNo: rcvNo,
      date: document.getElementById("pay-date").value,
      partyName: party.name,
      partyPhone: party.phone,
      amount: amt,
      mode,
      notes
    });
    // Prefer native/PC receipt template print from voucher modal
    const vp = document.getElementById("btn-voucher-print");
    if (vp) vp.onclick = () => { if (typeof printPaymentReceipt === "function") printPaymentReceipt(payId, "a4"); };
  });

  // Parties View
  document.getElementById("btn-add-party-modal").addEventListener("click", openAddPartyModal);
  document.getElementById("btn-close-party-modal").addEventListener("click", () => {
    document.getElementById("modal-party").classList.remove("open");
  });
  document.getElementById("btn-cancel-party").addEventListener("click", () => {
    document.getElementById("modal-party").classList.remove("open");
  });
  document.getElementById("btn-save-party").addEventListener("click", saveNewParty);
  document.getElementById("btn-party-edit")?.addEventListener("click", () => openEditPartyModal(State.selectedPartyId));
  document.getElementById("btn-party-delete")?.addEventListener("click", () => deleteParty(State.selectedPartyId));
  document.getElementById("party-search-input").addEventListener("input", renderParties);
  document.querySelectorAll("#party-type-filter .tab-pill").forEach(tab => {
    tab.addEventListener("click", e => {
      document.querySelectorAll("#party-type-filter .tab-pill").forEach(t => t.classList.remove("active"));
      e.target.classList.add("active");
      renderParties();
    });
  });

  ["party-stmt-from", "party-stmt-to"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", () => {
      if (State.selectedPartyId) selectParty(State.selectedPartyId);
    });
  });
  document.getElementById("party-stmt-all")?.addEventListener("click", () => {
    const f = document.getElementById("party-stmt-from"), t = document.getElementById("party-stmt-to");
    if (f) f.value = "";
    if (t) t.value = "";
    if (State.selectedPartyId) selectParty(State.selectedPartyId);
  });
  document.getElementById("btn-party-share-statement")?.addEventListener("click", async () => {
    const party = State.parties.find(p => p.id === State.selectedPartyId);
    if (!party) return;
    const stmt = partyStatement(party.id, {
      from: document.getElementById("party-stmt-from")?.value || "",
      to: document.getElementById("party-stmt-to")?.value || ""
    });
    const text = partyStatementText(stmt);
    State._lastStatementShareText = text;
    const shared = typeof shareTextNative === "function" ? await shareTextNative(`Statement - ${party.name}`, text) : false;
    if (shared) return;
    let phone = String(party.phone || "").replace(/\D/g, "");
    if (phone.length > 10) phone = phone.slice(-10);
    const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  });

  document.getElementById("btn-party-whatsapp-reminder").addEventListener("click", () => {
    const party = State.parties.find(p => p.id === State.selectedPartyId);
    if (!party) return;
    let phone = String(party.phone || "").replace(/\D/g, "");
    if (phone.length > 10) phone = phone.slice(-10);
    const text = `Namaste ${party.name},\nThis is a friendly payment reminder${bizName() ? ` from *${bizName()}*` : ""}.\nYour outstanding balance is *${formatINR(party.balance)}*.\n${paymentInstructionText({ bank: true, lead: "Please pay at the earliest" }) || "Please clear it at the earliest."}\nThank you!`;
    const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(text)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank');
  });

  document.getElementById("btn-party-create-bill").addEventListener("click", () => {
    openNewInvoiceModal();
    if (State.selectedPartyId) {
      document.getElementById("inv-party-select").value = State.selectedPartyId;
      updateInvoicePartyMeta();
    }
  });

  // Inventory View
  document.getElementById("btn-add-item-modal").addEventListener("click", openAddItemModal);
  document.getElementById("btn-close-item-modal").addEventListener("click", closeItemModal);
  document.getElementById("btn-cancel-item").addEventListener("click", closeItemModal);
  document.getElementById("btn-save-item").addEventListener("click", saveNewItem);
  document.getElementById("item-track-serial").addEventListener("change", syncSerialTools);
  document.getElementById("serial-scan-input").addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    addDraftSerial(e.target.value);
  });
  document.getElementById("btn-serial-add").addEventListener("click", () => addDraftSerial(document.getElementById("serial-scan-input").value));
  document.getElementById("btn-serial-stop").addEventListener("click", stopSerialScan);
  document.getElementById("inventory-search-input").addEventListener("input", renderInventoryTable);
  document.getElementById("inventory-category-filter").addEventListener("change", renderInventoryTable);
  document.getElementById("btn-filter-low-stock")?.addEventListener("click", () => {
    State.lowStockOnly = !State.lowStockOnly;
    const button = document.getElementById("btn-filter-low-stock");
    if (button) button.classList.toggle("is-on", State.lowStockOnly);
    renderInventoryTable();
  });

  // Purchases View
  document.getElementById("btn-create-purchase-modal").addEventListener("click", () => {
    if (typeof openPurchaseBillModal === "function") {
      openPurchaseBillModal();
      return;
    }
    showToast("Purchase form is not loaded.", "error");
  });

  // Expenses View
  document.getElementById("btn-add-expense-modal").addEventListener("click", openAddExpenseModal);
  document.getElementById("btn-close-expense-modal").addEventListener("click", () => {
    document.getElementById("modal-expense").classList.remove("open");
  });
  document.getElementById("btn-cancel-expense").addEventListener("click", () => {
    document.getElementById("modal-expense").classList.remove("open");
  });
  document.getElementById("btn-save-expense").addEventListener("click", saveNewExpense);

  // Reports
  // 1.13.9 (M1): #accounts-tabs shares the reports-tabs class; it has its own handler.
  document.querySelectorAll(".reports-tabs .tab-pill[data-report]").forEach(tab => {
    tab.addEventListener("click", e => {
      document.querySelectorAll(".reports-tabs .tab-pill[data-report]").forEach(t => t.classList.remove("active"));
      e.target.classList.add("active");
      const r = e.target.getAttribute("data-report");
      document.querySelectorAll(".report-panel").forEach(p => p.classList.add("d-none"));
      document.getElementById(`report-panel-${r}`).classList.remove("d-none");
    });
  });

  document.getElementById("daybook-date-picker").addEventListener("change", e => {
    renderDaybook(e.target.value);
  });
  document.getElementById("gstr-month")?.addEventListener("change", renderReports);
  document.getElementById("btn-export-sales-csv")?.addEventListener("click", exportSalesCsv);
  document.getElementById("btn-share-catalogue")?.addEventListener("click", shareCatalogue);
  document.getElementById("inventory-more-btn")?.addEventListener("click", () => {
    document.getElementById("inventory-more")?.classList.toggle("open");
  });
  document.getElementById("btn-open-po")?.addEventListener("click", openPurchaseOrderModal);
  document.getElementById("btn-open-debit")?.addEventListener("click", openDebitNoteModal);
  document.getElementById("btn-close-po")?.addEventListener("click", () => document.getElementById("modal-po").classList.remove("open"));
  document.getElementById("btn-cancel-po")?.addEventListener("click", () => document.getElementById("modal-po").classList.remove("open"));
  document.getElementById("btn-save-po")?.addEventListener("click", savePurchaseOrder);
  document.getElementById("po-item")?.addEventListener("change", () => {
    const item = State.items.find(i => i.id === document.getElementById("po-item").value);
    if (item) document.getElementById("po-rate").value = item.costPrice;
  });
  document.getElementById("btn-close-debit")?.addEventListener("click", () => document.getElementById("modal-debit").classList.remove("open"));
  document.getElementById("btn-cancel-debit")?.addEventListener("click", () => document.getElementById("modal-debit").classList.remove("open"));
  document.getElementById("btn-save-debit")?.addEventListener("click", saveDebitNote);
  document.getElementById("dn-item")?.addEventListener("change", () => {
    const item = State.items.find(i => i.id === document.getElementById("dn-item").value);
    if (item) document.getElementById("dn-rate").value = item.costPrice;
  });
  document.getElementById("btn-party-redeem-loyalty")?.addEventListener("click", redeemLoyalty);
  document.getElementById("pos-search")?.addEventListener("input", renderPos);
  document.getElementById("pos-serial-input")?.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    posScanSerial(e.target.value);
  });
  document.getElementById("pos-price-list")?.addEventListener("change", () => {
    State.posCart = [];
    renderPos();
  });
  document.getElementById("pos-party")?.addEventListener("change", renderPosCart);
  document.getElementById("btn-pos-checkout")?.addEventListener("click", checkoutPos);

  // Settings
  document.getElementById("btn-save-settings").addEventListener("click", saveSettingsForm);
  if (typeof BillSetuGstin !== "undefined") {
    BillSetuGstin.populateStateSelect(document.getElementById("party-input-state"), State.business?.stateCode || "");
    BillSetuGstin.populateStateSelect(document.getElementById("set-state"), State.business?.stateCode || "");
    BillSetuGstin.bindGstinField(document.getElementById("party-input-gstin"), {
      stateSelect: document.getElementById("party-input-state"),
      hintEl: document.getElementById("party-gstin-hint")
    });
    BillSetuGstin.bindGstinField(document.getElementById("set-gstin"), {
      stateSelect: document.getElementById("set-state"),
      panInput: document.getElementById("set-pan"),
      hintEl: document.getElementById("set-gstin-hint")
    });
  }
  if (typeof BillSetuReportPrint !== "undefined") BillSetuReportPrint.wireReportPrintButtons();
  document.getElementById("btn-export-json")?.addEventListener("click", exportJSONBackup);
  document.getElementById("btn-export-data")?.addEventListener("click", exportJSONBackup);
  try {
    const mq = window.matchMedia("(min-width: 801px)");
    const sync = () => syncRowMenusForViewport();
    if (mq.addEventListener) mq.addEventListener("change", sync);
    else if (mq.addListener) mq.addListener(sync);
    sync();
  } catch (_) {}

  document.getElementById("btn-import-trigger")?.addEventListener("click", triggerImportJSON);
  document.getElementById("btn-import-data")?.addEventListener("click", triggerImportJSON);
  document.getElementById("input-import-json").addEventListener("change", handleImportJSON);
  document.getElementById("btn-lock-app").addEventListener("click", lockApp);
  document.getElementById("btn-change-lock").addEventListener("click", changeLockPassword);
  document.getElementById("auth-form").addEventListener("submit", submitAuth);

  // Sales Search & Filter
  document.getElementById("sales-search-input").addEventListener("input", renderSalesTable);
  document.getElementById("sales-filter-type").addEventListener("change", renderSalesTable);
  document.getElementById("sales-filter-status").addEventListener("change", () => {
    document.getElementById("btn-filter-unpaid")?.classList.toggle("is-on", document.getElementById("sales-filter-status").value === "UNPAID");
    renderSalesTable();
  });
  document.getElementById("btn-filter-unpaid").addEventListener("click", () => {
    document.getElementById("sales-filter-status").value = "UNPAID";
    document.getElementById("btn-filter-unpaid").classList.add("is-on");
    renderSalesTable();
  });

  const globalSearch = document.getElementById("global-search");
  globalSearch.addEventListener("input", () => renderSearchPanel("search-results", globalSearch.value, false));
  globalSearch.addEventListener("keydown", e => moveSearchCursor(e, "search-results"));
  const invoiceSearch = document.getElementById("invoice-item-search");
  invoiceSearch.addEventListener("focus", () => renderSearchPanel("invoice-item-results", invoiceSearch.value, true));
  invoiceSearch.addEventListener("input", () => renderSearchPanel("invoice-item-results", invoiceSearch.value, true));
  invoiceSearch.addEventListener("keydown", e => moveSearchCursor(e, "invoice-item-results"));
  document.getElementById("search-results").addEventListener("click", chooseSearchHit);
  document.getElementById("invoice-item-results").addEventListener("click", chooseSearchHit);
  document.addEventListener("click", e => {
    if (e.target.closest(".search-box, .catalog-search")) return;
    hideSearchPanels();
  });

  // Keyboard Shortcuts
  window.addEventListener("keydown", async e => {
    if (e.key === "Escape") {
      const discardModal = document.getElementById("modal-discard-draft");
      if (discardModal?.classList.contains("open")) {
        finishDiscardDraft(false);
        return;
      }
      if (isInvoiceFormOpen() && isInvoiceDraftDirty()) {
        const discard = await askDiscardDraft();
        if (!discard) return;
      }
      stopSerialScan();
      hideSearchPanels();
      document.querySelectorAll(".modal-backdrop").forEach(m => m.classList.remove("open"));
      document.body.classList.remove("invoice-modal-open");
      State.editingInvoiceId = null;
    } else if ((e.altKey && (e.key === "n" || e.key === "N")) || e.key === "F2") {
      if (!document.body.classList.contains("books-open")) return;
      if (typeof canWrite === "function" && !canWrite("sales")) return;
      e.preventDefault();
      openNewInvoiceModal();
    } else if (e.ctrlKey && e.key === "k") {
      e.preventDefault();
      document.getElementById("global-search").focus();
    }
  });
}

function todayISO() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const pick = type => parts.find(part => part.type === type)?.value || "01";
  return `${pick("year")}-${pick("month")}-${pick("day")}`;
}

function daysPastDue(dueDate) {
  if (!dueDate) return 0;
  const due = new Date(dueDate + "T00:00:00");
  const today = new Date(todayISO() + "T00:00:00");
  return Math.round((today - due) / 86400000);
}

function orderTotals(lines) {
  let taxable = 0;
  let gst = 0;
  (lines || []).forEach(line => {
    const base = (Number(line.qty) || 0) * (Number(line.rate) || 0);
    taxable += base;
    gst += base * ((Number(line.gstRate) || 0) / 100);
  });
  const tax = Math.round(taxable * 100) / 100;
  const taxGst = Math.round(gst * 100) / 100;
  return { taxable: tax, gst: taxGst, total: Math.round(tax + taxGst) };
}

function renderOverdueFollowups() {
  const body = document.getElementById("dash-overdue-body");
  const countEl = document.getElementById("overdue-count");
  if (!body) return;
  const overdue = State.invoices.filter(inv => isPostedSale(inv) && inv.balanceDue > 0 && daysPastDue(inv.dueDate) > 0);
  if (countEl) countEl.textContent = `${overdue.length} bill${overdue.length === 1 ? "" : "s"} past due date`;
  if (overdue.length === 0) {
    body.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:18px;">No overdue bills. Collections are up to date.</td></tr>`;
    return;
  }
  body.innerHTML = overdue.map(inv => `
    <tr>
      <td><strong>${escHtml(inv.invoiceNo)}</strong></td>
      <td>${escHtml(inv.partyName)}</td>
      <td>${escHtml(inv.dueDate || "")}</td>
      <td class="text-red">${daysPastDue(inv.dueDate)} days</td>
      <td><strong>${formatINR(inv.balanceDue)}</strong></td>
      <td><button class="btn btn-outline btn-sm" onclick="remindOverdue('${inv.id}')">WhatsApp reminder</button></td>
    </tr>
  `).join("");
}

function remindOverdue(invoiceId) {
  const inv = State.invoices.find(i => i.id === invoiceId);
  if (!inv) return;
  const phone = String(inv.partyPhone || "").replace(/\D/g, "");
  const text = `Namaste ${inv.partyName},\n${bizName() ? `Reminder from *${bizName()}*` : "Reminder"} for bill *${inv.invoiceNo}*.\nDue on ${inv.dueDate}. Balance still open: *${formatINR(inv.balanceDue)}*.${paymentInstructionText({ lead: "Pay" }) ? "\n" + paymentInstructionText({ lead: "Pay" }) : ""}`;
  const url = phone ? `https://wa.me/91${phone.slice(-10)}?text=${encodeURIComponent(text)}` : `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

function renderOrdersAndDebits() {
  const ordersBody = document.getElementById("orders-table-body");
  const debitsBody = document.getElementById("debits-table-body");
  if (ordersBody) {
    if (!State.purchaseOrders.length) {
      ordersBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted" style="padding:16px;">No purchase orders yet.</td></tr>`;
    } else {
      ordersBody.innerHTML = sortDocsDefault(State.purchaseOrders, "orders", ["poNo"]).map(po => {
        const totals = orderTotals(po.items);
        const action = po.status === "OPEN"
          ? `<button class="btn btn-primary btn-sm" onclick="convertPurchaseOrder('${po.id}')">Receive as purchase</button>`
          : `<span class="badge badge-paid">Received</span>`;
        return `<tr>
          <td><strong>${po.poNo}</strong></td>
          <td>${po.date}</td>
          <td>${po.supplierName}</td>
          <td>${formatINR(totals.total)}</td>
          <td><span class="badge ${po.status === "OPEN" ? "badge-partial" : "badge-paid"}">${po.status}</span></td>
          <td>${action}</td>
        </tr>`;
      }).join("");
    }
  }
  if (debitsBody) {
    if (!State.debitNotes.length) {
      debitsBody.innerHTML = `<tr><td colspan="5" class="text-center text-muted" style="padding:16px;">No debit notes yet.</td></tr>`;
    } else {
      debitsBody.innerHTML = sortDocsDefault(State.debitNotes, "debits", ["noteNo"]).map(note => `<tr>
        <td><strong>${note.noteNo}</strong></td>
        <td>${note.date}</td>
        <td>${note.supplierName}</td>
        <td>${note.againstBill || "-"}</td>
        <td><strong>${formatINR(note.total)}</strong></td>
      </tr>`).join("");
    }
  }
}

function fillSupplierSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const suppliers = State.parties.filter(p => p.type === "SUPPLIER");
  select.innerHTML = suppliers.map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join("");
}

function fillItemSelect(selectId) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = State.items.map(item => `<option value="${escHtml(item.id)}">${escHtml(item.name)}</option>`).join("");
}

function openPurchaseOrderModal() {
  fillSupplierSelect("po-supplier");
  fillItemSelect("po-item");
  document.getElementById("po-date").value = todayISO();
  document.getElementById("po-expected").value = todayISO();
  document.getElementById("po-qty").value = 1;
  const item = State.items[0];
  if (item) document.getElementById("po-rate").value = item.costPrice;
  document.getElementById("po-notes").value = "";
  document.getElementById("modal-po").classList.add("open");
}

function savePurchaseOrder() {
  if (typeof blockedAction === "function" && blockedAction("purchase")) return;
  const supplier = State.parties.find(p => p.id === document.getElementById("po-supplier").value);
  const item = State.items.find(i => i.id === document.getElementById("po-item").value);
  const qty = Number(document.getElementById("po-qty").value);
  const rate = Number(document.getElementById("po-rate").value);
  if (!supplier || !item || !qty || qty <= 0) {
    showToast("Supplier, item and quantity are required", "error");
    return;
  }
  const poDate = document.getElementById("po-date").value || todayISO();
  let poNo = (typeof BillSetuDocNumbering !== "undefined")
    ? BillSetuDocNumbering.previewNextNumber("PURCHASE_ORDER", poDate)
    : (typeof nextDocNo === "function" ? nextDocNo("PO") : ("PO-" + String((State.purchaseOrders || []).length + 1).padStart(4, "0")));
  State.purchaseOrders.push({
    id: "po-" + Date.now(),
    poNo,
    date: poDate,
    expectedDate: document.getElementById("po-expected").value,
    supplierId: supplier.id,
    supplierName: supplier.name,
    status: "OPEN",
    notes: document.getElementById("po-notes").value.trim(),
    items: [{ itemId: item.id, description: item.name, qty, rate, gstRate: item.gstRate }]
  });
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.commitDocNumber) {
    BillSetuDocNumbering.commitDocNumber("PURCHASE_ORDER", poNo, poDate);
  }
  if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) {
    BillSetuSync.markUpdated(State.purchaseOrders[State.purchaseOrders.length - 1]);
  }
  saveToStorage();
  document.getElementById("modal-po").classList.remove("open");
  showToast("Purchase order saved. Stock stays unchanged until you receive it.");
  renderPurchasesTable();
}

function convertPurchaseOrder(poId) {
  if (!requireBusinessState("a purchase")) return;
  const po = State.purchaseOrders.find(p => p.id === poId);
  if (!po || po.status !== "OPEN") return;
  const totals = orderTotals(po.items);
  const supplier = State.parties.find(p => p.id === po.supplierId);
  State.purchases.push({
    id: "pur-" + Date.now(),
    billNo: po.poNo.replace("PO-", "IN-"),
    date: todayISO(),
    supplierId: po.supplierId,
    supplierName: po.supplierName,
    supplierGstin: supplier?.gstin || "",
    taxableAmount: Math.round(totals.taxable),
    gstAmount: Math.round(totals.gst),
    ...purchaseGstFields(supplier, Math.round(totals.gst)),
    totalBill: totals.total,
    paidAmount: 0,
    balanceDue: totals.total,
    status: "UNPAID"
  });
  po.items.forEach(line => {
    const stockItem = State.items.find(i => i.id === line.itemId);
    if (stockItem) stockItem.stock += line.qty;
  });
  if (supplier) {
    supplier.balance = (supplier.balance || 0) + totals.total;
    supplier.balType = "PAYABLE";
  }
  po.status = "RECEIVED";
  saveToStorage();
  showToast(`${po.poNo} received. Stock increased and supplier dues updated.`);
  renderPurchasesTable();
  renderDashboard();
}

function openDebitNoteModal() {
  fillSupplierSelect("dn-supplier");
  fillItemSelect("dn-item");
  document.getElementById("dn-date").value = todayISO();
  document.getElementById("dn-against").value = "";
  document.getElementById("dn-qty").value = 1;
  const item = State.items[0];
  if (item) document.getElementById("dn-rate").value = item.costPrice;
  document.getElementById("modal-debit").classList.add("open");
}

function saveDebitNote() {
  if (!requireBusinessState("a debit note")) return;
  const supplier = State.parties.find(p => p.id === document.getElementById("dn-supplier").value);
  const item = State.items.find(i => i.id === document.getElementById("dn-item").value);
  const qty = Number(document.getElementById("dn-qty").value);
  const rate = Number(document.getElementById("dn-rate").value);
  if (!supplier || !item || !qty || qty <= 0) {
    showToast("Supplier, item and quantity are required", "error");
    return;
  }
  const totals = orderTotals([{ qty, rate, gstRate: item.gstRate }]);
  const dnDate = document.getElementById("dn-date").value || todayISO();
  let noteNo = (typeof BillSetuDocNumbering !== "undefined")
    ? BillSetuDocNumbering.previewNextNumber("DEBIT_NOTE", dnDate)
    : (typeof nextDocNo === "function" ? nextDocNo("DN") : ("DN-" + String((State.debitNotes || []).length + 1).padStart(4, "0")));
  const note = {
    id: "dn-" + Date.now(),
    noteNo,
    date: dnDate,
    supplierId: supplier.id,
    supplierName: supplier.name,
    againstBill: document.getElementById("dn-against").value.trim(),
    itemName: item.name,
    qty,
    total: totals.total,
    gstAmount: Math.round(totals.gst),
    isInterstate: !!isInterstateFor(partyStateCode(supplier)) // 1.13.16: stored like purchases
  };
  item.stock += qty;
  supplier.balance = Math.max(0, (supplier.balance || 0) - totals.total);
  State.debitNotes.push(note);
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.commitDocNumber) {
    BillSetuDocNumbering.commitDocNumber("DEBIT_NOTE", note.noteNo, note.date);
  }
  if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(note);
  saveToStorage();
  document.getElementById("modal-debit").classList.remove("open");
  showToast(`Debit note ${note.noteNo} for ${formatINR(totals.total)} adjusted against ${supplier.name}.`);
  renderPurchasesTable();
  renderDashboard();
}

function renderExtendedReports() {
  const outward = State.invoices.filter(isPostedSale);
  const creditNotes = State.invoices.filter(i => i.docType === "CREDIT_NOTE");
  const outputTax = outward.reduce((s, i) => s + (i.cgstTotal || 0) + (i.sgstTotal || 0) + (i.igstTotal || 0), 0);
  const creditTax = creditNotes.reduce((s, i) => s + (i.cgstTotal || 0) + (i.sgstTotal || 0) + (i.igstTotal || 0), 0);
  const purchaseItc = State.purchases.reduce((s, p) => s + (p.gstAmount || 0), 0);
  const debitItc = State.debitNotes.reduce((s, n) => s + (n.gstAmount || 0), 0);
  const itc = Math.max(0, purchaseItc - debitItc);
  const netPayable = (outputTax - creditTax) - itc;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  setText("gstr2-count", String(State.purchases.length));
  setText("gstr2-taxable", formatINR(State.purchases.reduce((s, p) => s + (p.taxableAmount || 0), 0)));
  setText("gstr2-itc", formatINR(itc));
  setText("gstr3b-outward", formatINR(outputTax));
  setText("gstr3b-credit", formatINR(creditTax));
  setText("gstr3b-itc", formatINR(itc));
  setText("gstr3b-net", formatINR(netPayable));

  const gstr2Body = document.getElementById("gstr2-table-body");
  if (gstr2Body) {
    gstr2Body.innerHTML = State.purchases.map(p => `<tr>
      <td>${escHtml(p.billNo)}</td><td>${escHtml(p.date)}</td><td>${escHtml(p.supplierName)}</td><td>${escHtml(p.supplierGstin || "-")}</td>
      <td>${formatINR(p.taxableAmount)}</td><td>${formatINR(p.gstAmount)}</td><td>${formatINR(p.totalBill)}</td>
    </tr>`).join("") || `<tr><td colspan="7" class="text-center text-muted">No inward bills.</td></tr>`;
  }

  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
  const agingRows = [];
  State.invoices.filter(inv => isPostedSale(inv) && inv.balanceDue > 0).forEach(inv => {
    const late = daysPastDue(inv.dueDate);
    let bucket = "Not yet due";
    if (late <= 0) buckets.current += inv.balanceDue;
    else if (late <= 30) { buckets.d30 += inv.balanceDue; bucket = "1–30 days"; }
    else if (late <= 60) { buckets.d60 += inv.balanceDue; bucket = "31–60 days"; }
    else if (late <= 90) { buckets.d90 += inv.balanceDue; bucket = "61–90 days"; }
    else { buckets.d90p += inv.balanceDue; bucket = "90+ days"; }
    if (late > 0) bucket = late <= 0 ? "Not yet due" : bucket;
    agingRows.push({ inv, late, bucket: late <= 0 ? "Not yet due" : bucket });
  });
  setText("age-current", formatINR(buckets.current));
  setText("age-30", formatINR(buckets.d30));
  setText("age-60", formatINR(buckets.d60));
  setText("age-90", formatINR(buckets.d90));
  setText("age-90p", formatINR(buckets.d90p));
  const agingBody = document.getElementById("aging-table-body");
  if (agingBody) {
    agingBody.innerHTML = agingRows.map(row => `<tr>
      <td>${escHtml(row.inv.invoiceNo)}</td><td>${escHtml(row.inv.partyName)}</td><td>${escHtml(row.inv.dueDate || "-")}</td>
      <td>${row.bucket}</td><td><strong>${formatINR(row.inv.balanceDue)}</strong></td>
    </tr>`).join("") || `<tr><td colspan="5" class="text-center text-muted">No open balances.</td></tr>`;
  }

  const cashIn = outward.reduce((s, i) => s + invoiceCollectedOnBill(i), 0)
    + State.payments.filter(p => p.direction === "IN").reduce((s, p) => s + p.amount, 0);
  const cashOut = State.expenses.reduce((s, e) => s + (e.amount || 0), 0)
    + State.purchases.reduce((s, p) => s + purchasePaidOnBill(p), 0)
    + State.payments.filter(p => p.direction === "OUT").reduce((s, p) => s + p.amount, 0);
  setText("cash-in", formatINR(cashIn));
  setText("cash-out", formatINR(cashOut));
  setText("cash-net", formatINR(cashIn - cashOut));
}

function exportSalesCsv() {
  const header = ["Date", "Number", "Type", "Party", "GSTIN", "POS", "Taxable", "CGST", "SGST", "IGST", "Total", "Balance"];
  const lines = [header.join(",")];
  State.invoices.forEach(inv => {
    const cells = [inv.date, inv.invoiceNo, inv.docType, inv.partyName, inv.partyGstin || "", inv.posStateName || "",
      inv.taxableTotal, inv.cgstTotal, inv.sgstTotal, inv.igstTotal, inv.grandTotal, inv.balanceDue];
    lines.push(cells.map(cell => `"${String(cell ?? "").replace(/"/g, '""')}"`).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "sales-register.csv";
  link.click();
  URL.revokeObjectURL(link.href);
  showToast("Sales register downloaded for your CA.");
}

function shareCatalogue() {
  const lines = State.items.map(item => `• ${item.name} — ${formatINR(item.sellingPrice)} (GST ${item.gstRate}%)`).join("\n");
  const phone = String(State.business.phone || "").trim();
  const text = `${bizName() ? `*${bizName()}* item list` : "*Item list*"}\n${lines}${phone ? `\n\nTo order, WhatsApp ${phone}` : ""}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank");
}

function redeemLoyalty() {
  const party = State.parties.find(p => p.id === State.selectedPartyId);
  if (!party) return;
  const points = party.loyaltyPoints || 0;
  if (points < 50) {
    showToast("At least 50 points are needed. 1 point = ₹1.", "error");
    return;
  }
  if (party.balType !== "RECEIVABLE" || party.balance <= 0) {
    showToast("Redeem points only against an amount the party still owes.", "error");
    return;
  }
  const rupees = Math.min(points, Math.round(party.balance));
  party.loyaltyPoints -= rupees;
  party.balance = Math.max(0, party.balance - rupees);
  State.payments.push({
    id: "pay-" + Date.now(),
    receiptNo: (typeof BillSetuDocNumbering !== "undefined"
      ? BillSetuDocNumbering.previewNextNumber("RECEIPT", todayISO())
      : (typeof nextDocNo === "function" ? nextDocNo("RCT") : ("LOY-" + String((State.payments || []).length + 1).padStart(4, "0")))),
    date: todayISO(),
    partyId: party.id,
    partyName: party.name,
    direction: "LOYALTY",
    amount: rupees,
    mode: "LOYALTY",
    notes: `Loyalty redeemed, ${rupees} points`
  });
  saveToStorage();
  showToast(`${rupees} points redeemed. ${party.name} now owes ${formatINR(party.balance)}.`);
  renderParties();
  selectParty(party.id);
  renderDashboard();
}

function renderPos() {
  const grid = document.getElementById("pos-item-grid");
  const partySelect = document.getElementById("pos-party");
  if (!grid || !partySelect) return;
  if (!partySelect.options.length) {
    partySelect.innerHTML = State.parties.filter(p => p.type === "CUSTOMER").map(p => `<option value="${escHtml(p.id)}">${escHtml(p.name)}</option>`).join("");
  }
  const query = (document.getElementById("pos-search")?.value || "").toLowerCase();
  const priceList = document.getElementById("pos-price-list")?.value || "RETAIL";
  const items = State.items.filter(item => [item.name, item.brand, item.model, item.code].join(" ").toLowerCase().includes(query));
  grid.innerHTML = items.map(item => {
    const rate = priceList === "WHOLESALE" ? (item.wholesalePrice || item.sellingPrice) : item.sellingPrice;
    const service = isServiceCategory(item.category);
    const low = !service && Number(item.minStock) >= 0 && Number(item.stock) <= Number(item.minStock);
    const chip = service
      ? `<span class="pos-chip">Service</span>`
      : `<span class="pos-chip${low ? " low" : ""}">${escHtml(String(item.stock))} in stock</span>`;
    return `<button type="button" class="pos-item" onclick="posAddItem('${item.id}')">
      <span class="pos-item-name">${escHtml(item.name)}</span>
      <span class="pos-item-price">${formatINR(rate)}</span>
      ${chip}
    </button>`;
  }).join("") || `<p class="text-muted">No items match.</p>`;
  renderPosCart();
}

function posScanSerial(raw) {
  const code = String(raw || "").trim();
  if (!code) return false;
  const item = State.items.find(i => i.trackSerial && (i.serials || []).some(serial => serial.toLowerCase() === code.toLowerCase()));
  if (!item) {
    showToast(`No in-stock item has serial ${code}.`, "error");
    return false;
  }
  const serial = item.serials.find(entry => entry.toLowerCase() === code.toLowerCase());
  if (State.posCart.some(line => (line.serials || []).some(entry => entry.toLowerCase() === serial.toLowerCase()))) {
    showToast("Already scanned. Skipped.");
    return false;
  }
  const priceList = document.getElementById("pos-price-list")?.value || "RETAIL";
  const rate = priceList === "WHOLESALE" ? (item.wholesalePrice || item.sellingPrice) : item.sellingPrice;
  State.posCart.push({
    itemId: item.id,
    description: item.name,
    ...productMeta(item),
    hsn: item.hsn,
    qty: 1,
    unit: item.unit,
    rate,
    gstRate: item.gstRate,
    discPercent: 0,
    serials: [serial]
  });
  const input = document.getElementById("pos-serial-input");
  if (input) input.value = "";
  renderPosCart();
  if (typeof noteImei === "function") noteImei(serial);
  return true;
}

function posAddItem(itemId) {
  const item = State.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.trackSerial) {
    const usedSerials = new Set(State.posCart.flatMap(line => line.serials || []));
    const godownId = document.getElementById("pos-godown")?.value;
    const nextSerial = (item.serials || []).find(code => !usedSerials.has(code) && (!godownId || (item.serialGodown?.[code] || godownId) === godownId));
    if (!nextSerial) {
      showToast("No more available serial numbers in stock for this item.", "error");
      return;
    }
    posScanSerial(nextSerial);
    return;
  }
  const priceList = document.getElementById("pos-price-list")?.value || "RETAIL";
  const rate = priceList === "WHOLESALE" ? (item.wholesalePrice || item.sellingPrice) : item.sellingPrice;
  const existing = State.posCart.find(line => line.itemId === itemId && line.rate === rate && !(line.serials || []).length);
  if (existing) existing.qty += 1;
  else State.posCart.push({
    itemId: item.id,
    description: item.name,
    ...productMeta(item),
    hsn: item.hsn,
    qty: 1,
    unit: item.unit,
    rate,
    gstRate: item.gstRate,
    discPercent: 0,
    serials: []
  });
  renderPosCart();
}

function posChangeQty(index, delta) {
  const line = State.posCart[index];
  if (!line) return;
  const stockItem = State.items.find(i => i.id === line.itemId);
  if (stockItem?.trackSerial) {
    if (delta > 0) {
      showToast("Scan the next serial to add another unit.");
      document.getElementById("pos-serial-input")?.focus();
      return;
    }
    (line.serials || []).pop();
    line.qty = (line.serials || []).length;
    if (line.qty <= 0) State.posCart.splice(index, 1);
    renderPosCart();
    return;
  }
  line.qty += delta;
  if (line.qty <= 0) State.posCart.splice(index, 1);
  renderPosCart();
}

function renderPosCart() {
  const box = document.getElementById("pos-lines");
  const totals = document.getElementById("pos-totals");
  if (!box || !totals) return;
  if (!State.posCart.length) {
    box.innerHTML = `<p class="text-muted text-sm">Tap an item to start the bill.</p>`;
    totals.innerHTML = "";
    return;
  }
  const party = State.parties.find(p => p.id === document.getElementById("pos-party")?.value);
  const interstate = isInterstateFor(defaultPlaceOfSupply(party));   // null = business state missing
  let taxable = 0;
  let tax = 0;
  box.innerHTML = State.posCart.map((line, index) => {
    const base = line.qty * line.rate;
    taxable += base;
    tax += base * (line.gstRate / 100);
    return `<div class="pos-line">
      <div><strong>${escHtml(line.description)}</strong><div class="text-muted text-sm">${formatINR(line.rate)} × ${line.qty}${(line.serials || []).length ? ` · SN ${escHtml(line.serials.join(", "))}` : ""}</div></div>
      <div class="d-flex gap-2 align-center">
        <button class="btn btn-outline btn-sm" onclick="posChangeQty(${index}, -1)">−</button>
        <span>${line.qty}</span>
        <button class="btn btn-outline btn-sm" onclick="posChangeQty(${index}, 1)">+</button>
      </div>
    </div>`;
  }).join("");
  const grand = Math.round(taxable + tax);
  totals.innerHTML = `<div>Taxable ${formatINR(taxable)}</div><div>${interstate === null ? "GST (Set business state)" : interstate ? "IGST" : "CGST + SGST"} ${formatINR(tax)}</div><h3>Total ${formatINR(grand)}</h3>`;
}

function checkoutPos() {
  if (typeof blockedAction === "function" && blockedAction("sales")) return;
  if (!requireBusinessState("a bill")) return;
  if (!State.posCart.length) {
    showToast("Add at least one item", "error");
    return;
  }
  const party = State.parties.find(p => p.id === document.getElementById("pos-party").value);
  if (!party) return;
  const posCodeCounter = defaultPlaceOfSupply(party);
  const isInterstate = isInterstateFor(posCodeCounter);
  let taxableTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;
  const items = State.posCart.map(line => {
    const taxableVal = line.qty * line.rate;
    const taxVal = taxableVal * (line.gstRate / 100);
    taxableTotal += taxableVal;
    if (isInterstate) {
      igstTotal += taxVal;
      return { ...line, taxableVal, cgstVal: 0, sgstVal: 0, igstVal: taxVal, total: taxableVal + taxVal, batchExp: "" };
    }
    const half = taxVal / 2;
    cgstTotal += half;
    sgstTotal += half;
    return { ...line, taxableVal, cgstVal: half, sgstVal: half, igstVal: 0, total: taxableVal + taxVal, batchExp: "" };
  });
  const godownId = document.getElementById("pos-godown")?.value || (typeof defaultGodownId === "function" ? defaultGodownId() : "");
  items.forEach(line => { line.godownId = godownId; });
  const grandTotal = Math.round(taxableTotal + cgstTotal + sgstTotal + igstTotal);
  const mode = document.querySelector('input[name="pos-pay-mode"]:checked')?.value || "CASH";
  const received = mode === "CREDIT" ? 0 : grandTotal;
  const balanceDue = grandTotal - received;
  if (!serialLinesValid(items, false)) return;
  if (Number(party.creditLimit) > 0 && (party.balance || 0) + balanceDue > Number(party.creditLimit)) {
    const proceed = confirm(`${party.name} credit limit is ${formatINR(party.creditLimit)}. Counter bill would take dues to ${formatINR((party.balance || 0) + balanceDue)}. Continue?`);
    if (!proceed) return;
  }
  const invoice = {
    id: "inv-" + Date.now(),
    docType: "TAX_INVOICE",
    invoiceNo: (typeof BillSetuDocNumbering !== "undefined")
      ? BillSetuDocNumbering.previewNextNumber("TAX_INVOICE")
      : (typeof nextDocNo === "function" ? nextDocNo("POS") : ("POS-" + String((State.invoices || []).length + 1).padStart(4, "0"))),
    date: todayISO(),
    dueDate: todayISO(),
    partyId: party.id,
    partyName: party.name,
    partyGstin: party.gstin,
    partyPhone: party.phone,
    posStateCode: posCodeCounter,
    posStateName: (gstStatesApi() && gstStatesApi().stateName(posCodeCounter)) || party.stateName || "",
    isInterstate,
    items,
    taxableTotal,
    cgstTotal,
    sgstTotal,
    igstTotal,
    roundOff: grandTotal - (taxableTotal + cgstTotal + sgstTotal + igstTotal),
    grandTotal,
    amountReceived: received,
    collectedOnBill: received,
    balanceDue,
    paymentMode: mode,
    notes: "Counter sale",
    godownId,
    grossTotal: grandTotal,
    loyaltyPointsRedeemed: 0,
    loyaltyDiscount: 0,
    loyaltyPointsEarned: typeof pointsEarnedFor === "function" ? pointsEarnedFor(grandTotal) : Math.floor(grandTotal / 100),
    ewayBill: "",
    vehicleNo: "",
    transporterName: "",
    transporterId: ""
  };
  items.forEach(line => adjustStockLine(line, "out"));
  if (balanceDue > 0) {
    partyAddReceivable(party, balanceDue);
  }
  if (typeof settleLoyaltyOnInvoice === "function") settleLoyaltyOnInvoice(party, invoice);
  else party.loyaltyPoints = (party.loyaltyPoints || 0) + Math.floor(grandTotal / 100);
  if (typeof logActivity === "function") logActivity(`Counter bill ${invoice.invoiceNo}`);
  State.invoices.push(invoice);
  if (typeof BillSetuDocNumbering !== "undefined" && BillSetuDocNumbering.commitDocNumber) {
    BillSetuDocNumbering.commitDocNumber("TAX_INVOICE", invoice.invoiceNo, invoice.date);
  }
  State.posCart = [];
  saveToStorage();
  showToast(`Counter bill ${invoice.invoiceNo} saved.`);
  renderDashboard();
  renderPos();
  openPrintModal(invoice.id);
}

// App Initialization
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  if (sessionStorage.getItem(SESSION_KEY) === "1" && readLock()) enterApp();
  else showAuthGate();
});


/** Company-profile fields other than the name. Any of these saved means the book is not a first run. */
const BUSINESS_PROFILE_FIELDS = ["tradeName", "gstin", "pan", "stateCode", "stateName", "address", "phone", "email",
  "bankName", "bankAcc", "bankIfsc", "bankBranch", "upiId", "logo", "signatureImage", "signatureName", "jurisdiction"];
function businessHasSavedData(b) {
  return !!b && BUSINESS_PROFILE_FIELDS.some(k => String(b[k] == null ? "" : b[k]).trim() !== "");
}
/** True when this book already holds company data or any records, i.e. it is not a brand-new install. */
function bookIsExisting() {
  if (businessHasSavedData(State.business)) return true;
  const lists = ["invoices", "purchases", "expenses", "payments", "parties", "items", "debitNotes", "purchaseOrders"];
  return lists.some(k => Array.isArray(State[k]) && State[k].length > 0);
}
/**
 * Merge an incoming company record over the saved one without ever replacing a saved, non-blank
 * value with a blank one (NM11b). Non-string values (flags, numbers) are taken as given.
 */
function mergeBusinessKeepSaved(saved, incoming) {
  const out = { ...(saved || {}) };
  Object.entries(incoming || {}).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === "string" && !v.trim() && String(out[k] == null ? "" : out[k]).trim()) return;
    out[k] = v;
  });
  return out;
}
/**
 * 1.13.13 (BUG-1, SY12): merge a restored / joined company over the saved one field by field.
 * Non-blank incoming profile values win; blank ones keep the saved values. GSTIN, state and PAN are
 * one set: the state always follows the GSTIN that is kept, and is never left blank if either side has one.
 * Non-profile keys (flags, numbering, templates) come from the incoming record, as before.
 */
/** 1.13.14: the company fields that differ between two business records, as readable labels. */
const BUSINESS_CHANGE_LABELS = [["name", "business name"], ["tradeName", "trade name"], ["gstin", "GSTIN"], ["pan", "PAN"], ["stateCode", "state"], ["address", "address"], ["phone", "phone"], ["email", "email"]];
function businessChangedFields(before, after) {
  const nb = v => String(v == null ? "" : v).trim();
  const a = before || {}, b = after || {};
  return BUSINESS_CHANGE_LABELS.filter(([k]) => (k === "stateCode" ? normStateCode(a[k], a.stateName) !== normStateCode(b[k], b.stateName) : nb(a[k]) !== nb(b[k]))).map(([, l]) => l);
}
window.businessChangedFields = businessChangedFields;
function mergeRestoredBusiness(saved, incoming) {
  const s = saved || {}, f = incoming || {};
  const nb = v => String(v == null ? "" : v).trim();
  const out = { ...f };
  ["name", ...BUSINESS_PROFILE_FIELDS].forEach(k => {
    if (!nb(f[k]) && nb(s[k])) out[k] = s[k];
  });
  // A different business name with no trade name of its own must not keep the old trade name.
  if (nb(f.name) && !nb(f.tradeName) && nb(s.name) && nb(f.name).toLowerCase() !== nb(s.name).toLowerCase()) out.tradeName = nb(f.name);
  if (nb(out.name) && !nb(out.tradeName)) out.tradeName = nb(out.name);
  const G = gstStatesApi();
  const fG = nb(f.gstin).toUpperCase(), sG = nb(s.gstin).toUpperCase();
  const src = fG ? f : (sG ? s : null), other = src === f ? s : f;
  const stOf = b => normStateCode(b && b.stateCode, b && b.stateName);
  let code;
  if (src) {
    const g = fG || sG;
    out.gstin = g;
    code = (G ? normStateCode(G.gstinStateCode(g)) : "") || stOf(src) || stOf(other);
    const v = G && G.validateGstin ? G.validateGstin(g) : null;
    // The PAN is part of the GSTIN (characters 3-12): keep the GSTIN side's own PAN, else the other
    // side's only if it matches; derive it only when this restore changes the GSTIN (an identical
    // round-trip stays exact).
    const panOfG = (v && v.ok && v.pan) || (g.length === 15 ? g.slice(2, 12) : "");
    const op = nb(other.pan).toUpperCase();
    out.pan = nb(src.pan).toUpperCase() || (op && op === panOfG ? op : "") || (fG && fG !== sG ? panOfG : "");
  } else {
    out.gstin = "";
    code = stOf(f) || stOf(s);
    out.pan = nb(f.pan) || nb(s.pan);
  }
  out.stateCode = code || "";
  out.stateName = code ? ((G && G.stateName(code)) || (stOf(f) === code ? nb(f.stateName) : nb(s.stateName))) : "";
  return out;
}
window.bookIsExisting = bookIsExisting;
window.mergeBusinessKeepSaved = mergeBusinessKeepSaved;
window.mergeRestoredBusiness = mergeRestoredBusiness;

function openCompanySetupWizard(opts) {
  const modal = document.getElementById("modal-company-setup");
  if (!modal) {
    // Fallback: jump to settings
    switchView("settings");
    showToast("Add your business name and GSTIN in Settings to get started.");
    return;
  }
  const existing = !!(opts && opts.existing) || bookIsExisting();
  modal.dataset.mode = existing ? "existing" : "first-run";
  const b = State.business || {};
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v == null ? "" : String(v); };
  // Always prefill from the saved company, so nothing saved can be lost by an empty form.
  setVal("setup-biz-name", b.name || "");
  setVal("setup-trade-name", b.tradeName && b.tradeName !== b.name ? b.tradeName : "");
  setVal("setup-gstin", b.gstin || "");
  setVal("setup-address", b.address || "");
  setVal("setup-phone", b.phone || "");
  const fileEl = document.getElementById("setup-logo-file");
  if (fileEl) fileEl.value = "";
  const title = document.getElementById("company-setup-title");
  const intro = document.getElementById("company-setup-intro");
  // 1.13.13 (N4): an existing book with no GST state is asked for it here too.
  const G0 = typeof BillSetuGstin !== "undefined" ? BillSetuGstin : null;
  const needsState = existing && !(normStateCode(b.stateCode || "", b.stateName) || (G0 && b.gstin ? G0.gstinStateCode(b.gstin) : ""));
  modal.dataset.needsState = needsState ? "1" : "";
  const hasName = !!String(b.name || "").trim();
  if (title) title.textContent = existing ? (needsState ? (hasName ? "Add your business state" : "Add your business name and state") : "Add your business name") : "Set up your company";
  if (intro) intro.textContent = existing
    ? (needsState && hasName
      ? "Your GST state is missing. It sets CGST+SGST or IGST on your bills. Your saved details below are kept. To clear a saved detail, use Settings."
      : needsState
      ? "Your business name and GST state are missing. The name prints on your invoices and receipts; the state sets CGST/SGST or IGST. Your saved details below are kept. To clear a saved detail, use Settings."
      : "Your business name is missing. It prints on your invoices and receipts. Your saved details below are kept. To clear a saved detail, use Settings.")
    : "Ledgerbay keeps your books on this device. Add your business details to start. You can change them anytime in Settings.";
  const reviewHint = document.getElementById("company-setup-review-hint");
  const unstamped = typeof gstReviewUnstampedCount === "function" ? gstReviewUnstampedCount() : 0;
  if (reviewHint) {
    if (needsState && unstamped > 0) {
      reviewHint.hidden = false;
      reviewHint.textContent = unstamped === 1
        ? "1 bill or note was saved before the state was set. Review it in Books."
        : `${unstamped} bills and notes were saved before the state was set. Review them in Books.`;
    } else {
      reviewHint.hidden = true;
      reviewHint.textContent = "";
    }
  }
  const save = document.getElementById("btn-company-setup-save");
  if (save) save.textContent = existing ? (needsState ? (hasName ? "Save state" : "Save name and state") : "Save name") : "Save and continue";
  modal.classList.add("open");
  if (typeof BillSetuGstin !== "undefined") {
    // 1.13.13: prefill only the saved state; a value left in the select from earlier never counts as saved.
    const setupState = document.getElementById("setup-state");
    if (setupState) setupState.value = "";
    BillSetuGstin.populateStateSelect(setupState, normStateCode(b.stateCode || "", b.stateName) || (b.gstin ? BillSetuGstin.gstinStateCode(b.gstin) : "") || "");
    BillSetuGstin.bindGstinField(document.getElementById("setup-gstin"), {
      stateSelect: document.getElementById("setup-state"),
      hintEl: document.getElementById("setup-gstin-hint")
    });
  }
  const nameEl = document.getElementById("setup-biz-name");
  if (nameEl) nameEl.focus();
}

function closeCompanySetupWizard() {
  document.getElementById("modal-company-setup")?.classList.remove("open");
}

function promptMissingBusinessName() {
  if (String(State.business?.name || "").trim()) return false;
  if (document.getElementById("modal-company-setup")?.classList.contains("open")) return false;
  setTimeout(() => {
    if (String(State.business?.name || "").trim()) return;
    if (document.getElementById("modal-company-setup")?.classList.contains("open")) return;
    showToast("Add your business name in Settings. It prints on your invoices and receipts.");
  }, 600);
  return true;
}
window.promptMissingBusinessName = promptMissingBusinessName;

function submitCompanySetup(event) {
  if (event) event.preventDefault();
  const name = document.getElementById("setup-biz-name")?.value.trim() || "";
  if (!name) {
    showToast("Enter your business name.", "error");
    return;
  }
  let gstin = (document.getElementById("setup-gstin")?.value || "").trim().toUpperCase();
  // 1.13.11: same rule as the party form: a wrong GSTIN blocks saving with a clear message; blank is fine.
  if (gstin) {
    const v = (typeof BillSetuGstin !== "undefined")
      ? BillSetuGstin.validateGstin(gstin)
      : { ok: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin), message: "That GSTIN is not valid.", gstin };
    if (!v.ok) {
      showToast((v.message || "That GSTIN is not valid.") + " Fix it or leave GSTIN blank.", "error");
      document.getElementById("setup-gstin")?.focus();
      return;
    }
    gstin = v.gstin || gstin;
  }
  const address = document.getElementById("setup-address")?.value.trim() || "";
  const phone = document.getElementById("setup-phone")?.value.trim() || "";
  const G = typeof BillSetuGstin !== "undefined" ? BillSetuGstin : null;
  const existingBook = document.getElementById("modal-company-setup")?.dataset.mode === "existing" || bookIsExisting();
  const stateCode = normStateCode(document.getElementById("setup-state")?.value || "") || (G && gstin ? G.gstinStateCode(gstin) : "")
    || (existingBook ? normStateCode(State.business?.stateCode || "") : "");
  // Every book needs its GST state: a first run picks it, and an existing book without one is asked for it (1.13.13, N4).
  if (!stateCode) {
    showToast("Select the state on your GST registration.", "error");
    return;
  }
  const setupWarning = G && gstin ? G.stateMismatchMessage(gstin, stateCode) : "";
  // 1.13.12 (NM11b): merge. A blank field in the form never wipes a saved GSTIN, address, phone, PAN or state.
  const saved = { ...EMPTY_BUSINESS, ...(State.business || {}) };
  // 1.13.15: name the details that were actually missing in the confirmation.
  const hadName = !!String(saved.name || "").trim();
  const hadState = !!businessStateCode();
  const tradeName = document.getElementById("setup-trade-name")?.value.trim() || "";
  State.business = mergeBusinessKeepSaved(saved, {
    name,
    tradeName: tradeName || (String(saved.tradeName || "").trim() && saved.tradeName !== saved.name ? saved.tradeName : name),
    gstin,
    pan: gstin.length === 15 ? gstin.slice(2, 12) : "",
    address,
    phone,
    stateCode,
    stateName: (G && stateCode && G.stateName(stateCode)) || ""
  });
  State.business.updatedAt = Date.now();
  const fileInput = document.getElementById("setup-logo-file");
  const finish = () => {
    saveToStorage();
    closeCompanySetupWizard();
    renderDashboard();
    if (setupWarning) showToast("Company saved. Warning: " + setupWarning, "warning", { ttlMs: 8000 });
    else if (existingBook && !hadState) {
      const n = typeof gstReviewUnstampedCount === "function" ? gstReviewUnstampedCount() : 0;
      const extra = n ? ` ${n === 1 ? "1 bill or note was saved before the state was set. Review it in Books." : n + " bills and notes were saved before the state was set. Review them in Books."}` : "";
      showToast((hadName ? "Business state saved." : "Business details saved.") + extra, "success", { ttlMs: n ? 6000 : 2500 });
    }
    else if (existingBook) showToast("Business name saved. Your other company details were kept.", "success", { ttlMs: 2500 });
    else showToast("Welcome to Ledgerbay — your company is ready.", "success", { ttlMs: 1800 });
    if (lbIsPersonal() && typeof maybePersonalSeed === "function") maybePersonalSeed();
  };
  if (fileInput && fileInput.files && fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = ev => {
      State.business.logo = String(ev.target.result || "");
      finish();
    };
    reader.readAsDataURL(fileInput.files[0]);
  } else {
    finish();
  }
}

async function maybePersonalSeed() {
  if (!lbIsPersonal()) return;
  if (State.parties.length > 0 || State.items.length > 0) return; // never overwrite / duplicate
  try {
    const res = await fetch("about:blank#no-personal-seed", { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    if (!isLedgerbayOrBillSetuBackup(data)) return;
    // Seed parties/items only; leave invoices empty unless file has them and store still empty
    applyBackupMergeDedupe({
      business: State.business.name ? State.business : mergeBusinessKeepSaved(data.business || {}, State.business),
      parties: data.parties || [],
      items: data.items || [],
      invoices: State.invoices.length ? State.invoices : (data.invoices || []),
      purchases: State.purchases.length ? State.purchases : (data.purchases || []),
      expenses: State.expenses.length ? State.expenses : (data.expenses || []),
      payments: State.payments.length ? State.payments : (data.payments || []),
      purchaseOrders: [],
      debitNotes: []
    });
    if (!State.business.name && data.business) State.business = mergeBusinessKeepSaved({ ...EMPTY_BUSINESS, ...data.business }, State.business);
    ensureBooks();
    saveToStorage();
    showToast("Imported your parties and items.");
    renderDashboard();
  } catch (err) {
    console.warn("personal seed skipped", err);
  }
}

window.openCompanySetupWizard = openCompanySetupWizard;
window.submitCompanySetup = submitCompanySetup;
window.applyBackupReplace = applyBackupReplace;
window.applyBackupMergeDedupe = applyBackupMergeDedupe;
window.isLedgerbayOrBillSetuBackup = isLedgerbayOrBillSetuBackup;
