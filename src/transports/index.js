import { SerialTransport } from "./SerialTransport.js";
import { BleTransport } from "./BleTransport.js";
import { UdpTransport } from "./UdpTransport.js";
import { isLinux, isAndroid, isElectron, isLocalEnvironment } from "../utils/environment.js";

export const TRANSPORTS = {
  usb: { label: "USB Device", cls: SerialTransport },
  ble: { label: "BLE Device", cls: BleTransport },
  udp: { label: "WiFi Device", cls: UdpTransport },
};

export function createTransport(kind) {
  const T = TRANSPORTS[kind];
  if (!T) throw new Error(`Unknown transport: ${kind}`);
  return new T.cls();
}

/**
 * Whether the given transport should be offered to the user.
 *
 * Combines two checks:
 *   1. Browser feature support (Web Serial / Web Bluetooth / WebSocket)
 *   2. Environment suitability:
 *        - BLE: hidden on Linux desktop (Web Bluetooth unreliable under BlueZ);
 *               still available on Android (its UA also matches /Linux/ but
 *               Web Bluetooth works fine there) and in Electron on Linux
 *               where the bundled Chromium tracks the Chrome version explicitly.
 *        - UDP: only useful when a local bridge can be reached
 *               (localhost / LAN / Electron). On a public host (e.g. GitHub
 *               Pages) the bridge isn't reachable so we hide the option
 *               to avoid confusing connect-timeout errors.
 */
export function transportSupported(kind) {
  return transportUnavailableReason(kind) == null;
}

/**
 * Why the given transport can't be used here, or null if it can.
 * Surfaced in the UI as a "(n/a)" suffix + tooltip so users can self-diagnose
 * instead of just seeing a missing option.
 */
export function transportUnavailableReason(kind) {
  const T = TRANSPORTS[kind];
  if (!T) return "unknown transport";

  if (kind === "ble" && !T.cls.isSupported()) {
    return "no Web Bluetooth (use Chrome/Edge; page must be HTTPS or localhost)";
  }
  if (kind === "usb" && !T.cls.isSupported()) {
    return "no Web Serial (use desktop Chrome/Edge — not Firefox/Safari)";
  }
  if (kind === "udp" && !T.cls.isSupported()) {
    return "no WebSocket";
  }

  if (kind === "ble" && isLinux() && !isAndroid() && !isElectron()) {
    return "Web Bluetooth on Linux desktop is unreliable — use Android or Electron";
  }
  if (kind === "udp" && !isLocalEnvironment()) {
    return "UDP bridge unreachable from a public host";
  }

  return null;
}
