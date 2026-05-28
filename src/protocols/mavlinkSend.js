// MAVLink v1 frame builder + GCS stream management.
// Builds properly CRC'd MAVLink v1 frames so the GCS can request data streams
// and send heartbeats. Without this, ArduPilot won't push BATTERY_STATUS,
// SYS_STATUS, RC_CHANNELS, or RADIO_STATUS (they are on streams that default
// to 0 Hz in many FC configs).

const GCS_SYS  = 255;
const GCS_COMP = 190;

// CRC-16/MCRF4XX used by MAVLink
function crcAccum(b, crc) {
  let tmp = b ^ (crc & 0xff);
  tmp ^= (tmp << 4) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

function buildV1(msgid, payload, crcExtra, seq = 0) {
  const len = payload.length;
  // CRC covers: LEN, SEQ, SYS, COMP, MSGID, PAYLOAD, then CRC_EXTRA seed
  const crcData = [len, seq, GCS_SYS, GCS_COMP, msgid, ...payload, crcExtra];
  let crc = 0xffff;
  for (const b of crcData) crc = crcAccum(b, crc);
  const frame = new Uint8Array(6 + len + 2);
  frame[0] = 0xfe; // STX
  frame[1] = len;
  frame[2] = seq;
  frame[3] = GCS_SYS;
  frame[4] = GCS_COMP;
  frame[5] = msgid;
  frame.set(payload, 6);
  frame[6 + len]     = crc & 0xff;
  frame[6 + len + 1] = (crc >> 8) & 0xff;
  return frame;
}

// HEARTBEAT (msg 0, CRC_EXTRA 50) — keeps ArduPilot streaming to this GCS IP
let _heartbeatSeq = 0;
export function buildHeartbeat() {
  const p = new Uint8Array(9);
  const dv = new DataView(p.buffer);
  dv.setUint32(0, 0, true);   // custom_mode
  p[4] = 6;                   // type: MAV_TYPE_GCS
  p[5] = 8;                   // autopilot: MAV_AUTOPILOT_INVALID
  p[6] = 0;                   // base_mode
  p[7] = 4;                   // system_status: MAV_STATE_ACTIVE
  p[8] = 3;                   // mavlink_version
  return buildV1(0, p, 50, _heartbeatSeq++ & 0xff);
}

// REQUEST_DATA_STREAM (msg 66, CRC_EXTRA 148)
// streamId: 0=ALL, 1=RAW_SENSORS, 2=EXTENDED_STATUS, 3=RC_CHANNELS,
//           6=POSITION, 10=EXTRA1(attitude), 11=EXTRA2(VFR_HUD)
let _streamSeq = 0;
export function buildStreamRequest(streamId, rateHz, targetSys = 1) {
  const p = new Uint8Array(6);
  const dv = new DataView(p.buffer);
  dv.setUint16(0, rateHz, true); // req_message_rate
  p[2] = targetSys;              // target_system
  p[3] = 0;                      // target_component (0 = all)
  p[4] = streamId;               // req_stream_id
  p[5] = 1;                      // start_stop: 1 = start
  return buildV1(66, p, 148, _streamSeq++ & 0xff);
}

// Send stream requests for the data the UI needs but ArduPilot won't push
// by default. Called once after MAVLink protocol is locked.
export function requestMavlinkStreams(send) {
  // EXTENDED_STATUS: SYS_STATUS, BATTERY_STATUS, etc.
  send(buildStreamRequest(2, 2));
  // RC_CHANNELS: RC link quality / RSSI
  send(buildStreamRequest(3, 5));
}
