/**
 * Barcode and serial scanning.
 *
 * On the Android and iOS app, Scan opens the Capacitor ML Kit camera
 * (Code 128, Code 39, EAN-13, EAN-8, UPC-A, UPC-E, QR, Data Matrix).
 * In a browser it uses the BarcodeDetector API when the browser has one,
 * and otherwise the bundled ZXing decoder on the same camera stream.
 * A USB scanner that types like a keyboard still works: it ends with Enter.
 *
 * An IMEI is 15 digits. If the Luhn check digit does not match, Ledgerbay
 * warns and still keeps the number.
 */

const SCAN_FORMATS = ["CODE_128", "CODE_39", "EAN_13", "EAN_8", "UPC_A", "UPC_E", "QR_CODE", "DATA_MATRIX"];

let scanSession = null;

function luhnValid(digits) {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let doubleIt = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (doubleIt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    doubleIt = !doubleIt;
  }
  return sum % 10 === 0;
}

function imeiCheck(raw) {
  const digits = String(raw || "").replace(/\s+/g, "");
  const looksLikeImei = /^\d{15}$/.test(digits);
  return { digits, looksLikeImei, valid: looksLikeImei && luhnValid(digits) };
}

function noteImei(raw) {
  const check = imeiCheck(raw);
  if (check.looksLikeImei && !check.valid) {
    showToast("This looks like an IMEI, but the check digit does not match. It was kept anyway.", "error");
  }
  return check;
}

function scannerPlugin() {
  if (!window.Capacitor?.isNativePlatform?.() || !window.Capacitor.isNativePlatform()) return null;
  try {
    return window.Capacitor.registerPlugin("BarcodeScanner");
  } catch (err) {
    return null;
  }
}

function cameraDeniedMessage() {
  if (scannerPlugin()) {
    return "Ledgerbay needs the camera to read serial and IMEI barcodes. Camera permission was denied. Open Android settings for Ledgerbay, allow Camera, then tap Scan again.";
  }
  return "Ledgerbay needs the camera to read serial and IMEI barcodes. Camera permission was denied. Allow the camera for this site in the browser, or type the number.";
}

async function ensureNativeCamera(plugin) {
  let status = { camera: "prompt" };
  try {
    status = await plugin.checkPermissions();
  } catch (err) {
    status = { camera: "prompt" };
  }
  if (status.camera === "granted" || status.camera === "limited") return true;
  const before = status.camera;
  try {
    status = await plugin.requestPermissions();
  } catch (err) {
    status = { camera: "denied" };
  }
  if (status.camera === "granted" || status.camera === "limited") return true;
  showToast(cameraDeniedMessage(), "error");
  if (before === "denied") {
    try { await plugin.openSettings(); } catch (err) { /* settings screen is optional */ }
  }
  return false;
}

function beepScan() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.value = 0.06;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.07);
      setTimeout(() => ctx.close().catch(() => {}), 250);
    }
  } catch (err) { /* a silent shop PC is fine */ }
  try {
    if (navigator.vibrate) navigator.vibrate(70);
  } catch (err) { /* vibration is optional */ }
}

function serialLines(value) {
  return String(value || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function writeSerialLines(field, lines) {
  const el = document.getElementById(field);
  if (!el) return 0;
  el.value = lines.join("\n");
  el.dispatchEvent(new Event("input", { bubbles: true }));
  const count = document.getElementById(`${field}-count`);
  if (count) count.textContent = lines.length ? `${lines.length} serial${lines.length === 1 ? "" : "s"}` : "";
  return lines.length;
}

function appendSerialLine(field, code) {
  const el = document.getElementById(field);
  if (!el) return false;
  const lines = serialLines(el.value);
  if (lines.some(line => line.toLowerCase() === code.toLowerCase())) {
    showToast("Already scanned. Skipped.");
    return false;
  }
  lines.push(code);
  writeSerialLines(field, lines);
  noteImei(code);
  return true;
}

function normalizeSerialField(field) {
  const el = document.getElementById(field);
  if (!el) return;
  const seen = new Set();
  const kept = [];
  let skipped = false;
  let fresh = "";
  String(el.value).split(/\r?\n/).forEach(raw => {
    const code = raw.trim();
    if (!code) return;
    const key = code.toLowerCase();
    if (seen.has(key)) {
      skipped = true;
      return;
    }
    seen.add(key);
    kept.push(code);
    fresh = code;
  });
  const trailingBreak = /\n\s*$/.test(el.value);
  el.value = kept.join("\n") + (trailingBreak ? "\n" : "");
  writeSerialLines(field, kept);
  if (trailingBreak) el.value = `${kept.join("\n")}\n`;
  if (skipped) showToast("Already scanned. Skipped.");
  else if (fresh) noteImei(fresh);
}

function applySaleSerial(code) {
  const q = String(code || "").trim().toLowerCase();
  if (!q) return false;
  const item = State.items.find(entry => (entry.serials || []).some(serial => serial.toLowerCase() === q));
  if (item) {
    const serial = item.serials.find(entry => entry.toLowerCase() === q);
    const invoiceOpen = document.getElementById("modal-invoice")?.classList.contains("open");
    if (!invoiceOpen && State.currentView === "pos") return posScanSerial(serial) === true;
    const already = (State.invoiceDraftItems || []).some(line => (line.serials || []).some(entry => entry.toLowerCase() === serial.toLowerCase()));
    if (already) {
      showToast("Already scanned. Skipped.");
      return false;
    }
    applyItemToDraft(item.id, serial);
    showToast(`${item.name} added. Serial ${serial} is in stock.`);
    return true;
  }
  const byCode = State.items.find(entry => String(entry.code || "").toLowerCase() === q);
  if (byCode) {
    if (State.currentView === "pos" && !document.getElementById("modal-invoice")?.classList.contains("open")) {
      posAddItem(byCode.id);
      showToast(`${byCode.name} added from barcode ${code}.`);
      return true;
    }
    applyItemToDraft(byCode.id, "");
    showToast(`${byCode.name} added from barcode ${code}.`);
    return true;
  }
  const search = document.getElementById("invoice-item-search") || document.getElementById("pos-search");
  if (search) {
    search.value = code;
    search.dispatchEvent(new Event("input", { bubbles: true }));
  }
  showToast(`No in-stock item has serial ${code}.`, "error");
  return false;
}

function deliverScan(target, code) {
  const value = String(code || "").trim();
  if (!value || !target) return false;
  if (target.mode === "draft") {
    const box = document.getElementById("item-track-serial");
    if (box && !box.checked) {
      box.checked = true;
      syncSerialTools();
    }
    return addDraftSerial(value);
  }
  if (target.mode === "lines") return appendSerialLine(target.field, value);
  if (target.mode === "line") return addLineSerial(target.line, value) === true;
  if (target.mode === "pos") {
    posScanSerial(value);
    return State.posCart.some(line => (line.serials || []).some(serial => serial.toLowerCase() === value.toLowerCase()));
  }
  if (target.mode === "lookup") {
    const input = document.getElementById(target.field || "serial-lookup-input");
    if (input) input.value = value;
    if (typeof renderSerialLookup === "function") renderSerialLookup(value);
    noteImei(value);
    return true;
  }
  if (target.mode === "sale") return applySaleSerial(value);
  const input = document.getElementById(target.field);
  if (!input) return false;
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  noteImei(value);
  return true;
}

function looseScanTarget() {
  if (document.getElementById("modal-purchase")?.classList.contains("open")) return { mode: "lines", field: "pur-serials", continuous: true };
  if (document.getElementById("modal-receive")?.classList.contains("open")) return { mode: "lines", field: "recv-serials", continuous: true };
  if (document.getElementById("modal-debit")?.classList.contains("open")) return { mode: "lines", field: "dn-serials", continuous: true };
  if (document.getElementById("modal-item")?.classList.contains("open")) return { mode: "draft", continuous: true };
  if (document.getElementById("modal-invoice")?.classList.contains("open")) return { mode: "sale", continuous: false };
  if (State.currentView === "pos") return { mode: "pos", continuous: true };
  if (State.currentView === "inventory") return { mode: "lookup", field: "serial-lookup-input", continuous: false };
  return { mode: "sale", continuous: false };
}

function updateScanHud() {
  const count = document.getElementById("scan-hud-count");
  const title = document.getElementById("scan-hud-title");
  if (!scanSession || !count || !title) return;
  title.textContent = scanSession.continuous
    ? "Keep scanning. Each new serial is added."
    : "Point the camera at one barcode.";
  count.textContent = scanSession.accepted
    ? `${scanSession.accepted} scanned this time`
    : "Nothing scanned yet";
}

function showScanOverlay(nativeCamera) {
  const overlay = document.getElementById("scan-overlay");
  if (!overlay) return;
  overlay.hidden = false;
  document.body.classList.add("barcode-scanner-active");
  document.body.classList.toggle("scan-native", !!nativeCamera);
  updateScanHud();
}

function hideScanOverlay() {
  const overlay = document.getElementById("scan-overlay");
  if (overlay) overlay.hidden = true;
  document.body.classList.remove("barcode-scanner-active", "scan-native");
  const video = document.getElementById("scan-video");
  if (video) {
    video.pause();
    video.srcObject = null;
    video.classList.add("d-none");
  }
}

async function stopBarcodeScan() {
  const session = scanSession;
  scanSession = null;
  if (!session) {
    hideScanOverlay();
    return;
  }
  session.stopped = true;
  if (session.nativeListener) {
    try { await session.nativeListener.remove(); } catch (err) { /* already gone */ }
  }
  if (session.plugin) {
    try { await session.plugin.removeAllListeners(); } catch (err) { /* already gone */ }
    try { await session.plugin.stopScan(); } catch (err) { /* camera already closed */ }
  }
  if (session.controls) {
    try { session.controls.stop(); } catch (err) { /* stream already stopped */ }
  }
  if (session.stream) session.stream.getTracks().forEach(track => track.stop());
  if (session.frame) cancelAnimationFrame(session.frame);
  hideScanOverlay();
}

function takeScan(code) {
  const session = scanSession;
  if (!session || session.stopped) return;
  const value = String(code || "").trim();
  if (!value) return;
  const now = Date.now();
  if (value.toLowerCase() === session.lastCode && now - session.lastAt < 1400) return;
  session.lastCode = value.toLowerCase();
  session.lastAt = now;
  const ok = deliverScan(session.target, value);
  if (!ok) return;
  session.accepted += 1;
  beepScan();
  updateScanHud();
  if (!session.continuous) stopBarcodeScan();
}

async function startNativeScan(plugin, session) {
  const allowed = await ensureNativeCamera(plugin);
  if (!allowed || session.stopped) return "denied";
  session.plugin = plugin;
  try {
    session.nativeListener = await plugin.addListener("barcodesScanned", event => {
      const list = event?.barcodes || [];
      list.forEach(barcode => takeScan(barcode.rawValue || barcode.displayValue || ""));
    });
    await plugin.startScan({ formats: SCAN_FORMATS, lensFacing: "BACK" });
  } catch (err) {
    return "failed";
  }
  showScanOverlay(true);
  return "started";
}

function cameraErrorMessage(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError") return cameraDeniedMessage();
  return "The camera did not start. Type the serial, or use a USB scanner.";
}

async function startDetectorScan(session, video) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (err) {
    showToast(cameraErrorMessage(err), "error");
    return false;
  }
  if (session.stopped) {
    stream.getTracks().forEach(track => track.stop());
    return false;
  }
  session.stream = stream;
  video.srcObject = stream;
  video.classList.remove("d-none");
  showScanOverlay(false);
  try { await video.play(); } catch (err) { /* the tap on Scan already counts as the gesture */ }
  let detector;
  try {
    detector = new window.BarcodeDetector({
      formats: ["code_128", "code_39", "ean_13", "ean_8", "upc_a", "upc_e", "qr_code", "data_matrix"]
    });
  } catch (err) {
    detector = new window.BarcodeDetector();
  }
  const canvas = document.createElement("canvas");
  const tick = async () => {
    if (!scanSession || scanSession !== session || session.stopped) return;
    if (video.readyState >= 2 && video.videoWidth) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const codes = await detector.detect(canvas);
        if (codes[0]?.rawValue) takeScan(codes[0].rawValue);
      } catch (err) { /* the next frame tries again */ }
    }
    session.frame = requestAnimationFrame(tick);
  };
  session.frame = requestAnimationFrame(tick);
  return true;
}

async function startWebScan(session) {
  const video = document.getElementById("scan-video");
  if (!video || !navigator.mediaDevices?.getUserMedia) {
    showToast("This browser has no camera. Use a USB scanner or type the serial.", "error");
    return false;
  }
  if ("BarcodeDetector" in window) return startDetectorScan(session, video);
  const Reader = window.ZXingBrowser?.BrowserMultiFormatReader;
  if (!Reader) {
    showToast("This browser cannot read barcodes from the camera. Type the serial, or use a USB scanner.", "error");
    return false;
  }
  video.classList.remove("d-none");
  showScanOverlay(false);
  const reader = new Reader(undefined, 400);
  try {
    session.controls = await reader.decodeFromConstraints(
      { video: { facingMode: "environment" } },
      video,
      (result) => {
        if (result?.getText) takeScan(result.getText());
      }
    );
  } catch (err) {
    showToast(cameraErrorMessage(err), "error");
    return false;
  }
  return true;
}

async function openBarcodeScan(target) {
  if (scanSession) await stopBarcodeScan();
  const session = {
    target,
    continuous: !!target.continuous,
    accepted: 0,
    lastCode: "",
    lastAt: 0,
    stopped: false
  };
  scanSession = session;
  const plugin = scannerPlugin();
  try {
    if (plugin) {
      const native = await startNativeScan(plugin, session);
      if (native === "started" || session.stopped) return;
      if (native === "denied") {
        await stopBarcodeScan();
        return;
      }
    }
    const started = await startWebScan(session);
    if (!started) await stopBarcodeScan();
  } catch (err) {
    showToast("The camera scanner could not start. Type the serial, or use a USB scanner.", "error");
    await stopBarcodeScan();
  }
}

function openScanFromButton(button) {
  const mode = button.dataset.scanMode || "value";
  const field = button.dataset.scanField || "";
  const line = button.dataset.scanLine;
  const continuous = button.dataset.scanContinuous === "1" || mode === "draft" || mode === "lines" || mode === "pos" || mode === "line";
  if ((mode === "lines" || mode === "line") && field) {
    const wrap = document.getElementById(field)?.closest(".d-none");
    if (wrap) {
      showToast("Choose an item that tracks serial numbers first.", "error");
      return;
    }
  }
  openBarcodeScan({
    mode,
    field,
    line: line == null ? -1 : Number(line),
    continuous: mode === "value" || mode === "lookup" || mode === "sale" ? false : continuous
  });
}

let wedgeBuffer = "";
let wedgeStart = 0;
let wedgeLast = 0;

function noteWedgeKey(event, now = event.timeStamp || performance.now()) {
  if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing) return false;
  if (!wedgeBuffer || now - wedgeLast > 45) {
    wedgeBuffer = "";
    wedgeStart = now;
  }
  wedgeLast = now;
  if (event.key === "Enter") {
    const code = wedgeBuffer;
    const fast = code.length >= 4 && (now - wedgeStart) <= Math.max(80, code.length * 35);
    wedgeBuffer = "";
    if (!fast) return false;
    const el = event.target;
    const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA") && !el.readOnly && !el.disabled;
    if (typing) {
      noteImei(code);
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    deliverScan(looseScanTarget(), code);
    return true;
  }
  if (event.key.length === 1) wedgeBuffer += event.key;
  return false;
}

document.addEventListener("DOMContentLoaded", () => {
  document.body.addEventListener("click", event => {
    const button = event.target.closest?.(".scan-btn");
    if (!button) return;
    event.preventDefault();
    openScanFromButton(button);
  });
  document.getElementById("scan-hud-done")?.addEventListener("click", () => stopBarcodeScan());
  ["pur-serials", "recv-serials", "dn-serials"].forEach(id => {
    document.getElementById(id)?.addEventListener("keydown", event => {
      if (event.key !== "Enter") return;
      setTimeout(() => normalizeSerialField(id), 0);
    });
  });
  document.getElementById("tr-serials")?.addEventListener("change", () => normalizeSerialField("tr-serials"));
  document.getElementById("pos-search")?.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const code = event.target.value.trim();
    if (!code) return;
    if (applySaleSerial(code)) {
      event.target.value = "";
      if (typeof renderPos === "function") renderPos();
    }
  });
  document.getElementById("item-input-code")?.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    noteImei(event.target.value);
  });
  window.addEventListener("keydown", noteWedgeKey, true);
});

window.luhnValid = luhnValid;
window.imeiCheck = imeiCheck;
window.noteImei = noteImei;
window.openBarcodeScan = openBarcodeScan;
window.stopBarcodeScan = stopBarcodeScan;
window.deliverScan = deliverScan;
window.applySaleSerial = applySaleSerial;
window.noteWedgeKey = noteWedgeKey;
window.SCAN_FORMATS = SCAN_FORMATS;
