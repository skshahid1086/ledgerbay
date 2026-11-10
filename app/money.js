/**
 * Ledgerbay shared money engine — all amounts in integer paise.
 * Round-half-up everywhere. Used by bills, purchases, CNs, reports, templates.
 */
(function (global) {
  "use strict";

  /** Round half up to nearest integer (paise). Avoids float .50 → down. */
  function roundHalfUp(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.floor(x + 0.5 + 1e-9);
  }

  /** Rupees → paise (half-up). 15000000.75 → 1500000075. */
  function toPaise(rupees) {
    const r = Number(rupees);
    if (!Number.isFinite(r)) return 0;
    // Scale via string when possible to keep .xx exact
    const s = String(rupees);
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const neg = s[0] === "-";
      const body = neg ? s.slice(1) : s;
      const [w, f = ""] = body.split(".");
      const frac = (f + "000").slice(0, 3);
      const two = frac.slice(0, 2);
      const third = Number(frac[2] || 0);
      let p = Number(w) * 100 + Number(two);
      if (third >= 5) p += 1;
      return neg ? -p : p;
    }
    return roundHalfUp(r * 100);
  }

  function fromPaise(paise) {
    return (Number(paise) || 0) / 100;
  }

  /** rate(rupees) × qty → line amount paise (half-up). */
  function lineAmountPaise(rateRupees, qty) {
    const q = Number(qty);
    if (!Number.isFinite(q) || q === 0) return 0;
    const rateP = toPaise(rateRupees);
    // rateP * qty may be fractional when qty is decimal (1.5 kg)
    return roundHalfUp(rateP * q);
  }

  function taxOnTaxablePaise(taxablePaise, gstRate) {
    const rate = Number(gstRate) || 0;
    if (rate <= 0 || taxablePaise <= 0) return 0;
    return roundHalfUp((taxablePaise * rate) / 100);
  }

  /** Inclusive gross paise → taxable + tax (tax = gross − taxable). */
  function splitInclusivePaise(grossPaise, gstRate) {
    const rate = Number(gstRate) || 0;
    if (rate <= 0) return { taxablePaise: grossPaise, taxPaise: 0 };
    const taxablePaise = roundHalfUp((grossPaise * 100) / (100 + rate));
    return { taxablePaise, taxPaise: grossPaise - taxablePaise };
  }

  /**
   * Compute a document (sale / purchase / CN).
   * @param {Array} draftItems — { qty, rate, discPercent, gstRate, rateInclusive? }
   * @param {object} opts — { isInterstate, billDiscount, loyaltyRupees, zeroGst,
   *   discountMode: 'beforeTax'|'afterTax' }
   */
  function computeDocument(draftItems, opts) {
    opts = opts || {};
    const isInterstate = !!opts.isInterstate;
    const zeroGst = !!opts.zeroGst;
    const discountMode = opts.discountMode === "afterTax" ? "afterTax" : "beforeTax";
    const billDiscP = Math.max(0, toPaise(opts.billDiscount || 0));
    const loyaltyP = Math.max(0, toPaise(opts.loyaltyRupees || 0));

    // Build pre-discount lines (skip qty<=0 for money; caller validates negatives)
    const raw = [];
    (draftItems || []).forEach((item, index) => {
      const qty = Number(item.qty);
      if (!Number.isFinite(qty) || qty <= 0) {
        raw.push({
          index, item, skip: true,
          taxablePaise: 0, taxPaise: 0, gstRate: zeroGst ? 0 : (Number(item.gstRate) || 0),
          grossPaise: 0
        });
        return;
      }
      const gstRate = zeroGst ? 0 : (Number(item.gstRate) || 0);
      const inclusive = !!(item.rateInclusive || item.inclusive || opts.rateInclusive);
      let taxablePaise;
      let taxPaise;
      let grossPaise;
      const discPercent = Math.max(0, Number(item.discPercent) || 0);
      if (inclusive) {
        const gross0 = lineAmountPaise(item.rate, qty);
        const afterLineDisc = roundHalfUp(gross0 * (100 - discPercent) / 100);
        const split = splitInclusivePaise(afterLineDisc, gstRate);
        taxablePaise = split.taxablePaise;
        taxPaise = split.taxPaise;
        grossPaise = afterLineDisc;
      } else {
        const amountP = lineAmountPaise(item.rate, qty);
        taxablePaise = roundHalfUp(amountP * (100 - discPercent) / 100);
        taxPaise = taxOnTaxablePaise(taxablePaise, gstRate);
        grossPaise = taxablePaise + taxPaise;
      }
      raw.push({ index, item, skip: false, taxablePaise, taxPaise, gstRate, grossPaise });
    });

    const active = raw.filter(l => !l.skip);
    const sumTaxable = active.reduce((s, l) => s + l.taxablePaise, 0);
    const sumGross = active.reduce((s, l) => s + l.grossPaise, 0);

    let priced;
    if (discountMode === "afterTax") {
      // Allocate ₹ discount across tax-inclusive line totals, then back-out taxable.
      const disc = Math.min(billDiscP, sumGross);
      const loy = Math.min(loyaltyP, Math.max(0, sumGross - disc));
      const cut = disc + loy;
      let allocated = 0;
      priced = raw.map((line, i) => {
        if (line.skip) {
          return emptyLine(line);
        }
        const isLast = line === active[active.length - 1];
        let newGross;
        if (sumGross <= 0) newGross = 0;
        else if (isLast) newGross = Math.max(0, sumGross - cut - allocated);
        else {
          newGross = roundHalfUp(line.grossPaise * (sumGross - cut) / sumGross);
          allocated += newGross;
        }
        const split = splitInclusivePaise(newGross, line.gstRate);
        return finishLine(line, split.taxablePaise, split.taxPaise, isInterstate);
      });
    } else {
      // beforeTax (default): allocate discount across TAXABLE, then recompute GST.
      const disc = Math.min(billDiscP, sumTaxable);
      const loy = Math.min(loyaltyP, Math.max(0, sumTaxable - disc));
      const cut = disc + loy;
      let allocated = 0;
      priced = raw.map((line) => {
        if (line.skip) return emptyLine(line);
        const isLast = line === active[active.length - 1];
        let newTaxable;
        if (sumTaxable <= 0) newTaxable = 0;
        else if (isLast) newTaxable = Math.max(0, sumTaxable - cut - allocated);
        else {
          newTaxable = roundHalfUp(line.taxablePaise * (sumTaxable - cut) / sumTaxable);
          allocated += newTaxable;
        }
        const newTax = taxOnTaxablePaise(newTaxable, line.gstRate);
        return finishLine(line, newTaxable, newTax, isInterstate);
      });
    }

    const taxableTotalP = priced.reduce((s, l) => s + (l._taxableP || 0), 0);
    const cgstTotalP = priced.reduce((s, l) => s + (l._cgstP || 0), 0);
    const sgstTotalP = priced.reduce((s, l) => s + (l._sgstP || 0), 0);
    const igstTotalP = priced.reduce((s, l) => s + (l._igstP || 0), 0);
    const netP = taxableTotalP + cgstTotalP + sgstTotalP + igstTotalP;
    // Round-half-up to nearest rupee from paise net
    const grandP = roundHalfUp(netP / 100) * 100;
    const roundOffP = grandP - netP;

    const billDiscApplied = discountMode === "afterTax"
      ? Math.min(billDiscP, sumGross)
      : Math.min(billDiscP, sumTaxable);
    const loyaltyApplied = discountMode === "afterTax"
      ? Math.min(loyaltyP, Math.max(0, sumGross - billDiscApplied))
      : Math.min(loyaltyP, Math.max(0, sumTaxable - billDiscApplied));

    return {
      items: priced.map(stripMeta),
      taxableTotal: fromPaise(taxableTotalP),
      cgstTotal: fromPaise(cgstTotalP),
      sgstTotal: fromPaise(sgstTotalP),
      igstTotal: fromPaise(igstTotalP),
      net: fromPaise(netP),
      roundOff: fromPaise(roundOffP),
      grandTotal: fromPaise(grandP),
      billDiscount: fromPaise(billDiscApplied),
      loyaltyRupees: fromPaise(loyaltyApplied),
      rawGrand: fromPaise(sumGross),
      discountMode,
      // paise mirrors for tests / GSTR
      _paise: {
        taxableTotal: taxableTotalP,
        cgstTotal: cgstTotalP,
        sgstTotal: sgstTotalP,
        igstTotal: igstTotalP,
        net: netP,
        grandTotal: grandP,
        roundOff: roundOffP
      }
    };
  }

  function emptyLine(line) {
    return {
      ...line.item,
      qty: Number(line.item.qty) || 0,
      gstRate: line.gstRate,
      taxableVal: 0, cgstVal: 0, sgstVal: 0, igstVal: 0, total: 0,
      preBillTaxableVal: 0,
      _taxableP: 0, _cgstP: 0, _sgstP: 0, _igstP: 0, _totalP: 0
    };
  }

  function finishLine(line, taxablePaise, taxPaise, isInterstate) {
    let cgstP = 0, sgstP = 0, igstP = 0;
    if (isInterstate) igstP = taxPaise;
    else {
      cgstP = Math.floor(taxPaise / 2);
      sgstP = taxPaise - cgstP;
    }
    return {
      ...line.item,
      gstRate: line.gstRate,
      taxableVal: fromPaise(taxablePaise),
      cgstVal: fromPaise(cgstP),
      sgstVal: fromPaise(sgstP),
      igstVal: fromPaise(igstP),
      total: fromPaise(taxablePaise + taxPaise),
      /* Taxable before bill/loyalty ₹ discount (after line %). Tally print Amount. */
      preBillTaxableVal: fromPaise(line.taxablePaise || 0),
      _taxableP: taxablePaise,
      _cgstP: cgstP,
      _sgstP: sgstP,
      _igstP: igstP,
      _totalP: taxablePaise + taxPaise
    };
  }

  function stripMeta(line) {
    const o = { ...line };
    delete o._taxableP; delete o._cgstP; delete o._sgstP; delete o._igstP; delete o._totalP;
    return o;
  }

  function roundMoney(n) {
    return fromPaise(toPaise(n));
  }

  /** Nearest-rupee grand from a net rupee amount (half-up). */
  function roundToRupee(netRupees) {
    return fromPaise(roundHalfUp(toPaise(netRupees) / 100) * 100);
  }

  const api = {
    toPaise, fromPaise, roundHalfUp, lineAmountPaise, taxOnTaxablePaise,
    splitInclusivePaise, computeDocument, roundMoney, roundToRupee
  };
  global.BillSetuMoney = api;
  // Back-compat globals used across the app
  global.roundMoney = roundMoney;
  global.toPaise = toPaise;
  global.fromPaise = fromPaise;
})(typeof window !== "undefined" ? window : globalThis);
