/**
 * Ledgerbay desktop bridge — only active inside the Electron shell.
 * Starts the bundled sync host when the user picks Host, and fills LAN URL hints.
 */
(function () {
  if (!window.billsetuDesktop || !window.billsetuDesktop.isDesktop) return;

  document.documentElement.classList.add("billsetu-desktop");

  // Honour store variant: ensure LEDGERBAY_BUILD.VARIANT stays store if build-config loaded
  try {
    window.billsetuDesktop.getInfo().then((info) => {
      if (info && info.variant && window.LEDGERBAY_BUILD && !Object.isFrozen?.(window.LEDGERBAY_BUILD)) {
        /* build-config is frozen — native path */
      }
      document.documentElement.dataset.ledgerbayVariant = (info && info.variant) || 'store';
      document.documentElement.dataset.noDemoSeed = info && info.noDemoSeed ? '1' : '0';
    }).catch(() => {});
  } catch (_) {}


  async function refreshHostHints() {
    try {
      const st = await window.billsetuDesktop.syncStatus();
      const hint = document.getElementById("sync-host-hint-url");
      if (hint && st && st.lanUrl) hint.textContent = st.lanUrl;
      const url = document.getElementById("sync-url");
      if (url && st && st.url && (!url.value || /127\.0\.0\.1|localhost/i.test(url.value))) {
        // Prefer loopback for this PC; phones use LAN URL from the hint
        url.value = st.url;
      }
    } catch (_) {}
  }

  async function ensureHostServer() {
    const pass = (document.getElementById("sync-host-passcode")?.value || "").trim();
    try {
      const result = await window.billsetuDesktop.startSyncServer(pass || undefined);
      await refreshHostHints();
      if (result && result.running) {
        const url = document.getElementById("sync-url");
        if (url) url.value = result.url;
        const enabled = document.getElementById("sync-enabled");
        // Do not auto-enable; user still chooses Sync now / First join
        if (typeof showToast === "function") {
          showToast("Sync server running at " + (result.lanUrl || result.url), "success");
        }
      } else if (result && result.error && typeof showToast === "function") {
        showToast("Sync server: " + result.error, "error");
      }
    } catch (err) {
      if (typeof showToast === "function") {
        showToast("Sync server failed: " + (err && err.message ? err.message : err), "error");
      }
    }
  }

  function wire() {
    const hostRadio = document.getElementById("sync-role-host");
    if (hostRadio) {
      hostRadio.addEventListener("change", () => {
        if (hostRadio.checked) ensureHostServer();
      });
    }
    // If host already selected when settings open
    document.getElementById("nav-settings")?.addEventListener("click", () => {
      setTimeout(() => {
        if (document.getElementById("sync-role-host")?.checked) refreshHostHints();
      }, 300);
    });

    // Patch host panel instructions for desktop
    const hostPanel = document.getElementById("sync-host-panel");
    if (hostPanel) {
      const lis = hostPanel.querySelectorAll("ol li, ul li");
      if (lis[0]) {
        lis[0].textContent = "Use Sync → Start Sync Server in the menu (or choose Host here). Set a passcode via the Setup page if prompted.";
      }
    }

    // Start button if we inject one
    let btn = document.getElementById("btn-desktop-start-sync");
    if (!btn && hostPanel) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.id = "btn-desktop-start-sync";
      btn.className = "btn btn-primary";
      btn.textContent = "Start Sync Server on this PC";
      btn.style.marginTop = "8px";
      hostPanel.insertBefore(btn, hostPanel.firstChild?.nextSibling || null);
      // Put after heading block
      const first = hostPanel.querySelector("ol, ul, .form-group, p");
      if (first && first.parentNode) first.parentNode.insertBefore(btn, first);
      else hostPanel.appendChild(btn);
      btn.addEventListener("click", () => ensureHostServer());
    }

    refreshHostHints();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
