// UDP <-> WebSocket bridge for browser telemetry clients.
//
// Browsers can't open raw UDP sockets, so this small bridge:
//   - listens on a UDP port for incoming datagrams (telemetry from drone)
//   - accepts WebSocket clients
//   - forwards each UDP datagram to every connected WS client as a binary frame
//   - forwards binary frames from WS clients back out as UDP datagrams to the
//     last-seen sender (so the browser can send commands upstream)
//
// Usage:
//   node udp-bridge.js [--ws=14555] [--udp=14550] [--host=0.0.0.0]
//
// Browser connects to:  ws://localhost:14555?listen=14550

import dgram from "node:dgram";
import http from "node:http";
import { WebSocketServer } from "ws";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  })
);

const WS_PORT = Number(args.ws ?? 14555);
const UDP_PORT = Number(args.udp ?? 14550);
const HOST = args.host ?? "0.0.0.0";

const udp = dgram.createSocket("udp4");
let lastRemote = null; // { address, port } — most recent UDP sender

udp.on("error", (err) => {
  console.error("[udp] error:", err.message);
});

udp.on("message", (msg, rinfo) => {
  lastRemote = { address: rinfo.address, port: rinfo.port };
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(msg);
  }
});

udp.on("listening", () => {
  const a = udp.address();
  console.log(`[udp] listening on ${a.address}:${a.port}`);
});

udp.bind(UDP_PORT, HOST);

const server = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end(
    `Telemetry UDP bridge\n` +
      `WS port: ${WS_PORT}\n` +
      `UDP port: ${UDP_PORT}\n` +
      `Last UDP sender: ${
        lastRemote ? `${lastRemote.address}:${lastRemote.port}` : "(none yet)"
      }\n`
  );
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws, req) => {
  console.log(`[ws] client connected (${wss.clients.size} total) from ${req.socket.remoteAddress}`);
  ws.binaryType = "nodebuffer";
  ws.on("message", (data, isBinary) => {
    if (!isBinary || !lastRemote) return;
    udp.send(data, lastRemote.port, lastRemote.address, (err) => {
      if (err) console.error("[udp send]", err.message);
    });
  });
  ws.on("close", () => {
    console.log(`[ws] client disconnected (${wss.clients.size} total)`);
  });
});

server.listen(WS_PORT, () => {
  console.log(`[ws] listening on ws://localhost:${WS_PORT}`);
  console.log(`     browser: connect with ?listen=${UDP_PORT}`);
});

process.on("SIGINT", () => {
  console.log("\nshutting down…");
  udp.close();
  wss.close();
  server.close();
  process.exit(0);
});
