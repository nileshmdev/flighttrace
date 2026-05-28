// LTM (Light Telemetry) parser.
// Frame: '$' 'T' <type> <payload...> <checksum=XOR(payload)>
// Common frames: G(GPS,18), A(Attitude,9), S(Status,11), O(Origin,18), N(Nav,10), X(extended,10)

import { xorChecksum } from "../utils/crc.js";

const FRAMES = {
  G: { len: 18, name: "gps" },
  A: { len: 9, name: "attitude" },
  S: { len: 11, name: "status" },
  O: { len: 18, name: "origin" },
  N: { len: 10, name: "nav" },
  X: { len: 10, name: "extended" },
};

export class LtmParser {
  constructor(emit) {
    this.emit = emit;
    this.buf = new Uint8Array(0);
  }

  feed(chunk) {
    this.buf = concat(this.buf, chunk);
    let i = 0;
    while (i < this.buf.length) {
      // Find header '$T'
      while (i + 1 < this.buf.length && !(this.buf[i] === 0x24 && this.buf[i + 1] === 0x54)) i++;
      if (i + 3 > this.buf.length) break;
      const typeChar = String.fromCharCode(this.buf[i + 2]);
      const def = FRAMES[typeChar];
      if (!def) {
        i++;
        continue;
      }
      const total = 3 + def.len + 1; // header + payload + crc
      if (i + total > this.buf.length) break;
      const payloadStart = i + 3;
      const payloadEnd = i + 3 + def.len;
      const crc = this.buf[payloadEnd];
      const calc = xorChecksum(this.buf, payloadStart, payloadEnd);
      if (crc === calc) {
        this.dispatch(typeChar, this.buf.subarray(payloadStart, payloadEnd));
        i += total;
      } else {
        i++;
      }
    }
    this.buf = this.buf.subarray(i);
  }

  dispatch(type, p) {
    const dv = new DataView(p.buffer, p.byteOffset, p.byteLength);
    switch (type) {
      case "G": {
        const lat = dv.getInt32(0, true) / 1e7;
        const lon = dv.getInt32(4, true) / 1e7;
        const groundSpeed = p[8]; // m/s
        const altitude = dv.getInt32(9, true) / 100; // cm -> m
        const sats = p[13] >> 2;
        const fix = p[13] & 0x03;
        this.emit("gps", { lat, lon, groundSpeed, altitude, satellites: sats, fix });
        break;
      }
      case "A": {
        const pitch = dv.getInt16(0, true);
        const roll = dv.getInt16(2, true);
        const heading = dv.getInt16(4, true);
        this.emit("attitude", { pitch, roll, yaw: heading });
        break;
      }
      case "S": {
        const voltage = dv.getUint16(0, true) / 1000; // mV -> V
        const rssi = p[4];
        const airspeed = p[5];
        const status = p[6];
        const armed = !!(status & 0x01);
        const failsafe = !!(status & 0x02);
        const flightModeIdx = (status >> 2) & 0x3f;
        this.emit("battery", { voltage });
        this.emit("link", { uplinkRssi1: rssi });
        this.emit("status", { armed, failsafe, flightModeIdx, airspeed });
        break;
      }
      case "O": {
        const homeLat = dv.getInt32(0, true) / 1e7;
        const homeLon = dv.getInt32(4, true) / 1e7;
        const homeAlt = dv.getInt32(8, true) / 100;
        const osdOn = p[12];
        const homeFix = p[13];
        this.emit("home", { lat: homeLat, lon: homeLon, alt: homeAlt, osdOn, homeFix });
        break;
      }
      case "N": {
        this.emit("nav", { mode: p[0], state: p[1] });
        break;
      }
      case "X": {
        const hdop = dv.getUint16(0, true) / 100;
        this.emit("ext", { hdop });
        break;
      }
    }
  }
}

function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
