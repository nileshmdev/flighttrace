// CRSF (Crossfire) frame parser.
// Frame layout: [sync][len][type][payload...][crc8]
//   sync = 0xC8 (flight controller dest) — also seen 0xEA, 0xEE
//   len  = number of bytes after this field, including type and CRC
//   crc8 = DVB-S2 over [type ... payload]

import { crc8DvbS2 } from "../utils/crc.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("CRSF");

export const CRSF_SYNC_BYTES = new Set([0xc8, 0xea, 0xee, 0xc0]);
export const CRSF_MAX_LEN = 64;

export const CRSF_TYPE = {
  GPS: 0x02,
  VARIO: 0x07,
  BATTERY_SENSOR: 0x08,
  BARO_ALTITUDE: 0x09,
  LINK_STATISTICS: 0x14,
  RC_CHANNELS: 0x16,
  ATTITUDE: 0x1e,
  FLIGHT_MODE: 0x21,
};

export class CrsfParser {
  constructor(emit) {
    this.emit = emit;
    this.buf = new Uint8Array(0);
  }

  feed(chunk) {
    this.buf = concat(this.buf, chunk);
    let i = 0;
    while (i < this.buf.length) {
      // Find sync
      while (i < this.buf.length && !CRSF_SYNC_BYTES.has(this.buf[i])) i++;
      if (i + 2 > this.buf.length) break;
      const len = this.buf[i + 1];
      if (len < 2 || len > CRSF_MAX_LEN) {
        i++;
        continue;
      }
      const total = len + 2;
      if (i + total > this.buf.length) break;
      const type = this.buf[i + 2];
      const payloadStart = i + 3;
      const payloadEnd = i + total - 1;
      const crc = this.buf[i + total - 1];
      const calc = crc8DvbS2(this.buf, i + 2, payloadEnd);
      if (crc === calc) {
        const payload = this.buf.subarray(payloadStart, payloadEnd);
        this.dispatch(type, payload);
        i += total;
      } else {
        i++; // resync
      }
    }
    this.buf = this.buf.subarray(i);
  }

  dispatch(type, p) {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    const out = { _type: type };
    switch (type) {
      case CRSF_TYPE.GPS: {
        if (p.length < 15) return;
        out.lat = dv.getInt32(0, false) / 1e7;
        out.lon = dv.getInt32(4, false) / 1e7;
        out.groundSpeed = dv.getUint16(8, false) / 36; // 0.1 km/h -> m/s (km/h /3.6 = m/s; raw is /10 km/h)
        out.heading = dv.getUint16(10, false) / 100;  // deg
        out.altitude = dv.getUint16(12, false) - 1000; // meters, +1000 offset
        out.satellites = p[14];
        this.emit("gps", out);
        break;
      }
      case CRSF_TYPE.VARIO: {
        if (p.length < 2) return;
        out.verticalSpeed = dv.getInt16(0, false) / 100; // cm/s -> m/s
        this.emit("vario", out);
        break;
      }
      case CRSF_TYPE.BATTERY_SENSOR: {
        if (p.length < 8) return;
        out.voltage = dv.getUint16(0, false) / 10; // 0.1V
        out.current = dv.getUint16(2, false) / 10; // 0.1A
        out.capacity = (p[4] << 16) | (p[5] << 8) | p[6]; // mAh
        out.percent = p[7];
        this.emit("battery", out);
        break;
      }
      case CRSF_TYPE.BARO_ALTITUDE: {
        if (p.length < 2) return;
        out.baroAltitude = dv.getInt16(0, false) / 10; // dm -> m (legacy: depending on firmware)
        this.emit("baro", out);
        break;
      }
      case CRSF_TYPE.LINK_STATISTICS: {
        if (p.length < 10) return;
        // RSSI bytes: old CRSF = unsigned magnitude (negate); ELRS = signed int8 (already negative).
        // Sign-extend then: positive magnitude → negate, already-negative → keep.
        out.uplinkRssi1 = rssiDbm(p[0]);
        out.uplinkRssi2 = rssiDbm(p[1]);
        out.uplinkLq = p[2];
        out.uplinkSnr = (p[3] << 24) >> 24;
        out.activeAntenna = p[4];
        out.rfMode = p[5];
        out.uplinkTxPower = p[6];
        out.downlinkRssi = rssiDbm(p[7]);
        out.downlinkLq = p[8];
        out.downlinkSnr = (p[9] << 24) >> 24;
        this.emit("link", out);
        break;
      }
      case CRSF_TYPE.ATTITUDE: {
        if (p.length < 6) return;
        out.pitch = (dv.getInt16(0, false) / 10000) * (180 / Math.PI);
        out.roll = (dv.getInt16(2, false) / 10000) * (180 / Math.PI);
        out.yaw = (dv.getInt16(4, false) / 10000) * (180 / Math.PI);
        this.emit("attitude", out);
        break;
      }
      case CRSF_TYPE.RC_CHANNELS: {
        if (p.length < 22) {
          log.warn("RC_CHANNELS frame too short: %d bytes (need 22)", p.length);
          return;
        }
        const ch = new Array(16);
        for (let i = 0; i < 16; i++) {
          const bit = i * 11;
          const b = bit >> 3;
          const shift = bit & 7;
          const lo = p[b] ?? 0;
          const mi = p[b + 1] ?? 0;
          const hi = p[b + 2] ?? 0;
          ch[i] = ((lo | (mi << 8) | (hi << 16)) >> shift) & 0x7ff;
        }
        log.debug("RC ch1-4: %d %d %d %d", ch[0], ch[1], ch[2], ch[3]);
        this.emit("rcChannels", { rcChannels: ch });
        break;
      }
      case CRSF_TYPE.FLIGHT_MODE: {
        // Null-terminated ASCII
        let s = "";
        for (let i = 0; i < p.length && p[i] !== 0; i++) s += String.fromCharCode(p[i]);
        out.flightMode = s;
        this.emit("flightMode", out);
        break;
      }
    }
  }
}

// Handle both old CRSF (unsigned magnitude, e.g. 23 → -23 dBm)
// and ELRS (signed int8, e.g. 0xE9=233 → -23 dBm already).
function rssiDbm(b) {
  const s = (b << 24) >> 24; // sign-extend as int8
  return s > 0 ? -s : s;
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
