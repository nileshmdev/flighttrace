// Pinia store for live telemetry. Updates are merged from parser events.
// Keeps a flight path trail (capped) and an arm timer.

import { defineStore } from "pinia";

const TRAIL_MAX = 2000;

export const useTelemetryStore = defineStore("telemetry", {
  state: () => ({
    // Position
    lat: null,
    lon: null,
    altitude: null,       // m (AMSL or relative depending on source)
    relAltitude: null,    // m AGL when available
    heading: null,        // deg
    groundSpeed: null,    // m/s
    verticalSpeed: null,  // m/s
    satellites: null,
    fix: null,            // 0=no, 2=2D, 3=3D, 4+=DGPS/RTK
    hdop: null,

    // Attitude
    pitch: null, // deg
    roll: null,
    yaw: null,

    // Battery / power
    voltage: null,  // V
    current: null,  // A
    capacity: null, // mAh used
    percent: null,  // %

    // Link
    uplinkRssi1: null,
    uplinkLq: null,
    uplinkSnr: null,
    uplinkTxPower: null,
    downlinkRssi: null,
    downlinkLq: null,
    rfMode: null,

    // Status
    armed: false,
    failsafe: false,
    flightMode: null,
    baseMode: null,
    customMode: null,
    systemStatus: null,
    mavlinkVersion: null,   // 1 or 2, set from first heartbeat

    // Home / nav
    homeLat: null,
    homeLon: null,
    homeAlt: null,

    // RC channels (CRSF RC_CHANNELS_PACKED — 16 values, range 172-1811)
    rcChannels: null,

    // Misc
    throttle: null,
    airspeed: null,

    // Derived
    distanceFromHome: null, // m
    armedAt: null,          // timestamp ms
    armSeconds: 0,

    // Trail of [lon, lat] pairs
    trail: [],
    lastUpdate: 0,
  }),
  actions: {
    apply(evt, data) {
      // Generic shallow merge of any defined fields
      for (const k of Object.keys(data)) {
        if (data[k] !== undefined && k in this.$state) this.$state[k] = data[k];
      }
      // Event-specific cross-mapping
      switch (evt) {
        case "heartbeat":
          if (data.armed !== this.armed) this._setArmed(data.armed);
          this.flightMode = describeMavMode(data) ?? this.flightMode;
          break;
        case "flightMode": {
          // CRSF: keep raw string for display (e.g. "ACRO", "!OK").
          // No special char prefix = armed; '!' = disarmed.
          this.flightMode = data.flightMode || this.flightMode;
          const armed = isCrsfArmed(data.flightMode);
          if (armed !== this.armed) this._setArmed(armed);
          break;
        }
        case "status":
          if (data.armed !== undefined && data.armed !== this.armed) this._setArmed(data.armed);
          if (data.flightModeIdx !== undefined) {
            this.flightMode = LTM_MODES[data.flightModeIdx] || `mode#${data.flightModeIdx}`;
          }
          break;
        case "home":
          this.homeLat = data.lat;
          this.homeLon = data.lon;
          this.homeAlt = data.alt;
          break;
        case "gps":
        case "position":
          if (data.lat != null && data.lon != null && (data.lat !== 0 || data.lon !== 0)) {
            this._pushTrail(data.lon, data.lat);
            this._recomputeDistance();
          }
          break;
        case "rcChannels":
          // Array assignment — use store proxy (not $state) to guarantee reactivity
          this.rcChannels = data.rcChannels ?? null;
          break;
        case "sys":
          if (data.battPercent != null) this.percent = data.battPercent;
          break;
      }
      this.lastUpdate = Date.now();
    },

    _setArmed(armed) {
      this.armed = armed;
      if (armed) {
        // Re-arm: restart timer from zero
        this.armedAt = Date.now();
        this.armSeconds = 0;
      }
      // On disarm: leave armedAt and armSeconds frozen at last value
    },

    tickArmTimer() {
      if (this.armed && this.armedAt) {
        this.armSeconds = (Date.now() - this.armedAt) / 1000;
      }
      // Disarmed: armSeconds stays frozen — don't touch it
    },

    _pushTrail(lon, lat) {
      const last = this.trail[this.trail.length - 1];
      if (!last || Math.abs(last[0] - lon) > 1e-6 || Math.abs(last[1] - lat) > 1e-6) {
        this.trail.push([lon, lat]);
        if (this.trail.length > TRAIL_MAX) this.trail.shift();
      }
    },

    _recomputeDistance() {
      if (this.homeLat == null || this.homeLon == null || this.lat == null || this.lon == null) return;
      this.distanceFromHome = haversine(this.homeLat, this.homeLon, this.lat, this.lon);
    },

    setHomeFromCurrent() {
      if (this.lat != null && this.lon != null) {
        this.homeLat = this.lat;
        this.homeLon = this.lon;
        this.homeAlt = this.altitude;
        this._recomputeDistance();
      }
    },

    // Feed a single CSV-parsed snapshot row during replay playback.
    // Uses the store proxy (this[k]) rather than $state[k] so array fields
    // like rcChannels stay reactive — InfoCards.vue's v-for needs that.
    applySnapshot(snapshot) {
      const stateKeys = new Set(Object.keys(this.$state));
      for (const [k, v] of Object.entries(snapshot)) {
        if (k === 'time' || k === 'trail' || !stateKeys.has(k)) continue;
        this[k] = v;
      }
      if (snapshot.lat != null && snapshot.lon != null) {
        this._pushTrail(snapshot.lon, snapshot.lat);
      }
      this.lastUpdate = Date.now();
    },

    // Seek: reset state then apply final snapshot + pre-built trail in one shot.
    applySeek(snapshot, trail) {
      this.$reset();
      const stateKeys = new Set(Object.keys(this.$state));
      for (const [k, v] of Object.entries(snapshot)) {
        if (k === 'time' || k === 'trail' || !stateKeys.has(k)) continue;
        this[k] = v;
      }
      this.trail = trail;
      this.lastUpdate = Date.now();
    },

    reset() {
      this.$reset();
    },
  },
});

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

const LTM_MODES = [
  "Manual", "Rate", "Angle", "Horizon", "Acro", "Stabilized1",
  "Stabilized2", "Stabilized3", "AltHold", "GpsHold", "Waypoints",
  "HeadFree", "CircleMode", "RTH", "FollowMe", "LandIn",
  "FlybywireA", "FlybywireB", "Cruise", "Unknown",
];

function describeMavMode(d) {
  if (d.customMode == null) return null;
  return `mode ${d.customMode}`;
}

// CRSF arm detection — exact match against the known armed mode set.
// "ANGL*" must NOT match "ANGL"; only the exact strings below are armed.
const CRSF_ARMED_MODES = new Set([
  "ACRO", "STAB", "STAB*", "STABILIZE",
  "AIR", "AIR*", "AIRMODE",
  "ANGL", "ANGLE",
  "HORIZON",
]);

function isCrsfArmed(mode) {
  if (!mode) return false;
  const upper = mode.trim().toUpperCase();
  if (upper.includes("DISARM")) return false;
  return CRSF_ARMED_MODES.has(upper);
}
