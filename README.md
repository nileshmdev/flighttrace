# FlightTrace

Real-time drone telemetry dashboard. Connect over **USB**, **Bluetooth LE**, or **Wi-Fi UDP** and get live flight data in your browser — no native app required.

> **⚠️ Disclaimer:** This tool was built for personal debugging and testing purposes. It may contain bugs or missing features. Use at your own risk.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Download

Grab the latest build from the [Releases page](../../releases):

| Platform | File |
|---|---|
| Linux | `FlightTrace-*.AppImage` |
| macOS | `FlightTrace-*.dmg` |
| Windows | `FlightTrace-*.exe` |

Or open the [web app](https://nileshmdev.github.io/flighttrace/#/) in Chrome / Edge.

---

## Supported Protocols

Auto-detected from the byte stream — no manual configuration needed.

- **CRSF** (TBS Crossfire / ExpressLRS)
- **MAVLink v1 / v2** (ArduPilot, PX4, iNav)
- **LTM** (Light Telemetry)

See the [Wiki](../../wiki/Supported-Protocols) for full frame and field details.

---

## Supported Hardware

> **Platform notes:**
> - **USB** — works in Chrome/Edge desktop browser and in the Electron app.
> - **Wi-Fi UDP** — requires the WebSocket bridge process; runs automatically inside the Electron app. Not available in the hosted web app.
> - **Bluetooth LE** — works in Chrome/Edge on Windows and macOS. **On Linux the browser web app does not support BLE** (most Chrome/Chromium builds on Linux strip Web Bluetooth); use the Electron app instead.

### USB (Web Serial)

Any flight controller or radio link module connected via USB serial (FTDI, CP210x, CH340, STM32, ESP32, RP2040, and others). Default baud rate `420000`, configurable in **Settings → Interface**.

### Bluetooth LE (Web Bluetooth)

Common BLE-to-serial adapters and radio link modules (Nordic UART, HM-10, SpeedyBee, DroneBridge, and others). If your device isn't found, enable **Show all devices** in **Settings → Interface**.

### Wi-Fi / UDP

Any flight controller that streams MAVLink, CRSF, or LTM over UDP (e.g. MAVLink over Wi-Fi via ESP-01, ESP32, or SiK radio telemetry). Default port `14550`. The WebSocket bridge runs automatically inside the Electron app; for browser use start `node bridge/udp-bridge.js`.

---

## Quick Start (local dev)

```bash
git clone <repo-url>
cd flighttrace
npm install
npm run dev        # Vite dev server + UDP bridge
```

Requires **Node.js 20.12+** and **Chrome / Edge** for USB and BLE.

---

## Documentation

Full setup guides, troubleshooting, and platform-specific notes are in the [Wiki](../../wiki):

- [Getting started](../../wiki/Getting-Started)
- [macOS setup & Bluetooth](../../wiki/macOS-Setup)
- [Troubleshooting](../../wiki/Troubleshooting)
- [Building from source](../../wiki/Building-From-Source)

---

## License

MIT — see [LICENSE](LICENSE).

FlightTrace is independent and not affiliated with TBS, ExpressLRS, ArduPilot, PX4, iNav, Betaflight, SpeedyBee, or any flight controller or radio vendor mentioned. Trademarks belong to their respective owners.
