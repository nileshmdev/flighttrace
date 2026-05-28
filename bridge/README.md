# UDP ↔ WebSocket Bridge

Browsers cannot open raw UDP sockets. This tiny Node service listens for
UDP telemetry (e.g. MAVLink over Wi-Fi from an ESP32 / SiK / DroneBridge / TX-side
WFB) and forwards it to the web app over a WebSocket.

## Run

```bash
cd bridge
npm install
npm start
# or with custom ports:
node udp-bridge.js --ws=14555 --udp=14550
```

Then in the web app's **Settings → Interface**:

- URL: `ws://localhost:14555`
- Listen port: `14550`

## How it works

1. Bridge binds UDP `0.0.0.0:14550` and WebSocket `0.0.0.0:14555`.
2. Each incoming UDP datagram is forwarded as a binary WS frame to all
   connected browser clients.
3. Binary WS frames from the browser are sent back to the most-recent UDP
   sender (so command upstream works once the drone has sent at least one
   packet).

## Test it

Send a fake datagram with `nc`:

```bash
echo -n -e '\xfe\x09\x00\x01\x01\x00...' | nc -u -w0 localhost 14550
```

Or check the status page in a browser: `http://localhost:14555/`
