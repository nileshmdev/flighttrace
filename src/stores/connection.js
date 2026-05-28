// Connection store: owns the active transport + protocol detector.
// Routes raw bytes -> detector -> telemetry store.

import { defineStore } from "pinia";
import { createTransport, transportSupported, transportUnavailableReason, TRANSPORTS } from "../transports";
import { ProtocolDetector } from "../protocols/ProtocolDetector.js";
import { useTelemetryStore } from "./telemetry.js";
import { telemetryLogger } from "../utils/TelemetryLogger.js";
import { createLogger } from "../utils/logger.js";

const log = createLogger("MAVLink");
import { buildHeartbeat, requestMavlinkStreams } from "../protocols/mavlinkSend.js";

// Web Serial / Web Bluetooth throw NotFoundError when the user dismisses the
// device chooser. Treat that as "no-op", not an error.
function isCancellation(e) {
  if (!e) return false;
  if (e.name === "NotFoundError" || e.name === "AbortError") return true;
  const m = (e.message || "").toLowerCase();
  return m.includes("cancel") || m.includes("user denied") || m.includes("no port selected");
}

export const useConnectionStore = defineStore("connection", {
  state: () => ({
    interface: "usb",        // 'usb' | 'ble' | 'udp'
    status: "disconnected",  // 'disconnected' | 'connecting' | 'connected'
    error: null,             // transient — cleared after a few seconds or by user
    detectState: "idle",     // 'idle' | 'scoring' | 'locked' | 'timeout'
    detectScores: { crsf: 0, mavlink: 0, ltm: 0 },
    protocol: null,          // 'crsf' | 'mavlink' | 'ltm' | null
    bytesIn: 0,
    framesIn: 0,
    lastByteAt: 0,
    deviceLabel: null, // set after transport connect, e.g. "USB · CP210x"
  }),
  getters: {
    available() {
      return Object.fromEntries(
        Object.keys(TRANSPORTS).map((k) => [k, transportSupported(k)])
      );
    },
    unavailableReasons() {
      return Object.fromEntries(
        Object.keys(TRANSPORTS).map((k) => [k, transportUnavailableReason(k)])
      );
    },
  },
  actions: {
    async connect(options = {}) {
      if (this.status === "connecting" || this.status === "connected") return;
      this.status = "connecting";
      this.error = null;
      this.detectState = "scoring";
      this.protocol = null;
      this.detectScores = { crsf: 0, mavlink: 0, ltm: 0 };
      this.bytesIn = 0;
      this.framesIn = 0;

      const telemetry = useTelemetryStore();
      const detector = new ProtocolDetector((evt, data) => {
        if (evt === "__detect__") {
          this.detectState = data.state;
          if (data.scores) this.detectScores = data.scores;
          if (data.protocol) {
            this.protocol = data.protocol;
            telemetryLogger.start(data.protocol, this.interface);
            if (data.protocol === "mavlink") this._startMavlinkGcs();
          }
          return;
        }
        this.framesIn++;
        telemetry.apply(evt, data);
        telemetryLogger.record(telemetry.$state);
      });
      this._detector = detector;

      let t;
      try {
        t = createTransport(this.interface);
        t.onData = (chunk) => {
          this.bytesIn += chunk.length;
          this.lastByteAt = Date.now();
          detector.feed(chunk);
        };
        t.onClose = (err) => {
          if (err && this.status === "connected") this.error = err.message || String(err);
          this._transport = null;
          this._detector = null;
          this.status = "disconnected";
          this.detectState = "idle";
          this.deviceLabel = null;
          this.protocol = null;
          // Auto-save buffered telemetry on unexpected disconnect
          telemetryLogger.stop();
        };
        await t.connect(options);
        this._transport = t;
        this.deviceLabel = t.label ?? null;
        this.status = "connected";
        // Note: telemetryLogger.start() is called from the detector callback
        // above when a protocol is detected — calling it again here would
        // reset the buffer and lose data already recorded.
      } catch (e) {
        // Best-effort tear-down of any half-open transport (e.g. BLE GATT
        // connected but no notify char found).
        try { await t?.disconnect?.(); } catch {}
        this._transport = null;
        this._detector = null;
        this.detectState = "idle";
        this.status = "disconnected";
        if (!isCancellation(e)) {
          this.error = e?.message || String(e);
          // Auto-clear after a few seconds so the UI doesn't stay noisy.
          setTimeout(() => {
            if (this.error === (e?.message || String(e))) this.error = null;
          }, 6000);
        }
      }
    },

    _startMavlinkGcs() {
      const hasSend = typeof this._transport?.send === "function";
      log.debug("GCS init — transport.send=%s interface=%s", hasSend, this.interface);
      const send = (chunk) => {
        if (this._transport?.send) {
          this._transport.send(chunk);
        } else {
          log.warn("send() not available on transport");
        }
      };
      // Request the streams ArduPilot won't push by default (battery, RC/RSSI)
      requestMavlinkStreams(send);
      log.debug("stream requests sent for EXTENDED_STATUS(2) + RC_CHANNELS(3)");
      // Periodic heartbeat keeps the FC streaming to this GCS IP:port
      clearInterval(this._hbTimer);
      this._hbTimer = setInterval(() => {
        if (this.status === "connected") send(buildHeartbeat());
      }, 1000);
    },

    async disconnect() {
      clearInterval(this._hbTimer);
      this._hbTimer = null;
      if (this._transport) {
        try { await this._transport.disconnect(); } catch {}
        this._transport = null;
      }
      this._detector = null;
      this.status = "disconnected";
      this.detectState = "idle";
      this.deviceLabel = null;
      this.protocol = null;
      // Auto-download the buffered log, then clear it so the next session starts fresh
      telemetryLogger.stop();
    },

    clearError() {
      this.error = null;
    },
  },
});
