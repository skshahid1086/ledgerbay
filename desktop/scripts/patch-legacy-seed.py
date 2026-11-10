#!/usr/bin/env python3
"""Patch older app.js copies that lack lbIsProd so VARIANT=store starts empty."""
import re, sys
from pathlib import Path
p = Path(sys.argv[1])
src = p.read_text(encoding="utf-8")
if "function lbIsProd" in src and "EMPTY_BUSINESS" in src and "lbIsProd() ? EMPTY_BUSINESS" in src:
    print("app.js already has native store empty-seed")
    sys.exit(0)

helper = r'''
/** Desktop-injected build variant helpers (store ships empty). */
function lbVariant() {
  try { return (window.LEDGERBAY_BUILD && LEDGERBAY_BUILD.VARIANT) || "dev"; } catch (_) { return "dev"; }
}
function lbIsProd() { const v = lbVariant(); return v === "store" || v === "personal"; }
function lbIsPersonal() { return lbVariant() === "personal"; }

const EMPTY_BUSINESS = {
  name: "", tradeName: "", gstin: "", pan: "", stateCode: "27", stateName: "Maharashtra",
  address: "", phone: "", email: "", bankName: "", bankAcc: "", bankIfsc: "", bankBranch: "",
  upiId: "", terms: "1. Goods once sold will not be taken back without the original bill.\n2. Subject to local jurisdiction.",
  logo: "", signatureImage: "", signatureName: "",
  declaration: "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.",
  jurisdiction: "", classicBlankCells: true
};

'''
if "function lbIsProd" not in src:
    m = re.search(r"const CATEGORY_PRESETS = \{.*?\n\};\n", src, re.S)
    if m:
        src = src[:m.end()] + helper + src[m.end():]
    else:
        src = helper + src

old = """const State = {
  business: { ...DEFAULT_BUSINESS },
  parties: [...SAMPLE_PARTIES],
  items: [...SAMPLE_ITEMS],
  invoices: [...SAMPLE_INVOICES],
  purchases: [...SAMPLE_PURCHASES],
  expenses: [...SAMPLE_EXPENSES],
  purchaseOrders: JSON.parse(JSON.stringify(SAMPLE_ORDERS)),
  debitNotes: [],
  payments: [...SAMPLE_PAYMENTS],"""
new = """const State = {
  business: { ...(lbIsProd() ? EMPTY_BUSINESS : DEFAULT_BUSINESS) },
  parties: lbIsProd() ? [] : [...SAMPLE_PARTIES],
  items: lbIsProd() ? [] : [...SAMPLE_ITEMS],
  invoices: lbIsProd() ? [] : [...SAMPLE_INVOICES],
  purchases: lbIsProd() ? [] : [...SAMPLE_PURCHASES],
  expenses: lbIsProd() ? [] : [...SAMPLE_EXPENSES],
  purchaseOrders: lbIsProd() ? [] : JSON.parse(JSON.stringify(SAMPLE_ORDERS)),
  debitNotes: [],
  payments: lbIsProd() ? [] : [...SAMPLE_PAYMENTS],"""
if old in src:
    src = src.replace(old, new, 1)
    print("patched State seed for lbIsProd")
else:
    print("WARNING: State seed block not found for patch")

if 'Demo data is not available in this build' not in src:
    # Legacy builds ask `confirm("Load the <shop> demo?…")` before reloading sample data.
    src2 = re.sub(
        r'if \(!confirm\("Load the [^"?]* demo\?',
        lambda m: 'if (typeof lbIsProd === "function" && lbIsProd()) { showToast("Demo data is not available in this build.", "error"); return; }\n    ' + m.group(0),
        src,
        count=1,
    )
    if src2 != src:
        src = src2
        print("guarded demo reload")

p.write_text(src, encoding="utf-8")
print("legacy app.js patch done")
