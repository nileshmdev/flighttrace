// Telemetry session logger — buffers CSV rows in memory and downloads them.
//
// Lifecycle (driven by connection.js):
//   • start()  — called once when protocol is detected (data is flowing)
//   • record() — called on every parser callback; rate-limited to 10Hz
//   • stop()   — called on disconnect; auto-downloads + resets the buffer
//
// Filename: telemetry_YYYY-MM-DD_HH-MM-SS_<protocol>_<iface>.csv

// All telemetry-store fields worth logging. Order = CSV column order.
// Keep in sync with the Pinia state in src/stores/telemetry.js.
const FIELDS = [
  // Time
  "time",
  // Position
  "lat", "lon", "altitude", "relAltitude",
  "heading", "groundSpeed", "verticalSpeed",
  "satellites", "fix", "hdop",
  // Attitude
  "pitch", "roll", "yaw",
  // Battery / power
  "voltage", "current", "capacity", "percent",
  // Link quality
  "uplinkRssi1", "uplinkLq", "uplinkSnr", "uplinkTxPower",
  "downlinkRssi", "downlinkLq", "rfMode",
  // Status
  "armed", "failsafe", "flightMode",
  "baseMode", "customMode", "systemStatus", "mavlinkVersion",
  // Home / nav
  "homeLat", "homeLon", "homeAlt",
  // RC channels — serialised as JSON array (16 values)
  "rcChannels",
  // Misc
  "throttle", "airspeed",
  // Derived
  "distanceFromHome", "armSeconds",
];

export class TelemetryLogger {
  constructor() {
    this._rows = [];
    this._protocol = "unknown";
    this._iface = "unknown";
    this._startedAt = null;
    this._lastSnapshot = 0;
    // 100 ms = 10 Hz; captures attitude detail without bloating file size.
    this._intervalMs = 100;
  }

  // Idempotent — multiple callers (protocol-detect, post-connect) won't
  // restart and lose the buffer.
  start(protocol, iface) {
    if (this._startedAt) return;
    this._rows = [FIELDS.join(",")];
    this._protocol = protocol || "unknown";
    this._iface = iface || "unknown";
    this._startedAt = new Date();
    this._lastSnapshot = 0;
  }

  record(state) {
    if (!this._startedAt) return;
    const now = Date.now();
    if (now - this._lastSnapshot < this._intervalMs) return;
    this._lastSnapshot = now;

    const row = FIELDS.map((f) => {
      if (f === "time") return new Date().toISOString();
      const v = state[f];
      if (v == null) return "";
      if (typeof v === "boolean") return v ? "1" : "0";
      if (Array.isArray(v)) {
        // Serialise as JSON, then CSV-escape any embedded quotes
        return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
      }
      if (typeof v === "string") return `"${v.replace(/"/g, '""')}"`;
      if (typeof v === "number" && !Number.isInteger(v)) return v.toFixed(2);
      return v;
    });
    this._rows.push(row.join(","));
  }

  get hasData() {
    return this._rows.length > 1; // more than just the header
  }

  download() {
    if (!this.hasData) return;
    const ts = (this._startedAt ?? new Date())
      .toISOString()
      .replace(/[:.]/g, "-")
      .slice(0, 19);
    const name = `telemetry_${ts}_${this._protocol}_${this._iface}.csv`;

    const blob = new Blob([this._rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Auto-download then reset — called on disconnect (clean or unexpected).
  stop() {
    if (this.hasData) this.download();
    this.reset();
  }

  reset() {
    this._rows = [];
    this._startedAt = null;
    this._lastSnapshot = 0;
  }
}

export const telemetryLogger = new TelemetryLogger();
