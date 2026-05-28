// MAVLink v1 / v2 frame parser.
// v1: 0xFE LEN SEQ SYS COMP MSGID PAYLOAD CRC(2)   (header 6 bytes)
// v2: 0xFD LEN INC_FLAGS CMP_FLAGS SEQ SYS COMP MSGID(3) PAYLOAD CRC(2) [SIG(13)]

import { createLogger } from "../utils/logger.js";
const log = createLogger("MAVLink");

const STX_V1 = 0xfe;
const STX_V2 = 0xfd;

const MSG = {
  HEARTBEAT:          0,
  SYS_STATUS:         1,
  GPS_RAW_INT:        24,
  ATTITUDE:           30,
  GLOBAL_POSITION_INT:33,
  RC_CHANNELS_RAW:    35,  // ArduPilot stream-3 (8-ch); rssi at offset 21
  RC_CHANNELS:        65,  // PX4 / newer ArduPilot (18-ch); rssi at offset 41
  VFR_HUD:            74,
  RADIO_STATUS:       109, // common.xml — wire: rxerrors(u16@0), fixed(u16@2), rssi@4, remrssi@5, txbuf@6, noise@7, remnoise@8
  BATTERY_STATUS:     147,
  RADIO:              166, // ardupilotmega.xml — wire: rssi@0, remrssi@1, txbuf@2, noise@3, remnoise@4, rxerrors(u16@5), fixed(u16@7)
  HOME_POSITION:      242,
};

// SiK radio RSSI count → dBm  (Si1000 datasheet approx, confirmed by ArduPilot docs)
// rssi=0 → -127 dBm, rssi=254 → ~7 dBm
function sikTodBm(raw) {
  return Math.round((raw / 1.9) - 127);
}

const MAV_STATE_NAMES = ["UNINIT","BOOT","CALIBRATING","STANDBY","ACTIVE","CRITICAL","EMERGENCY","POWEROFF"];

export class MavlinkParser {
  constructor(emit) {
    this.emit  = emit;
    this.buf   = new Uint8Array(0);
    this._dbgSeen = {};
  }

  feed(chunk) {
    this.buf = concat(this.buf, chunk);
    let i = 0;
    while (i < this.buf.length) {
      const b = this.buf[i];
      if (b === STX_V1) {
        if (i + 8 > this.buf.length) break;
        const len   = this.buf[i + 1];
        const total = 6 + len + 2;
        if (i + total > this.buf.length) break;
        const payload = this.buf.subarray(i + 6, i + 6 + len);
        this.dispatch(this.buf[i + 5], payload, {
          seq: this.buf[i + 2], sys: this.buf[i + 3], comp: this.buf[i + 4], version: 1,
        });
        i += total;
      } else if (b === STX_V2) {
        if (i + 12 > this.buf.length) break;
        const len    = this.buf[i + 1];
        const sigLen = (this.buf[i + 2] & 0x01) ? 13 : 0;
        const total  = 10 + len + 2 + sigLen;
        if (i + total > this.buf.length) break;
        const msgid   = this.buf[i + 7] | (this.buf[i + 8] << 8) | (this.buf[i + 9] << 16);
        const payload = this.buf.subarray(i + 10, i + 10 + len);
        this.dispatch(msgid, payload, {
          seq: this.buf[i + 4], sys: this.buf[i + 5], comp: this.buf[i + 6], version: 2,
        });
        i += total;
      } else {
        i++;
      }
    }
    this.buf = this.buf.subarray(i);
  }

  dispatch(msgid, p, meta) {
    const dv  = new DataView(p.buffer, p.byteOffset, p.byteLength);
    // MAVLink v2 truncates trailing zero bytes; get() returns fallback on OOB.
    const get = (off, fn, fallback = 0) => {
      try { return fn.call(dv, off, true); } catch { return fallback; }
    };
    // Per-ID debug log (fires once per message type seen — dev only)
    if (!this._dbgSeen[msgid]) {
      this._dbgSeen[msgid] = true;
      log.debug(`first msg id=${msgid} len=${p.length} v${meta.version}`);
    }

    switch (msgid) {

      case MSG.HEARTBEAT: {
        if (p.length < 9) return;
        const customMode   = get(0, dv.getUint32);
        const baseMode     = p.length > 6 ? p[6] : 0;
        const systemStatus = p.length > 7 ? p[7] : 0;
        const armed        = !!(baseMode & 0x80);
        this.emit("heartbeat", {
          armed, baseMode, customMode,
          type:             p.length > 4 ? p[4] : 0,
          autopilot:        p.length > 5 ? p[5] : 0,
          systemStatus,
          systemStatusName: MAV_STATE_NAMES[systemStatus] || String(systemStatus),
          mavlinkVersion:   meta.version,  // track v1 vs v2
        });
        break;
      }

      case MSG.SYS_STATUS: {
        // voltage_battery (uint16, mV) @14 · current_battery (int16, 10*mA) @16
        // battery_remaining (int8, %) @30
        if (p.length < 16) return;
        const voltage    = get(14, dv.getUint16) / 1000;
        const currentRaw = get(16, dv.getInt16);
        const current    = currentRaw === -1 ? null : currentRaw / 100;
        const battRaw    = get(30, dv.getInt8, -1);
        const battPercent= battRaw < 0 ? null : battRaw;
        this.emit("sys", { voltage, current, battPercent });
        break;
      }

      case MSG.GPS_RAW_INT: {
        if (p.length < 30) return;
        const eph = get(20, dv.getUint16);
        this.emit("gps", {
          lat:        get(8,  dv.getInt32) / 1e7,
          lon:        get(12, dv.getInt32) / 1e7,
          altitude:   get(16, dv.getInt32) / 1000,
          hdop:       eph === 65535 ? null : eph / 100,
          fix:        p.length > 28 ? p[28] : 0,
          satellites: p.length > 29 ? p[29] : 0,
        });
        break;
      }

      case MSG.ATTITUDE: {
        if (p.length < 16) return;
        const R = 180 / Math.PI;
        this.emit("attitude", {
          roll:  get(4,  dv.getFloat32) * R,
          pitch: get(8,  dv.getFloat32) * R,
          yaw:   get(12, dv.getFloat32) * R,
        });
        break;
      }

      case MSG.GLOBAL_POSITION_INT: {
        if (p.length < 24) return;
        const vx  = get(20, dv.getInt16) / 100;
        const vy  = get(22, dv.getInt16) / 100;
        const vz  = get(24, dv.getInt16) / 100;
        const hdgRaw = get(26, dv.getUint16);
        this.emit("position", {
          lat:          get(4,  dv.getInt32) / 1e7,
          lon:          get(8,  dv.getInt32) / 1e7,
          altitude:     get(12, dv.getInt32) / 1000,
          relAltitude:  get(16, dv.getInt32) / 1000,
          vx, vy, vz,
          groundSpeed:  Math.sqrt(vx * vx + vy * vy),
          verticalSpeed:-vz,
          heading:      hdgRaw === 65535 ? null : hdgRaw / 100,
        });
        break;
      }

      case MSG.RC_CHANNELS_RAW: {
        // ArduPilot stream-3. rssi @21: 0–254 (255=invalid), scale to 0–100% LQ.
        if (p.length < 22) return;
        const rssi = p[21];
        if (rssi !== 255) this.emit("radio", { uplinkLq: Math.round(rssi * 100 / 254) });
        break;
      }

      case MSG.RC_CHANNELS: {
        // PX4 / newer ArduPilot. rssi @41: 0–254 (255=invalid).
        if (p.length < 42) return;
        const rssi = p[41];
        if (rssi !== 255) this.emit("radio", { uplinkLq: Math.round(rssi * 100 / 254) });
        break;
      }

      case MSG.VFR_HUD: {
        if (p.length < 20) return;
        this.emit("vfr", {
          airspeed:     get(0,  dv.getFloat32),
          groundSpeed:  get(4,  dv.getFloat32),
          altitude:     get(8,  dv.getFloat32),
          verticalSpeed:get(12, dv.getFloat32),
          heading:      get(16, dv.getInt16),
          throttle:     get(18, dv.getUint16),
        });
        break;
      }

      case MSG.RADIO_STATUS: {
        // common.xml wire order: rxerrors(u16@0), fixed(u16@2), rssi@4, remrssi@5, txbuf@6, noise@7, remnoise@8
        // rssi=GCS rx (downlink), remrssi=aircraft rx (uplink). Convert SiK counts→dBm.
        if (p.length < 6) return;
        const rssi    = p[4];
        const remrssi = p[5];
        this.emit("radio", {
          uplinkRssi1:  remrssi === 255 ? null : sikTodBm(remrssi),
          downlinkRssi: rssi    === 255 ? null : sikTodBm(rssi),
        });
        break;
      }

      case MSG.RADIO: {
        // ardupilotmega.xml wire order: rssi@0, remrssi@1, txbuf@2, noise@3, remnoise@4, rxerrors(u16@5), fixed(u16@7)
        // Same semantics as RADIO_STATUS but DIFFERENT offsets.
        if (p.length < 2) return;
        const rssi    = p[0];
        const remrssi = p[1];
        this.emit("radio", {
          uplinkRssi1:  remrssi === 255 ? null : sikTodBm(remrssi),
          downlinkRssi: rssi    === 255 ? null : sikTodBm(rssi),
        });
        break;
      }

      case MSG.BATTERY_STATUS: {
        // current_consumed (int32, mAh) @0 · current_battery (int16, 10*mA) @30
        // battery_remaining (int8, %) @35
        const capacityRaw = get(0,  dv.getInt32);
        const currentRaw  = get(30, dv.getInt16);
        const remaining   = p.length > 35 ? p[35] : null;
        this.emit("battery", {
          percent:  remaining === 0xff ? null : remaining,
          capacity: capacityRaw >= 0   ? capacityRaw : null,
          current:  currentRaw !== -1 && currentRaw >= 0 ? currentRaw / 100 : null,
        });
        break;
      }

      case MSG.HOME_POSITION: {
        if (p.length < 12) return;
        this.emit("home", {
          lat: get(0, dv.getInt32) / 1e7,
          lon: get(4, dv.getInt32) / 1e7,
          alt: get(8, dv.getInt32) / 1000,
        });
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
