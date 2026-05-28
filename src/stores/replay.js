// Replay store — loads a telemetry CSV, drives playback into the telemetry store.
// Timing is wall-clock based so speed changes are handled by re-anchoring.

import { defineStore } from "pinia";
import { useTelemetryStore } from "./telemetry.js";

const TRAIL_MAX = 2000;

// ── CSV helpers ──────────────────────────────────────────────────────────────

function parseCsvLine(line) {
  const vals = [];
  let cur = "", inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === "," && !inQ) {
      vals.push(cur); cur = "";
    } else {
      cur += c;
    }
  }
  vals.push(cur);
  return vals;
}

// Fields stored as booleans in the CSV ("1" or "0")
const BOOL_FIELDS = new Set(["armed", "failsafe"]);
// Fields stored as JSON-encoded arrays
const ARRAY_FIELDS = new Set(["rcChannels"]);
// Fields stored as raw strings (no Number() coercion)
const STRING_FIELDS = new Set(["flightMode"]);

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1)
    .filter((l) => l.trim())
    .map((line) => {
      const vals = parseCsvLine(line);
      const obj = {};
      headers.forEach((h, i) => {
        const v = (vals[i] ?? "").trim();
        if (h === "time") { obj[h] = new Date(v).getTime(); return; }
        if (v === "") { obj[h] = null; return; }
        if (BOOL_FIELDS.has(h)) { obj[h] = v === "1"; return; }
        if (ARRAY_FIELDS.has(h)) {
          try { obj[h] = JSON.parse(v); } catch { obj[h] = null; }
          return;
        }
        if (STRING_FIELDS.has(h)) { obj[h] = v || null; return; }
        const n = Number(v);
        obj[h] = isNaN(n) ? v : n;
      });
      return obj;
    })
    .filter((r) => r.time != null && !isNaN(r.time));
}

function fmtMs(ms) {
  if (!ms || ms < 0) return "00:00";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ── Module-level playback state (non-reactive internals) ─────────────────────

let _timer = null;
let _startWallTime = 0;
let _startRowTime = 0;
let _lastSpeed = 1;

// ── Store ────────────────────────────────────────────────────────────────────

export const useReplayStore = defineStore("replay", {
  state: () => ({
    status: "idle",   // 'idle' | 'playing' | 'paused' | 'done'
    rows: [],
    cursor: 0,
    filename: null,
    speed: 1,         // playback speed multiplier
    error: null,
  }),

  getters: {
    totalDuration(s) {
      if (s.rows.length < 2) return 0;
      return s.rows[s.rows.length - 1].time - s.rows[0].time;
    },
    progress(s) {
      const dur = s.rows.length > 1
        ? s.rows[s.rows.length - 1].time - s.rows[0].time : 0;
      if (!dur) return 0;
      const idx = Math.min(s.cursor, s.rows.length - 1);
      return (s.rows[idx].time - s.rows[0].time) / dur;
    },
    currentTimeStr(s) {
      if (!s.rows.length) return "00:00";
      const idx = Math.min(s.cursor, s.rows.length - 1);
      return fmtMs(s.rows[idx].time - s.rows[0].time);
    },
    totalTimeStr(s) {
      return fmtMs(s.rows.length > 1
        ? s.rows[s.rows.length - 1].time - s.rows[0].time : 0);
    },
  },

  actions: {
    async loadFile(file) {
      this.error = null;
      try {
        const text = await file.text();
        const rows = parseCsv(text);
        if (!rows.length) throw new Error("No valid rows found in the CSV file.");
        this.rows = rows;
        this.cursor = 0;
        this.filename = file.name;
        this.speed = 1;
        this.status = "paused";
        // Initialise display with first frame
        const telemetry = useTelemetryStore();
        telemetry.reset();
        telemetry.applySnapshot(rows[0]);
      } catch (e) {
        this.error = e.message || String(e);
        throw e;
      }
    },

    play() {
      if (!this.rows.length) return;
      if (this.status === "done") {
        // Restart from beginning
        const telemetry = useTelemetryStore();
        telemetry.reset();
        this.cursor = 0;
        telemetry.applySnapshot(this.rows[0]);
      }
      this.status = "playing";
      _startWallTime = Date.now();
      _startRowTime = this.rows[this.cursor]?.time ?? 0;
      _lastSpeed = this.speed;
      clearInterval(_timer);
      _timer = setInterval(() => this._tick(), 150);
    },

    pause() {
      clearInterval(_timer);
      _timer = null;
      if (this.status === "playing") this.status = "paused";
    },

    stop() {
      clearInterval(_timer);
      _timer = null;
      this.rows = [];
      this.cursor = 0;
      this.filename = null;
      this.error = null;
      this.status = "idle";
      const telemetry = useTelemetryStore();
      telemetry.reset();
    },

    // pct: 0.0 – 1.0
    seekTo(pct) {
      if (!this.rows.length) return;
      const wasPlaying = this.status === "playing";
      clearInterval(_timer);
      _timer = null;

      const targetTime = this.rows[0].time + pct * this.totalDuration;
      let idx = this.rows.findIndex((r) => r.time >= targetTime);
      if (idx < 0) idx = this.rows.length - 1;
      this.cursor = idx;

      // Rebuild telemetry: apply final snapshot + reconstructed trail in one call
      const trail = this.rows
        .slice(0, idx + 1)
        .filter((r) => r.lat != null && r.lon != null)
        .map((r) => [r.lon, r.lat])
        .slice(-TRAIL_MAX);

      const telemetry = useTelemetryStore();
      telemetry.applySeek(this.rows[idx], trail);

      _startWallTime = Date.now();
      _startRowTime = this.rows[idx]?.time ?? this.rows[0].time;
      _lastSpeed = this.speed;

      if (wasPlaying) {
        this.status = "playing";
        _timer = setInterval(() => this._tick(), 150);
      } else {
        this.status = idx >= this.rows.length - 1 ? "done" : "paused";
      }
    },

    _tick() {
      if (!this.rows.length) return;

      // Re-anchor timing when speed is changed mid-play
      if (this.speed !== _lastSpeed) {
        _startRowTime = this.rows[Math.min(this.cursor, this.rows.length - 1)]?.time ?? _startRowTime;
        _startWallTime = Date.now();
        _lastSpeed = this.speed;
      }

      const elapsed = (Date.now() - _startWallTime) * this.speed;
      const targetTime = _startRowTime + elapsed;
      const telemetry = useTelemetryStore();

      while (this.cursor < this.rows.length && this.rows[this.cursor].time <= targetTime) {
        telemetry.applySnapshot(this.rows[this.cursor]);
        this.cursor++;
      }

      if (this.cursor >= this.rows.length) {
        clearInterval(_timer);
        _timer = null;
        this.status = "done";
      }
    },
  },
});
