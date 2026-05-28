<script setup>
import { ref, watch } from "vue";
import { useSettingsStore } from "../stores/settings.js";
import { useConnectionStore } from "../stores/connection.js";
import { KNOWN_SERVICES } from "../transports/BleTransport.js";
import { alertAudio } from "../utils/AlertAudio.js";

const settings = useSettingsStore();
const conn = useConnectionStore();
const tab = ref("sensors");

function applyBlePreset(key) {
  if (!key || key === "custom") return;
  const p = KNOWN_SERVICES[key];
  if (!p) return;
  settings.ble.serviceUuid = p.service;
  settings.ble.customNotifyUuid = p.notify;
}

const SENSOR_LABELS = {
  armTimer:      "Arm Timer",
  rssi:          "LINK · LQ / RSSI / TX Pwr",
  voltage:       "POWER · Voltage",
  percent:       "Battery %",
  distance:      "Distance from Home",
  altitude:      "Altitude",
  groundSpeed:   "Ground Speed",
  verticalSpeed: "Vertical Speed",
  satellites:    "GPS Card",
  current:       "Current draw",
};

const tabs = [
  { id: "sensors", label: "Sensors" },
  { id: "interface", label: "Interface" },
  { id: "units", label: "Units" },
  { id: "map", label: "Map" },
  { id: "alerts", label: "Alerts" },
  { id: "protocol", label: "Protocol" },
];

watch(
  () => settings.$state,
  () => settings.save(),
  { deep: true }
);
</script>

<template>
  <div class="flex-1 flex flex-col p-5 gap-4 max-w-4xl mx-auto w-full">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold tracking-wide text-hud-text">Settings</h1>
        <p class="text-[11px] text-hud-mute mt-0.5 tracking-wide">Configure your ground station preferences</p>
      </div>
      <router-link to="/" class="btn">← Dashboard</router-link>
    </div>

    <div class="panel flex flex-col flex-1 overflow-hidden">
      <!-- Pill tab bar — GCS v3 style -->
      <div class="flex gap-1 p-1.5 mx-4 mt-4 mb-0 rounded-lg" style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.07)">
        <button
          v-for="t in tabs"
          :key="t.id"
          class="flex-1 h-8 rounded-md text-[11px] font-semibold tracking-[0.1em] uppercase transition-all duration-150 cursor-pointer"
          :class="tab === t.id
            ? 'text-hud-text'
            : 'text-hud-mute hover:text-hud-text'"
          :style="tab === t.id
            ? 'background: linear-gradient(180deg, rgba(167,139,250,0.22), rgba(167,139,250,0.08)); box-shadow: inset 0 0 0 1px rgba(167,139,250,0.35), 0 0 14px -4px rgba(167,139,250,0.4)'
            : ''"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <div class="p-5 overflow-auto">
        <!-- SENSORS -->
        <section v-if="tab === 'sensors'" class="space-y-5">
          <p class="text-sm text-hud-mute">Toggle individual widgets and cards on the dashboard.</p>

          <!-- Top bar cells -->
          <div>
            <div class="stat-label mb-3">Top Bar</div>
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="k in ['armTimer','rssi','voltage','percent']" :key="k"
                class="flex items-center gap-2.5 panel-tight px-3 py-2.5 cursor-pointer select-none hover:border-hud-accent/30 transition-colors"
              >
                <input v-model="settings.visibleSensors[k]" type="checkbox" class="accent-hud-accent shrink-0 w-3.5 h-3.5" />
                <span class="text-sm leading-tight text-hud-text">{{ SENSOR_LABELS[k] }}</span>
              </label>
            </div>
          </div>

          <!-- Bottom-left panel stats -->
          <div>
            <div class="stat-label mb-3">Bottom Panel</div>
            <div class="grid grid-cols-2 gap-2">
              <label
                v-for="k in ['altitude','distance','groundSpeed','verticalSpeed']" :key="k"
                class="flex items-center gap-2.5 panel-tight px-3 py-2.5 cursor-pointer select-none hover:border-hud-accent/30 transition-colors"
              >
                <input v-model="settings.visibleSensors[k]" type="checkbox" class="accent-hud-accent shrink-0 w-3.5 h-3.5" />
                <span class="text-sm leading-tight text-hud-text">{{ SENSOR_LABELS[k] }}</span>
              </label>
            </div>
          </div>

          <!-- Right-panel info cards — each row = one card -->
          <div>
            <div class="stat-label mb-3">Right Panel Cards</div>
            <div class="space-y-2">

              <!-- LINK card -->
              <div class="panel-tight px-3 py-2.5">
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input v-model="settings.visibleSensors.rssi" type="checkbox" class="accent-hud-accent shrink-0" />
                  <span class="text-sm font-medium">LINK Card</span>
                  <span class="text-xs text-hud-mute ml-1">LQ · RSSI · SNR · TX Power</span>
                </label>
              </div>

              <!-- POWER card — two sub-toggles -->
              <div class="panel-tight px-3 py-2.5 space-y-1.5">
                <div class="text-sm font-medium text-hud-text">POWER Card</div>
                <div class="flex flex-wrap gap-x-4 gap-y-1 pl-1">
                  <label class="flex items-center gap-1.5 cursor-pointer select-none">
                    <input v-model="settings.visibleSensors.voltage" type="checkbox" class="accent-hud-accent shrink-0" />
                    <span class="text-sm text-hud-mute">Voltage / % / Per-cell</span>
                  </label>
                  <label class="flex items-center gap-1.5 cursor-pointer select-none">
                    <input v-model="settings.visibleSensors.current" type="checkbox" class="accent-hud-accent shrink-0" />
                    <span class="text-sm text-hud-mute">Current draw</span>
                  </label>
                </div>
                <p v-if="!settings.visibleSensors.voltage && !settings.visibleSensors.current"
                   class="text-[11px] text-hud-warn pl-1">Both off — card will be hidden.</p>
              </div>


              <!-- GPS card -->
              <div class="panel-tight px-3 py-2.5">
                <label class="flex items-center gap-2 cursor-pointer select-none">
                  <input v-model="settings.visibleSensors.satellites" type="checkbox" class="accent-hud-accent shrink-0" />
                  <span class="text-sm font-medium">GPS Card</span>
                  <span class="text-xs text-hud-mute ml-1">Satellites · HDOP · Position</span>
                </label>
              </div>

            </div>
          </div>
        </section>

        <!-- INTERFACE -->
        <section v-if="tab === 'interface'" class="space-y-4">
          <div>
            <div class="stat-label mb-1">USB / Web Serial</div>
            <label class="flex items-center gap-2 text-sm">
              Baud rate
              <select v-model.number="settings.serial.baudRate" class="settings-input">
                <option :value="115200">115200</option>
                <option :value="230400">230400</option>
                <option :value="250000">250000 (CRSF)</option>
                <option :value="420000">420000 (CRSF default)</option>
                <option :value="921600">921600</option>
              </select>
            </label>
          </div>
          <div>
            <div class="stat-label mb-1">Bluetooth (BLE)</div>
            <label class="flex items-center gap-2 text-sm">
              Discovery
              <select
                v-model="settings.ble.discoveryMode"
                class="settings-input"
              >
                <option value="acceptAll">Show all devices</option>
                <option value="namePrefix">Filter by name prefix</option>
                <option value="service">Filter by service UUID</option>
              </select>
            </label>
            <label
              v-if="settings.ble.discoveryMode === 'namePrefix'"
              class="flex items-center gap-2 text-sm mt-2"
            >
              Name prefix
              <input
                v-model="settings.ble.namePrefix"
                placeholder="e.g. ELRS_"
                class="settings-input w-48"
              />
            </label>
            <div v-if="settings.ble.discoveryMode === 'service'" class="space-y-2 mt-2">
              <label class="flex items-center gap-2 text-sm">
                Preset
                <select
                  class="settings-input"
                  @change="applyBlePreset($event.target.value)"
                >
                  <option value="">— pick one —</option>
                  <option value="nus">Nordic UART / HM-11 / NRF (NUS)</option>
                  <option value="hm10esp32">HM-10 / ESP32 (0xffe0 svc, 0xffe1 char)</option>
                  <option value="cc2541">CC2541 / BT-11 (0xffe0 svc, 0xffe2 notify)</option>
                  <option value="speedybeeV2">SpeedyBee V2</option>
                  <option value="speedybeeV1">SpeedyBee V1</option>
                  <option value="dronebridge">DroneBridge</option>
                  <option value="rn487">Microchip RN487x</option>
                  <option value="custom">Custom…</option>
                </select>
              </label>
              <label class="flex items-center gap-2 text-sm">
                Service UUID
                <input
                  v-model="settings.ble.serviceUuid"
                  placeholder="0000ffe0-…"
                  class="settings-input w-80"
                />
              </label>
              <label class="flex items-center gap-2 text-sm">
                Notify char UUID
                <input
                  v-model="settings.ble.customNotifyUuid"
                  placeholder="(optional — auto-detected)"
                  class="settings-input w-80"
                />
              </label>
            </div>
            <p class="text-xs text-hud-mute mt-2">
              "Show all devices" scans for any device advertising a known drone
              BLE service (NUS, HM-10, SpeedyBee, etc.). If your module uses a
              custom UUID not in that list, use "Filter by service UUID" instead
              and enter the UUID from the module's datasheet.
            </p>
          </div>
          <div>
            <div class="stat-label mb-1">Wi-Fi (UDP via WebSocket bridge)</div>
            <div class="flex items-center gap-2 text-sm">
              <input v-model="settings.udp.url" class="settings-input w-72" />
              <span>port</span>
              <input v-model.number="settings.udp.listenPort" type="number" class="settings-input w-24" />
            </div>
            <p class="text-xs text-hud-mute mt-1">
              Browsers cannot open raw UDP — run a small Node bridge that forwards UDP &lt;-&gt; WebSocket.
            </p>
          </div>
        </section>

        <!-- UNITS -->
        <section v-if="tab === 'units'" class="space-y-3">
          <label class="flex items-center gap-2 text-sm">
            <input v-model="settings.units" type="radio" value="metric" class="accent-hud-accent" />
            Metric (m, km/h, °C)
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="settings.units" type="radio" value="imperial" class="accent-hud-accent" />
            Imperial (ft, mph, °F)
          </label>
        </section>

        <!-- MAP -->
        <section v-if="tab === 'map'" class="space-y-3">
          <label class="flex items-center gap-2 text-sm">
            Style
            <select v-model="settings.map.style" class="settings-input">
              <option value="osm">OpenStreetMap</option>
              <option value="satellite">Satellite (Esri)</option>
            </select>
            <span class="text-xs text-hud-mute ml-2">(reload page to apply)</span>
          </label>
          <label class="flex items-center gap-2 text-sm">
            Drone icon
            <select v-model="settings.map.droneIcon" class="settings-input">
              <option value="plane">Plane / Fixed-wing</option>
              <option value="quad">Quadcopter (X-frame)</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="settings.map.showTrail" type="checkbox" class="accent-hud-accent" />
            Show flight trail
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="settings.map.centerOnDrone" type="checkbox" class="accent-hud-accent" />
            Auto-center on drone
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="settings.map.autoSetHome" type="checkbox" class="accent-hud-accent" />
            Auto set home on arm
            <span class="text-xs text-hud-mute">(re-sets every arm; manual override always available)</span>
          </label>
        </section>

        <!-- ALERTS -->
        <section v-if="tab === 'alerts'" class="space-y-3">
          <div class="stat-label mb-1">Audio</div>
          <label class="flex items-center gap-2 text-sm">
            <input v-model="settings.alerts.audioEnabled" type="checkbox" class="accent-hud-accent" />
            Enable alert sounds
            <span class="text-xs text-hud-mute">(synthesized beeps — no files required)</span>
          </label>
          <div v-if="settings.alerts.audioEnabled" class="flex flex-wrap gap-2 mt-1">
            <button class="btn text-xs" @click="alertAudio.arm()">▶ Armed</button>
            <button class="btn text-xs" @click="alertAudio.homeSet()">▶ Home set</button>
            <button class="btn text-xs" @click="alertAudio.lowVoltage()">▶ Low voltage</button>
            <button class="btn text-xs" @click="alertAudio.criticalVoltage()">▶ Critical</button>
            <button class="btn text-xs" @click="alertAudio.signalLoss()">▶ Signal loss</button>
            <button class="btn text-xs" @click="alertAudio.failsafe()">▶ Failsafe</button>
          </div>
          <div class="stat-label mb-1 mt-4">Voltage Alerts</div>
          <label class="flex items-center gap-2 text-sm">
            Low voltage warning (V)
            <input v-model.number="settings.alerts.lowVoltage" type="number" step="0.1" class="settings-input w-24" />
          </label>
          <label class="flex items-center gap-2 text-sm">
            Critical voltage (V)
            <input v-model.number="settings.alerts.criticalVoltage" type="number" step="0.1" class="settings-input w-24" />
          </label>
          <label class="flex items-center gap-2 text-sm">
            Signal-loss LQ threshold (%)
            <input v-model.number="settings.alerts.signalLoss" type="number" class="settings-input w-24" />
          </label>
          <div class="stat-label mb-1 mt-4">Battery Pack</div>
          <label class="flex items-center gap-2 text-sm">
            Cell count override
            <input
              :value="settings.pack?.cellsOverride ?? ''"
              type="number"
              min="1" max="12" placeholder="auto" class="settings-input w-24"
              @input="e => { const n = parseInt(e.target.value); settings.pack.cellsOverride = isNaN(n) || n < 1 ? null : Math.min(12, n); }"
            />
            <span class="text-xs text-hud-mute">cells (blank = auto-detect from first voltage)</span>
          </label>
          <label class="flex items-center gap-2 text-sm">
            Total capacity (mAh)
            <input
              :value="settings.pack?.totalCapacity ?? ''"
              type="number"
              min="0" step="100" placeholder="unknown" class="settings-input w-24"
              @input="e => { const n = parseInt(e.target.value); settings.pack.totalCapacity = isNaN(n) || n <= 0 ? null : n; }"
            />
            <span class="text-xs text-hud-mute">enables % fraction + time-remaining estimate</span>
          </label>
          <label class="flex items-center gap-2 text-sm">
            Chemistry
            <select v-model="settings.pack.chemistry" class="settings-input">
              <option value="LI-PO">LiPo</option>
              <option value="LI-ION">Li-Ion</option>
              <option value="LI-FE">LiFePO4</option>
              <option value="NIMH">NiMH</option>
            </select>
          </label>
          <label class="flex items-center gap-2 text-sm">
            Max cell voltage (V)
            <input
              v-model.number="settings.pack.maxCellVoltage"
              type="number" min="1" max="5" step="0.05"
              class="settings-input w-24"
            />
            <span class="text-xs text-hud-mute">full-charge V/cell — used for cell-count detection (default 4.2)</span>
          </label>
        </section>

        <!-- PROTOCOL STATUS -->
        <section v-if="tab === 'protocol'" class="space-y-3">
          <div class="panel-tight p-4">
            <div class="stat-label mb-2">Detection state</div>
            <div class="text-sm font-mono text-hud-text">{{ conn.detectState }}</div>
            <div class="text-sm font-mono text-hud-text">protocol: {{ conn.protocol ?? "—" }}</div>
          </div>
          <div class="panel-tight p-4">
            <div class="stat-label mb-3">Frame validation scores</div>
            <div v-for="(v, k) in conn.detectScores" :key="k" class="flex items-center gap-2 mt-2">
              <span class="w-16 text-xs uppercase text-hud-mute font-mono">{{ k }}</span>
              <div class="flex-1 h-1.5 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.05)">
                <div
                  class="bar-accent"
                  :style="{ width: Math.min(100, v * 25) + '%' }"
                />
              </div>
              <span class="text-xs font-mono w-6 text-right text-hud-mute tabular-nums">{{ v }}</span>
            </div>
          </div>
          <div class="panel-tight p-4 text-xs text-hud-mute">
            Bytes received: <span class="text-hud-text font-mono">{{ conn.bytesIn }}</span>
            · Frames decoded: <span class="text-hud-text font-mono">{{ conn.framesIn }}</span>
          </div>
        </section>

        <div class="mt-8 pt-4 flex justify-end" style="border-top: 1px solid rgba(255,255,255,0.06)">
          <button class="btn text-hud-danger hover:!border-hud-danger/40" @click="settings.resetDefaults()">Reset to defaults</button>
        </div>
      </div>
    </div>
  </div>
</template>
