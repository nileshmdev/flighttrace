// CRC8 DVB-S2 (poly 0xD5) — used by CRSF
export function crc8DvbS2(buf, start = 0, end = buf.length) {
  let crc = 0;
  for (let i = start; i < end; i++) {
    crc ^= buf[i];
    for (let b = 0; b < 8; b++) {
      crc = (crc & 0x80) ? ((crc << 1) ^ 0xd5) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

// CRC X.25 (CRC16-CCITT, poly 0x1021, init 0xFFFF, reflected) — MAVLink
export function crcX25Init() {
  return 0xffff;
}
export function crcX25Update(crc, b) {
  let tmp = (b ^ (crc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return (((crc >>> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >>> 4)) & 0xffff) >>> 0;
}
export function crcX25(buf, start, end, seed = 0xffff) {
  let crc = seed;
  for (let i = start; i < end; i++) crc = crcX25Update(crc, buf[i]);
  return crc;
}

// XOR checksum for LTM (XOR of payload bytes)
export function xorChecksum(buf, start, end) {
  let c = 0;
  for (let i = start; i < end; i++) c ^= buf[i];
  return c & 0xff;
}
