// Score-based protocol auto-detection.
// Strategy: while DETECTING, run all candidate parsers in dry-run mode and
// count successful frame validations. First parser to cross THRESHOLD wins.
// CRC validation in each parser is the strongest signal — pattern matches alone
// are not enough since 0xC8 / 0xFE / 0xFD bytes occur randomly in payloads.

import { CrsfParser } from "./crsf.js";
import { MavlinkParser } from "./mavlink.js";
import { LtmParser } from "./ltm.js";

const THRESHOLD = 3; // valid frames before locking
const TIMEOUT_MS = 5000;

export const PROTOCOLS = ["crsf", "mavlink", "ltm"];

// Set of fields each protocol can produce (used to dim unsupported UI fields).
export const PROTOCOL_FIELDS = {
  crsf: new Set([
    "lat", "lon", "altitude", "groundSpeed", "heading", "satellites",
    "verticalSpeed", "voltage", "current", "capacity", "percent",
    "pitch", "roll", "yaw", "flightMode",
    "uplinkRssi1", "uplinkLq", "uplinkTxPower", "downlinkRssi", "downlinkLq", "rfMode",
    "rcChannels",
  ]),
  mavlink: new Set([
    "lat", "lon", "altitude", "relAltitude", "groundSpeed", "verticalSpeed", "heading",
    "satellites", "fix", "hdop", "voltage", "current", "capacity", "percent",
    "pitch", "roll", "yaw", "armed", "baseMode", "customMode", "systemStatus",
    "throttle", "airspeed", "homeLat", "homeLon",
    "uplinkRssi1", "downlinkRssi", "uplinkLq",
  ]),
  ltm: new Set([
    "lat", "lon", "altitude", "groundSpeed", "satellites", "fix",
    "pitch", "roll", "yaw",
    "voltage", "uplinkRssi1", "armed", "failsafe", "flightModeIdx",
    "homeLat", "homeLon", "hdop",
  ]),
};

export class ProtocolDetector {
  constructor(emit) {
    this.emit = emit;
    this.detected = null;
    this.startedAt = Date.now();
    this.scores = { crsf: 0, mavlink: 0, ltm: 0 };
    this.parsers = {
      crsf: new CrsfParser((evt, data) => this.onFrame("crsf", evt, data)),
      mavlink: new MavlinkParser((evt, data) => this.onFrame("mavlink", evt, data)),
      ltm: new LtmParser((evt, data) => this.onFrame("ltm", evt, data)),
    };
  }

  feed(chunk) {
    if (this.detected) {
      this.parsers[this.detected].feed(chunk);
      return;
    }
    // Detection phase: feed the same bytes to all parsers.
    // A parser's feed() can call onFrame() synchronously and lock detection,
    // which nulls the other parsers — guard and break early to avoid null.feed().
    for (const proto of PROTOCOLS) {
      if (this.parsers[proto]) this.parsers[proto].feed(chunk.slice());
      if (this.detected) break;
    }
    if (Date.now() - this.startedAt > TIMEOUT_MS && !this.detected) {
      this.emit("__detect__", { state: "timeout", scores: { ...this.scores } });
    }
  }

  onFrame(proto, evt, data) {
    if (!this.detected) {
      this.scores[proto] = (this.scores[proto] || 0) + 1;
      this.emit("__detect__", { state: "scoring", scores: { ...this.scores } });
      if (this.scores[proto] >= THRESHOLD) {
        this.detected = proto;
        this.emit("__detect__", { state: "locked", protocol: proto });
        // Reset other parsers' buffers (free memory)
        for (const p of PROTOCOLS) if (p !== proto) this.parsers[p] = null;
      }
    }
    if (this.detected === proto) {
      this.emit(evt, data);
    }
  }

  getProtocol() {
    return this.detected;
  }

  reset() {
    this.detected = null;
    this.scores = { crsf: 0, mavlink: 0, ltm: 0 };
    this.startedAt = Date.now();
    this.parsers = {
      crsf: new CrsfParser((evt, data) => this.onFrame("crsf", evt, data)),
      mavlink: new MavlinkParser((evt, data) => this.onFrame("mavlink", evt, data)),
      ltm: new LtmParser((evt, data) => this.onFrame("ltm", evt, data)),
    };
  }
}
