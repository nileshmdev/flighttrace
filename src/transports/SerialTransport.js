// Web Serial API transport. Browser support: Chrome/Edge (desktop).
// Requires user gesture to call requestPort().

// USB-to-serial chip vendors commonly found in RC / drone hardware.
// Passing these as filters restricts the browser picker to USB-backed
// devices, which hides Linux's native /dev/ttyS* UARTs (not USB, so no
// vendorId — they're filtered out automatically).
const USB_SERIAL_FILTERS = [
  { usbVendorId: 0x0403 }, // FTDI (FT232/FT2232 — TBS Crossfire, FrSky, many FCs)
  { usbVendorId: 0x10c4 }, // Silicon Labs CP210x (ELRS, Happymodel, RadioMaster)
  { usbVendorId: 0x1a86 }, // WCH CH340/CH341/CH9102 (clones, ESP32 dev boards)
  { usbVendorId: 0x067b }, // Prolific PL2303
  { usbVendorId: 0x04d8 }, // Microchip MCP2200
  { usbVendorId: 0x2341 }, // Arduino ATmega16U2/32U4
  { usbVendorId: 0x2e8a }, // Raspberry Pi Pico / RP2040 USB CDC
  { usbVendorId: 0x303a }, // Espressif ESP32-S/C native USB CDC
  { usbVendorId: 0x239a }, // Adafruit
  { usbVendorId: 0x0483 }, // STMicroelectronics (Betaflight/iNav FC native USB CDC)
  { usbVendorId: 0x26ac }, // 3DR / Holybro / mRo (PX4 FMU)
  { usbVendorId: 0x1209 }, // Generic OSHW USB
];

const USB_VENDOR_NAMES = {
  0x0403: "FTDI",
  0x10c4: "CP210x",
  0x1a86: "CH340",
  0x067b: "PL2303",
  0x04d8: "MCP2200",
  0x2341: "Arduino",
  0x2e8a: "RP2040",
  0x303a: "ESP32",
  0x239a: "Adafruit",
  0x0483: "STM32",
  0x26ac: "PX4",
  0x1209: "USB CDC",
};

export class SerialTransport {
  constructor() {
    this.port = null;
    this.reader = null;
    this.readLoop = null;
    this.onData = null;
    this.onClose = null;
    this.connected = false;
    this.label = "USB";
  }

  static isSupported() {
    return typeof navigator !== "undefined" && "serial" in navigator;
  }

  async connect({ baudRate = 420000 } = {}) {
    if (!SerialTransport.isSupported()) {
      throw new Error("Web Serial API not supported in this browser. Use Chrome or Edge desktop.");
    }
    this.port = await navigator.serial.requestPort({ filters: USB_SERIAL_FILTERS });
    await this.port.open({ baudRate, bufferSize: 4096 });
    const info = this.port.getInfo?.() ?? {};
    const vendorName =
      USB_VENDOR_NAMES[info.usbVendorId] ??
      (info.usbVendorId != null
        ? info.usbVendorId.toString(16).padStart(4, "0").toUpperCase()
        : "Serial");
    this.label = `USB · ${vendorName}`;
    this.connected = true;
    this.readLoop = this._read();
  }

  async _read() {
    while (this.port?.readable && this.connected) {
      this.reader = this.port.readable.getReader();
      try {
        while (true) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && this.onData) this.onData(value);
        }
      } catch (err) {
        // Read error — surface and exit.
        if (this.onClose) this.onClose(err);
        break;
      } finally {
        try { this.reader.releaseLock(); } catch {}
        this.reader = null;
      }
    }
  }

  async send(chunk) {
    if (!this.port?.writable) return;
    const writer = this.port.writable.getWriter();
    try { await writer.write(chunk); } finally { writer.releaseLock(); }
  }

  async disconnect() {
    this.connected = false;
    try {
      if (this.reader) await this.reader.cancel();
    } catch {}
    try {
      if (this.port) await this.port.close();
    } catch {}
    this.port = null;
    if (this.onClose) this.onClose();
  }
}
