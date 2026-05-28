// User-configurable settings, persisted to localStorage.

import { defineStore } from "pinia";

const KEY = "telemetry.settings.v1";

const DEFAULTS = {
  units: "metric", // 'metric' | 'imperial'
  pack: {
    cellsOverride: null,   // null = auto-detect from first voltage reading
    totalCapacity: null,   // mAh — null hides the "used / total" fraction and time-remaining
    chemistry: "LI-PO",    // 'LI-PO' | 'LI-ION' | 'LI-FE' | 'NIMH'
    maxCellVoltage: 4.2,   // V/cell at full charge — upper bound for cell-count detection
  },
  serial: { baudRate: 420000 },
  ble: {
    discoveryMode: "acceptAll", // 'acceptAll' | 'namePrefix' | 'service'
    namePrefix: "",
    serviceUuid: "",
    customNotifyUuid: "",
  },
  udp: { url: "ws://localhost:14555", listenPort: 14550 },
  visibleSensors: {
    // TopHud bar cells
    armTimer: true,
    rssi: true,      // TX Pwr · LQ · RSSI cells + Link card
    voltage: true,   // Volts cell + Pack card
    percent: true,   // Battery cell
    // BottomLeftPanel cards
    altitude: true,
    distance: true,
    groundSpeed: true,
    verticalSpeed: true,
    // InfoCards (right panel)
    satellites: true,
    current: true,
  },
  map: {
    style: "satellite",   // 'osm' | 'satellite'
    droneIcon: "plane",   // 'plane' | 'quad'
    showTrail: true,
    centerOnDrone: true,
    autoSetHome: true,
  },
  alerts: {
    lowVoltage: 14.4,
    criticalVoltage: 13.6,
    signalLoss: 10, // LQ%
    audioEnabled: true,
  },
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return JSON.parse(JSON.stringify(DEFAULTS));
    const parsed = JSON.parse(raw);
    const base = JSON.parse(JSON.stringify(DEFAULTS));
    // Deep-merge one level: only keys present in DEFAULTS survive (whitelist),
    // so stale/removed keys in saved settings never bleed back in.
    for (const k of Object.keys(base)) {
      if (!(k in parsed)) continue;
      if (parsed[k] && typeof parsed[k] === "object" && !Array.isArray(parsed[k])) {
        for (const nk of Object.keys(base[k])) {
          if (nk in parsed[k]) base[k][nk] = parsed[k][nk];
        }
      } else {
        base[k] = parsed[k];
      }
    }
    return base;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
}

export const useSettingsStore = defineStore("settings", {
  state: () => load(),
  actions: {
    save() {
      try {
        localStorage.setItem(KEY, JSON.stringify(this.$state));
      } catch {}
    },
    resetDefaults() {
      Object.assign(this.$state, JSON.parse(JSON.stringify(DEFAULTS)));
      this.save();
    },
  },
});
