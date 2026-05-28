// Wi-Fi (UDP) transport via a WebSocket bridge.
// Browsers can't open raw UDP — see bridge/udp-bridge.js.

const CONNECT_TIMEOUT_MS = 4000;

export class UdpTransport {
  constructor() {
    this.ws = null;
    this.connected = false;
    this.onData = null;
    this.onClose = null;
    this.label = "WiFi";
  }

  static isSupported() {
    return typeof WebSocket !== "undefined";
  }

  async connect({ url = "ws://localhost:14555", listenPort = 14550 } = {}) {
    // On HTTPS the browser blocks ws:// (mixed content). Auto-route through
    // Vite's /ws-bridge proxy which forwards wss:// → ws://localhost:14555.
    if (typeof location !== "undefined" && location.protocol === "https:" && url.startsWith("ws://")) {
      url = `wss://${location.host}/ws-bridge`;
    }

    const fullUrl = `${url}?listen=${listenPort}`;

    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(fullUrl);
      } catch (e) {
        reject(new Error(`Bad WebSocket URL: ${fullUrl} (${e.message})`));
        return;
      }
      this.ws = ws;
      ws.binaryType = "arraybuffer";

      const timer = setTimeout(() => {
        try { ws.close(); } catch {}
        reject(
          new Error(
            `UDP bridge not reachable at ${fullUrl} after ${CONNECT_TIMEOUT_MS / 1000}s. ` +
            `Start it with: cd bridge && npm install && npm start`
          )
        );
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        clearTimeout(timer);
        this.connected = true;
        // "ws://host:port/path" → "host:port"
        this.label = `WiFi · ${url.replace(/^wss?:\/\//, "").split("/")[0] || "bridge"}`;
        resolve();
      };

      ws.onerror = () => {
        // The WebSocket spec gives no detail on errors. The most common cause
        // is the bridge not running. Resolve via onclose so we deliver one
        // useful message.
      };

      ws.onclose = (ev) => {
        clearTimeout(timer);
        if (!this.connected) {
          reject(
            new Error(
              `Couldn't connect to ${fullUrl} (code ${ev.code || "n/a"}). ` +
              `Most likely the UDP bridge isn't running. ` +
              `Start it: cd bridge && npm install && npm start`
            )
          );
        } else {
          this.connected = false;
          if (this.onClose) this.onClose();
        }
      };

      ws.onmessage = (ev) => {
        if (this.onData && ev.data instanceof ArrayBuffer) {
          this.onData(new Uint8Array(ev.data));
        }
      };
    });
  }

  send(chunk) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(chunk);
  }

  async disconnect() {
    this.connected = false;
    try { if (this.ws) this.ws.close(); } catch {}
    this.ws = null;
    if (this.onClose) this.onClose();
  }
}
