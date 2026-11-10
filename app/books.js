/**
 * Ledgerbay books — double-entry on top of the bills already in the app.
 *
 * Every voucher has equal debit and credit (stored in rupees, checked in paise).
 * Sales, purchases, debit notes, expenses, and later payments are posted again
 * whenever the books are saved, so editing a bill updates the ledger.
 * Vouchers you type yourself (no sourceId) are kept.
 *
 * This is ordinary Indian bookkeeping. It does not copy any other product's
 * screens, files, or names beyond the words shops already use (ledger, voucher,
 * trial balance, and so on).
 */

const BOOKS_REGISTRY_KEY = "billsetu_registry_v1";
const BOOKS_DATA_KEY = "billsetu_data_v1";

const PRIMARY_GROUPS = [
  ["g-capital", "Capital Account", "LIABILITY", ""],
  ["g-loans", "Loans (Liability)", "LIABILITY", ""],
  ["g-current-liab", "Current Liabilities", "LIABILITY", ""],
  ["g-creditors", "Sundry Creditors", "LIABILITY", "g-current-liab"],
  ["g-duties", "Duties & Taxes", "LIABILITY", "g-current-liab"],
  ["g-fixed", "Fixed Assets", "ASSET", ""],
  ["g-current", "Current Assets", "ASSET", ""],
  ["g-debtors", "Sundry Debtors", "ASSET", "g-current"],
  ["g-bank", "Bank Accounts", "ASSET", "g-current"],
  ["g-cash", "Cash-in-Hand", "ASSET", "g-current"],
  ["g-stock", "Stock-in-Hand", "ASSET", "g-current"],
  ["g-sales", "Sales Accounts", "INCOME", ""],
  ["g-purchase", "Purchase Accounts", "EXPENSE", ""],
  ["g-direct-inc", "Direct Incomes", "INCOME", ""],
  ["g-indirect-inc", "Indirect Incomes", "INCOME", ""],
  ["g-direct-exp", "Direct Expenses", "EXPENSE", ""],
  ["g-indirect-exp", "Indirect Expenses", "EXPENSE", ""]
];

let accountsTab = "chart";

function booksPaise(value) {
  return Math.round((Number(value) || 0) * 100);
}

function booksRupees(paise) {
  return booksPaise(paise / 100) / 100;
}

function defaultChequeLayout() {
  return {
    widthMm: 202,
    heightMm: 92,
    date: { left: 145, top: 10 },
    payee: { left: 22, top: 28 },
    words: { left: 22, top: 42 },
    amount: { left: 150, top: 42 },
    crossing: { left: 8, top: 6 }
  };
}

function defaultAccounts() {
  return {
    companyId: "co-main",
    yearId: "fy-2026",
    fyStart: "2026-04-01",
    fyEnd: "2027-03-31",
    readOnly: false,
    interestRate: 18,
    graceDays: 0,
    groups: [],
    ledgers: [],
    vouchers: [],
    bankDates: {},
    openingBills: [],
    cheques: [],
    chequeLayout: defaultChequeLayout()
  };
}

function ensureAccounts() {
  if (!State.accounts || !Array.isArray(State.accounts.ledgers)) {
    const fresh = defaultAccounts();
    if (State.accounts && typeof State.accounts === "object") Object.assign(fresh, State.accounts);
    fresh.groups = Array.isArray(State.accounts?.groups) ? State.accounts.groups : [];
    fresh.ledgers = Array.isArray(State.accounts?.ledgers) ? State.accounts.ledgers : [];
    fresh.vouchers = Array.isArray(State.accounts?.vouchers) ? State.accounts.vouchers : [];
    fresh.openingBills = Array.isArray(State.accounts?.openingBills) ? State.accounts.openingBills : [];
    fresh.cheques = Array.isArray(State.accounts?.cheques) ? State.accounts.cheques : [];
    fresh.bankDates = State.accounts?.bankDates && typeof State.accounts.bankDates === "object" ? State.accounts.bankDates : {};
    fresh.chequeLayout = State.accounts?.chequeLayout || defaultChequeLayout();
    State.accounts = fresh;
  }
  if (!State.accounts.chequeLayout) State.accounts.chequeLayout = defaultChequeLayout();
  if (!State.accounts.bankDates) State.accounts.bankDates = {};
  PRIMARY_GROUPS.forEach(([id, name, nature, parentId]) => {
    if (!State.accounts.groups.some(group => group.id === id)) {
      State.accounts.groups.push({ id, name, nature, parentId, system: true });
    }
  });
  ensureSystemLedger("l-cash", "Cash in Hand", "g-cash");
  ensureSystemLedger("l-bank", "Bank", "g-bank");
  ensureSystemLedger("l-sales", "Sales", "g-sales");
  ensureSystemLedger("l-purchase", "Purchases", "g-purchase");
  ensureSystemLedger("l-cgst-out", "Output CGST", "g-duties");
  ensureSystemLedger("l-sgst-out", "Output SGST", "g-duties");
  ensureSystemLedger("l-igst-out", "Output IGST", "g-duties");
  ensureSystemLedger("l-cgst-in", "Input CGST", "g-duties");
  ensureSystemLedger("l-sgst-in", "Input SGST", "g-duties");
  ensureSystemLedger("l-igst-in", "Input IGST", "g-duties");
  ensureSystemLedger("l-round", "Round Off", "g-indirect-exp");
  ensureSystemLedger("l-discount", "Discount", "g-indirect-exp");
  ensureSystemLedger("l-interest", "Interest income", "g-indirect-inc");
  ensureSystemLedger("l-capital", "Capital", "g-capital");
  ensureSystemLedger("l-opening-stock", "Opening Stock", "g-stock");
  ensureSystemLedger("l-opening-diff", "Opening Balance Difference", "g-capital");
  (State.parties || []).forEach(party => ensurePartyLedger(party));
  (State.expenses || []).forEach(exp => ensureExpenseLedger(exp.category));
  if (typeof migrateSettingsBankToAccount === "function") migrateSettingsBankToAccount();
  if (!State.accounts.readOnly) syncAccounting();
  ensureRegistry();
}

function ensureSystemLedger(id, name, groupId) {
  let ledger = State.accounts.ledgers.find(entry => entry.id === id);
  if (!ledger) {
    ledger = { id, name, groupId, opening: 0, openingDr: true, system: true };
    State.accounts.ledgers.push(ledger);
  } else if (!ledger.groupId) {
    ledger.groupId = groupId;
  }
  return ledger;
}

function ensurePartyLedger(party) {
  if (!party?.id || !State.accounts) return "";
  const id = "l-party-" + party.id;
  const supplier = party.type === "SUPPLIER" || party.balType === "PAYABLE";
  const groupId = supplier ? "g-creditors" : "g-debtors";
  let ledger = State.accounts.ledgers.find(entry => entry.id === id);
  if (!ledger) {
    ledger = { id, name: party.name || "Party", groupId, opening: 0, openingDr: !supplier, system: true, partyId: party.id };
    State.accounts.ledgers.push(ledger);
  } else {
    ledger.name = party.name || ledger.name;
    ledger.groupId = groupId;
    ledger.partyId = party.id;
  }
  return id;
}

function ensureExpenseLedger(category) {
  const name = category || "Expense";
  const slug = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "expense";
  const id = "l-exp-" + slug;
  return ensureSystemLedger(id, name, "g-indirect-exp").id;
}

function groupById(id) {
  return State.accounts.groups.find(group => group.id === id);
}

function groupNature(id) {
  const group = groupById(id);
  if (!group) return "ASSET";
  if (group.nature) return group.nature;
  if (group.parentId) return groupNature(group.parentId);
  return "ASSET";
}

function ledgerById(id) {
  return State.accounts?.ledgers?.find(ledger => ledger.id === id);
}

function inFinancialYear(date) {
  const day = date || "";
  if (!State.accounts) return true;
  return day >= State.accounts.fyStart && day <= State.accounts.fyEnd;
}

function booksMoneyLedger(mode, accountId) {
  // Explicit accountId on the document wins. Docs without one keep classic
  // l-cash / l-bank so adding a new "default" bank does not rewrite history.
  if (accountId && typeof ledgerById === "function" && ledgerById(accountId)) return accountId;
  if (accountId && State.accounts?.ledgers?.some(l => l.id === accountId)) return accountId;
  const value = String(mode || "").toUpperCase();
  if (value === "CASH" || value === "CREDIT" || value === "") return "l-cash";
  return "l-bank";
}

// 1.13.16: true = intra (CGST+SGST), false = inter (IGST), null = "missing": no stored split and no
// business state, so the split can't be decided (same signal as isInterstateFor). Callers post such GST
// to "Input GST (state not set)" instead of guessing CGST+SGST.
function booksGstIntra(gstin, supplierId, stored) {
  // A purchase saved with an explicit split keeps it.
  if (typeof stored === "boolean") return !stored;
  const biz = typeof businessStateCode === "function" ? businessStateCode() : String(State.business?.stateCode || "");
  if (!biz) return null;
  const supplier = supplierId ? (State.parties || []).find(p => p.id === supplierId) : null;
  const fromParty = supplier && typeof partyStateCode === "function" ? partyStateCode(supplier) : "";
  const match = String(gstin || "").match(/^(\d{2})/);
  const code = fromParty || (match ? match[1] : "");
  if (!code) return true;
  return code === biz;
}

const BOOKS_GST_UNSPLIT_LEDGER = "l-gst-in-unsplit";
/** Split input GST (paise) by booksGstIntra's answer; "missing" goes to one holding ledger, created
 *  only when needed, so the books still balance without inventing a CGST/SGST split. */
function booksInputGstSplit(gstPaise, intra) {
  if (intra === null) {
    ensureSystemLedger(BOOKS_GST_UNSPLIT_LEDGER, "Input GST (business state not set)", "g-duties");
    return { cgst: 0, sgst: 0, igst: 0, unsplit: gstPaise };
  }
  const cgst = intra ? Math.floor(gstPaise / 2) : 0;
  return { cgst, sgst: intra ? gstPaise - cgst : 0, igst: intra ? 0 : gstPaise, unsplit: 0 };
}

function booksLine(ledgerId, debitPaise, creditPaise, ref) {
  if (!debitPaise && !creditPaise) return null;
  return {
    ledgerId,
    dr: debitPaise / 100,
    cr: creditPaise / 100,
    refType: ref?.type || "",
    refName: ref?.name || "",
    bankDate: ""
  };
}

function balanceVoucherLines(lines) {
  const kept = lines.filter(Boolean);
  let debit = 0;
  let credit = 0;
  kept.forEach(entry => {
    debit += booksPaise(entry.dr);
    credit += booksPaise(entry.cr);
  });
  const diff = debit - credit;
  if (diff > 0) kept.push(booksLine("l-round", 0, diff));
  else if (diff < 0) kept.push(booksLine("l-round", -diff, 0));
  return kept;
}

function voucherTotalsPaise(voucher) {
  let debit = 0;
  let credit = 0;
  (voucher?.lines || []).forEach(entry => {
    debit += booksPaise(entry.dr);
    credit += booksPaise(entry.cr);
  });
  return { debit, credit, balanced: debit === credit };
}

function partyRecord(id, name, supplier) {
  return State.parties.find(party => party.id === id) || {
    id: id || "party-unknown",
    name: name || "Party",
    type: supplier ? "SUPPLIER" : "CUSTOMER",
    balType: supplier ? "PAYABLE" : "RECEIVABLE"
  };
}

function saleVoucherLines(inv) {
  const partyId = ensurePartyLedger(partyRecord(inv.partyId, inv.partyName, false));
  const grand = booksPaise(inv.grandTotal);
  const onBill = typeof invoiceCollectedOnBill === "function" ? booksPaise(invoiceCollectedOnBill(inv)) : (inv.collectedOnBill != null ? booksPaise(inv.collectedOnBill) : booksPaise(inv.amountReceived));
  const received = Math.max(0, Math.min(onBill, grand));
  const balance = Math.max(0, grand - received);
  const round = booksPaise(inv.roundOff);
  const lines = [
    booksLine(booksMoneyLedger(inv.paymentMode, inv.accountId), received, 0),
    booksLine(partyId, balance, 0, balance ? { type: "New Ref", name: inv.invoiceNo } : null),
    booksLine("l-discount", booksPaise(inv.billDiscount) + booksPaise(inv.loyaltyDiscount), 0),
    booksLine("l-sales", 0, booksPaise(inv.taxableTotal)),
    booksLine("l-cgst-out", 0, booksPaise(inv.cgstTotal)),
    booksLine("l-sgst-out", 0, booksPaise(inv.sgstTotal)),
    booksLine("l-igst-out", 0, booksPaise(inv.igstTotal))
  ];
  if (round > 0) lines.push(booksLine("l-round", 0, round));
  else if (round < 0) lines.push(booksLine("l-round", -round, 0));
  let built = balanceVoucherLines(lines);
  if (inv.docType === "CREDIT_NOTE") {
    built = built.map(entry => ({ ...entry, dr: entry.cr, cr: entry.dr }));
  }
  return built;
}

/** 1.13.19 (BUG-9): input GST with no stored split is parked for review, even after a
 *  business state is set. Do not invent CGST/SGST or IGST from today's state. */
function booksInputIntraOrPark(stored) {
  if (typeof stored === "boolean") return !stored;
  return null;
}
window.booksInputIntraOrPark = booksInputIntraOrPark;

function purchaseVoucherLines(purchase) {
  const partyId = ensurePartyLedger(partyRecord(purchase.supplierId, purchase.supplierName, true));
  const gst = booksPaise(purchase.gstAmount);
  const intra = booksInputIntraOrPark(purchase.isInterstate);
  const { cgst, sgst, igst, unsplit } = booksInputGstSplit(gst, intra);
  return balanceVoucherLines([
    booksLine("l-purchase", booksPaise(purchase.taxableAmount), 0),
    booksLine("l-cgst-in", cgst, 0),
    booksLine("l-sgst-in", sgst, 0),
    booksLine("l-igst-in", igst, 0),
    unsplit ? booksLine(BOOKS_GST_UNSPLIT_LEDGER, unsplit, 0) : null,
    booksLine(partyId, 0, booksPaise(purchase.totalBill), { type: "New Ref", name: purchase.billNo })
  ]);
}

function debitNoteLines(note) {
  const supplier = State.parties.find(party => party.id === note.supplierId);
  const partyId = ensurePartyLedger(partyRecord(note.supplierId, note.supplierName, true));
  const gst = booksPaise(note.gstAmount);
  const total = booksPaise(note.total);
  // 1.13.16: the note's stored split, else its purchase's stored split (a return mirrors the bill).
  // 1.13.19 (BUG-9): if neither has a stamp, park on the unsplit review ledger — never re-decide
  // from the current business state.
  const linked = note.purchaseId ? (State.purchases || []).find(p => p.id === note.purchaseId) : null;
  const stored = typeof note.isInterstate === "boolean" ? note.isInterstate
    : (linked && typeof linked.isInterstate === "boolean" ? linked.isInterstate : undefined);
  const intra = booksInputIntraOrPark(stored);
  const { cgst, sgst, igst, unsplit } = booksInputGstSplit(gst, intra);
  const ref = note.againstBill
    ? { type: "Agst Ref", name: note.againstBill }
    : { type: "On Account", name: "" };
  return balanceVoucherLines([
    booksLine(partyId, total, 0, ref),
    booksLine("l-purchase", 0, Math.max(0, total - gst)),
    booksLine("l-cgst-in", 0, cgst),
    booksLine("l-sgst-in", 0, sgst),
    booksLine("l-igst-in", 0, igst),
    unsplit ? booksLine(BOOKS_GST_UNSPLIT_LEDGER, 0, unsplit) : null
  ]);
}

function pushOpen(map, ledgerId, name, amount) {
  if (!amount) return;
  if (!map[ledgerId]) map[ledgerId] = [];
  map[ledgerId].push({ name, left: amount });
}

function consumeOpen(map, ledgerId, amount, name) {
  const parts = [];
  let left = amount;
  const slots = map[ledgerId] || [];
  if (name) {
    const named = slots.find(slot => slot.name === name && slot.left > 0);
    if (named) {
      const used = Math.min(named.left, left);
      named.left -= used;
      left -= used;
      parts.push({ type: "Agst Ref", name, amount: used });
    }
  }
  slots.forEach(slot => {
    if (left <= 0 || slot.left <= 0) return;
    const used = Math.min(slot.left, left);
    slot.left -= used;
    left -= used;
    parts.push({ type: "Agst Ref", name: slot.name, amount: used });
  });
  if (left > 0) parts.push({ type: "On Account", name: "", amount: left });
  return parts;
}

function rememberNewRefs(mapDr, mapCr, lines) {
  lines.forEach(entry => {
    if (entry.refType !== "New Ref") return;
    const debit = booksPaise(entry.dr);
    const credit = booksPaise(entry.cr);
    if (debit) pushOpen(mapDr, entry.ledgerId, entry.refName, debit);
    if (credit) pushOpen(mapCr, entry.ledgerId, entry.refName, credit);
  });
}

function refSplitLines(ledgerId, side, parts) {
  return parts.map(part => booksLine(
    ledgerId,
    side === "dr" ? part.amount : 0,
    side === "cr" ? part.amount : 0,
    { type: part.type, name: part.name }
  ));
}

function syncAccounting() {
  if (!State.accounts || State.accounts.readOnly || State.accounts._syncing) return;
  State.accounts._syncing = true;
  try {
    const manual = (State.accounts.vouchers || []).filter(voucher =>
      !voucher.sourceId || voucher.sourceKind === "contra" || voucher.sourceKind === "adjust"
    );
    const bankDates = { ...(State.accounts.bankDates || {}) };
    (State.accounts.vouchers || []).forEach(voucher => {
      (voucher.lines || []).forEach((entry, index) => {
        if (entry.bankDate) bankDates[`${voucher.id}:${index}:${entry.ledgerId}`] = entry.bankDate;
      });
    });
    const openDr = {};
    const openCr = {};
    (State.accounts.openingBills || []).forEach(bill => {
      const ledgerId = "l-party-" + bill.partyId;
      pushOpen(bill.dr ? openDr : openCr, ledgerId, bill.name, booksPaise(bill.amount));
    });
    const generated = [];
    const events = [];
    (State.invoices || []).forEach(inv => {
      if (!inv || inv.docType === "ESTIMATE" || inv.docType === "PROFORMA" || inv.docType === "DELIVERY_CHALLAN") return;
      // 1.13.7: a cancelled bill posts nothing; its money now sits on an advance receipt.
      if (inv.cancelled || String(inv.status || "").toUpperCase() === "CANCELLED") return;
      if (!inFinancialYear(inv.date)) return;
      events.push({ date: inv.date || "", rank: 1, kind: "sale", doc: inv });
    });
    (State.purchases || []).forEach(purchase => {
      if (!purchase || purchase.cancelled || String(purchase.status || "").toUpperCase() === "CANCELLED") return;
      if (!inFinancialYear(purchase.date)) return;
      events.push({ date: purchase.date || "", rank: 2, kind: "purchase", doc: purchase });
    });
    (State.debitNotes || []).forEach(note => {
      if (!inFinancialYear(note.date)) return;
      events.push({ date: note.date || "", rank: 3, kind: "debit", doc: note });
    });
    (State.expenses || []).forEach(exp => {
      if (!inFinancialYear(exp.date)) return;
      events.push({ date: exp.date || "", rank: 4, kind: "expense", doc: exp });
    });
    (State.payments || []).forEach(payment => {
      if (!inFinancialYear(payment.date)) return;
      if (payment.direction === "LOYALTY") return;
      events.push({ date: payment.date || "", rank: 5, kind: "payment", doc: payment });
    });
    events.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank);
    events.forEach(event => {
      if (event.kind === "sale") {
        const inv = event.doc;
        const lines = saleVoucherLines(inv);
        rememberNewRefs(openDr, openCr, lines);
        generated.push({
          id: `vch-sale-${inv.id}`,
          date: inv.date,
          dueDate: inv.dueDate || inv.date,
          type: inv.docType === "CREDIT_NOTE" ? "Credit Note" : "Sales",
          number: inv.invoiceNo,
          narration: `${inv.partyName || ""} ${inv.invoiceNo || ""}`.trim(),
          sourceKind: "sale",
          sourceId: inv.id,
          lines
        });
      } else if (event.kind === "purchase") {
        const purchase = event.doc;
        const lines = purchaseVoucherLines(purchase);
        rememberNewRefs(openDr, openCr, lines);
        generated.push({
          id: `vch-purchase-${purchase.id}`,
          date: purchase.date,
          dueDate: purchase.date,
          type: "Purchase",
          number: purchase.billNo,
          narration: purchase.supplierName || "Purchase",
          sourceKind: "purchase",
          sourceId: purchase.id,
          lines
        });
        const paid = typeof purchasePaidOnBill === "function" ? booksPaise(purchasePaidOnBill(purchase)) : booksPaise(purchase.paidOnBill != null ? purchase.paidOnBill : purchase.paidAmount);
        if (paid > 0) {
          const partyId = ensurePartyLedger(partyRecord(purchase.supplierId, purchase.supplierName, true));
          const parts = consumeOpen(openCr, partyId, paid, purchase.billNo);
          generated.push({
            id: `vch-purchase-pay-${purchase.id}`,
            date: purchase.date,
            type: "Payment",
            number: purchase.billNo + "-PAY",
            narration: `Paid against ${purchase.billNo}`,
            sourceKind: "purchase-pay",
            sourceId: purchase.id + ":pay",
            lines: balanceVoucherLines([
              ...refSplitLines(partyId, "dr", parts),
              booksLine(booksMoneyLedger(purchase.paymentMode || "BANK", purchase.accountId), 0, paid)
            ])
          });
        }
      } else if (event.kind === "debit") {
        const note = event.doc;
        const lines = debitNoteLines(note);
        const partyLine = lines.find(entry => String(entry.ledgerId).startsWith("l-party-") && booksPaise(entry.dr));
        if (partyLine?.refType === "Agst Ref") consumeOpen(openCr, partyLine.ledgerId, booksPaise(partyLine.dr), partyLine.refName);
        generated.push({
          id: `vch-debit-${note.id}`,
          date: note.date,
          type: "Debit Note",
          number: note.noteNo,
          narration: note.supplierName || "Debit note",
          sourceKind: "debit",
          sourceId: note.id,
          lines
        });
      } else if (event.kind === "expense") {
        const exp = event.doc;
        const ledgerId = ensureExpenseLedger(exp.category);
        generated.push({
          id: `vch-expense-${exp.id}`,
          date: exp.date,
          type: "Expense",
          number: exp.category || "Expense",
          narration: exp.notes || exp.category || "Expense",
          sourceKind: "expense",
          sourceId: exp.id,
          lines: balanceVoucherLines([
            booksLine(ledgerId, booksPaise(exp.amount), 0),
            booksLine(booksMoneyLedger(exp.mode, exp.accountId), 0, booksPaise(exp.amount))
          ])
        });
      } else if (event.kind === "payment") {
        const payment = event.doc;
        const partyId = ensurePartyLedger(partyRecord(payment.partyId, payment.partyName, payment.direction === "OUT"));
        const amount = booksPaise(payment.amount);
        const money = booksMoneyLedger(payment.mode, payment.accountId);
        if (payment.direction === "OUT") {
          const parts = consumeOpen(openCr, partyId, amount);
          generated.push({
            id: `vch-pay-${payment.id}`,
            date: payment.date,
            type: "Payment",
            number: payment.receiptNo || "Payment",
            narration: payment.notes || payment.partyName || "Payment",
            sourceKind: "payment",
            sourceId: payment.id,
            lines: balanceVoucherLines([...refSplitLines(partyId, "dr", parts), booksLine(money, 0, amount)])
          });
        } else {
          const parts = consumeOpen(openDr, partyId, amount);
          generated.push({
            id: `vch-pay-${payment.id}`,
            date: payment.date,
            type: "Receipt",
            number: payment.receiptNo || "Receipt",
            narration: payment.notes || payment.partyName || "Receipt",
            sourceKind: "payment",
            sourceId: payment.id,
            lines: balanceVoucherLines([booksLine(money, amount, 0), ...refSplitLines(partyId, "cr", parts)])
          });
        }
      }
    });
    generated.forEach(voucher => {
      voucher.lines.forEach((entry, index) => {
        const saved = bankDates[`${voucher.id}:${index}:${entry.ledgerId}`];
        if (saved) entry.bankDate = saved;
      });
    });
    State.accounts.vouchers = manual.concat(generated);
    State.accounts.bankDates = bankDates;
    deriveOpeningBalances(generated);
  } finally {
    State.accounts._syncing = false;
  }
}

/**
 * 1.13.8 (TB1): Tally-style openings, derived on every sync (so an upgrade or an edit can never double count).
 * - A party ledger's opening = the party balance minus what this year's bills, receipts and notes post to it,
 *   so Debtors / Creditors in the books always equal the party balances (opening balances included).
 * - "Opening Balance Difference" (Capital) takes the other side of every opening (bank, cash, party,
 *   opening stock, any manual ledger opening), so the trial balance and balance sheet tally.
 */
function deriveOpeningBalances(generated) {
  if (!State.accounts || !Array.isArray(State.accounts.ledgers)) return;
  const posted = {};
  (generated || []).forEach(voucher => (voucher.lines || []).forEach(entry => {
    posted[entry.ledgerId] = (posted[entry.ledgerId] || 0) + booksPaise(entry.dr) - booksPaise(entry.cr);
  }));
  (State.parties || []).forEach(party => {
    if (!party || !party.id || party.deletedAt) return;
    // 1.13.9 (O1): a party saved before the next full ensureAccounts still gets its ledger here.
    const ledger = ledgerById("l-party-" + party.id) || ledgerById(ensurePartyLedger(party));
    if (!ledger) return;
    const signed = booksPaise(party.balance) * (party.balType === "PAYABLE" ? -1 : 1);
    const open = signed - (posted[ledger.id] || 0);
    ledger.opening = Math.abs(open) / 100;
    ledger.openingDr = open >= 0;
    ledger.openingDerived = true;
  });
  const diff = ledgerById("l-opening-diff") || ensureSystemLedger("l-opening-diff", "Opening Balance Difference", "g-capital");
  let sum = 0;
  State.accounts.ledgers.forEach(ledger => {
    if (ledger.id === "l-opening-diff") return;
    sum += booksPaise(ledger.opening) * (ledger.openingDr === false ? -1 : 1);
  });
  diff.opening = Math.abs(sum) / 100;
  diff.openingDr = sum < 0;
  diff.openingDerived = true;
}

function ledgerNetPaise(ledgerId, untilDate) {
  const ledger = ledgerById(ledgerId);
  if (!ledger) return 0;
  let net = booksPaise(ledger.opening) * (ledger.openingDr === false ? -1 : 1);
  (State.accounts.vouchers || []).forEach(voucher => {
    if (untilDate && voucher.date > untilDate) return;
    (voucher.lines || []).forEach(entry => {
      if (entry.ledgerId !== ledgerId) return;
      net += booksPaise(entry.dr) - booksPaise(entry.cr);
    });
  });
  return net;
}

function trialBalance() {
  let debit = 0;
  let credit = 0;
  const rows = (State.accounts?.ledgers || []).map(ledger => {
    const net = ledgerNetPaise(ledger.id);
    if (net > 0) debit += net;
    else credit += -net;
    return {
      id: ledger.id,
      name: ledger.name,
      groupId: ledger.groupId,
      group: groupById(ledger.groupId)?.name || "",
      net
    };
  });
  return { debit, credit, balanced: debit === credit, rows };
}

function closingStockPaise() {
  let raw = 0;
  (State.items || []).forEach(item => {
    if (!item || isServiceCategory(item.category)) return;
    raw += (Number(item.stock) || 0) * (Number(item.costPrice) || 0);
  });
  return booksPaise(raw);
}

function profitAndLoss() {
  let income = 0;
  let expense = 0;
  (State.accounts?.ledgers || []).forEach(ledger => {
    if (ledger.id === "l-opening-stock") return;
    const nature = groupNature(ledger.groupId);
    const net = ledgerNetPaise(ledger.id);
    if (nature === "INCOME") income += -net;
    else if (nature === "EXPENSE") expense += net;
  });
  const opening = ledgerNetPaise("l-opening-stock");
  const stock = closingStockPaise();
  const profit = income - expense - opening + stock;
  return { income, expense, opening, stock, profit };
}

function ledgerPeriodPaise(ledgerId, fromDate, toDate) {
  let net = 0;
  (State.accounts.vouchers || []).forEach(voucher => {
    if (fromDate && voucher.date < fromDate) return;
    if (toDate && voucher.date > toDate) return;
    (voucher.lines || []).forEach(entry => {
      if (entry.ledgerId !== ledgerId) return;
      net += booksPaise(entry.dr) - booksPaise(entry.cr);
    });
  });
  return net;
}

function isoParts(iso) {
  const [year, month, day] = String(iso || "").split("-").map(Number);
  return { year, month, day };
}

function isoFromParts(year, month, day) {
  const date = new Date(year, month - 1, day);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function dayBefore(iso) {
  const { year, month, day } = isoParts(iso);
  return isoFromParts(year, month, day - 1);
}

function balanceSheet() {
  const stock = closingStockPaise();
  let assets = stock;
  let liabilities = 0;
  (State.accounts?.ledgers || []).forEach(ledger => {
    if (ledger.id === "l-opening-stock") return;
    const nature = groupNature(ledger.groupId);
    const net = ledgerNetPaise(ledger.id);
    if (nature === "ASSET") assets += net;
    else if (nature === "LIABILITY") liabilities += -net;
  });
  const pnl = profitAndLoss();
  const profit = pnl.profit;
  return {
    assets,
    liabilities,
    profit,
    stock,
    balanced: assets === liabilities + profit
  };
}

function cashAndBankIds() {
  return new Set((State.accounts?.ledgers || [])
    .filter(ledger => ledger.groupId === "g-cash" || ledger.groupId === "g-bank" || ledger.id === "l-cash" || ledger.id === "l-bank")
    .map(ledger => ledger.id));
}

function cashFlow(fromDate, toDate) {
  const ids = cashAndBankIds();
  let opening = 0;
  (State.accounts?.ledgers || []).forEach(ledger => {
    if (!ids.has(ledger.id)) return;
    opening += fromDate ? ledgerNetPaise(ledger.id, dayBefore(fromDate)) : booksPaise(ledger.opening) * (ledger.openingDr === false ? -1 : 1);
  });
  let receipts = 0;
  let payments = 0;
  (State.accounts.vouchers || []).forEach(voucher => {
    if (fromDate && voucher.date < fromDate) return;
    if (toDate && voucher.date > toDate) return;
    (voucher.lines || []).forEach(entry => {
      if (!ids.has(entry.ledgerId)) return;
      receipts += booksPaise(entry.dr);
      payments += booksPaise(entry.cr);
    });
  });
  const closing = opening + receipts - payments;
  const fund = fundFlow(fromDate, toDate);
  return { opening, receipts, payments, closing, ties: opening + receipts - payments === closing, fund };
}

function fundFlow(fromDate, toDate) {
  const from = fromDate || State.accounts.fyStart;
  const to = toDate || State.accounts.fyEnd;
  let profit = 0;
  (State.accounts.ledgers || []).forEach(ledger => {
    if (ledger.id === "l-opening-stock") return;
    const nature = groupNature(ledger.groupId);
    const move = ledgerPeriodPaise(ledger.id, from, to);
    if (nature === "INCOME") profit += -move;
    else if (nature === "EXPENSE") profit -= move;
  });
  const sources = [];
  const applications = [];
  if (profit >= 0) sources.push({ label: "Profit for the period", amount: profit });
  else applications.push({ label: "Loss for the period", amount: -profit });
  (State.accounts.ledgers || []).forEach(ledger => {
    const nature = groupNature(ledger.groupId);
    if (nature === "INCOME" || nature === "EXPENSE") return;
    if (cashAndBankIds().has(ledger.id)) return;
    if (ledger.id === "l-opening-stock") return;
    const move = ledgerPeriodPaise(ledger.id, from, to);
    if (!move) return;
    if (nature === "ASSET") {
      if (move > 0) applications.push({ label: `Increase in ${ledger.name}`, amount: move });
      else sources.push({ label: `Decrease in ${ledger.name}`, amount: -move });
    } else if (nature === "LIABILITY") {
      if (move > 0) applications.push({ label: `Decrease in ${ledger.name}`, amount: move });
      else sources.push({ label: `Increase in ${ledger.name}`, amount: -move });
    }
  });
  let sourceTotal = sources.reduce((sum, row) => sum + row.amount, 0);
  let applicationTotal = applications.reduce((sum, row) => sum + row.amount, 0);
  const gap = sourceTotal - applicationTotal;
  if (gap > 0) applications.push({ label: "Increase in cash and bank", amount: gap });
  else if (gap < 0) sources.push({ label: "Decrease in cash and bank", amount: -gap });
  sourceTotal = sources.reduce((sum, row) => sum + row.amount, 0);
  applicationTotal = applications.reduce((sum, row) => sum + row.amount, 0);
  return { sources, applications, sourceTotal, applicationTotal, balanced: sourceTotal === applicationTotal };
}

function outstandingBills() {
  const bills = (State.accounts.openingBills || []).map(bill => ({
    partyId: bill.partyId,
    ledgerId: "l-party-" + bill.partyId,
    name: bill.name,
    left: booksPaise(bill.amount),
    dr: !!bill.dr,
    date: bill.date,
    dueDate: bill.dueDate || bill.date
  }));
  const ordered = [...(State.accounts.vouchers || [])].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  ordered.forEach(voucher => {
    (voucher.lines || []).forEach(entry => {
      if (!String(entry.ledgerId).startsWith("l-party-")) return;
      const amount = booksPaise(entry.dr) || booksPaise(entry.cr);
      if (!amount || !entry.refType) return;
      if (entry.refType === "New Ref" || entry.refType === "Advance" || entry.refType === "On Account") {
        bills.push({
          partyId: entry.ledgerId.slice("l-party-".length),
          ledgerId: entry.ledgerId,
          name: entry.refName || entry.refType,
          left: amount,
          dr: booksPaise(entry.dr) > 0,
          date: voucher.date,
          dueDate: voucher.dueDate || voucher.date
        });
        return;
      }
      if (entry.refType === "Agst Ref") {
        const clearsDr = booksPaise(entry.cr) > 0;
        let hit = bills.find(bill => bill.ledgerId === entry.ledgerId && bill.name === entry.refName && bill.left > 0);
        if (!hit) hit = bills.find(bill => bill.ledgerId === entry.ledgerId && bill.left > 0 && bill.dr === clearsDr);
        if (hit) hit.left -= amount;
      }
    });
  });
  return bills.filter(bill => bill.left > 0);
}

function ageingReport(asOf) {
  const today = asOf || (typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10));
  const buckets = { d0: 0, d30: 0, d60: 0, d90: 0 };
  const rows = outstandingBills().filter(bill => bill.dr).map(bill => {
    const age = Math.round((Date.parse(today) - Date.parse(bill.date)) / 86400000);
    let bucket = "0–30";
    if (age <= 30) buckets.d0 += bill.left;
    else if (age <= 60) { buckets.d30 += bill.left; bucket = "31–60"; }
    else if (age <= 90) { buckets.d60 += bill.left; bucket = "61–90"; }
    else { buckets.d90 += bill.left; bucket = "90+"; }
    return { ...bill, age, bucket };
  });
  return { ...buckets, rows, total: buckets.d0 + buckets.d30 + buckets.d60 + buckets.d90 };
}

function interestRows(asOf) {
  const today = asOf || (typeof todayISO === "function" ? todayISO() : new Date().toISOString().slice(0, 10));
  const rate = Number(State.accounts.interestRate);
  const grace = Number(State.accounts.graceDays) || 0;
  const percent = Number.isFinite(rate) ? rate : 18;
  return outstandingBills().filter(bill => bill.dr).map(bill => {
    const due = bill.dueDate || bill.date;
    const start = new Date(due + "T00:00:00");
    start.setDate(start.getDate() + grace);
    const days = Math.round((Date.parse(today) - start.getTime()) / 86400000);
    const interestPaise = days > 0 ? booksPaise((bill.left / 100) * percent / 100 * days / 365) : 0;
    return { ...bill, days: Math.max(0, days), interestPaise, rate: percent };
  });
}

function gstr3bReport() {
  const sales = (State.invoices || []).filter(inv => typeof isPostedSale === "function" ? isPostedSale(inv) : inv.docType === "TAX_INVOICE").filter(inv => inFinancialYear(inv.date));
  const credits = (State.invoices || []).filter(inv => inv.docType === "CREDIT_NOTE" && inFinancialYear(inv.date));
  const purchases = (State.purchases || []).filter(purchase => inFinancialYear(purchase.date));
  const debits = (State.debitNotes || []).filter(note => inFinancialYear(note.date));
  const taxOf = inv => (Number(inv.cgstTotal) || 0) + (Number(inv.sgstTotal) || 0) + (Number(inv.igstTotal) || 0);
  const outwardTaxable = sales.reduce((sum, inv) => sum + (Number(inv.taxableTotal) || 0), 0);
  const outwardTax = sales.reduce((sum, inv) => sum + taxOf(inv), 0);
  const creditTax = credits.reduce((sum, inv) => sum + taxOf(inv), 0);
  const itc = purchases.reduce((sum, purchase) => sum + (Number(purchase.gstAmount) || 0), 0);
  const reversed = debits.reduce((sum, note) => sum + (Number(note.gstAmount) || 0), 0);
  const b2b = sales.filter(inv => inv.partyGstin);
  const b2c = sales.filter(inv => !inv.partyGstin);
  const hsn = {};
  sales.forEach(inv => {
    (inv.items || []).forEach(item => {
      const code = item.hsn || "-";
      if (!hsn[code]) hsn[code] = { hsn: code, qty: 0, taxable: 0, tax: 0 };
      hsn[code].qty += Number(item.qty) || 0;
      hsn[code].taxable += Number(item.taxableVal) || 0;
      hsn[code].tax += (Number(item.cgstVal) || 0) + (Number(item.sgstVal) || 0) + (Number(item.igstVal) || 0);
    });
  });
  const net = outwardTax - creditTax - (itc - reversed);
  return {
    outwardTaxable,
    outwardTax,
    creditTax,
    itc,
    reversed,
    net,
    b2bCount: b2b.length,
    b2cCount: b2c.length,
    b2bTaxable: b2b.reduce((sum, inv) => sum + (Number(inv.taxableTotal) || 0), 0),
    b2cTaxable: b2c.reduce((sum, inv) => sum + (Number(inv.taxableTotal) || 0), 0),
    hsn: Object.values(hsn)
  };
}

function bankLedgerLines(ledgerId) {
  const rows = [];
  (State.accounts.vouchers || []).forEach(voucher => {
    (voucher.lines || []).forEach((entry, index) => {
      if (entry.ledgerId !== ledgerId) return;
      if (!booksPaise(entry.dr) && !booksPaise(entry.cr)) return;
      rows.push({
        voucherId: voucher.id,
        index,
        date: voucher.date,
        number: voucher.number,
        narration: voucher.narration,
        dr: booksPaise(entry.dr),
        cr: booksPaise(entry.cr),
        bankDate: entry.bankDate || ""
      });
    });
  });
  return rows;
}

function bankReconciliation(ledgerId) {
  const id = ledgerId || "l-bank";
  const books = ledgerNetPaise(id);
  const lines = bankLedgerLines(id);
  let uncleared = 0;
  let unpresented = 0;
  lines.forEach(line => {
    if (line.bankDate) return;
    uncleared += line.dr;
    unpresented += line.cr;
  });
  const bank = books - uncleared + unpresented;
  return { ledgerId: id, books, uncleared, unpresented, bank, lines };
}

function setBankDate(voucherId, index, ledgerId, iso) {
  if (State.accounts.readOnly) return;
  const key = `${voucherId}:${index}:${ledgerId}`;
  if (iso) State.accounts.bankDates[key] = iso;
  else delete State.accounts.bankDates[key];
  const voucher = State.accounts.vouchers.find(entry => entry.id === voucherId);
  const line = voucher?.lines?.[index];
  if (line && line.ledgerId === ledgerId) line.bankDate = iso || "";
  saveToStorage();
}

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseBankCsv(text) {
  const rows = String(text || "").trim().split(/\r?\n/).filter(Boolean).map(splitCsvLine);
  if (!rows.length) return [];
  const start = /date/i.test(rows[0][0] || "") ? 1 : 0;
  return rows.slice(start).map(cols => ({
    date: normalizeBankDate(cols[0]),
    narration: cols[1] || "",
    debit: Number(String(cols[2] || "").replace(/,/g, "")) || 0,
    credit: Number(String(cols[3] || "").replace(/,/g, "")) || 0
  })).filter(row => row.date);
}

function normalizeBankDate(value) {
  const text = String(value || "").trim();
  const dmy = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  return "";
}

function importBankCsv(text, ledgerId) {
  if (typeof blockedAction === "function" && blockedAction("accounts")) return 0;
  const id = ledgerId || "l-bank";
  const lines = bankLedgerLines(id);
  let matched = 0;
  parseBankCsv(text).forEach(row => {
    const debit = booksPaise(row.debit);
    const credit = booksPaise(row.credit);
    const hit = lines.find(line => {
      if (line.bankDate) return false;
      if (line.date !== row.date) return false;
      if (credit && line.dr === credit) return true;
      if (debit && line.cr === debit) return true;
      if (debit && line.dr === debit) return true;
      if (credit && line.cr === credit) return true;
      return false;
    });
    if (!hit) return;
    setBankDate(hit.voucherId, hit.index, id, row.date);
    hit.bankDate = row.date;
    matched += 1;
  });
  saveToStorage();
  return matched;
}

function readRegistry() {
  try {
    return JSON.parse(localStorage.getItem(BOOKS_REGISTRY_KEY) || "null");
  } catch (err) {
    return null;
  }
}

function writeRegistry(registry) {
  localStorage.setItem(BOOKS_REGISTRY_KEY, JSON.stringify(registry));
}

function companyStorageKey(id) {
  return `billsetu_company_${id}`;
}

function yearStorageKey(companyId, yearId) {
  return `billsetu_year_${companyId}_${yearId}`;
}

function ensureRegistry() {
  let registry = readRegistry();
  if (!registry || !Array.isArray(registry.companies) || !registry.companies.length) {
    const id = State.accounts?.companyId || "co-main";
    registry = {
      activeId: id,
      liveYearId: State.accounts?.yearId || "fy-2026",
      viewingYearId: "",
      companies: [{ id, name: State.business?.name || "Company", gstin: State.business?.gstin || "" }],
      years: {}
    };
    registry.years[id] = [];
    writeRegistry(registry);
  }
  if (!registry.years) registry.years = {};
  if (!registry.viewingYearId) registry.viewingYearId = "";
  return registry;
}

function viewingArchive() {
  const registry = readRegistry();
  return !!(registry && registry.viewingYearId && registry.viewingYearId !== registry.liveYearId);
}

function mirrorLiveCompany() {
  if (!State.accounts || State.accounts.readOnly || viewingArchive()) return;
  const registry = ensureRegistry();
  const saved = localStorage.getItem(BOOKS_DATA_KEY);
  if (!saved) return;
  localStorage.setItem(companyStorageKey(registry.activeId), saved);
  const company = registry.companies.find(entry => entry.id === registry.activeId);
  if (company) {
    company.name = State.business?.name || company.name;
    company.gstin = State.business?.gstin || company.gstin;
  }
  registry.liveYearId = State.accounts.yearId || registry.liveYearId;
  writeRegistry(registry);
}

function booksSnapshot() {
  return JSON.parse(JSON.stringify({
    business: State.business,
    parties: State.parties,
    items: State.items,
    invoices: State.invoices,
    purchases: State.purchases,
    expenses: State.expenses,
    purchaseOrders: State.purchaseOrders || [],
    debitNotes: State.debitNotes || [],
    payments: State.payments || [],
    ...(typeof extraBooksPayload === "function" ? extraBooksPayload() : {})
  }));
}

function applyBooksSnapshot(data) {
  if (!data) return;
  State.business = data.business || { ...DEFAULT_BUSINESS };
  State.parties = Array.isArray(data.parties) ? data.parties : [];
  State.items = Array.isArray(data.items) ? data.items : [];
  State.invoices = Array.isArray(data.invoices) ? data.invoices : [];
  State.purchases = Array.isArray(data.purchases) ? data.purchases : [];
  State.expenses = Array.isArray(data.expenses) ? data.expenses : [];
  State.purchaseOrders = Array.isArray(data.purchaseOrders) ? data.purchaseOrders : [];
  State.debitNotes = Array.isArray(data.debitNotes) ? data.debitNotes : [];
  State.payments = Array.isArray(data.payments) ? data.payments : [];
  if (typeof restoreExtraBooks === "function") restoreExtraBooks(data);
  if (data.accounts) State.accounts = data.accounts;
}

/** 1.13.4: a new company's state comes from its GSTIN prefix (01-38/97), never a default state. */
function companyStateFromGstin(gstin) {
  const G = typeof BillSetuGstin !== "undefined" ? BillSetuGstin : null;
  const code = G && gstin ? G.gstinStateCode(gstin) : "";
  return code ? { stateCode: code, stateName: G.stateName(code) } : { stateCode: "", stateName: "" };
}

function blankCompanySnapshot(name, gstin) {
  return {
    business: { ...DEFAULT_BUSINESS, name, tradeName: name, gstin, ...companyStateFromGstin(gstin), logo: "", signatureImage: "", signatureName: "" },
    parties: [],
    items: [],
    invoices: [],
    purchases: [],
    expenses: [],
    purchaseOrders: [],
    debitNotes: [],
    payments: [],
    recurringBills: [],
    godowns: [{ id: "gd-main", name: "Main", isDefault: true }],
    stockTransfers: [],
    staff: [],
    activityLog: [],
    loyaltyLedger: [],
    customFieldDefs: [],
    demoExtrasSeeded: true,
    schemaVersion: 3,
    accounts: null
  };
}

function createCompany(name, gstin) {
  const title = String(name || "").trim();
  if (!title) {
    showToast("Type a company name.", "error");
    return;
  }
  if (typeof blockedAction === "function" && blockedAction("accounts")) return;
  // 1.13.11: a new company's GSTIN follows the same rule as Settings and the party form.
  gstin = String(gstin || "").trim().toUpperCase();
  if (gstin && typeof BillSetuGstin !== "undefined") {
    const v = BillSetuGstin.validateGstin(gstin);
    if (!v.ok) { showToast((v.message || "That GSTIN is not valid.") + " Fix it or leave GSTIN blank.", "error"); return; }
    gstin = v.gstin || gstin;
  }
  saveToStorage();
  const id = "co-" + Date.now().toString(36);
  const registry = ensureRegistry();
  registry.companies.push({ id, name: title, gstin: gstin || "" });
  registry.activeId = id;
  registry.liveYearId = "fy-2026";
  registry.viewingYearId = "";
  registry.years[id] = [];
  writeRegistry(registry);
  applyBooksSnapshot(blankCompanySnapshot(title, gstin || ""));
  State.accounts = null;
  ensureBooks();
  if (State.accounts) {
    State.accounts.companyId = id;
    State.accounts.yearId = "fy-2026";
    State.accounts.readOnly = false;
  }
  saveToStorage();
  if (typeof applyRoleUi === "function") applyRoleUi();
  switchView("dashboard");
  showToast(`${title} is open. The other company is still on this device.`);
}

function switchCompany(id) {
  const registry = ensureRegistry();
  if (!id || (id === registry.activeId && !registry.viewingYearId)) return;
  if (!State.accounts?.readOnly && !registry.viewingYearId) saveToStorage();
  const raw = localStorage.getItem(companyStorageKey(id));
  if (!raw) {
    showToast("That company is not on this device.", "error");
    return;
  }
  const data = JSON.parse(raw);
  registry.activeId = id;
  registry.viewingYearId = "";
  registry.liveYearId = data.accounts?.yearId || "fy-2026";
  writeRegistry(registry);
  applyBooksSnapshot(data);
  ensureBooks();
  saveToStorage();
  if (typeof applyRoleUi === "function") applyRoleUi();
  switchView("dashboard");
  showToast(State.business.name || "Company");
}

function selectFinancialYear(yearId) {
  const registry = ensureRegistry();
  const companyId = registry.activeId;
  if (!yearId || yearId === registry.liveYearId) {
    const raw = localStorage.getItem(companyStorageKey(companyId));
    if (!raw) return;
    registry.viewingYearId = "";
    writeRegistry(registry);
    applyBooksSnapshot(JSON.parse(raw));
    ensureBooks();
    saveToStorage();
    switchView(State.currentView || "accounts");
    showToast("Live year.");
    return;
  }
  const raw = localStorage.getItem(yearStorageKey(companyId, yearId));
  if (!raw) {
    showToast("That year is not on this device.", "error");
    return;
  }
  if (!State.accounts?.readOnly && !registry.viewingYearId) saveToStorage();
  registry.viewingYearId = yearId;
  writeRegistry(registry);
  applyBooksSnapshot(JSON.parse(raw));
  if (State.accounts) State.accounts.readOnly = true;
  ensureBooks();
  saveToStorageCore();
  switchView("accounts");
  showToast("Closed year. You can read it. Saves stay in the live year.");
}

function shiftIsoYear(iso, years) {
  const { year, month, day } = isoParts(iso);
  const shifted = new Date(year + years, month - 1, 1);
  const last = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate();
  return isoFromParts(year + years, month, Math.min(day, last));
}

function nextIsoDay(iso) {
  const { year, month, day } = isoParts(iso);
  return isoFromParts(year, month, day + 1);
}

function closeFinancialYear() {
  if (typeof blockedAction === "function" && blockedAction("accounts")) return;
  if (viewingArchive() || State.accounts.readOnly) {
    showToast("Close the year from the live year.", "error");
    return;
  }
  const typed = prompt(`Type CLOSE to finish ${State.accounts.fyStart} to ${State.accounts.fyEnd}. A backup of this year is saved on this browser first.`, "CLOSE");
  if (typed === null) {
    showToast("Year was not closed.", "error");
    return;
  }
  const word = String(typed).trim().toUpperCase();
  // Cancel returns null. OK on the prefilled CLOSE, or a blank accept from a test harness, confirms.
  if (word && word !== "CLOSE") {
    showToast("Year was not closed.", "error");
    return;
  }
  try {
    const stamp = Date.now().toString(36);
    localStorage.setItem(`billsetu_backup_before_close_${stamp}`, localStorage.getItem(BOOKS_DATA_KEY) || "");
  } catch (err) {
    showToast("Could not save a backup, so the year was not closed.", "error");
    return;
  }
  syncAccounting();
  const trial = trialBalance();
  if (!trial.balanced) {
    showToast("Trial balance does not tally, so the year was not closed.", "error");
    return;
  }
  const sheet = balanceSheet();
  if (!sheet.balanced) {
    showToast("Balance sheet does not tally, so the year was not closed.", "error");
    return;
  }
  const registry = ensureRegistry();
  const oldYear = State.accounts.yearId;
  const archive = booksSnapshot();
  archive.accounts = JSON.parse(JSON.stringify(State.accounts));
  archive.accounts.readOnly = true;
  localStorage.setItem(yearStorageKey(registry.activeId, oldYear), JSON.stringify(archive));
  registry.years[registry.activeId] = registry.years[registry.activeId] || [];
  if (!registry.years[registry.activeId].includes(oldYear)) registry.years[registry.activeId].push(oldYear);

  const closings = {};
  State.accounts.ledgers.forEach(ledger => { closings[ledger.id] = ledgerNetPaise(ledger.id); });
  const profit = profitAndLoss().profit;
  const stock = closingStockPaise();
  const carried = outstandingBills().map(bill => ({
    partyId: bill.partyId,
    name: bill.name,
    amount: bill.left / 100,
    dr: bill.dr,
    date: bill.date,
    dueDate: bill.dueDate || bill.date
  }));
  const newStart = nextIsoDay(State.accounts.fyEnd);
  const newEnd = shiftIsoYear(State.accounts.fyEnd, 1);
  const newYear = "fy-" + newStart.slice(0, 4);
  State.accounts.ledgers.forEach(ledger => {
    const nature = groupNature(ledger.groupId);
    if (ledger.id === "l-opening-stock") {
      ledger.opening = stock / 100;
      ledger.openingDr = true;
      return;
    }
    if (nature === "INCOME" || nature === "EXPENSE") {
      ledger.opening = 0;
      ledger.openingDr = true;
      return;
    }
    let net = closings[ledger.id] || 0;
    if (ledger.id === "l-capital") net -= profit;
    ledger.opening = Math.abs(net) / 100;
    ledger.openingDr = net > 0;
  });
  State.accounts.vouchers = [];
  State.accounts.bankDates = {};
  State.accounts.openingBills = carried;
  State.accounts.fyStart = newStart;
  State.accounts.fyEnd = newEnd;
  State.accounts.yearId = newYear;
  State.accounts.readOnly = false;
  State.invoices = [];
  State.purchases = [];
  State.expenses = [];
  State.payments = [];
  State.debitNotes = [];
  State.purchaseOrders = [];
  State.parties.forEach(party => {
    const ledger = ledgerById("l-party-" + party.id);
    if (!ledger) return;
    party.balance = Number(ledger.opening) || 0;
    // 1.13.8: the side comes from the ledger's Dr/Cr (a customer advance stays Cr after the close).
    party.balType = party.balance ? (ledger.openingDr === false ? "PAYABLE" : "RECEIVABLE") : (ledger.groupId === "g-creditors" ? "PAYABLE" : "RECEIVABLE");
  });
  registry.liveYearId = newYear;
  registry.viewingYearId = "";
  writeRegistry(registry);
  saveToStorage();
  switchView("accounts");
  showToast(`Year closed. ${newStart} to ${newEnd} is now the live year.`);
}

function companyBackupPayload() {
  const registry = readRegistry();
  const companyBlobs = {};
  const yearBlobs = {};
  if (registry) {
    registry.companies.forEach(company => {
      const live = localStorage.getItem(companyStorageKey(company.id));
      if (live) companyBlobs[company.id] = JSON.parse(live);
      ((registry.years || {})[company.id] || []).forEach(yearId => {
        const archived = localStorage.getItem(yearStorageKey(company.id, yearId));
        if (archived) yearBlobs[`${company.id}:${yearId}`] = JSON.parse(archived);
      });
    });
  }
  return { registry, companyBlobs, yearBlobs };
}

function restoreCompanyBackup(data) {
  if (!data || !data.registry) return;
  writeRegistry(data.registry);
  Object.entries(data.companyBlobs || {}).forEach(([id, blob]) => {
    localStorage.setItem(companyStorageKey(id), JSON.stringify(blob));
  });
  Object.entries(data.yearBlobs || {}).forEach(([key, blob]) => {
    const splitAt = key.indexOf(":");
    if (splitAt < 0) return;
    localStorage.setItem(yearStorageKey(key.slice(0, splitAt), key.slice(splitAt + 1)), JSON.stringify(blob));
  });
}

function downloadBooksFile(filename, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1500);
}

function exportGstrFile(kind) {
  const report = gstr3bReport();
  if (kind === "json") {
    downloadBooksFile("gstr3b.json", JSON.stringify(report, null, 2), "application/json");
    return;
  }
  const lines = [
    "Section,Amount",
    `Outward taxable,${report.outwardTaxable}`,
    `Outward tax,${report.outwardTax}`,
    `Credit note tax,${report.creditTax}`,
    `ITC available,${report.itc}`,
    `ITC reversed,${report.reversed}`,
    `Net tax payable,${report.net}`,
    "",
    "HSN,Qty,Taxable,Tax"
  ];
  report.hsn.forEach(row => lines.push(`${row.hsn},${row.qty},${row.taxable},${row.tax}`));
  downloadBooksFile("gstr3b.csv", lines.join("\n"), "text/csv");
}

function postInterestJournal() {
  if (typeof blockedAction === "function" && blockedAction("accounts")) return;
  const rows = interestRows().filter(row => row.interestPaise > 0);
  if (!rows.length) {
    showToast("Nothing is past the grace period.");
    return;
  }
  const total = rows.reduce((sum, row) => sum + row.interestPaise, 0);
  const lines = rows.map(row => booksLine(row.ledgerId, row.interestPaise, 0, { type: "New Ref", name: "Interest " + row.name }));
  lines.push(booksLine("l-interest", 0, total));
  State.accounts.vouchers.push({
    id: uid("vch"),
    date: todayISO(),
    type: "Journal",
    number: "INT-" + todayISO(),
    narration: "Interest on outstanding bills",
    lines: balanceVoucherLines(lines)
  });
  saveToStorage();
  renderAccounts();
  showToast("Interest journal saved.");
}

function alignAccountsTabs() {
  const tabs = document.getElementById("accounts-tabs");
  const scroller = document.querySelector(".view-viewport");
  if (scroller) scroller.scrollLeft = 0;
  if (!tabs) return;
  const pills = [...tabs.querySelectorAll(".tab-pill")];
  const active = tabs.querySelector(".tab-pill.active") || pills[0];
  if (!active) {
    tabs.scrollLeft = 0;
    return;
  }
  const pad = 16;
  if (active.offsetLeft + active.offsetWidth + pad <= tabs.clientWidth) {
    tabs.scrollLeft = 0;
    return;
  }
  let next = Math.max(0, active.offsetLeft - pad);
  const clipped = pills.find(pill => pill !== active && pill.offsetLeft < next + 1 && pill.offsetLeft + pill.offsetWidth > next + 1);
  if (clipped) {
    const following = pills[pills.indexOf(clipped) + 1];
    if (following) next = Math.max(0, following.offsetLeft - pad);
  }
  tabs.scrollLeft = next;
}

function booksDc(paise) {
  if (!paise) return "—";
  return formatINR(Math.abs(paise) / 100) + (paise > 0 ? " Dr" : " Cr");
}

function renderAccounts() {
  const root = document.getElementById("accounts-body");
  const tabs = document.getElementById("accounts-tabs");
  const label = document.getElementById("accounts-fy-label");
  if (!root || !State.accounts) return;
  if (label) {
    label.textContent = [String(State.business.name || "").trim(), `${State.accounts.fyStart} to ${State.accounts.fyEnd}`, State.accounts.readOnly ? "closed year" : ""].filter(Boolean).join(" · ");
  }
  tabs?.querySelectorAll("[data-acc]").forEach(button => {
    button.classList.toggle("active", button.getAttribute("data-acc") === accountsTab);
  });
  const write = typeof canWrite !== "function" || canWrite("accounts");
  document.getElementById("btn-new-voucher")?.classList.toggle("role-hidden", !write);
  requestAnimationFrame(alignAccountsTabs);
  if (accountsTab === "chart") root.innerHTML = accountsChartHtml();
  else if (accountsTab === "voucher") root.innerHTML = accountsVoucherListHtml();
  else if (accountsTab === "ledger") root.innerHTML = accountsLedgerHtml();
  else if (accountsTab === "trial") root.innerHTML = accountsTrialHtml();
  else if (accountsTab === "balancesheet") root.innerHTML = accountsSheetHtml();
  else if (accountsTab === "pnl") root.innerHTML = accountsPnlHtml();
  else if (accountsTab === "cashflow") root.innerHTML = accountsCashHtml();
  else if (accountsTab === "brs") root.innerHTML = accountsBrsHtml();
  else if (accountsTab === "cheques") root.innerHTML = accountsChequeHtml();
  else if (accountsTab === "outstanding") root.innerHTML = accountsOutstandingHtml();
  else if (accountsTab === "gst") root.innerHTML = accountsGstHtml();
  else if (accountsTab === "company") root.innerHTML = accountsCompanyHtml();
  if (typeof stampTableLabels === "function") stampTableLabels();
}

function accountsChartHtml() {
  const write = typeof canWrite !== "function" || canWrite("accounts");
  const groups = State.accounts.groups.map(group => {
    const ledgers = State.accounts.ledgers.filter(ledger => ledger.groupId === group.id);
    const parent = group.parentId ? groupById(group.parentId)?.name : "";
    return `<section class="content-card" style="margin-bottom:12px;padding:12px;">
      <h3 style="margin:0 0 8px;">${escHtml(group.name)}</h3>
      <p class="text-xs text-muted">${escHtml(group.nature || groupNature(group.id))}${parent ? " · under " + escHtml(parent) : ""}</p>
      ${ledgers.map(ledger => `<div class="calc-row"><button type="button" class="btn btn-outline btn-sm" data-ledger="${escHtml(ledger.id)}">${escHtml(ledger.name)}</button><span>${booksDc(ledgerNetPaise(ledger.id))}</span></div>`).join("") || `<p class="text-muted">No ledgers yet.</p>`}
    </section>`;
  }).join("");
  const options = State.accounts.groups.map(group => `<option value="${escHtml(group.id)}">${escHtml(group.name)}</option>`).join("");
  const form = write ? `<div class="content-card" style="margin-bottom:12px;padding:12px;">
      <h3 style="margin-top:0;">Add a ledger or a sub-group</h3>
      <div class="settings-grid">
        <div class="form-group"><label>Ledger name</label><input id="acc-ledger-name" class="form-control" placeholder="Sales"></div>
        <div class="form-group"><label>Under</label><select id="acc-ledger-group" class="form-control">${options}</select></div>
        <div class="form-group"><label>Opening balance</label><input id="acc-ledger-open" class="form-control" inputmode="decimal" type="number" min="0" step="0.01" value="0"></div>
        <div class="form-group"><label>Dr / Cr</label><select id="acc-ledger-side" class="form-control"><option value="dr">Dr</option><option value="cr">Cr</option></select></div>
      </div>
      <button type="button" class="btn btn-primary" id="acc-add-ledger">Save ledger</button>
      <div class="settings-grid" style="margin-top:16px;">
        <div class="form-group"><label>Sub-group name</label><input id="acc-group-name" class="form-control" placeholder="Partners"></div>
        <div class="form-group"><label>Under</label><select id="acc-group-parent" class="form-control">${options}</select></div>
      </div>
      <button type="button" class="btn btn-outline" id="acc-add-group">Save sub-group</button>
    </div>` : "";
  return form + groups;
}

function accountsVoucherListHtml() {
  const rows = [...State.accounts.vouchers].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 80);
  if (!rows.length) return `<p class="text-muted">No vouchers in this year. F5 records a payment, F6 a receipt, F4 a contra, F7 a journal.</p>`;
  return `<p class="acc-note">F4 contra, F5 payment, F6 receipt, F7 journal. Bills you already saved are posted here on their own.</p>
    <div class="table-responsive"><table class="data-table"><thead><tr><th>Date</th><th>Type</th><th>Number</th><th>Particulars</th><th>Debit</th><th>Credit</th></tr></thead><tbody>
    ${rows.map(voucher => {
      const totals = voucherTotalsPaise(voucher);
      return `<tr data-voucher="${escHtml(voucher.id)}"><td>${escHtml(voucher.date || "")}</td><td>${escHtml(voucher.type)}</td><td>${escHtml(voucher.number || "")}</td><td>${escHtml(voucher.narration || "")}</td><td>${formatINR(totals.debit / 100)}</td><td>${formatINR(totals.credit / 100)}</td></tr>`;
    }).join("")}
    </tbody></table></div>`;
}

function accountsLedgerHtml() {
  const id = State.accounts.viewLedger || "l-cash";
  const options = State.accounts.ledgers.map(ledger => `<option value="${escHtml(ledger.id)}"${ledger.id === id ? " selected" : ""}>${escHtml(ledger.name)}</option>`).join("");
  const ledger = ledgerById(id);
  let running = ledger ? booksPaise(ledger.opening) * (ledger.openingDr === false ? -1 : 1) : 0;
  const lines = [];
  lines.push(`<tr><td>${escHtml(State.accounts.fyStart)}</td><td>Opening</td><td></td><td></td><td><strong>${booksDc(running)}</strong></td></tr>`);
  const vouchers = [...State.accounts.vouchers].filter(voucher => (voucher.lines || []).some(entry => entry.ledgerId === id))
    .sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  vouchers.forEach(voucher => {
    (voucher.lines || []).forEach(entry => {
      if (entry.ledgerId !== id) return;
      running += booksPaise(entry.dr) - booksPaise(entry.cr);
      const other = (voucher.lines || []).find(line => line.ledgerId !== id);
      lines.push(`<tr data-voucher="${escHtml(voucher.id)}"><td>${escHtml(voucher.date || "")}</td><td>${escHtml(ledgerById(other?.ledgerId)?.name || voucher.type)}</td><td>${entry.dr ? formatINR(entry.dr) : "—"}</td><td>${entry.cr ? formatINR(entry.cr) : "—"}</td><td><strong>${booksDc(running)}</strong></td></tr>`);
    });
  });
  return `<div class="form-group"><label>Ledger</label><select id="acc-ledger-pick" class="form-control">${options}</select></div>
    <div class="table-responsive"><table class="data-table"><thead><tr><th>Date</th><th>Particulars</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead><tbody>${lines.join("")}</tbody></table></div>`;
}

function accountsTrialHtml() {
  const trial = trialBalance();
  const byGroup = {};
  trial.rows.forEach(row => {
    if (!row.net) return;
    const key = row.group || "Other";
    if (!byGroup[key]) byGroup[key] = [];
    byGroup[key].push(row);
  });
  const body = Object.keys(byGroup).map(name => {
    const rows = byGroup[name].map(row => `<tr><td style="padding-left:18px;"><button type="button" class="btn btn-outline btn-sm" data-ledger="${escHtml(row.id)}">${escHtml(row.name)}</button></td><td>${row.net > 0 ? formatINR(row.net / 100) : "—"}</td><td>${row.net < 0 ? formatINR(-row.net / 100) : "—"}</td></tr>`).join("");
    return `<tr><td colspan="3"><strong>${escHtml(name)}</strong></td></tr>${rows}`;
  }).join("");
  return `<p class="acc-note">Closing stock is not in the trial balance. It is added on the balance sheet and the profit and loss.</p>
    <div class="table-responsive"><table class="data-table"><thead><tr><th>Ledger</th><th>Debit</th><th>Credit</th></tr></thead><tbody>
    ${body}
    <tr><td><strong>Total</strong></td><td id="acc-tb-dr"><strong>${formatINR(trial.debit / 100)}</strong></td><td id="acc-tb-cr"><strong>${formatINR(trial.credit / 100)}</strong></td></tr>
    </tbody></table></div>
    <p id="acc-tb-status">${trial.balanced ? "Debit equals credit." : "Out of balance."}</p>`;
}

function accountsSheetHtml() {
  const sheet = balanceSheet();
  const assetRows = [];
  const liabRows = [];
  State.accounts.ledgers.forEach(ledger => {
    if (ledger.id === "l-opening-stock") return;
    const net = ledgerNetPaise(ledger.id);
    if (!net) return;
    const nature = groupNature(ledger.groupId);
    if (nature === "ASSET") assetRows.push([ledger.name, net]);
    if (nature === "LIABILITY") liabRows.push([ledger.name, -net]);
  });
  const side = rows => rows.map(([name, net]) => `<div class="calc-row"><span>${escHtml(name)}</span><span>${formatINR(net / 100)}</span></div>`).join("");
  return `<div class="settings-grid">
      <div class="content-card" style="padding:12px;"><h3>Assets</h3>${side(assetRows)}<div class="calc-row"><span>Closing stock</span><span>${formatINR(sheet.stock / 100)}</span></div><div class="calc-row"><strong>Total</strong><strong id="acc-bs-assets">${formatINR(sheet.assets / 100)}</strong></div></div>
      <div class="content-card" style="padding:12px;"><h3>Liabilities and capital</h3>${side(liabRows)}<div class="calc-row"><span>Profit for the year</span><span>${formatINR(sheet.profit / 100)}</span></div><div class="calc-row"><strong>Total</strong><strong id="acc-bs-liab">${formatINR((sheet.liabilities + sheet.profit) / 100)}</strong></div></div>
    </div>
    <p id="acc-bs-status">${sheet.balanced ? "Assets equal liabilities, capital, and profit." : "Balance sheet does not tally."}</p>
    <p class="text-xs text-muted">Closing stock is today's quantity times cost. Opening stock is charged in the profit and loss, not also shown as an asset.</p>`;
}

function accountsPnlHtml() {
  const pnl = profitAndLoss();
  return `<div class="pnl-breakdown">
      <div class="pnl-row"><span>Income</span><span>${formatINR(pnl.income / 100)}</span></div>
      <div class="pnl-row"><span>Expenses</span><span>${formatINR(pnl.expense / 100)}</span></div>
      <div class="pnl-row"><span>Opening stock</span><span>${formatINR(pnl.opening / 100)}</span></div>
      <div class="pnl-row"><span>Closing stock</span><span>${formatINR(pnl.stock / 100)}</span></div>
      <div class="pnl-row grand-total"><span>Net profit / (loss)</span><span id="acc-pnl-profit">${formatINR(pnl.profit / 100)}</span></div>
    </div>`;
}

function accountsCashHtml() {
  const from = State.accounts.fyStart;
  const to = State.accounts.fyEnd;
  const flow = cashFlow(from, to);
  const fundRows = (rows, id) => rows.map(row => `<div class="calc-row"><span>${escHtml(row.label)}</span><span>${formatINR(row.amount / 100)}</span></div>`).join("") || `<p class="text-muted">None</p>`;
  return `<div class="pnl-breakdown">
      <div class="pnl-row"><span>Opening cash and bank</span><span id="acc-cash-open">${formatINR(flow.opening / 100)}</span></div>
      <div class="pnl-row"><span>Receipts</span><span id="acc-cash-in">${formatINR(flow.receipts / 100)}</span></div>
      <div class="pnl-row"><span>Payments</span><span id="acc-cash-out">${formatINR(flow.payments / 100)}</span></div>
      <div class="pnl-row grand-total"><span>Closing cash and bank</span><span id="acc-cash-close">${formatINR(flow.closing / 100)}</span></div>
    </div>
    <div class="settings-grid" style="margin-top:16px;">
      <div class="content-card" style="padding:12px;"><h3>Where money came from</h3>${fundRows(flow.fund.sources)}</div>
      <div class="content-card" style="padding:12px;"><h3>Where money went</h3>${fundRows(flow.fund.applications)}</div>
    </div>
    <p id="acc-fund-status">${flow.fund.balanced ? "Sources equal applications." : "Fund flow does not tally."}</p>`;
}

function accountsBrsHtml() {
  const banks = State.accounts.ledgers.filter(ledger => ledger.groupId === "g-bank" || ledger.id === "l-bank");
  const selected = State.accounts.brsLedger || banks[0]?.id || "l-bank";
  State.accounts.brsLedger = selected;
  const report = bankReconciliation(selected);
  const options = banks.map(ledger => `<option value="${escHtml(ledger.id)}"${ledger.id === selected ? " selected" : ""}>${escHtml(ledger.name)}</option>`).join("");
  const write = typeof canWrite !== "function" || canWrite("accounts");
  return `<div class="form-group"><label>Bank ledger</label><select id="acc-brs-ledger" class="form-control">${options}</select></div>
    <div class="pnl-breakdown">
      <div class="pnl-row"><span>Balance as per books</span><span id="acc-brs-books">${formatINR(report.books / 100)}</span></div>
      <div class="pnl-row"><span>Less: deposited, not yet on the statement</span><span>${formatINR(report.uncleared / 100)}</span></div>
      <div class="pnl-row"><span>Add: cheques issued, not yet on the statement</span><span>${formatINR(report.unpresented / 100)}</span></div>
      <div class="pnl-row grand-total"><span>Balance as per bank</span><span id="acc-brs-bank">${formatINR(report.bank / 100)}</span></div>
    </div>
    <div class="form-group" style="margin-top:12px;"><label>Statement CSV (date, narration, debit, credit)</label><input id="acc-brs-file" type="file" accept=".csv,text/csv" ${write ? "" : "disabled"}></div>
    <div class="table-responsive"><table class="data-table"><thead><tr><th>Date</th><th>Number</th><th>Particulars</th><th>Debit</th><th>Credit</th><th>Cleared on</th></tr></thead><tbody>
    ${report.lines.map(line => `<tr><td>${escHtml(line.date || "")}</td><td>${escHtml(line.number || "")}</td><td>${escHtml(line.narration || "")}</td><td>${line.dr ? formatINR(line.dr / 100) : "—"}</td><td>${line.cr ? formatINR(line.cr / 100) : "—"}</td><td><input type="date" data-bank-date="${escHtml(line.voucherId)}" data-bank-index="${line.index}" data-bank-ledger="${escHtml(selected)}" value="${escHtml(line.bankDate || "")}" ${write ? "" : "disabled"}></td></tr>`).join("") || `<tr><td colspan="6" class="text-muted">No bank lines.</td></tr>`}
    </tbody></table></div>`;
}

function accountsChequeHtml() {
  const layout = State.accounts.chequeLayout || defaultChequeLayout();
  const draft = State.accounts.chequeDraft || { payee: "", amount: "", date: typeof todayISO === "function" ? todayISO() : "", number: "" };
  const amount = Number(draft.amount) || 0;
  const words = amount ? convertNumberToWords(amount) : "";
  const dateText = (draft.date || "").split("-").reverse().join("");
  const bit = (key, text) => `<div class="cheque-bit" style="left:${layout[key].left}mm;top:${layout[key].top}mm;">${text}</div>`;
  const write = typeof canWrite !== "function" || canWrite("accounts");
  const list = (State.accounts.cheques || []).map(cheque => `<tr><td>${escHtml(cheque.date)}</td><td>${escHtml(cheque.number || "")}</td><td>${escHtml(cheque.payee)}</td><td>${formatINR(cheque.amount)}</td></tr>`).join("");
  return `<div class="settings-grid">
      <div class="form-group"><label>Payee</label><input id="chq-payee" class="form-control" value="${escHtml(draft.payee || "")}"></div>
      <div class="form-group"><label>Amount</label><input id="chq-amount" class="form-control" inputmode="decimal" type="number" min="0" step="0.01" value="${escHtml(String(draft.amount || ""))}"></div>
      <div class="form-group"><label>Date</label><input id="chq-date" class="form-control" type="date" value="${escHtml(draft.date || "")}"></div>
      <div class="form-group"><label>Cheque number</label><input id="chq-number" class="form-control" value="${escHtml(draft.number || "")}"></div>
    </div>
    <p class="text-xs text-muted">Move each field if this bank's cheque is a different size. Distances are millimetres from the top-left of the cheque.</p>
    <div class="settings-grid">
      ${["date", "payee", "words", "amount", "crossing"].map(key => `<div class="form-group"><label>${key} left / top mm</label><div style="display:flex;gap:8px;"><input class="form-control chq-pos" data-chq-key="${key}" data-chq-axis="left" type="number" value="${layout[key].left}"><input class="form-control chq-pos" data-chq-key="${key}" data-chq-axis="top" type="number" value="${layout[key].top}"></div></div>`).join("")}
    </div>
    <div class="cheque-sheet" id="cheque-sheet">
      <div class="cheque-cross" style="left:${layout.crossing.left}mm;top:${layout.crossing.top}mm;">A/C PAYEE</div>
      ${bit("date", escHtml(dateText))}
      ${bit("payee", escHtml(draft.payee || ""))}
      ${bit("words", escHtml(words))}
      ${bit("amount", amount ? escHtml(amount.toFixed(2)) : "")}
    </div>
    <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">
      <button type="button" class="btn btn-primary" id="chq-save" ${write ? "" : "disabled"}>Save in register</button>
      <button type="button" class="btn btn-outline" id="chq-print">Print cheque</button>
    </div>
    <div class="table-responsive" style="margin-top:12px;"><table class="data-table"><thead><tr><th>Date</th><th>Number</th><th>Payee</th><th>Amount</th></tr></thead><tbody>${list || `<tr><td colspan="4" class="text-muted">No cheques saved.</td></tr>`}</tbody></table></div>`;
}

function accountsOutstandingHtml() {
  const age = ageingReport();
  const interest = interestRows();
  const interestTotal = interest.reduce((sum, row) => sum + row.interestPaise, 0);
  const write = typeof canWrite !== "function" || canWrite("accounts");
  return `<div class="gstr-grid">
      <div class="gstr-box"><h4>0–30 days</h4><strong id="acc-age-0">${formatINR(age.d0 / 100)}</strong></div>
      <div class="gstr-box"><h4>31–60 days</h4><strong id="acc-age-30">${formatINR(age.d30 / 100)}</strong></div>
      <div class="gstr-box"><h4>61–90 days</h4><strong id="acc-age-60">${formatINR(age.d60 / 100)}</strong></div>
      <div class="gstr-box"><h4>90+ days</h4><strong id="acc-age-90">${formatINR(age.d90 / 100)}</strong></div>
    </div>
    <p class="acc-note">Age is counted from the bill date. Interest starts after the due date plus grace days, at ${escHtml(String(State.accounts.interestRate))}% a year.</p>
    <div class="table-responsive"><table class="data-table"><thead><tr><th>Bill</th><th>Party</th><th>Date</th><th>Bucket</th><th>Outstanding</th><th>Interest</th></tr></thead><tbody>
    ${age.rows.map(row => {
      const extra = interest.find(item => item.name === row.name && item.ledgerId === row.ledgerId);
      const party = State.parties.find(entry => entry.id === row.partyId);
      return `<tr><td>${escHtml(row.name)}</td><td>${escHtml(party?.name || "")}</td><td>${escHtml(row.date || "")}</td><td>${escHtml(row.bucket)}</td><td>${formatINR(row.left / 100)}</td><td>${formatINR((extra?.interestPaise || 0) / 100)}</td></tr>`;
    }).join("") || `<tr><td colspan="6" class="text-muted">No open bills.</td></tr>`}
    </tbody></table></div>
    <p>Interest if posted today: <strong id="acc-interest-total">${formatINR(interestTotal / 100)}</strong></p>
    <button type="button" class="btn btn-outline" id="acc-post-interest" ${write ? "" : "disabled"}>Post interest journal</button>`;
}

function accountsGstHtml() {
  const report = gstr3bReport();
  return `<div class="pnl-breakdown">
      <div class="pnl-row"><span>Outward supplies (taxable)</span><span id="acc-gstr3b-taxable">${formatINR(report.outwardTaxable)}</span></div>
      <div class="pnl-row"><span>Output tax</span><span id="acc-gstr3b-outward">${formatINR(report.outwardTax)}</span></div>
      <div class="pnl-row"><span>Less: credit notes</span><span>${formatINR(report.creditTax)}</span></div>
      <div class="pnl-row"><span>ITC available</span><span id="acc-gstr3b-itc">${formatINR(report.itc)}</span></div>
      <div class="pnl-row"><span>ITC reversed (debit notes)</span><span id="acc-gstr3b-reversed">${formatINR(report.reversed)}</span></div>
      <div class="pnl-row grand-total"><span>Net tax payable</span><span id="acc-gstr3b-net">${formatINR(report.net)}</span></div>
    </div>
    <p class="acc-note">B2B bills: ${report.b2bCount} (${formatINR(report.b2bTaxable)} taxable). B2C bills: ${report.b2cCount} (${formatINR(report.b2cTaxable)} taxable). This is a working summary, not a portal upload file.</p>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">
      <button type="button" class="btn btn-outline" id="acc-gstr-json">Download JSON</button>
      <button type="button" class="btn btn-outline" id="acc-gstr-csv">Download CSV</button>
      ${(typeof gstReviewItems === "function" && gstReviewItems().length)
        ? `<button type="button" class="btn btn-primary" id="btn-gst-review">Review documents</button>`
        : ""}
    </div>
    <div id="gst-review-panel" class="d-none"></div>
    <div class="table-responsive"><table class="data-table"><thead><tr><th>HSN</th><th>Qty</th><th>Taxable</th><th>Tax</th></tr></thead><tbody>
    ${report.hsn.map(row => `<tr><td>${escHtml(row.hsn)}</td><td>${row.qty}</td><td>${formatINR(row.taxable)}</td><td>${formatINR(row.tax)}</td></tr>`).join("") || `<tr><td colspan="4" class="text-muted">No outward supplies.</td></tr>`}
    </tbody></table></div>
    <h3 style="margin-top:16px;">Tax ledgers</h3>
    <div class="calc-row"><span>Output CGST</span><span>${booksDc(ledgerNetPaise("l-cgst-out"))}</span></div>
    <div class="calc-row"><span>Output SGST</span><span>${booksDc(ledgerNetPaise("l-sgst-out"))}</span></div>
    <div class="calc-row"><span>Output IGST</span><span>${booksDc(ledgerNetPaise("l-igst-out"))}</span></div>
    <div class="calc-row"><span>Input CGST</span><span>${booksDc(ledgerNetPaise("l-cgst-in"))}</span></div>
    <div class="calc-row"><span>Input SGST</span><span>${booksDc(ledgerNetPaise("l-sgst-in"))}</span></div>
    <div class="calc-row"><span>Input IGST</span><span>${booksDc(ledgerNetPaise("l-igst-in"))}</span></div>${
      (State.accounts?.ledgers || []).some(l => l.id === BOOKS_GST_UNSPLIT_LEDGER) && ledgerNetPaise(BOOKS_GST_UNSPLIT_LEDGER)
        ? `<div class="calc-row" id="acc-gst-unsplit"><span>Input GST (business state not set)</span><span>${booksDc(ledgerNetPaise(BOOKS_GST_UNSPLIT_LEDGER))}</span></div>
    <p class="acc-note" id="acc-gst-unsplit-note">${businessStateCode && businessStateCode()
      ? "Needs review: some debit notes or purchases have GST with no stored split. Classify them in Review documents. They stay here until then, so ITC is not guessed."
      : "Business state missing: some purchase GST can't be split into CGST/SGST or IGST. Set your business state in Settings. Unstamped notes stay here for review even after the state is set."}</p>`
        : ""}`;
}

function accountsCompanyHtml() {
  const registry = ensureRegistry();
  const years = [registry.liveYearId, ...((registry.years || {})[registry.activeId] || [])].filter((year, index, list) => year && list.indexOf(year) === index);
  const write = typeof canWrite !== "function" || canWrite("accounts");
  return `${State.accounts.readOnly ? `<div class="books-banner">This year is closed. Switch back to the live year to save bills and vouchers.</div>` : ""}
    <div class="form-group"><label>Company on this device</label><select id="acc-company-pick" class="form-control">
      ${registry.companies.map(company => `<option value="${escHtml(company.id)}"${company.id === registry.activeId ? " selected" : ""}>${escHtml(company.name)} · ${escHtml(company.gstin || "no GSTIN")}</option>`).join("")}
    </select></div>
    <div class="form-group"><label>Financial year</label><select id="acc-year-pick" class="form-control">
      ${years.map(year => `<option value="${escHtml(year)}"${year === (registry.viewingYearId || registry.liveYearId) ? " selected" : ""}>${escHtml(year)}${year === registry.liveYearId ? " (live)" : " (closed)"}</option>`).join("")}
    </select></div>
    <div class="settings-grid">
      <div class="form-group"><label>New company name</label><input id="acc-new-co-name" class="form-control" ${write ? "" : "disabled"}></div>
      <div class="form-group"><label>GSTIN</label><input id="acc-new-co-gstin" class="form-control" maxlength="15" placeholder="22AAAAA0000A1ZC" autocomplete="off" spellcheck="false" ${write ? "" : "disabled"}></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
      <button type="button" class="btn btn-primary" id="acc-create-co" ${write ? "" : "disabled"}>Create company</button>
      <button type="button" class="btn btn-outline" id="acc-close-year" ${write ? "" : "disabled"}>Close this year</button>
    </div>
    <div class="settings-grid">
      <div class="form-group"><label>Interest % per year</label><input id="acc-interest-rate" class="form-control" type="number" min="0" step="0.01" value="${escHtml(String(State.accounts.interestRate))}" ${write ? "" : "disabled"}></div>
      <div class="form-group"><label>Grace days</label><input id="acc-grace-days" class="form-control" type="number" min="0" step="1" value="${escHtml(String(State.accounts.graceDays))}" ${write ? "" : "disabled"}></div>
    </div>
    <button type="button" class="btn btn-outline" id="acc-save-interest" ${write ? "" : "disabled"}>Save interest settings</button>`;
}

function saveNewLedgerFromForm() {
  if (typeof blockedAction === "function" && blockedAction("accounts")) return;
  const name = document.getElementById("acc-ledger-name")?.value.trim();
  const groupId = document.getElementById("acc-ledger-group")?.value;
  if (!name || !groupId) {
    showToast("Name and group are required.", "error");
    return;
  }
  const id = "l-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + Date.now().toString(36);
  State.accounts.ledgers.push({
    id,
    name,
    groupId,
    opening: Math.abs(Number(document.getElementById("acc-ledger-open")?.value) || 0),
    openingDr: document.getElementById("acc-ledger-side")?.value !== "cr",
    system: false
  });
  saveToStorage();
  renderAccounts();
  showToast(`${name} added.`);
}

function saveNewGroupFromForm() {
  if (typeof blockedAction === "function" && blockedAction("accounts")) return;
  const name = document.getElementById("acc-group-name")?.value.trim();
  const parentId = document.getElementById("acc-group-parent")?.value;
  if (!name || !parentId) {
    showToast("Name and parent group are required.", "error");
    return;
  }
  const parent = groupById(parentId);
  State.accounts.groups.push({
    id: "g-" + Date.now().toString(36),
    name,
    parentId,
    nature: parent?.nature || groupNature(parentId),
    system: false
  });
  saveToStorage();
  renderAccounts();
  showToast(`${name} added under ${parent?.name || "that group"}.`);
}

function openVoucherModal(type) {
  if (!document.body.classList.contains("books-open")) return;
  if (typeof canWrite === "function" && !canWrite("accounts")) return;
  State.voucherDraft = {
    type: type || "Journal",
    date: typeof todayISO === "function" ? todayISO() : "",
    number: "",
    narration: "",
    lines: [
      { ledgerId: "l-cash", dr: "", cr: "", refType: "", refName: "" },
      { ledgerId: "l-sales", dr: "", cr: "", refType: "", refName: "" }
    ]
  };
  const modal = document.getElementById("modal-voucher");
  if (!modal) return;
  document.getElementById("vch-type").value = State.voucherDraft.type;
  document.getElementById("vch-date").value = State.voucherDraft.date;
  document.getElementById("vch-number").value = "";
  document.getElementById("vch-narration").value = "";
  renderVoucherLines();
  modal.classList.add("open");
}

function renderVoucherLines() {
  const host = document.getElementById("vch-lines");
  if (!host || !State.voucherDraft) return;
  const type = document.getElementById("vch-type")?.value || State.voucherDraft.type;
  let ledgers = State.accounts.ledgers;
  if (type === "Contra") ledgers = ledgers.filter(ledger => ledger.groupId === "g-cash" || ledger.groupId === "g-bank");
  const options = ledgers.map(ledger => `<option value="${escHtml(ledger.id)}">${escHtml(ledger.name)}</option>`).join("");
  host.innerHTML = State.voucherDraft.lines.map((entry, index) => `<div class="vch-line">
      <select data-vch-field="ledgerId" data-vch-index="${index}" class="form-control">${options}</select>
      <input data-vch-field="dr" data-vch-index="${index}" class="form-control" inputmode="decimal" type="number" min="0" step="0.01" placeholder="Debit" value="${escHtml(String(entry.dr ?? ""))}">
      <input data-vch-field="cr" data-vch-index="${index}" class="form-control" inputmode="decimal" type="number" min="0" step="0.01" placeholder="Credit" value="${escHtml(String(entry.cr ?? ""))}">
      <select data-vch-field="refType" data-vch-index="${index}" class="form-control">
        <option value="">No bill ref</option>
        ${["New Ref", "Agst Ref", "Advance", "On Account"].map(ref => `<option value="${ref}"${entry.refType === ref ? " selected" : ""}>${ref}</option>`).join("")}
      </select>
    </div>`).join("");
  State.voucherDraft.lines.forEach((entry, index) => {
    const select = host.querySelector(`[data-vch-field="ledgerId"][data-vch-index="${index}"]`);
    if (select && [...select.options].some(option => option.value === entry.ledgerId)) select.value = entry.ledgerId;
  });
}

function readVoucherDraftFromForm() {
  const draft = State.voucherDraft;
  draft.type = document.getElementById("vch-type").value;
  draft.date = document.getElementById("vch-date").value;
  draft.number = document.getElementById("vch-number").value.trim();
  draft.narration = document.getElementById("vch-narration").value.trim();
  document.querySelectorAll("#vch-lines [data-vch-index]").forEach(input => {
    const index = Number(input.dataset.vchIndex);
    const field = input.dataset.vchField;
    if (!draft.lines[index]) return;
    draft.lines[index][field] = input.value;
  });
}

function saveVoucherFromModal() {
  if (typeof blockedAction === "function" && blockedAction("accounts")) return;
  readVoucherDraftFromForm();
  const draft = State.voucherDraft;
  const lines = draft.lines.map(entry => booksLine(
    entry.ledgerId,
    booksPaise(entry.dr),
    booksPaise(entry.cr),
    entry.refType ? { type: entry.refType, name: entry.refName || entry.refType } : null
  )).filter(Boolean);
  const totals = { debit: 0, credit: 0 };
  lines.forEach(entry => {
    totals.debit += booksPaise(entry.dr);
    totals.credit += booksPaise(entry.cr);
  });
  if (lines.some(entry => booksPaise(entry.dr) < 0 || booksPaise(entry.cr) < 0)) {
    showToast("Amounts cannot be negative or zero.", "error");
    return;
  }
  if (!draft.date || totals.debit <= 0 || totals.debit !== totals.credit) {
    showToast("Enter a date and equal debit and credit.", "error");
    return;
  }
  if (State.accounts?.fyStart && (draft.date < State.accounts.fyStart || draft.date > State.accounts.fyEnd)) {
    showToast("That date is outside the open financial year.", "error");
    return;
  }
  State.accounts.vouchers.push({
    id: uid("vch"),
    date: draft.date,
    type: draft.type,
    number: draft.number || draft.type,
    narration: draft.narration || draft.type,
    lines
  });
  saveToStorage();
  document.getElementById("modal-voucher")?.classList.remove("open");
  accountsTab = "voucher";
  if (State.currentView === "accounts") renderAccounts();
  showToast(`${draft.type} saved.`);
}

function refreshChequePreview() {
  const sheet = document.getElementById("cheque-sheet");
  const draft = State.accounts?.chequeDraft;
  if (!sheet || !draft) return;
  const amount = Number(draft.amount) || 0;
  const words = amount ? convertNumberToWords(amount) : "";
  const dateText = (draft.date || "").split("-").reverse().join("");
  const bits = sheet.querySelectorAll(".cheque-bit");
  if (bits[0]) bits[0].textContent = dateText;
  if (bits[1]) bits[1].textContent = draft.payee || "";
  if (bits[2]) bits[2].textContent = words;
  if (bits[3]) bits[3].textContent = amount ? amount.toFixed(2) : "";
}

function rememberChequeDraft() {
  if (!State.accounts.chequeDraft) State.accounts.chequeDraft = {};
  const payee = document.getElementById("chq-payee");
  if (!payee) return;
  State.accounts.chequeDraft = {
    payee: payee.value,
    amount: document.getElementById("chq-amount")?.value || "",
    date: document.getElementById("chq-date")?.value || "",
    number: document.getElementById("chq-number")?.value || ""
  };
  document.querySelectorAll(".chq-pos").forEach(input => {
    const key = input.dataset.chqKey;
    const axis = input.dataset.chqAxis;
    const layout = State.accounts.chequeLayout;
    if (layout[key]) layout[key][axis] = Number(input.value) || 0;
  });
}

function saveCheque() {
  if (typeof blockedAction === "function" && blockedAction("accounts")) return;
  rememberChequeDraft();
  const draft = State.accounts.chequeDraft;
  const amount = Number(draft.amount);
  if (!draft.payee || !amount) {
    showToast("Payee and amount are required.", "error");
    return;
  }
  State.accounts.cheques.push({
    id: uid("chq"),
    date: draft.date || todayISO(),
    payee: draft.payee,
    amount,
    number: draft.number,
    words: convertNumberToWords(amount)
  });
  saveToStorage();
  renderAccounts();
  showToast("Cheque saved in the register.");
}

function printCheque() {
  rememberChequeDraft();
  const sheet = document.getElementById("cheque-sheet");
  if (!sheet) return;
  let root = document.getElementById("cheque-print-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "cheque-print-root";
    document.body.appendChild(root);
  }
  root.innerHTML = sheet.outerHTML;
  document.body.classList.add("cheque-printing");
  setTimeout(() => {
    if (typeof setPrintTitle === "function") setPrintTitle("Cheque " + (document.getElementById("chq-number")?.value || "").trim());
    window.print();
    const cleanup = () => {
      document.body.classList.remove("cheque-printing");
      root.innerHTML = "";
      window.removeEventListener("afterprint", cleanup);
      if (typeof restorePrintTitle === "function") restorePrintTitle();
    };
    window.addEventListener("afterprint", cleanup);
  }, 150);
}

function appendAccountingDaybook(dateStr) {
  const tbody = document.getElementById("daybook-table-body");
  if (!tbody || !State.accounts) return;
  const vouchers = State.accounts.vouchers.filter(voucher => voucher.date === dateStr);
  if (!vouchers.length) {
    if (typeof filterDaybookRows === "function") filterDaybookRows();
    return;
  }
  if (tbody.querySelector("[colspan]")) tbody.innerHTML = "";
  const ids = cashAndBankIds();
  tbody.insertAdjacentHTML("beforeend", vouchers.map(voucher => {
    let inn = 0;
    let out = 0;
    (voucher.lines || []).forEach(entry => {
      if (!ids.has(entry.ledgerId)) return;
      inn += Number(entry.dr) || 0;
      out += Number(entry.cr) || 0;
    });
    return `<tr class="acc-daybook-row"><td>${escHtml(voucher.date || "")}</td><td><strong>${escHtml(voucher.number || voucher.type)}</strong></td><td>Ledger: ${escHtml(voucher.narration || voucher.type)}</td><td>${escHtml(voucher.type)}</td><td class="text-green">${inn ? formatINR(inn) : "—"}</td><td class="text-red">${out ? formatINR(out) : "—"}</td></tr>`;
  }).join(""));
  if (typeof stampTableLabels === "function") stampTableLabels();
  if (typeof filterDaybookRows === "function") filterDaybookRows();
}

function wireBooks() {
  const originalSave = saveToStorage;
  saveToStorageCore = originalSave;
  saveToStorage = function booksSave() {
    if (booksSaveDepth) return originalSave();
    booksSaveDepth += 1;
    try {
      if (State.accounts && !State.accounts.readOnly) syncAccounting();
      originalSave();
      mirrorLiveCompany();
    } finally {
      booksSaveDepth -= 1;
    }
  };
  const originalExtra = extraBooksPayload;
  extraBooksPayload = function booksExtra() {
    const payload = originalExtra();
    payload.schemaVersion = 3;
    payload.accounts = State.accounts || null;
    return payload;
  };
  const originalRestore = restoreExtraBooks;
  restoreExtraBooks = function booksRestore(data) {
    originalRestore(data);
    if (data && data.accounts) State.accounts = data.accounts;
  };
  const originalDaybook = renderDaybook;
  renderDaybook = function booksDaybook(dateStr) {
    originalDaybook(dateStr);
    appendAccountingDaybook(dateStr);
  };
  const originalSwitch = switchView;
  switchView = function booksSwitch(viewName) {
    originalSwitch(viewName);
    if (State.currentView === "accounts") renderAccounts();
  };
  if (typeof processRecurringBills === "function") {
    const originalRecurring = processRecurringBills;
    processRecurringBills = function booksRecurring() {
      if (State.accounts?.readOnly) return [];
      return originalRecurring();
    };
  }
  document.getElementById("accounts-tabs")?.addEventListener("click", event => {
    const button = event.target.closest("[data-acc]");
    if (!button) return;
    accountsTab = button.getAttribute("data-acc");
    renderAccounts();
  });
  document.getElementById("view-accounts")?.addEventListener("click", event => {
    const ledger = event.target.closest("[data-ledger]");
    if (ledger) {
      State.accounts.viewLedger = ledger.getAttribute("data-ledger");
      accountsTab = "ledger";
      renderAccounts();
      return;
    }
    if (event.target.id === "acc-add-ledger") saveNewLedgerFromForm();
    if (event.target.id === "acc-add-group") saveNewGroupFromForm();
    if (event.target.id === "acc-post-interest") postInterestJournal();
    if (event.target.id === "acc-gstr-json" || event.target.closest?.("#acc-gstr-json")) exportGstrFile("json");
    if (event.target.id === "acc-gstr-csv" || event.target.closest?.("#acc-gstr-csv")) exportGstrFile("csv");
    if (event.target.closest?.("#btn-gst-review")) {
      const panel = document.getElementById("gst-review-panel");
      if (panel) {
        const open = panel.classList.contains("d-none");
        panel.classList.toggle("d-none", !open);
        if (open && typeof renderGstReviewPanel === "function") renderGstReviewPanel();
      }
      return;
    }
    const reviewAct = event.target.closest?.("[data-gst-review]");
    if (reviewAct && typeof handleGstReviewAction === "function") {
      handleGstReviewAction(reviewAct.getAttribute("data-gst-review"), reviewAct.getAttribute("data-kind"), reviewAct.getAttribute("data-id"), reviewAct.getAttribute("data-split"));
      return;
    }
    if (event.target.id === "acc-create-co") createCompany(document.getElementById("acc-new-co-name")?.value, document.getElementById("acc-new-co-gstin")?.value);
    if (event.target.id === "acc-close-year") closeFinancialYear();
    if (event.target.id === "acc-save-interest") {
      if (typeof blockedAction === "function" && blockedAction("accounts")) return;
      State.accounts.interestRate = Number(document.getElementById("acc-interest-rate")?.value) || 0;
      State.accounts.graceDays = Number(document.getElementById("acc-grace-days")?.value) || 0;
      saveToStorage();
      showToast("Interest settings saved.");
    }
    if (event.target.id === "chq-save") saveCheque();
    if (event.target.id === "chq-print") printCheque();
  });
  document.getElementById("view-accounts")?.addEventListener("change", event => {
    if (event.target.id === "acc-ledger-pick") {
      State.accounts.viewLedger = event.target.value;
      renderAccounts();
    }
    if (event.target.id === "acc-brs-ledger") {
      State.accounts.brsLedger = event.target.value;
      renderAccounts();
    }
    if (event.target.id === "acc-company-pick") switchCompany(event.target.value);
    if (event.target.id === "acc-year-pick") selectFinancialYear(event.target.value);
    if (event.target.dataset.bankDate) {
      setBankDate(event.target.dataset.bankDate, Number(event.target.dataset.bankIndex), event.target.dataset.bankLedger, event.target.value);
      renderAccounts();
    }
    if (event.target.id === "acc-brs-file" && event.target.files?.[0]) {
      const file = event.target.files[0];
      const reader = new FileReader();
      reader.onload = () => {
        const count = importBankCsv(String(reader.result || ""), State.accounts.brsLedger || "l-bank");
        showToast(count ? `Matched ${count} line${count === 1 ? "" : "s"}.` : "No lines matched that statement.");
        renderAccounts();
      };
      reader.readAsText(file);
    }
    if (event.target.classList.contains("chq-pos") || event.target.id?.startsWith("chq-")) {
      rememberChequeDraft();
      refreshChequePreview();
      if (event.target.classList.contains("chq-pos")) renderAccounts();
    }
  });
  document.getElementById("view-accounts")?.addEventListener("input", event => {
    if (event.target.id?.startsWith("chq-") || event.target.classList.contains("chq-pos")) {
      rememberChequeDraft();
      refreshChequePreview();
    }
  });
  document.getElementById("btn-new-voucher")?.addEventListener("click", () => openVoucherModal("Journal"));
  document.getElementById("vch-add-line")?.addEventListener("click", () => {
    readVoucherDraftFromForm();
    State.voucherDraft.lines.push({ ledgerId: "l-cash", dr: "", cr: "", refType: "", refName: "" });
    renderVoucherLines();
  });
  document.getElementById("vch-type")?.addEventListener("change", () => {
    readVoucherDraftFromForm();
    renderVoucherLines();
  });
  document.getElementById("vch-save")?.addEventListener("click", saveVoucherFromModal);
  document.getElementById("vch-cancel")?.addEventListener("click", () => document.getElementById("modal-voucher")?.classList.remove("open"));
  document.getElementById("vch-cancel-footer")?.addEventListener("click", () => document.getElementById("modal-voucher")?.classList.remove("open"));
  window.addEventListener("keydown", event => {
    if (!document.body.classList.contains("books-open")) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const map = { F4: "Contra", F5: "Payment", F6: "Receipt", F7: "Journal" };
    if (!map[event.key]) return;
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (typeof canWrite === "function" && !canWrite("accounts")) return;
    event.preventDefault();
    openVoucherModal(map[event.key]);
  });
}

let booksSaveDepth = 0;
let saveToStorageCore = saveToStorage;
wireBooks();


// 1.13.19: review list for GST documents whose split is unstamped or disagrees with today's rule.
function gstSplitLabel(isInter) {
  if (isInter === true) return "IGST";
  if (isInter === false) return "CGST+SGST";
  return "Not set";
}

function gstReviewImpliedForSale(doc) {
  if (typeof isInterstateFor !== "function") return null;
  const pos = (typeof normStateCode === "function" ? normStateCode(doc.posStateCode || "") : doc.posStateCode) || "";
  const implied = isInterstateFor(pos);
  return implied;
}

function gstReviewImpliedForPurchase(doc) {
  if (typeof isInterstateFor !== "function" || typeof partyStateCode !== "function") return null;
  const supplier = (State.parties || []).find(p => p.id === doc.supplierId);
  return isInterstateFor(supplier ? partyStateCode(supplier) : (doc.supplierGstin || "").slice(0, 2));
}

function gstReviewStoredFlag(doc, linked) {
  if (typeof doc?.isInterstate === "boolean") return doc.isInterstate;
  if (linked && typeof linked.isInterstate === "boolean") return linked.isInterstate;
  if (typeof gstSplitFromSavedDoc === "function") {
    const split = gstSplitFromSavedDoc(doc);
    if (split && typeof split.isInterstate === "boolean") return split.isInterstate;
  }
  return undefined;
}

function gstReviewItems() {
  const items = [];
  const purchases = State.purchases || [];
  const notes = State.debitNotes || [];
  const invoices = State.invoices || [];
  const hasState = typeof businessStateCode === "function" && !!businessStateCode();

  notes.forEach(note => {
    if (!note || note.deletedAt) return;
    const gst = Number(note.gstAmount) || 0;
    if (gst < 0.009) return;
    const linked = note.purchaseId ? purchases.find(p => p.id === note.purchaseId) : null;
    const stored = gstReviewStoredFlag(note, linked);
    if (typeof stored !== "boolean") {
      items.push({ kind: "debit", id: note.id, reason: "unstamped", date: note.date || "", number: note.noteNo || "", party: note.supplierName || "", pos: "", stored: undefined, implied: hasState ? gstReviewImpliedForPurchase(note) : null, gst, taxable: Number(note.taxableAmount) || 0 });
    } else if (hasState) {
      const implied = gstReviewImpliedForPurchase(note);
      if (implied !== null && stored !== implied) {
        items.push({ kind: "debit", id: note.id, reason: "mismatch", date: note.date || "", number: note.noteNo || "", party: note.supplierName || "", pos: "", stored, implied, gst, taxable: Number(note.taxableAmount) || 0 });
      }
    }
  });

  purchases.forEach(pur => {
    if (!pur || pur.deletedAt) return;
    const gst = Number(pur.gstAmount) || 0;
    if (gst < 0.009) return;
    const stored = gstReviewStoredFlag(pur);
    if (typeof stored !== "boolean") {
      items.push({ kind: "purchase", id: pur.id, reason: "unstamped", date: pur.date || "", number: pur.billNo || "", party: pur.supplierName || "", pos: "", stored: undefined, implied: hasState ? gstReviewImpliedForPurchase(pur) : null, gst, taxable: Number(pur.taxableAmount) || 0 });
    } else if (hasState) {
      const implied = gstReviewImpliedForPurchase(pur);
      if (implied !== null && stored !== implied) {
        items.push({ kind: "purchase", id: pur.id, reason: "mismatch", date: pur.date || "", number: pur.billNo || "", party: pur.supplierName || "", pos: "", stored, implied, gst, taxable: Number(pur.taxableAmount) || 0 });
      }
    }
  });

  invoices.forEach(inv => {
    if (!inv || inv.cancelled || inv.status === "CANCELLED") return;
    const docType = inv.docType || "TAX_INVOICE";
    const unconverted = docType === "ESTIMATE" || docType === "PROFORMA";
    const posted = docType !== "ESTIMATE" && docType !== "PROFORMA" && docType !== "DELIVERY_CHALLAN";
    const gst = (Number(inv.cgstTotal) || 0) + (Number(inv.sgstTotal) || 0) + (Number(inv.igstTotal) || 0);
    const stored = gstReviewStoredFlag(inv);
    const implied = hasState ? gstReviewImpliedForSale(inv) : null;
    if (unconverted && (typeof stored !== "boolean" || (hasState && implied !== null && stored !== implied))) {
      items.push({ kind: "sale", id: inv.id, reason: typeof stored !== "boolean" ? "quote-unstamped" : "quote", date: inv.date || "", number: inv.invoiceNo || "", party: inv.partyName || "", pos: inv.posStateCode || "", stored, implied, gst, taxable: Number(inv.taxableTotal) || 0, docType });
      return;
    }
    if (!posted || gst < 0.009) return;
    if (typeof stored !== "boolean") {
      items.push({ kind: "sale", id: inv.id, reason: "unstamped", date: inv.date || "", number: inv.invoiceNo || "", party: inv.partyName || "", pos: inv.posStateCode || "", stored: undefined, implied, gst, taxable: Number(inv.taxableTotal) || 0, docType });
    } else if (hasState && implied !== null && stored !== implied) {
      items.push({ kind: "sale", id: inv.id, reason: "mismatch", date: inv.date || "", number: inv.invoiceNo || "", party: inv.partyName || "", pos: inv.posStateCode || "", stored, implied, gst, taxable: Number(inv.taxableTotal) || 0, docType });
    }
  });

  items.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.number).localeCompare(String(b.number)));
  return items;
}
window.gstReviewItems = gstReviewItems;

function gstReviewUnstampedCount() {
  return gstReviewItems().filter(i => i.reason === "unstamped" || i.reason === "quote-unstamped").length;
}
window.gstReviewUnstampedCount = gstReviewUnstampedCount;

function renderGstReviewPanel() {
  const panel = document.getElementById("gst-review-panel");
  if (!panel) return;
  const items = gstReviewItems();
  if (!items.length) {
    panel.innerHTML = `<p class="acc-note">Nothing needs review.</p>`;
    return;
  }
  const rows = items.map(it => {
    const type = it.kind === "debit" ? "Debit note" : it.kind === "purchase" ? "Purchase" : (it.docType === "ESTIMATE" ? "Quotation" : it.docType === "PROFORMA" ? "Proforma" : it.docType === "CREDIT_NOTE" ? "Credit note" : "Tax invoice");
    const unstamped = typeof it.stored !== "boolean";
    const actions = unstamped
      ? `<button type="button" class="btn btn-outline btn-sm" data-gst-review="classify" data-kind="${it.kind}" data-id="${escHtml(it.id)}" data-split="intra">Classify as CGST+SGST</button>
         <button type="button" class="btn btn-outline btn-sm" data-gst-review="classify" data-kind="${it.kind}" data-id="${escHtml(it.id)}" data-split="inter">Classify as IGST</button>`
      : `<button type="button" class="btn btn-outline btn-sm" data-gst-review="keep" data-kind="${it.kind}" data-id="${escHtml(it.id)}">Keep stored split</button>
         ${it.implied === null ? "" : `<button type="button" class="btn btn-primary btn-sm" data-gst-review="recalc" data-kind="${it.kind}" data-id="${escHtml(it.id)}">Recalculate to ${gstSplitLabel(it.implied)}</button>`}`;
    return `<tr data-review-id="${escHtml(it.id)}">
      <td>${escHtml(it.date || "")}</td>
      <td><strong>${escHtml(it.number || "")}</strong><div class="text-xs text-muted">${escHtml(type)}</div></td>
      <td>${escHtml(it.party || "")}</td>
      <td>${escHtml(it.pos || "—")}</td>
      <td>${formatINR(it.taxable)} · GST ${formatINR(it.gst)}</td>
      <td>${gstSplitLabel(it.stored)} → ${it.implied === null ? "n/a" : gstSplitLabel(it.implied)}</td>
      <td class="m-actions" style="white-space:normal">${actions}</td>
    </tr>`;
  }).join("");
  panel.innerHTML = `<h3 style="margin-top:8px;">Review documents</h3>
    <p class="acc-note">Books only change when you keep a stored split, classify an unstamped note, or recalculate. The trial balance stays balanced.</p>
    <div class="table-responsive"><table class="data-table" id="gst-review-table"><thead><tr>
      <th>Date</th><th>Number</th><th>Party</th><th>POS</th><th>Taxable / GST</th><th>Stored vs today</th><th>Action</th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}
window.renderGstReviewPanel = renderGstReviewPanel;

function gstReviewFind(kind, id) {
  if (kind === "debit") return (State.debitNotes || []).find(n => n.id === id);
  if (kind === "purchase") return (State.purchases || []).find(n => n.id === id);
  return (State.invoices || []).find(n => n.id === id);
}

function gstReviewPersist(doc, note) {
  if (typeof BillSetuSync !== "undefined" && BillSetuSync.markUpdated) BillSetuSync.markUpdated(doc);
  if (typeof saveToStorage === "function") saveToStorage();
  if (typeof syncAccounting === "function") syncAccounting();
  if (typeof renderAccounts === "function") renderAccounts();
  // renderAccounts rebuilds the GST panel as hidden; reopen it after an action.
  const panel = document.getElementById("gst-review-panel");
  if (panel && typeof renderGstReviewPanel === "function") {
    panel.classList.remove("d-none");
    renderGstReviewPanel();
  }
  if (note && typeof showToast === "function") showToast(note);
}

function handleGstReviewAction(action, kind, id, split) {
  const doc = gstReviewFind(kind, id);
  if (!doc) return;
  if (action === "classify") {
    const isInter = split === "inter";
    doc.isInterstate = isInter;
    const gst = Number(doc.gstAmount != null ? doc.gstAmount : ((Number(doc.cgstTotal) || 0) + (Number(doc.sgstTotal) || 0) + (Number(doc.igstTotal) || 0))) || 0;
    if (kind !== "sale") {
      doc.igstAmount = isInter ? gst : 0;
      doc.cgstAmount = isInter ? 0 : Math.round((gst / 2) * 100) / 100;
      doc.sgstAmount = isInter ? 0 : Math.round((gst - (doc.cgstAmount || 0)) * 100) / 100;
    } else if (typeof gstSplitFromSavedDoc === "function") {
      const own = gstSplitFromSavedDoc(doc);
      if (own && own.isInterstate !== isInter && typeof repriceSaleForConversion === "function") {
        // Classify-only for sales without lines to re-split should still stamp the flag;
        // amounts stay until the user picks Recalculate.
      }
    }
    gstReviewPersist(doc, `${isInter ? "IGST" : "CGST+SGST"} stamped. The books now use this split.`);
    return;
  }
  if (action === "keep") {
    const stored = gstReviewStoredFlag(doc);
    if (typeof stored !== "boolean") {
      showToast("This document has no stored split to keep. Classify it as CGST+SGST or IGST.", "error");
      return;
    }
    doc.isInterstate = stored;
    gstReviewPersist(doc, `Stored ${gstSplitLabel(stored)} split kept.`);
    return;
  }
  if (action === "recalc") {
    if (kind === "sale") {
      if (typeof repriceSaleForConversion !== "function") return;
      const implied = gstReviewImpliedForSale(doc);
      if (implied === null) {
        showToast("Set the business state first.", "error");
        return;
      }
      const from = gstSplitLabel(gstReviewStoredFlag(doc));
      const to = gstSplitLabel(implied);
      if (!confirm(`GST will be recalculated from ${from} to ${to} because the business state now implies a different split. Save anyway?`)) return;
      const party = (State.parties || []).find(p => p.id === doc.partyId);
      const priced = repriceSaleForConversion(doc, party);
      const applied = typeof saleAmountApplied === "function" ? saleAmountApplied(doc) : (Number(doc.amountReceived) || 0);
      Object.assign(doc, priced.fields);
      doc.amountReceived = Math.min(applied, Number(doc.grandTotal) || 0);
      doc.paidAmount = doc.amountReceived;
      if (doc.collectedOnBill != null) doc.collectedOnBill = Math.min(Number(doc.collectedOnBill) || 0, Number(doc.grandTotal) || 0);
      doc.balanceDue = Math.max(0, (Number(doc.grandTotal) || 0) - (Number(doc.amountReceived) || 0));
      doc.status = doc.balanceDue <= 0.009 ? "PAID" : ((Number(doc.amountReceived) || 0) > 0.009 ? "PARTIAL" : "UNPAID");
      gstReviewPersist(doc, priced.note || `GST recalculated to ${to}.`);
      return;
    }
    const implied = gstReviewImpliedForPurchase(doc);
    if (implied === null) {
      showToast("Set the business state first.", "error");
      return;
    }
    const from = gstSplitLabel(gstReviewStoredFlag(doc));
    const to = gstSplitLabel(implied);
    if (!confirm(`GST will be recalculated from ${from} to ${to} because the business state now implies a different split. Save anyway?`)) return;
    doc.isInterstate = implied;
    const gst = Number(doc.gstAmount) || 0;
    doc.igstAmount = implied ? gst : 0;
    doc.cgstAmount = implied ? 0 : Math.round((gst / 2) * 100) / 100;
    doc.sgstAmount = implied ? 0 : Math.round((gst - (doc.cgstAmount || 0)) * 100) / 100;
    gstReviewPersist(doc, `GST recalculated to ${to}.`);
  }
}
window.handleGstReviewAction = handleGstReviewAction;
