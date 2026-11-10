/**
 * Hash-based history so browser Back / Android Back steps through
 * sheets → modals → detail → previous view → home (double-back exit).
 * Works on file:// via location.hash (#/sales, #/invoice/ID).
 */
(function (global) {
  "use strict";

  const STACK_KEY = "billsetu_nav_stack_v1";
  let applying = false; global.__billsetuHistApplying = false;
  let lastHomeBackAt = 0;

  function currentView() {
    const el = document.querySelector(".view-panel.active, .view-panel.open, section.view-panel[style*='display: block']");
    if (el && el.id) return el.id.replace(/^view-/, "");
    // Fallback: first visible
    const panels = document.querySelectorAll("section.view-panel");
    for (const p of panels) {
      if (p.classList.contains("active") || p.classList.contains("open")) {
        return p.id.replace(/^view-/, "");
      }
    }
    return (typeof State !== "undefined" && State.currentView) || "dashboard";
  }

  function routeFromHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    if (!raw) return { type: "view", view: "dashboard" };
    const parts = raw.split("/").filter(Boolean);
    const head = parts[0];
    if (head === "invoice" && parts[1]) return { type: "invoice", id: decodeURIComponent(parts[1]) };
    if (head === "payment" && parts[1]) return { type: "payment", id: decodeURIComponent(parts[1]) };
    if (head === "purchase" && parts[1]) return { type: "purchase", id: decodeURIComponent(parts[1]) };
    if (head === "expense" && parts[1]) return { type: "expense", id: decodeURIComponent(parts[1]) };
    if (head === "new-invoice") return { type: "modal", modal: "invoice" };
    return { type: "view", view: head || "dashboard" };
  }

  function hashFor(entry) {
    if (!entry) return "#/dashboard";
    if (entry.type === "invoice") return `#/invoice/${encodeURIComponent(entry.id)}`;
    if (entry.type === "payment") return `#/payment/${encodeURIComponent(entry.id)}`;
    if (entry.type === "purchase") return `#/purchase/${encodeURIComponent(entry.id)}`;
    if (entry.type === "expense") return `#/expense/${encodeURIComponent(entry.id)}`;
    if (entry.type === "modal" && entry.modal === "invoice") return "#/new-invoice";
    if (entry.type === "view") return `#/${entry.view || "dashboard"}`;
    return "#/dashboard";
  }

  function push(entry, replace) {
    if (applying) return;
    const url = hashFor(entry);
    const state = entry || { type: "view", view: "dashboard" };
    try {
      if (replace) history.replaceState(state, "", url);
      else history.pushState(state, "", url);
    } catch (_) {
      // file:// some browsers are picky — still set hash
      if (replace) location.replace(url);
      else location.hash = url.replace(/^#/, "");
    }
  }

  function closeTopOverlay() {
    // Sheets / more menus first
    const more = document.getElementById("invd-more-sheet");
    if (more && more.classList.contains("open")) {
      more.classList.remove("open");
      document.getElementById("invd-more-backdrop")?.classList.remove("open");
      return true;
    }
    // Discard draft modal
    const discard = document.getElementById("modal-discard-draft");
    if (discard?.classList.contains("open")) {
      if (typeof finishDiscardDraft === "function") finishDiscardDraft(false);
      else discard.classList.remove("open");
      return true;
    }
    // Any open modal-backdrop
    const modals = [...document.querySelectorAll(".modal-backdrop.open")];
    if (modals.length) {
      const top = modals[modals.length - 1];
      const id = top.id || "";
      if (id === "modal-invoice" && typeof confirmLeaveInvoiceForm === "function") {
        confirmLeaveInvoiceForm().then(ok => {
          if (ok) {
            if (typeof setInvoiceModalOpen === "function") setInvoiceModalOpen(false);
            else top.classList.remove("open");
          }
        });
        return true;
      }
      if (id === "modal-print-preview") {
        top.classList.remove("open");
        return true;
      }
      // Generic close
      const closeBtn = top.querySelector("[data-close], .btn-close, .modal-close, button[id^='btn-close']");
      if (closeBtn) closeBtn.click();
      else top.classList.remove("open");
      return true;
    }
    // Invoice detail panel
    const detail = document.getElementById("invoice-detail-root");
    if (detail?.classList.contains("open")) {
      if (typeof closeInvoiceDetail === "function") closeInvoiceDetail();
      else detail.classList.remove("open");
      return true;
    }
    const payDetail = document.getElementById("payment-detail-root");
    if (payDetail?.classList.contains("open")) {
      payDetail.classList.remove("open");
      return true;
    }
    return false;
  }

  function applyRoute(entry) {
    applying = true; global.__billsetuHistApplying = true;
    try {
      if (!entry) entry = routeFromHash();
      if (entry.type === "invoice" && typeof openInvoiceDetail === "function") {
        openInvoiceDetail(entry.id);
        return;
      }
      if (entry.type === "payment" && typeof openPaymentDetail === "function") {
        openPaymentDetail(entry.id);
        return;
      }
      if (entry.type === "purchase" && typeof openPurchaseDetail === "function") {
        openPurchaseDetail(entry.id);
        return;
      }
      if (entry.type === "expense" && typeof openExpenseDetail === "function") {
        openExpenseDetail(entry.id);
        return;
      }
      if (entry.type === "modal" && entry.modal === "invoice") {
        if (typeof openNewInvoiceModal === "function") openNewInvoiceModal();
        return;
      }
      const view = entry.view || "dashboard";
      if (typeof navigateTo === "function") navigateTo(view, true);
      else if (typeof showView === "function") showView(view);
      else if (typeof switchView === "function") switchView(view);
    } finally {
      applying = false;
    }
  }

  function onPopState(ev) {
    // Prefer closing overlay if one is open (matches Android back semantics)
    if (closeTopOverlay()) {
      // Keep hash in sync with remaining screen
      const view = currentView();
      push({ type: "view", view }, true);
      return;
    }
    const entry = (ev && ev.state) || routeFromHash();
    const cur = currentView();
    const targetIsDashboard = !entry
      || (entry.type === "view" && (entry.view || "dashboard") === "dashboard");

    // Exit toast ONLY when already on dashboard. Navigating TO dashboard from
    // another view must applyRoute (NEW-1: do not swallow applyRoute).
    if (cur === "dashboard" && targetIsDashboard) {
      const now = Date.now();
      if (now - lastHomeBackAt < 2000) {
        if (global.Capacitor?.Plugins?.App) {
          try { global.Capacitor.Plugins.App.exitApp(); } catch (_) {}
        }
        // Web / no native exit: never leave the document — push a sentinel entry
        push({ type: "view", view: "dashboard" }, false);
        return;
      }
      lastHomeBackAt = now;
      if (typeof showToast === "function") showToast("Press back again to exit");
      // Push (not replace) so another Back stays in-app and hits this guard again
      push({ type: "view", view: "dashboard" }, false);
      return;
    }
    applyRoute(entry);
    // Seed a dashboard sentinel after Back-to-home so the next Back is the
    // exit-guard instead of navigating off the SPA (blank screen on web).
    if (targetIsDashboard) {
      push({ type: "view", view: "dashboard" }, false);
    }
  }

  function hookNavigation() {
    // Wrap navigateTo / showView if present
    const wrap = (name) => {
      const orig = global[name];
      if (typeof orig !== "function" || orig.__billsetuHist) return;
      const wrapped = function (view, fromHist) {
        const ret = orig.apply(this, arguments);
        if (!fromHist && !applying) {
          const v = typeof view === "string" ? view.replace(/^view-/, "") : currentView();
          push({ type: "view", view: v });
        }
        return ret;
      };
      wrapped.__billsetuHist = true;
      global[name] = wrapped;
    };
    ["navigateTo", "showView", "goToView"].forEach(wrap);

    // Detail openers
    const detailWrap = (name, type) => {
      const orig = global[name];
      if (typeof orig !== "function" || orig.__billsetuHist) return;
      const wrapped = function (id) {
        const ret = orig.apply(this, arguments);
        if (!applying && id) push({ type, id: String(id) });
        return ret;
      };
      wrapped.__billsetuHist = true;
      global[name] = wrapped;
    };
    detailWrap("openInvoiceDetail", "invoice");
    detailWrap("openPaymentDetail", "payment");
    detailWrap("openPurchaseDetail", "purchase");
    detailWrap("openExpenseDetail", "expense");

    const origOpen = global.openNewInvoiceModal;
    if (typeof origOpen === "function" && !origOpen.__billsetuHist) {
      const wrapped = async function () {
        const ret = await origOpen.apply(this, arguments);
        if (!applying) push({ type: "modal", modal: "invoice" });
        return ret;
      };
      wrapped.__billsetuHist = true;
      global.openNewInvoiceModal = wrapped;
      global.openNewInvoice = wrapped;
    }
  }

  function init() {
    window.addEventListener("popstate", onPopState);
    // Cordova-style back (Capacitor hardware Back is handled in native-shell → history.back)
    document.addEventListener("backbutton", (e) => {
      e.preventDefault?.();
      history.back();
    }, false);

    hookNavigation();
    // Deep link on load
    const route = routeFromHash();
    if (route.type !== "view" || (route.view && route.view !== "dashboard")) {
      setTimeout(() => applyRoute(route), 50);
    } else {
      push({ type: "view", view: currentView() }, true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(init, 0));
  } else {
    setTimeout(init, 0);
  }

  global.BillSetuHistory = { push, applyRoute, routeFromHash, closeTopOverlay, hashFor };
})(typeof window !== "undefined" ? window : globalThis);
