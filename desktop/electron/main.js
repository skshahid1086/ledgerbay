'use strict';

const { app, BrowserWindow, Menu, shell, ipcMain, dialog, protocol, net, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const http = require('http');
const os = require('os');
const { runSmokeTest, runPersistSmoke } = require('./smoke');
const { runFirstrunAudit } = require('./firstrun-audit');
const { runFirstrunExtra } = require('./firstrun-extra');

let branding = { productName: 'Ledgerbay', appId: 'in.ledgerbay.app', scheme: 'ledgerbay', slug: 'ledgerbay', variant: 'store' };
try {
  branding = { ...branding, ...JSON.parse(fs.readFileSync(path.join(__dirname, 'branding.json'), 'utf8')) };
} catch (_) {}
const PRODUCT_NAME = branding.productName || 'Ledgerbay';

const APP_SCHEME = String(branding.scheme || 'ledgerbay').toLowerCase();
const APP_HOST = 'app';
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 1000;
const MIN_HEIGHT = 650;
const SYNC_PORT = Number(process.env.BILLSETU_SYNC_PORT) || 3000;

/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {import('child_process').ChildProcess | null} */
let syncChild = null;
let syncStarting = false;

const isDev = !app.isPackaged;

function webRoot() {
  // In asar or unpacked: web/ sits next to electron/ under app root
  return path.join(__dirname, '..', 'web');
}

function userDataPath(...parts) {
  return path.join(app.getPath('userData'), ...parts);
}

function boundsPath() {
  return userDataPath('window-bounds.json');
}

function loadBounds() {
  try {
    const raw = fs.readFileSync(boundsPath(), 'utf8');
    const b = JSON.parse(raw);
    if (b && typeof b.width === 'number' && typeof b.height === 'number') return b;
  } catch (_) {}
  return null;
}

/** Drop a saved position that is no longer on any screen (monitor unplugged, resolution changed). */
function visibleBounds(saved) {
  if (!saved) return null;
  const out = { ...saved };
  try {
    const displays = screen.getAllDisplays();
    const primary = screen.getPrimaryDisplay().workArea;
    out.width = Math.max(MIN_WIDTH, Math.min(out.width, primary.width));
    out.height = Math.max(MIN_HEIGHT, Math.min(out.height, primary.height));
    if (typeof out.x === 'number' && typeof out.y === 'number') {
      const onScreen = displays.some(({ workArea: a }) =>
        out.x + 100 <= a.x + a.width && out.x + out.width - 100 >= a.x &&
        out.y >= a.y - 10 && out.y + 50 <= a.y + a.height);
      if (!onScreen) {
        delete out.x;
        delete out.y;
      }
    }
  } catch (_) {}
  return out;
}

function saveBounds() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    if (mainWindow.isMinimized() || mainWindow.isMaximized()) {
      // Keep last normal bounds; still record maximized flag
      const data = loadBounds() || { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
      data.isMaximized = mainWindow.isMaximized();
      fs.writeFileSync(boundsPath(), JSON.stringify(data));
      return;
    }
    const b = mainWindow.getBounds();
    fs.writeFileSync(
      boundsPath(),
      JSON.stringify({
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        isMaximized: false
      })
    );
  } catch (_) {}
}

function registerPrivilegedSchemes() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
        bypassCSP: false
      }
    }
  ]);
}

registerPrivilegedSchemes();

// Data folder follows the lower-case product slug: ~/.config/ledgerbay on Linux,
// %APPDATA%\ledgerbay on Windows (same folder as "Ledgerbay" there, the file
// system is case-insensitive). Electron's default is appData/<productName>, so on
// Linux older builds wrote to ~/.config/Ledgerbay — move that folder once so
// existing books are kept. An explicit --user-data-dir always wins.
try {
  if (PRODUCT_NAME) app.setName(PRODUCT_NAME);
  const slug = String(branding.slug || 'ledgerbay').toLowerCase();
  if (slug && !app.commandLine.hasSwitch('user-data-dir')) {
    const appData = app.getPath('appData');
    const target = path.join(appData, slug);
    const legacy = path.join(appData, PRODUCT_NAME);
    let dir = target;
    if (legacy !== target && fs.existsSync(legacy) && !fs.existsSync(target)) {
      try {
        fs.renameSync(legacy, target);
      } catch (err) {
        console.error('[userData] could not move', legacy, '->', target, err && err.message);
        dir = legacy; // keep using the old folder rather than starting empty
      }
    }
    app.setPath('userData', dir);
  }
} catch (err) {
  console.error('[userData]', err && err.message);
}

// Log anything that would otherwise kill the main process silently.
function logMainError(kind, err) {
  const line = `[${new Date().toISOString()}] ${kind}: ${err && err.stack ? err.stack : err}\n`;
  console.error(line.trim());
  try {
    const dir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'main.log'), line);
  } catch (_) {}
}
process.on('uncaughtException', (err) => logMainError('uncaughtException', err));
process.on('unhandledRejection', (err) => logMainError('unhandledRejection', err));

// One window per data folder: a second launch focuses the running app instead of
// opening a second copy that would fight over the same books.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}


function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.htm': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.ttf': 'font/ttf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.pdf': 'application/pdf',
    '.map': 'application/json',
    '.txt': 'text/plain; charset=utf-8',
    '.bat': 'text/plain; charset=utf-8'
  };
  return map[ext] || 'application/octet-stream';
}

function resolveWebPath(urlPath) {
  let rel = decodeURIComponent(urlPath || '/');
  if (!rel || rel === '/') rel = '/index.html';
  // Strip leading slash
  rel = rel.replace(/^\/+/, '');
  // Prevent path traversal
  const root = path.resolve(webRoot());
  const full = path.resolve(root, rel);
  if (!full.startsWith(root + path.sep) && full !== root) {
    return null;
  }
  return full;
}

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const u = new URL(request.url);
      // billsetu://app/... or billsetu://./...
      let pathname = u.pathname || '/';
      if (u.hostname && u.hostname !== APP_HOST && u.hostname !== '.' && u.hostname !== 'localhost') {
        // billsetu://something/path — treat hostname as first segment only if not app
        pathname = '/' + u.hostname + (pathname === '/' ? '' : pathname);
      }
      let filePath = resolveWebPath(pathname);
      if (!filePath) {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      let st;
      try {
        st = fs.statSync(filePath);
      } catch {
        return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain' } });
      }
      if (st.isDirectory()) {
        filePath = path.join(filePath, 'index.html');
      }
      const data = fs.readFileSync(filePath);
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': mimeFor(filePath),
          'cache-control': 'no-cache'
        }
      });
    } catch (err) {
      return new Response(String(err && err.message ? err.message : err), {
        status: 500,
        headers: { 'content-type': 'text/plain' }
      });
    }
  });
}

function lanIPv4() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

function syncDataDir() {
  const dir = userDataPath('sync-data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function syncStatus() {
  return {
    running: !!(syncChild && !syncChild.killed && syncChild.exitCode === null),
    port: SYNC_PORT,
    url: `http://127.0.0.1:${SYNC_PORT}`,
    lanUrl: `http://${lanIPv4()}:${SYNC_PORT}`,
    setupUrl: `http://127.0.0.1:${SYNC_PORT}/setup`,
    dataDir: syncDataDir()
  };
}

function probeSyncHealth() {
  return new Promise((resolve) => {
    const req = http.get(
      { host: '127.0.0.1', port: SYNC_PORT, path: '/api/health', timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          try {
            resolve({ ok: res.statusCode === 200, body: JSON.parse(body) });
          } catch {
            resolve({ ok: res.statusCode === 200, body: null });
          }
        });
      }
    );
    req.on('error', () => resolve({ ok: false }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
  });
}

async function startSyncServer(passcode) {
  if (syncStarting) return syncStatus();
  const health = await probeSyncHealth();
  if (health.ok) {
    // Already running (maybe leftover); treat as ours if we didn't spawn
    return { ...syncStatus(), running: true, alreadyUp: true, health: health.body };
  }
  if (syncChild && syncChild.exitCode === null) {
    return syncStatus();
  }

  syncStarting = true;
  const serverJs = path.join(webRoot(), 'server.mjs');
  const env = {
    ...process.env,
    PORT: String(SYNC_PORT),
    HOST: '0.0.0.0',
    BILLSETU_DATA: syncDataDir()
  };
  if (passcode && String(passcode).trim()) {
    env.BILLSETU_SYNC_PASSCODE = String(passcode).trim();
  }

  try {
    // Packaged Electron binary runs as Node when ELECTRON_RUN_AS_NODE=1
    syncChild = spawn(process.execPath, [serverJs], {
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
      // cwd must be a real folder: inside app.asar chdir fails with ENOTDIR.
      cwd: app.getPath('userData'),
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    syncChild.stdout.on('data', (buf) => {
      const line = buf.toString();
      if (isDev) process.stdout.write('[sync] ' + line);
    });
    syncChild.stderr.on('data', (buf) => {
      const line = buf.toString();
      process.stderr.write('[sync:err] ' + line);
    });
    syncChild.on('exit', (code) => {
      if (isDev) console.log('[sync] exited', code);
      syncChild = null;
    });

    // Wait briefly for health
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const h = await probeSyncHealth();
      if (h.ok) {
        syncStarting = false;
        return { ...syncStatus(), running: true, health: h.body };
      }
    }
    syncStarting = false;
    return { ...syncStatus(), running: false, error: 'Sync server did not become healthy in time' };
  } catch (err) {
    syncStarting = false;
    return { ...syncStatus(), running: false, error: String(err && err.message ? err.message : err) };
  }
}

function stopSyncServer() {
  if (syncChild) {
    try {
      syncChild.kill();
    } catch (_) {}
    syncChild = null;
  }
  return syncStatus();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => {
            // Print the open bill (same as the in-app Print button) instead of the app screen.
            if (mainWindow) {
              mainWindow.webContents
                .executeJavaScript(
                  `(function(){var m=document.getElementById('modal-print-preview');` +
                  `if(m&&m.classList.contains('open')&&typeof runPrintAction==='function'){runPrintAction('print');return 'bill';}` +
                  `window.print();return 'page';})()`,
                  true
                )
                .catch((err) => logMainError('print', err));
            }
          }
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ role: 'toggleDevTools' }] : [{ role: 'toggleDevTools', visible: false, accelerator: 'F12' }])
      ]
    },
    {
      label: 'Sync',
      submenu: [
        {
          label: 'Start Sync Server (Host)',
          click: async () => {
            const result = await startSyncServer();
            if (mainWindow) {
              mainWindow.webContents.send('billsetu:sync-status', result);
            }
            const msg = result.running
              ? `Sync server is running.\n\nLocal: ${result.url}\nLAN: ${result.lanUrl}\nSetup: ${result.setupUrl}\n\nOn first run, open Setup in a browser to set a passcode (or use the Host panel reminder).`
              : `Could not start sync server.\n${result.error || 'Unknown error'}`;
            dialog.showMessageBox(mainWindow, {
              type: result.running ? 'info' : 'error',
              title: `${PRODUCT_NAME} Sync`,
              message: msg
            });
          }
        },
        {
          label: 'Stop Sync Server',
          click: () => {
            stopSyncServer();
            if (mainWindow) mainWindow.webContents.send('billsetu:sync-status', syncStatus());
          }
        },
        {
          label: 'Sync Server Status…',
          click: async () => {
            const health = await probeSyncHealth();
            const s = syncStatus();
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'Sync Status',
              message: health.ok
                ? `Running on port ${s.port}\nLAN: ${s.lanUrl}\nPasscode set: ${health.body && health.body.passcodeSet ? 'yes' : 'no'}`
                : 'Sync server is not running. Use Sync → Start Sync Server (Host).'
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Open Sync Setup in Browser',
          click: () => shell.openExternal(`http://127.0.0.1:${SYNC_PORT}/setup`)
        }
      ]
    },
    {
      label: 'Help',
      submenu: [
        {
          label: `About ${PRODUCT_NAME}`,
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: `About ${PRODUCT_NAME}`,
              message: `${PRODUCT_NAME} Desktop ${app.getVersion()}\nOffline GST billing\nVariant: ${branding.variant || 'store'}\nData folder:\n${app.getPath('userData')}`
            });
          }
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const saved = visibleBounds(loadBounds());
  const opts = {
    width: (saved && saved.width) || DEFAULT_WIDTH,
    height: (saved && saved.height) || DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: PRODUCT_NAME,
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true
    },
    icon: path.join(__dirname, '..', 'build', process.platform === 'win32' ? 'icon.ico' : 'icon.png')
  };
  if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') {
    opts.x = saved.x;
    opts.y = saved.y;
  }

  mainWindow = new BrowserWindow(opts);

  mainWindow.on('page-title-updated', (e) => {
    e.preventDefault();
    mainWindow.setTitle(PRODUCT_NAME);
  });

  mainWindow.once('ready-to-show', () => {
    if (saved && saved.isMaximized) mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('close', () => saveBounds());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // External links → default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowed = url.startsWith(`${APP_SCHEME}://`);
    if (!allowed) {
      event.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  // Downloads (backup JSON, bill PDFs, CSV): ask where to save, starting in Downloads.
  // Without an XDG user-dirs file Electron reports the home folder; prefer ~/Downloads then.
  const downloadsDir = () => {
    let dir = app.getPath('downloads');
    try {
      const home = app.getPath('home');
      const alt = path.join(home, 'Downloads');
      if (path.resolve(dir) === path.resolve(home) && fs.existsSync(alt)) dir = alt;
    } catch (_) {}
    return dir;
  };
  mainWindow.webContents.session.on('will-download', (_event, item) => {
    const name = item.getFilename() || 'download';
    const ext = path.extname(name).replace('.', '').toLowerCase();
    const filters = ext ? [{ name: ext.toUpperCase() + ' file', extensions: [ext] }, { name: 'All files', extensions: ['*'] }] : [];
    let target;
    try {
      target = dialog.showSaveDialogSync(mainWindow, {
        title: 'Save file',
        defaultPath: path.join(downloadsDir(), name),
        filters
      });
    } catch (err) {
      logMainError('save-dialog', err);
    }
    if (!target) {
      item.cancel();
      return;
    }
    item.setSavePath(target);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    logMainError('render-process-gone', details && details.reason);
    if (details && details.reason !== 'clean-exit' && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });

  mainWindow.loadURL(`${APP_SCHEME}://${APP_HOST}/index.html`);
}

function wireIpc() {
  ipcMain.handle('billsetu:get-info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
      productName: PRODUCT_NAME,
      appId: branding.appId,
      variant: branding.variant || 'store',
      noDemoSeed: (branding.variant || 'store') !== 'dev',
    platform: process.platform,
    sync: syncStatus()
  }));
  ipcMain.handle('billsetu:sync-status', async () => {
    const health = await probeSyncHealth();
    return { ...syncStatus(), health: health.body || null, healthy: !!health.ok };
  });
  ipcMain.handle('billsetu:sync-start', async (_e, passcode) => startSyncServer(passcode));
  ipcMain.handle('billsetu:sync-stop', () => stopSyncServer());
  ipcMain.handle('billsetu:print-to-pdf', async () => {
    if (!mainWindow) throw new Error('No window');
    const pdf = await mainWindow.webContents.printToPDF({
      landscape: false,
      pageSize: 'A4',
      printBackground: true,
      marginsType: 0
    });
    const out = userDataPath('test-print.pdf');
    fs.writeFileSync(out, pdf);
    return { path: out, bytes: pdf.length };
  });
}





app.whenReady().then(async () => {
  if (!gotSingleInstanceLock) return;
  registerAppProtocol();
  wireIpc();
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  if (process.env.BILLSETU_SMOKE === 'firstrun-extra') {
    const shotDir = process.env.BILLSETU_SCREEN_DIR || path.join(__dirname, '..', 'screens');
    try {
      await runFirstrunExtra({ app, getMainWindow: () => mainWindow, shotDir });
    } catch (err) {
      console.error('[firstrun-extra] FAILED', err);
      app.exit(1);
    }
  } else if (process.env.BILLSETU_SMOKE === 'firstrun') {
    const shotDir = process.env.BILLSETU_SCREEN_DIR || path.join(__dirname, '..', 'screens');
    try {
      await runFirstrunAudit({ app, getMainWindow: () => mainWindow, shotDir });
    } catch (err) {
      console.error('[firstrun] FAILED', err);
      app.exit(1);
    }
  } else if (process.env.BILLSETU_SMOKE === '1' || process.env.BILLSETU_SMOKE === '2') {
    const shotDir = process.env.BILLSETU_SCREEN_DIR || path.join(__dirname, '..', 'screens');
    const getMainWindow = () => mainWindow;
    try {
      if (process.env.BILLSETU_SMOKE === '1') await runSmokeTest({ app, getMainWindow, shotDir });
      else await runPersistSmoke({ app, getMainWindow, shotDir });
    } catch (err) {
      console.error('[smoke] FAILED', err);
      app.exit(1);
    }
  }
});

app.on('window-all-closed', () => {
  stopSyncServer();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopSyncServer();
});

// Export for tests / scripts
module.exports = { startSyncServer, stopSyncServer, syncStatus, webRoot };
