// Runtime environment detection.
//
// Used to gate transport availability:
//   - UDP/Wi-Fi needs a local UDP bridge → only useful on localhost / LAN / Electron
//   - Web Bluetooth on Linux Chromium is unreliable → hide the BLE option
//
// All checks are safe to call at module load (no DOM access required).

export function isElectron() {
  if (typeof window === "undefined") return false;
  return !!window.electronAPI?.isElectron ||
         (typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent));
}

export function isLinux() {
  if (typeof navigator === "undefined") return false;
  return /Linux/i.test(navigator.platform || navigator.userAgent || "");
}

export function isAndroid() {
  if (typeof navigator === "undefined") return false;
  return /Android/i.test(navigator.userAgent || "");
}

/**
 * True when the app can reach a local UDP-WebSocket bridge:
 *   - Electron (bridge bundled into main process)
 *   - localhost / 127.0.0.1 / ::1
 *   - RFC1918 private LAN address (10.x, 172.16-31.x, 192.168.x)
 *
 * False on a public domain (github.io, etc.) — there's no bridge to talk to.
 */
export function isLocalEnvironment() {
  if (isElectron()) return true;
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  if (!host) return false;
  if (host === "localhost" || host === "127.0.0.1" || host === "::1") return true;
  // RFC1918 private ranges
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // Link-local IPv4
  if (/^169\.254\./.test(host)) return true;
  return false;
}
