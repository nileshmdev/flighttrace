// Electron main process.
// - Embeds the UDP<->WebSocket bridge (no separate server process needed)
// - Grants Web Serial and Web Bluetooth permissions
// - BLE device selection via custom BrowserWindow picker (vertical list)
// - Loads the Vite-built dist/ in production, localhost:5173 in dev

'use strict';

const { app, BrowserWindow, session, ipcMain } = require('electron');
const path = require('path');
const dgram = require('dgram');
const http = require('http');
const https = require('https');

// ── Flags (must be set before app ready) ─────────────────────────────────────
// Web Bluetooth is enabled by default in Chromium 100+ (Electron 18+).
// No extra flags needed on macOS or Windows.
// Linux still needs enable-experimental-web-platform-features for requestLEScan().
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('enable-experimental-web-platform-features');
}

// ── UDP bridge ────────────────────────────────────────────────────────────────

let _udp, _wss, _httpServer;

function startBridge(wsPort = 14555, udpPort = 14550) {
  const { WebSocketServer } = require('ws');
  const udp = dgram.createSocket('udp4');
  let lastRemote = null;

  const server = http.createServer();
  const wss = new WebSocketServer({ server });

  udp.on('error', (err) => console.error('[bridge] UDP error:', err.message));
  udp.on('message', (msg, rinfo) => {
    lastRemote = { address: rinfo.address, port: rinfo.port };
    for (const client of wss.clients)
      if (client.readyState === 1) client.send(msg);
  });

  wss.on('connection', (ws) => {
    ws.binaryType = 'nodebuffer';
    ws.on('message', (data, isBinary) => {
      if (!isBinary || !lastRemote) return;
      udp.send(data, lastRemote.port, lastRemote.address, (err) => {
        if (err) console.error('[bridge] UDP send error:', err.message);
      });
    });
  });

  udp.bind(udpPort, '0.0.0.0');
  server.listen(wsPort, '127.0.0.1', () => {
    console.log(`[bridge] UDP:${udpPort} <-> WS:${wsPort}`);
  });

  _udp = udp; _wss = wss; _httpServer = server;
}

function stopBridge() {
  try { _wss?.close(); } catch {}
  try { _httpServer?.close(); } catch {}
  try { _udp?.close(); } catch {}
}

// ── Web Bluetooth — custom BrowserWindow picker ───────────────────────────────
// dialog.showMessageBox renders buttons horizontally — unusable with many
// devices. We use a small BrowserWindow (ble-picker.html) with a vertical
// scrollable list instead. IPC carries the device list in and the selection out.

let _btCallback  = null;
let _btDevices   = [];
let _btPicker    = null;
let _btFrozen    = false;   // when true, new select-bluetooth-device events are ignored
let _mainWindow  = null;

function showBlePicker() {
  // If picker is already open just push the latest device list to it.
  if (_btPicker && !_btPicker.isDestroyed()) {
    _btPicker.webContents.send('ble-devices', _btDevices);
    return;
  }
  _btFrozen = false;

  const parent = (_mainWindow && !_mainWindow.isDestroyed()) ? _mainWindow : undefined;
  _btPicker = new BrowserWindow({
    width: 400,
    height: 460,
    parent,
    modal: !!parent,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Select Bluetooth Device',
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  _btPicker.loadFile(path.join(__dirname, 'ble-picker.html'));

  // Push current device list as soon as the page is ready.
  _btPicker.webContents.once('did-finish-load', () => {
    _btPicker.webContents.send('ble-devices', _btDevices);
  });

  // Closed without selecting → cancel.
  _btPicker.on('closed', () => {
    const cb = _btCallback;
    _btCallback = null;
    _btPicker   = null;
    cb?.('');
  });
}

// Picker sends 'ble-select' with the chosen deviceId (empty string = cancel).
ipcMain.on('ble-select', (_, deviceId) => {
  const cb = _btCallback;
  _btCallback = null;
  cb?.(deviceId);
  if (_btPicker && !_btPicker.isDestroyed()) {
    _btPicker.destroy();
    _btPicker = null;
  }
});

// Picker stops scan — freeze incoming device updates.
ipcMain.on('ble-stop-scan', () => {
  _btFrozen = true;
});

// Picker restarts scan — clear accumulated list and resume incoming updates.
ipcMain.on('ble-restart-scan', () => {
  _btFrozen  = false;
  _btDevices = [];
  if (_btPicker && !_btPicker.isDestroyed())
    _btPicker.webContents.send('ble-devices', []);
});


// ── Web Serial — custom BrowserWindow picker ──────────────────────────────────

let _serialCallback = null;
let _serialPicker   = null;

function showSerialPicker(portList) {
  if (_serialPicker && !_serialPicker.isDestroyed()) {
    _serialPicker.webContents.send('serial-ports', portList);
    return;
  }

  const parent = (_mainWindow && !_mainWindow.isDestroyed()) ? _mainWindow : undefined;
  _serialPicker = new BrowserWindow({
    width: 420,
    height: 380,
    parent,
    modal: !!parent,
    resizable: false,
    minimizable: false,
    maximizable: false,
    title: 'Select Serial Port',
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  _serialPicker.loadFile(path.join(__dirname, 'serial-picker.html'));

  _serialPicker.webContents.once('did-finish-load', () => {
    _serialPicker.webContents.send('serial-ports', portList);
  });

  _serialPicker.on('closed', () => {
    const cb = _serialCallback;
    _serialCallback = null;
    _serialPicker   = null;
    cb?.('');
  });
}

ipcMain.on('serial-select', (_, portId) => {
  const cb = _serialCallback;
  _serialCallback = null;
  cb?.(portId);
  if (_serialPicker && !_serialPicker.isDestroyed()) {
    _serialPicker.destroy();
    _serialPicker = null;
  }
});

// Picker requests rescan: cancel current requestPort() and tell the renderer
// to call requestPort() again so a fresh select-serial-port event fires with
// any newly plugged-in devices.
ipcMain.on('serial-rescan', () => {
  const cb = _serialCallback;
  _serialCallback = null;
  cb?.('');
  if (_serialPicker && !_serialPicker.isDestroyed()) {
    _serialPicker.destroy();
    _serialPicker = null;
  }
  if (_mainWindow && !_mainWindow.isDestroyed()) {
    // executeJavaScript with userGesture=true gives the dispatched event a
    // synthetic user activation so requestPort() doesn't throw "must be
    // handling a user gesture".
    _mainWindow.webContents.executeJavaScript(
      "window.dispatchEvent(new CustomEvent('electron-serial-retry'))",
      true,
    );
  }
});


// ── IP geolocation (main process, no CORS) ───────────────────────────────────
ipcMain.handle('get-ip-location', () => new Promise((resolve, reject) => {
  const PROVIDERS = [
    { host: 'ipapi.co',   path: '/json/',  parse: (d) => ({ latitude: d.latitude,  longitude: d.longitude }) },
    { host: 'ipinfo.io',  path: '/json',   parse: (d) => { const [lat, lon] = (d.loc || '').split(','); return { latitude: +lat, longitude: +lon }; } },
  ];

  function tryNext(i) {
    if (i >= PROVIDERS.length) { reject(new Error('All IP geolocation providers failed')); return; }
    const p = PROVIDERS[i];
    https.get({ host: p.host, path: p.path, headers: { 'User-Agent': 'FlightTrace/1.0' } }, (res) => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const pos = p.parse(JSON.parse(raw));
          if (!pos.latitude || !pos.longitude) throw new Error('missing coords');
          resolve(pos);
        } catch { tryNext(i + 1); }
      });
    }).on('error', () => tryNext(i + 1));
  }
  tryNext(0);
}));

// ── BrowserWindow ─────────────────────────────────────────────────────────────

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    title: 'FlightTrace',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  });

  // ── Web Bluetooth — device picker ─────────────────────────────────────────
  // Must be on webContents (not session) in Electron 20+.
  // On macOS, fires once per discovered device with the current cumulative list.
  // On Windows, fires once with all devices found during the scan window.
  win.webContents.on('select-bluetooth-device', (event, deviceList, callback) => {
    event.preventDefault();
    _btCallback = callback;
    if (_btFrozen) return;          // scan stopped — ignore new devices
    // Merge rather than replace: handles both macOS (per-device events) and
    // Windows (full-list event) correctly.
    const seen = new Set(_btDevices.map(d => d.deviceId));
    for (const d of deviceList) {
      if (!seen.has(d.deviceId)) { _btDevices.push(d); seen.add(d.deviceId); }
    }
    showBlePicker();
  });

  // ── Load app ───────────────────────────────────────────────────────────────
  if (!app.isPackaged) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  _mainWindow = win;
  win.on('closed', () => { _mainWindow = null; });

  return win;
}

// ── Session-level handlers (registered once, not per-window) ─────────────────
// IMPORTANT: session.defaultSession handlers must be registered exactly once.
// Putting them inside createWindow() caused "one-time callback called more than
// once" crashes on macOS when the event fired while handlers were stacked.

function setupSession() {
  // Web Serial — custom picker window
  session.defaultSession.on('select-serial-port', (event, portList, _wc, callback) => {
    event.preventDefault();
    if (portList.length === 1) { callback(portList[0].portId); return; }
    _serialCallback = callback;
    showSerialPicker(portList);
  });

  // Permissions
  const ALLOWED_PERMISSIONS = ['serial', 'bluetooth', 'geolocation'];
  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    ALLOWED_PERMISSIONS.includes(permission)
  );
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.includes(permission));
  });
  session.defaultSession.setDevicePermissionHandler(() => true);

  // Map tile headers
  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        'https://tile.openstreetmap.org/*',
        'https://*.tile.openstreetmap.org/*',
        'https://server.arcgisonline.com/*',
      ],
    },
    (details, callback) => {
      details.requestHeaders['Referer'] = 'https://drone-telemetry.app/';
      details.requestHeaders['User-Agent'] =
        `DronetelemetryApp/${app.getVersion()} Electron/${process.versions.electron}`;
      callback({ requestHeaders: details.requestHeaders });
    }
  );
}

// ── App lifecycle ─────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  setupSession();
  startBridge();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  stopBridge();
  _btCallback = null;
  if (process.platform !== 'darwin') app.quit();
});
