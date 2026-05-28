// Web Bluetooth transport.
//
// Discovery modes:
//   acceptAll  — show every advertising device (most permissive, recommended)
//   namePrefix — filter by device name prefix
//   service    — filter by a specific service UUID (device must advertise it)
//
// After GATT connect we probe known service/characteristic pairs in order.
// For each candidate we try startNotifications(); if that fails with "Not
// supported" (common when the ESP32 firmware omits BLE2902 descriptor) we
// attempt a manual CCCD write as fallback before giving up.

import { createLogger } from "../utils/logger.js";
const log = createLogger("BLE");

// Source: Betaflight Configurator src/js/protocols/devices.js + ELRS docs
export const KNOWN_SERVICES = {
  // Nordic UART Service — ELRS BT, HM-11, NRF52, many ESP32 NUS firmwares
  nus: {
    label: "Nordic UART / HM-11 / NRF (NUS)",
    service: "6e400001-b5a3-f393-e0a9-e50e24dcca9e",
    notify:  "6e400003-b5a3-f393-e0a9-e50e24dcca9e",
    write:   "6e400002-b5a3-f393-e0a9-e50e24dcca9e",
  },
  // ESP32 / generic HM-10 style — single char 0xffe1 with READ+WRITE+NOTIFY
  // Arduino sketch: createCharacteristic(PROPERTY_READ|PROPERTY_WRITE|PROPERTY_NOTIFY)
  // Requires BLE2902 descriptor for Chrome; Android works without it.
  hm10esp32: {
    label: "HM-10 / ESP32 (0xffe0 svc, 0xffe1 char)",
    service: "0000ffe0-0000-1000-8000-00805f9b34fb",
    notify:  "0000ffe1-0000-1000-8000-00805f9b34fb",
    write:   "0000ffe1-0000-1000-8000-00805f9b34fb",
  },
  // CC2541 / BT-11 hardware — separate read(0xffe2) and write(0xffe1) chars
  cc2541: {
    label: "CC2541 / BT-11 (0xffe0 svc, 0xffe2 notify)",
    service: "0000ffe0-0000-1000-8000-00805f9b34fb",
    notify:  "0000ffe2-0000-1000-8000-00805f9b34fb",
    write:   "0000ffe1-0000-1000-8000-00805f9b34fb",
  },
  // SpeedyBee V2 adapter
  speedybeeV2: {
    label: "SpeedyBee V2",
    service: "0000abf0-0000-1000-8000-00805f9b34fb",
    notify:  "0000abf2-0000-1000-8000-00805f9b34fb",
    write:   "0000abf1-0000-1000-8000-00805f9b34fb",
  },
  // SpeedyBee V1 adapter
  speedybeeV1: {
    label: "SpeedyBee V1",
    service: "00001000-0000-1000-8000-00805f9b34fb",
    notify:  "00001002-0000-1000-8000-00805f9b34fb",
    write:   "00001001-0000-1000-8000-00805f9b34fb",
  },
  // DroneBridge
  dronebridge: {
    label: "DroneBridge",
    service: "0000db32-0000-1000-8000-00805f9b34fb",
    notify:  "0000db34-0000-1000-8000-00805f9b34fb",
    write:   "0000db33-0000-1000-8000-00805f9b34fb",
  },
  // Microchip RN4870/RN4871 transparent UART
  rn487: {
    label: "Microchip RN487x",
    service: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    notify:  "49535343-1e4d-4bd9-ba61-23c647249616",
    write:   "49535343-8841-43f4-a8d4-ecbe34729bb3",
  },
};

// Unique service UUIDs for optionalServices (dedup since ffe0 appears twice)
const ALL_SERVICES = [...new Set(Object.values(KNOWN_SERVICES).map((s) => s.service))];

// Try to subscribe to notifications. Falls back to manual CCCD write (0x2902)
// when the ESP32 firmware omits addDescriptor(new BLE2902()) — Chrome requires
// the CCCD to be present; Android tolerates its absence.
async function subscribeNotify(ch) {
  try {
    await ch.startNotifications();
    return true;
  } catch {
    try {
      const cccd = await ch.getDescriptor(0x2902);
      await cccd.writeValue(new Uint8Array([0x01, 0x00]));
      await ch.startNotifications();
      return true;
    } catch {
      return false;
    }
  }
}

export class BleTransport {
  constructor() {
    this.device = null;
    this.server = null;
    this.notifyChar = null;
    this.writeChar = null;
    this.connected = false;
    this.label = "BLE";
    this.onData = null;
    this.onClose = null;
  }

  static isSupported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  async connect({
    discoveryMode = "acceptAll",
    namePrefix = "",
    serviceUuid = null,
    customNotifyUuid = null,
  } = {}) {
    const inElectron = typeof window !== "undefined" && !!window.electronAPI?.isElectron;
    log.debug("connect() inElectron=%s discoveryMode=%s bluetooth=%s",
      inElectron, discoveryMode,
      typeof navigator !== "undefined" ? (navigator.bluetooth ? "ok" : "MISSING") : "no-navigator");

    if (!BleTransport.isSupported()) {
      throw new Error("Web Bluetooth not supported in this context.");
    }

    // Build requestDevice options.
    let requestOpts;
    if (discoveryMode === "namePrefix" && namePrefix) {
      requestOpts = {
        filters: [{ namePrefix }],
        optionalServices: [...ALL_SERVICES, ...(serviceUuid ? [serviceUuid] : [])],
      };
    } else if (discoveryMode === "service" && serviceUuid) {
      requestOpts = {
        filters: [{ services: [serviceUuid] }],
        optionalServices: [...ALL_SERVICES],
      };
    } else if (inElectron) {
      requestOpts = {
        acceptAllDevices: true,
        optionalServices: ALL_SERVICES,
      };
    } else {
      requestOpts = {
        acceptAllDevices: true,
        optionalServices: [...ALL_SERVICES, ...(serviceUuid ? [serviceUuid] : [])],
      };
    }

    log.debug("requestDevice opts:", JSON.stringify(requestOpts).slice(0, 300));
    let device;
    try {
      device = await navigator.bluetooth.requestDevice(requestOpts);
    } catch (e) {
      log.error("requestDevice failed — %s: %s", e.name, e.message);
      throw e;
    }
    log.debug("device selected:", device.name, device.id);
    this.device = device;
    this.label = `BLE · ${device.name || "Device"}`;
    this.device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      if (this.onClose) this.onClose();
    });

    try {
      this.server = await this.device.gatt.connect();
    } catch (e) {
      log.error("GATT connect failed: %s", e.message);
      throw new Error(`Bluetooth connection failed — ${e.message}`);
    }

    // Build candidate list.
    // If a specific serviceUuid is set: try every known entry that matches it
    // (covers both ffe1 and ffe2 variants for the 0xffe0 service).
    // Otherwise probe all known services in order.
    let candidates;
    if (serviceUuid) {
      candidates = Object.values(KNOWN_SERVICES)
        .filter((k) => k.service === serviceUuid)
        .map((k) => ({ service: k.service, notify: customNotifyUuid || k.notify }));
      if (candidates.length === 0) {
        candidates = [{ service: serviceUuid, notify: customNotifyUuid }];
      }
    } else {
      candidates = Object.values(KNOWN_SERVICES).map((k) => ({ service: k.service, notify: k.notify, write: k.write }));
    }

    let lastErr = null;
    for (const c of candidates) {
      if (!c.notify) continue;
      try {
        const svc = await this.server.getPrimaryService(c.service);
        const ch  = await svc.getCharacteristic(c.notify);
        if (!ch.properties.notify && !ch.properties.indicate) continue;
        if (!(await subscribeNotify(ch))) continue;
        ch.addEventListener("characteristicvaluechanged", (e) => {
          const v = e.target.value;
          if (this.onData) this.onData(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
        });
        this.notifyChar = ch;
        // Store write char if it differs from notify (e.g. CC2541 / NUS)
        if (c.write && c.write !== c.notify) {
          try { this.writeChar = await svc.getCharacteristic(c.write); } catch {}
        } else {
          this.writeChar = ch.properties.writeWithoutResponse || ch.properties.write ? ch : null;
        }
        this.connected = true;
        return;
      } catch (e) {
        lastErr = e;
      }
    }

    // Last-ditch: enumerate all pre-authorised services/characteristics.
    try {
      const services = await this.server.getPrimaryServices();
      for (const svc of services) {
        for (const ch of await svc.getCharacteristics()) {
          if (!ch.properties.notify && !ch.properties.indicate) continue;
          if (!(await subscribeNotify(ch))) continue;
          ch.addEventListener("characteristicvaluechanged", (e) => {
            const v = e.target.value;
            if (this.onData) this.onData(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
          });
          this.notifyChar = ch;
          this.connected = true;
          return;
        }
      }
    } catch (e) {
      lastErr = e;
    }

    throw new Error(
      "No notifiable characteristic found. " +
      "If your ESP32 sketch uses PROPERTY_NOTIFY, add: pCharacteristic->addDescriptor(new BLE2902()); " +
      "(Chrome requires a CCCD descriptor — Android works without it). " +
      "Also try 'Show all devices' mode if your device is not appearing. " +
      (lastErr ? `(last error: ${lastErr.message})` : "")
    );
  }

  async send(chunk) {
    if (!this.writeChar) return;
    // BLE MTU is commonly 20 bytes; split into chunks
    const MTU = 20;
    for (let i = 0; i < chunk.length; i += MTU) {
      try {
        await this.writeChar.writeValueWithoutResponse(chunk.slice(i, i + MTU));
      } catch {
        try { await this.writeChar.writeValue(chunk.slice(i, i + MTU)); } catch {}
      }
    }
  }

  async disconnect() {
    this.connected = false;
    try { if (this.notifyChar) await this.notifyChar.stopNotifications(); } catch {}
    try { if (this.server?.connected) this.server.disconnect(); } catch {}
    this.device = null;
    this.server = null;
    this.notifyChar = null;
    this.writeChar = null;
    if (this.onClose) this.onClose();
  }
}
