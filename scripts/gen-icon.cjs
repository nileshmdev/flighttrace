'use strict';

// Generates build/icon.png (512x512) from the same shapes as public/icon.svg
// using only Node.js built-in modules (zlib). Run with: node scripts/gen-icon.cjs

const { deflateSync } = require('zlib');
const { writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');

const SIZE = 512;
const OUT  = join(__dirname, '..', 'build', 'icon.png');

// RGBA pixel buffer
const buf = new Uint8Array(SIZE * SIZE * 4);

function blendPixel(idx, r, g, b, a) {
  const sa = a / 255, da = buf[idx + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  buf[idx]     = Math.round((r * sa + buf[idx]     * da * (1 - sa)) / oa);
  buf[idx + 1] = Math.round((g * sa + buf[idx + 1] * da * (1 - sa)) / oa);
  buf[idx + 2] = Math.round((b * sa + buf[idx + 2] * da * (1 - sa)) / oa);
  buf[idx + 3] = Math.round(oa * 255);
}

// ── 1. Background #0b0f14 with rounded corners rx=96 ─────────────────────────
const RX = 96;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let inside = true;
    if      (x < RX        && y < RX)        inside = (x-RX)**2 + (y-RX)**2 <= RX*RX;
    else if (x > SIZE-RX-1 && y < RX)        inside = (x-(SIZE-RX-1))**2 + (y-RX)**2 <= RX*RX;
    else if (x > SIZE-RX-1 && y > SIZE-RX-1) inside = (x-(SIZE-RX-1))**2 + (y-(SIZE-RX-1))**2 <= RX*RX;
    else if (x < RX        && y > SIZE-RX-1) inside = (x-RX)**2 + (y-(SIZE-RX-1))**2 <= RX*RX;
    if (inside) {
      const i = (y * SIZE + x) * 4;
      buf[i] = 11; buf[i+1] = 15; buf[i+2] = 20; buf[i+3] = 255;
    }
  }
}

// ── 2. Circle fill: rgba(0,210,255, 0.22) cx=256 cy=256 r=200 ────────────────
const CX = 256, CY = 256, CR = 200;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if ((x-CX)**2 + (y-CY)**2 <= CR*CR)
      blendPixel((y*SIZE+x)*4, 0, 210, 255, Math.round(255*0.22));
  }
}

// ── 3. Circle stroke: #00d2ff width=12 ───────────────────────────────────────
const CSTROKE = 12;
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const d = Math.sqrt((x-CX)**2 + (y-CY)**2);
    if (Math.abs(d - CR) <= CSTROKE / 2)
      blendPixel((y*SIZE+x)*4, 0, 210, 255, 255);
  }
}

// ── 4. Polygon fill: #00d2ff  (points 256,80 350,360 256,290 162,360) ────────
const POLY = [[256,80],[350,360],[256,290],[162,360]];

function inPoly(px_, py_) {
  let inside = false;
  for (let i = 0, j = POLY.length - 1; i < POLY.length; j = i++) {
    const [xi, yi] = POLY[i], [xj, yj] = POLY[j];
    if ((yi > py_) !== (yj > py_) && px_ < (xj-xi)*(py_-yi)/(yj-yi)+xi)
      inside = !inside;
  }
  return inside;
}

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    if (inPoly(x + 0.5, y + 0.5)) {
      const i = (y*SIZE+x)*4;
      buf[i] = 0; buf[i+1] = 210; buf[i+2] = 255; buf[i+3] = 255;
    }
  }
}

// ── PNG encode (pure built-ins) ───────────────────────────────────────────────
function crc32(data) {
  let c = 0xffffffff;
  for (const b of data) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c>>>1)^0xedb88320 : c>>>1; }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const d = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const len = Buffer.allocUnsafe(4); len.writeUInt32BE(d.length);
  const crcBuf = Buffer.allocUnsafe(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, d])));
  return Buffer.concat([len, t, d, crcBuf]);
}

const ihdr = Buffer.allocUnsafe(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8]=8; ihdr[9]=6; ihdr[10]=0; ihdr[11]=0; ihdr[12]=0; // 8-bit RGBA

// Scanlines: filter byte 0 + raw pixels
const rows = Buffer.allocUnsafe(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  rows[y * (1 + SIZE*4)] = 0;
  rows.set(new Uint8Array(buf.buffer, y*SIZE*4, SIZE*4), y*(1+SIZE*4)+1);
}

const pngFile = Buffer.concat([
  Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]),
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', deflateSync(rows, { level: 6 })),
  pngChunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(join(__dirname, '..', 'build'), { recursive: true });
writeFileSync(OUT, pngFile);
console.log('[gen-icon] wrote build/icon.png (' + SIZE + 'x' + SIZE + ')');
