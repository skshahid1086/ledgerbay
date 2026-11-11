/**
 * Injected by the iOS shell only. Routes print, share, and blob downloads
 * to the native share sheet. Does not change billing, GST, or books logic.
 */
(function () {
  if (window.__ledgerbayIOS) return;
  window.__ledgerbayIOS = true;

  function bridge() {
    return window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.ledgerbay;
  }

  function post(message) {
    var handler = bridge();
    if (!handler) return false;
    handler.postMessage(message);
    return true;
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onerror = function () { reject(reader.error || new Error("Could not read that file")); };
      reader.onload = function () {
        var result = String(reader.result || "");
        var comma = result.indexOf(",");
        resolve(comma >= 0 ? result.slice(comma + 1) : result);
      };
      reader.readAsDataURL(blob);
    });
  }

  var blobURLs = new Map();
  var origCreate = URL.createObjectURL.bind(URL);
  URL.createObjectURL = function (object) {
    var url = origCreate(object);
    if (typeof Blob !== "undefined" && object instanceof Blob) blobURLs.set(url, object);
    return url;
  };
  var origRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = function (url) {
    blobURLs.delete(url);
    return origRevoke(url);
  };

  function shareBlob(blob, name, title, text) {
    return blobToBase64(blob).then(function (base64) {
      if (base64.length > 32000000) {
        throw new Error("That file is too large to share from the app");
      }
      if (!post({
        type: "share-file",
        name: name || "Ledgerbay",
        mime: (blob && blob.type) || "application/octet-stream",
        base64: base64,
        title: title || name || "Ledgerbay",
        text: text || ""
      })) {
        throw new Error("Share bridge is unavailable");
      }
    });
  }

  var origShare = typeof navigator.share === "function" ? navigator.share.bind(navigator) : null;
  navigator.share = function (data) {
    data = data || {};
    var files = data.files ? Array.prototype.slice.call(data.files) : [];
    if (files.length) {
      return shareBlob(files[0], files[0].name, data.title, data.text);
    }
    var text = data.text || data.url || "";
    if (post({ type: "share-text", title: data.title || "Ledgerbay", text: String(text) })) {
      return Promise.resolve();
    }
    if (origShare) return origShare(data);
    return Promise.reject(new Error("Share is unavailable"));
  };
  navigator.canShare = function (data) {
    if (!bridge()) return false;
    if (data && data.files && data.files.length > 1) return false;
    return true;
  };

  var origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    var href = this.href || "";
    if (this.hasAttribute("download") && href.indexOf("blob:") === 0) {
      var blob = blobURLs.get(href);
      var name = this.getAttribute("download") || "Ledgerbay";
      if (blob) {
        var anchor = this;
        shareBlob(blob, name, name, "").catch(function () {
          origClick.call(anchor);
        });
        return;
      }
    }
    return origClick.call(this);
  };

  var origPrint = typeof window.print === "function" ? window.print.bind(window) : null;
  window.print = function () {
    if (post({ type: "print", title: document.title || "Ledgerbay" })) return;
    if (origPrint) origPrint();
  };

  window.__ledgerbaySetSafeArea = function (top, right, bottom, left) {
    var root = document.documentElement;
    if (!root || !root.style) return;
    root.style.setProperty("--safe-top", Number(top) + "px");
    root.style.setProperty("--safe-right", Number(right) + "px");
    root.style.setProperty("--safe-bottom", Number(bottom) + "px");
    root.style.setProperty("--safe-left", Number(left) + "px");
  };

  var style = document.createElement("style");
  style.setAttribute("data-ledgerbay-ios", "safe-area");
  style.textContent = [
    "@media (min-width: 801px) {",
    "  .sidebar { padding-top: var(--safe-top); padding-bottom: calc(12px + var(--safe-bottom)); box-sizing: border-box; }",
    "  .topbar { padding-top: var(--safe-top); min-height: calc(64px + var(--safe-top)); height: auto; box-sizing: border-box; }",
    "}"
  ].join("\n");
  (document.head || document.documentElement).appendChild(style);
})();
