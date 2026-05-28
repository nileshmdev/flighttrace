<script setup>
import { computed, ref, watchEffect, watch, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useConnectionStore } from "../stores/connection.js";
import { useSettingsStore } from "../stores/settings.js";
import { useReplayStore } from "../stores/replay.js";
import { fmtSeconds } from "../utils/units.js";

const APP_VERSION = __APP_VERSION__;
import { telemetryLogger } from "../utils/TelemetryLogger.js";
import { PROTOCOL_FIELDS } from "../protocols/ProtocolDetector.js";
import { TRANSPORTS } from "../transports";
import StatCell from "./StatCell.vue";

const telemetry = useTelemetryStore();
const conn = useConnectionStore();
const settings = useSettingsStore();
const replay = useReplayStore();
const sensors = computed(() => settings.visibleSensors);

const supports = (field) => {
  if (!conn.protocol) return true;
  return PROTOCOL_FIELDS[conn.protocol]?.has(field);
};

const gpsColor = computed(() => {
  const s = telemetry.satellites;
  if (s == null || s === 0) return "text-hud-mute";
  if (s < 6)  return "text-hud-danger";
  if (s < 10) return "text-hud-warn";
  return "text-hud-ok";
});

const gpsBars = computed(() => {
  const s = telemetry.satellites;
  if (!s) return 0;
  if (s < 4)  return 1;
  if (s < 7)  return 2;
  if (s < 10) return 3;
  return 4;
});

const lqColor = computed(() => {
  const lq = telemetry.uplinkLq;
  if (lq == null) return "text-hud-mute";
  if (lq < settings.alerts.signalLoss) return "text-hud-danger";
  if (lq < 50) return "text-hud-warn";
  return "text-hud-ok";
});

const lqBars = computed(() => {
  const lq = telemetry.uplinkLq;
  if (lq == null) return 0;
  if (lq < 25) return 1;
  if (lq < 50) return 2;
  if (lq < 75) return 3;
  return 4;
});

const battColor = computed(() => {
  const p = telemetry.percent;
  if (p == null) return "text-hud-mute";
  if (p < 20) return "text-hud-danger";
  if (p < 50) return "text-hud-warn";
  return "text-hud-ok";
});

const battPct = computed(() => Math.max(0, Math.min(1, (telemetry.percent ?? 0) / 100)));

// "25.2V (100%)" — falls back gracefully when one of the two is missing.
const battValue = computed(() => {
  const v = telemetry.voltage != null ? telemetry.voltage.toFixed(1) + "V" : null;
  const p = telemetry.percent != null ? Math.round(telemetry.percent) + "%" : null;
  if (v && p) return `${v} (${p})`;
  if (v) return v;
  if (p) return p;
  return "—";
});

// Protocol pretty label for the branding subtitle.
const protocolLabel = computed(() => {
  if (!conn.protocol) {
    if (conn.detectState === "scoring" && conn.status === "connected") return "DETECTING";
    return null;
  }
  if (conn.protocol === "mavlink") return `MAVLINK${telemetry.mavlinkVersion ? " V" + telemetry.mavlinkVersion : ""}`;
  return conn.protocol.toUpperCase();
});

// Single LINK pill — combines connection + detection + replay state.
const linkPill = computed(() => {
  if (replay.status !== "idle") return { label: "REPLAY", tone: "accent", pulse: replay.status === "playing" };
  if (conn.status === "connecting") return { label: "CONNECTING", tone: "warn", pulse: true };
  if (conn.status === "disconnected") return { label: "OFFLINE", tone: "mute" };
  if (conn.detectState === "scoring") return { label: "DETECTING", tone: "warn", pulse: true };
  return { label: "LINK", tone: "ok" };
});

const linkPillClass = computed(() => {
  const t = linkPill.value.tone;
  if (t === "ok") return "bg-hud-ok/20 text-hud-ok border-hud-ok/40";
  if (t === "warn") return "bg-hud-warn/20 text-hud-warn border-hud-warn/40";
  if (t === "accent") return "bg-hud-accent/20 text-hud-accent border-hud-accent/40";
  return "bg-hud-mute/10 text-hud-mute border-hud-border";
});

// STATE cell — armed / disarmed / offline with a coloured dot.
const stateLabel = computed(() => {
  if (conn.status !== "connected") return "OFFLINE";
  return telemetry.armed ? "ARMED" : "DISARMED";
});

const stateDot = computed(() => {
  if (conn.status !== "connected") return "bg-hud-mute";
  return telemetry.armed ? "bg-hud-danger" : "bg-hud-ok";
});

const stateColor = computed(() => {
  if (conn.status !== "connected") return "text-hud-mute";
  return telemetry.armed ? "text-hud-danger" : "text-hud-text";
});

const connectOpts = computed(() => {
  if (conn.interface === "usb") return { baudRate: settings.serial.baudRate };
  if (conn.interface === "ble")
    return {
      discoveryMode: settings.ble.discoveryMode,
      namePrefix: settings.ble.namePrefix,
      serviceUuid: settings.ble.serviceUuid || null,
      customNotifyUuid: settings.ble.customNotifyUuid || null,
    };
  if (conn.interface === "udp")
    return { url: settings.udp.url, listenPort: settings.udp.listenPort };
  return {};
});

async function toggleConnect() {
  if (conn.status === "connected") return conn.disconnect();
  if (conn.status === "connecting") return;
  await conn.connect(connectOpts.value);
}

// Show every transport in the dropdown — disable & annotate the ones that
// aren't usable here so users can see WHY (and don't think the app is broken
// when, say, BLE is missing). Each entry is { kind, label, available, reason }.
const transportEntries = computed(() =>
  Object.entries(TRANSPORTS).map(([k, t]) => ({
    kind: k,
    label: t.label,
    available: conn.available[k],
    reason: conn.unavailableReasons[k],
  }))
);

const availableTransports = computed(() => transportEntries.value.filter((e) => e.available));

// If the saved interface is no longer available (e.g. moved to a static host
// where UDP can't run), fall back to the first available transport.
watchEffect(() => {
  if (!conn.available[conn.interface]) {
    const first = availableTransports.value[0]?.kind;
    if (first) conn.interface = first;
  }
});

// Chip label shown in the right-side control:
//   connected   → e.g. "USB · CP210x" (from the live transport)
//   disconnected → the transport name from the picker
const chipLabel = computed(() => {
  if (conn.status === "connected" && conn.deviceLabel) return conn.deviceLabel;
  return TRANSPORTS[conn.interface]?.label ?? "USB";
});

// Re-render the log button when buffered data changes (it's not reactive itself).
const hasLogData = ref(false);
setInterval(() => { hasLogData.value = telemetryLogger.hasData; }, 1000);

// Transport dropdown — rich custom UI (replaces native <select>)
const transportInfo = {
  usb: { label: "USB", subtitle: "Serial cable" },
  ble: { label: "Bluetooth", subtitle: "Wireless BLE" },
  udp: { label: "WiFi UDP", subtitle: "Network bridge" },
};
const transportOpen = ref(false);
const transportRef = ref(null);
const dropdownRef = ref(null);
const dropdownStyle = ref({});

function selectTransport(kind) {
  conn.interface = kind;
  transportOpen.value = false;
}

// Compute dropdown position relative to the chip button — needed because
// the dropdown is teleported to <body> (the parent panel has overflow:hidden
// for rounded corners, which was clipping the dropdown).
function positionDropdown() {
  if (!transportRef.value) return;
  const btn = transportRef.value.querySelector(".transport-chip");
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  dropdownStyle.value = {
    position: "fixed",
    top: `${r.bottom + 8}px`,
    right: `${window.innerWidth - r.right}px`,
    width: "260px",
    zIndex: 100,
  };
}

watch(transportOpen, async (open) => {
  if (open) {
    await nextTick();
    positionDropdown();
  }
});

function onDocClick(e) {
  if (!transportOpen.value) return;
  const inTrigger = transportRef.value && transportRef.value.contains(e.target);
  const inPanel = dropdownRef.value && dropdownRef.value.contains(e.target);
  if (!inTrigger && !inPanel) transportOpen.value = false;
}
function onScrollOrResize() {
  if (transportOpen.value) positionDropdown();
}
// Electron: "Rescan" in the serial picker fires this event via
// executeJavaScript(code, userGesture=true), which gives it a synthetic user
// activation so requestPort() doesn't throw "must be handling a user gesture".
function onSerialRetry() {
  if (conn.status === "disconnected" && conn.interface === "usb") {
    conn.connect(connectOpts.value);
  }
}
onMounted(() => {
  document.addEventListener("mousedown", onDocClick);
  window.addEventListener("resize", onScrollOrResize);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("electron-serial-retry", onSerialRetry);
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDocClick);
  window.removeEventListener("resize", onScrollOrResize);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("electron-serial-retry", onSerialRetry);
});

// Replay file loader
const replayFileInput = ref(null);
const replayError = ref(null);
async function onReplayFile(e) {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  replayError.value = null;
  try {
    await replay.loadFile(file);
  } catch (err) {
    replayError.value = err.message || String(err);
    setTimeout(() => { replayError.value = null; }, 6000);
  }
}
</script>

<template>
  <!-- Floating glass panel — matches GCS v3 topbar aesthetic -->
  <div>
    <!--
      Fixed 64 px height, items-stretch so every child column fills the full
      height (keeps full-height divider lines). Each child then centres its own
      content with items-center / justify-center internally.
    -->
    <div
      class="panel flex items-stretch select-none min-w-max"
      style="height: 58px; border-radius: 0.75rem; overflow: hidden"
    >

      <!-- ── BRAND ── logo · name · link pill -->
      <div
        class="flex items-center gap-2 px-3 shrink-0"
        style="border-right: 1px solid rgba(255,255,255,0.07)"
      >
        <!-- Logo mark -->
        <div
          class="w-7 h-7 rounded-md shrink-0 flex items-center justify-center"
          style="
            background: radial-gradient(circle at 30% 30%, rgba(255,255,255,0.3), transparent 60%),
                        linear-gradient(135deg, #a78bfa, #6d4dff);
            box-shadow: 0 8px 20px -6px rgba(167,139,250,0.55),
                        inset 0 1px 0 rgba(255,255,255,0.3),
                        inset 0 -6px 12px rgba(0,0,0,0.3);
          "
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" class="w-4 h-4 drop-shadow">
            <circle cx="16" cy="16" r="13" fill="rgba(255,255,255,0.18)" stroke="white" stroke-width="1.4" />
            <polygon points="16,5 23,24 16,19 9,24" fill="white" stroke="rgba(0,0,0,0.25)" stroke-width="0.8" />
          </svg>
        </div>

        <!-- App name + subtitle — vertically stacked, same gap as segments -->
        <div class="flex flex-col justify-center gap-[4px] leading-none">
          <span class="text-[11px] font-semibold tracking-[0.06em] text-hud-text">FLIGHTTRACE</span>
          <span class="text-[8px] tracking-[0.2em] uppercase font-medium" style="color: #4f5b6e">Telemetry Monitor · v{{ APP_VERSION }}</span>
        </div>

        <!-- Vertical rule -->
        <div class="self-stretch w-px mx-1" style="background: rgba(255,255,255,0.07)"></div>

        <!-- Link pill + protocol label — centred as a block -->
        <div class="flex flex-col justify-center gap-[4px] leading-none">
          <span
            class="status-pill self-start"
            :class="[linkPillClass, linkPill.pulse ? 'animate-pulse' : '']"
          >
            <span
              class="w-[6px] h-[6px] rounded-full shrink-0"
              :class="{
                'bg-hud-ok shadow-glow': linkPill.tone === 'ok',
                'bg-hud-warn': linkPill.tone === 'warn',
                'bg-hud-mute': linkPill.tone === 'mute',
              }"
            />
            {{ linkPill.label }}
          </span>
          <!-- Protocol label — fixed-height placeholder keeps the block stable -->
          <span
            class="text-[8px] tracking-[0.18em] uppercase font-medium leading-none"
            style="color: #4f5b6e; min-height: 9px"
          >{{ protocolLabel ?? '' }}</span>
        </div>
      </div>

      <!-- ── STATUS STRIP ── equal-width cells, full bar height, stacked label ── -->
      <div class="hidden sm:flex flex-1 items-stretch overflow-hidden">

        <!-- STATE -->
        <div class="hud-item">
          <svg class="hud-icon" :class="stateColor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          <div class="hud-text">
            <span class="hud-val" :class="stateColor">{{ stateLabel }}</span>
            <span class="hud-label">STATE</span>
          </div>
        </div>

        <!-- MODE -->
        <div class="hud-item" :class="{ 'disabled-field': !supports('flightMode') }">
          <svg class="hud-icon text-hud-mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/>
            <line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/>
            <line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>
          </svg>
          <div class="hud-text">
            <span class="hud-val" :class="telemetry.flightMode ? 'text-hud-ok' : 'text-hud-mute'">
              {{ telemetry.flightMode || '—' }}
            </span>
            <span class="hud-label">MODE</span>
          </div>
        </div>

        <!-- TIMER -->
        <div v-if="sensors.armTimer" class="hud-item">
          <svg class="hud-icon text-hud-mute" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14.5 15.5"/>
            <path d="M5 3l1.5 1.5M19 3l-1.5 1.5M9 3h6"/>
          </svg>
          <div class="hud-text">
            <span class="hud-val text-hud-text">{{ fmtSeconds(telemetry.armSeconds) }}</span>
            <span class="hud-label">FLIGHT</span>
          </div>
        </div>

        <!-- GPS -->
        <div class="hud-item" :class="{ 'disabled-field': !supports('satellites') }">
          <!-- satellite icon + signal bars side by side -->
          <div class="flex items-center gap-[5px] shrink-0" :class="gpsColor">
            <!-- satellite: diagonal body + solar panels + signal arcs (matches reference icon) -->
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <!-- body + panels rotated -45° -->
              <g transform="rotate(-45 12 10)">
                <rect x="7"    y="8" width="10" height="4"  rx="1.5"/>
                <rect x="1.5"  y="6" width="4.5" height="8" rx="1"/>
                <rect x="18"   y="6" width="4.5" height="8" rx="1"/>
              </g>
              <!-- signal arcs from dish (lower-right) -->
              <path d="M13 19A4.5 4.5 0 0 1 19 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <path d="M10.5 21.5A8 8 0 0 1 21.5 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <!-- signal bars -->
            <svg width="16" height="13" viewBox="0 0 16 12" fill="currentColor">
              <rect x="0"    y="9" width="3" height="3"  rx="0.6" :opacity="gpsBars >= 1 ? 1 : 0.15"/>
              <rect x="4.3"  y="6" width="3" height="6"  rx="0.6" :opacity="gpsBars >= 2 ? 1 : 0.15"/>
              <rect x="8.6"  y="3" width="3" height="9"  rx="0.6" :opacity="gpsBars >= 3 ? 1 : 0.15"/>
              <rect x="12.9" y="0" width="3" height="12" rx="0.6" :opacity="gpsBars >= 4 ? 1 : 0.15"/>
            </svg>
          </div>
          <div class="hud-text">
            <span class="hud-val" :class="gpsColor">{{ telemetry.satellites ?? 0 }}</span>
            <span class="hud-label">SATELLITES</span>
          </div>
        </div>

        <!-- SIGNAL / LQ -->
        <div v-if="sensors.rssi" class="hud-item" :class="{ 'disabled-field': !supports('uplinkLq') }">
          <!-- radio tower + signal bars side by side -->
          <div class="flex items-center gap-[5px] shrink-0" :class="lqColor">
            <!-- RC radio transmitter: box + two antennas + two dials -->
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <!-- body -->
              <rect x="2" y="9" width="20" height="13" rx="2"/>
              <!-- left antenna -->
              <line x1="7"  y1="9" x2="7"  y2="3"/>
              <!-- right antenna -->
              <line x1="17" y1="9" x2="17" y2="3"/>
              <!-- left dial -->
              <circle cx="8"  cy="16" r="2.5"/>
              <!-- right dial -->
              <circle cx="16" cy="16" r="2.5"/>
            </svg>
            <!-- signal bars -->
            <svg width="16" height="13" viewBox="0 0 16 12" fill="currentColor">
              <rect x="0"    y="9" width="3" height="3"  rx="0.6" :opacity="lqBars >= 1 ? 1 : 0.15"/>
              <rect x="4.3"  y="6" width="3" height="6"  rx="0.6" :opacity="lqBars >= 2 ? 1 : 0.15"/>
              <rect x="8.6"  y="3" width="3" height="9"  rx="0.6" :opacity="lqBars >= 3 ? 1 : 0.15"/>
              <rect x="12.9" y="0" width="3" height="12" rx="0.6" :opacity="lqBars >= 4 ? 1 : 0.15"/>
            </svg>
          </div>
          <div class="hud-text">
            <span class="hud-val" :class="lqColor">{{ telemetry.uplinkLq != null ? telemetry.uplinkLq : '—' }}</span>
            <span class="hud-label">LINK LQ%</span>
          </div>
        </div>

        <!-- BATTERY -->
        <div
          v-if="sensors.percent || sensors.voltage"
          class="hud-item"
          :class="{ 'disabled-field': !supports('voltage') && !supports('percent') }"
        >
          <!-- Battery with dynamic fill level -->
          <svg class="hud-batt" :class="battColor" viewBox="0 0 12 22" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <!-- terminal nub -->
            <rect x="3.5" y="0" width="5" height="2.5" rx="0.8" fill="currentColor" stroke="none"/>
            <!-- outer shell -->
            <rect x="0.75" y="2.5" width="10.5" height="18.5" rx="1.8" stroke-width="1.5"/>
            <!-- fill level — grows from bottom -->
            <rect
              x="2.5"
              :y="4.25 + 15 * (1 - battPct)"
              width="7"
              :height="Math.max(0, 15 * battPct)"
              rx="0.8"
              fill="currentColor"
              stroke="none"
            />
          </svg>
          <div class="hud-text">
            <span class="hud-val" :class="battColor">{{ battValue }}</span>
            <span class="hud-label">BATTERY</span>
          </div>
        </div>

      </div>

      <!-- ── RIGHT CONTROLS ── transport · connect · log · settings -->
      <!-- items-center so all buttons sit on the same vertical axis -->
      <div class="flex items-center gap-1.5 px-2 shrink-0" style="border-left: 1px solid rgba(255,255,255,0.07)">

        <!-- Transport dropdown — custom panel with icons + descriptions -->
        <div ref="transportRef" class="relative">
          <!-- Chip button (closed state) -->
          <button
            type="button"
            class="transport-chip"
            :class="transportOpen ? 'transport-chip-open' : ''"
            :disabled="conn.status === 'connected' || conn.status === 'connecting'"
            @click="transportOpen = !transportOpen"
          >
            <!-- Icon tile -->
            <span
              class="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
              :style="conn.interface === 'usb' ? 'background: rgba(167,139,250,0.18)'
                    : conn.interface === 'ble' ? 'background: rgba(59,130,246,0.18)'
                    : 'background: rgba(34,211,238,0.18)'"
            >
              <svg v-if="conn.interface === 'usb'" class="w-3 h-3 text-hud-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 18V7"/><rect x="9" y="3" width="6" height="5" rx="1.2"/><path d="M9 7h6M9 18H7a2 2 0 01-2-2v-2h14v2a2 2 0 01-2 2h-2"/>
              </svg>
              <svg v-else-if="conn.interface === 'ble'" class="w-3 h-3" style="color: #60a5fa" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/>
              </svg>
              <svg v-else class="w-3 h-3" style="color: #22d3ee" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r=".5" fill="currentColor"/>
              </svg>
            </span>

            <!-- Label -->
            <span class="font-mono text-[12px] text-hud-text whitespace-nowrap tracking-wide">
              {{ conn.status === 'connected' ? chipLabel : transportInfo[conn.interface]?.label ?? 'USB' }}
            </span>

            <!-- Chevron (hidden when connected) -->
            <svg
              v-if="conn.status !== 'connected'"
              class="w-3 h-3 shrink-0 transition-transform duration-150"
              :class="transportOpen ? 'rotate-180' : ''"
              style="color:#4f5b6e"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
            >
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          <!-- Dropdown panel — teleported to <body> to escape parent overflow:hidden -->
          <Teleport to="body">
          <transition name="dropdown">
            <div
              v-if="transportOpen && conn.status !== 'connected'"
              ref="dropdownRef"
              class="panel p-1.5"
              :style="dropdownStyle"
            >
              <div class="px-2 py-1 text-[9px] tracking-[0.22em] uppercase font-semibold" style="color: #4f5b6e">
                Connection Interface
              </div>
              <button
                v-for="e in transportEntries"
                :key="e.kind"
                type="button"
                class="w-full flex items-center gap-2.5 px-2 py-2 rounded-md text-left transition-colors mt-0.5"
                :class="[
                  conn.interface === e.kind ? 'transport-option-active' : 'hover:bg-white/[0.04]',
                  !e.available ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer',
                ]"
                :disabled="!e.available"
                :title="!e.available && e.reason ? e.reason : ''"
                @click="e.available && selectTransport(e.kind)"
              >
                <!-- Icon tile -->
                <span
                  class="w-8 h-8 rounded-md flex items-center justify-center shrink-0"
                  :style="e.kind === 'usb' ? 'background: rgba(167,139,250,0.15); border: 1px solid rgba(167,139,250,0.25)'
                        : e.kind === 'ble' ? 'background: rgba(59,130,246,0.15); border: 1px solid rgba(59,130,246,0.25)'
                        : 'background: rgba(34,211,238,0.15); border: 1px solid rgba(34,211,238,0.25)'"
                >
                  <svg v-if="e.kind === 'usb'" class="w-4 h-4 text-hud-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M12 18V7"/><rect x="9" y="3" width="6" height="5" rx="1.2"/><path d="M9 7h6M9 18H7a2 2 0 01-2-2v-2h14v2a2 2 0 01-2 2h-2"/>
                  </svg>
                  <svg v-else-if="e.kind === 'ble'" class="w-4 h-4" style="color: #60a5fa" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="6.5 6.5 17.5 17.5 12 23 12 1 17.5 6.5 6.5 17.5"/>
                  </svg>
                  <svg v-else class="w-4 h-4" style="color: #22d3ee" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r=".5" fill="currentColor"/>
                  </svg>
                </span>

                <!-- Label + subtitle -->
                <div class="flex-1 min-w-0">
                  <div class="text-[12px] font-medium text-hud-text leading-tight">
                    {{ transportInfo[e.kind]?.label }}
                  </div>
                  <div class="text-[10px] truncate leading-tight mt-0.5" style="color: #4f5b6e">
                    {{ e.available ? transportInfo[e.kind]?.subtitle : (e.reason || 'Unavailable') }}
                  </div>
                </div>

                <!-- Selected check -->
                <svg
                  v-if="conn.interface === e.kind"
                  class="w-4 h-4 shrink-0 text-hud-accent"
                  viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                >
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </button>
            </div>
          </transition>
          </Teleport>
        </div>

        <!-- Hidden replay file input -->
        <input
          ref="replayFileInput"
          type="file"
          accept=".csv"
          class="sr-only"
          @change="onReplayFile"
        />

        <!-- Connect / Disconnect (hidden while replay is active) -->
        <template v-if="replay.status === 'idle'">
          <button
            class="px-3 h-7 rounded-lg text-[11px] font-semibold border transition-all whitespace-nowrap"
            :class="conn.status === 'connected'
              ? 'bg-hud-danger/15 border-hud-danger/40 text-hud-danger hover:bg-hud-danger/25'
              : 'bg-hud-ok/15 border-hud-ok/40 text-hud-ok hover:bg-hud-ok/25'"
            :disabled="conn.status === 'connecting'"
            @click="toggleConnect"
          >
            {{ conn.status === "connected" ? "Disconnect" : conn.status === "connecting" ? "Connecting…" : "Connect" }}
          </button>
        </template>

        <!-- Log download — same size as icon buttons -->
        <button
          v-if="hasLogData && replay.status === 'idle'"
          class="map-btn w-7 h-7 text-xs font-medium"
          title="Download telemetry log (CSV)"
          @click="telemetryLogger.download()"
        >
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
        </button>

        <!-- Replay file open button -->
        <button
          class="map-btn w-7 h-7"
          :class="replay.status !== 'idle' ? '!border-hud-accent !text-hud-accent' : ''"
          :disabled="conn.status === 'connected'"
          title="Open replay file (.csv)"
          @click="replayFileInput.click()"
        >
          <!-- Counter-clockwise arrow = replay/rewind icon -->
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-4.56"/>
          </svg>
        </button>

        <!-- Settings — same 36px square -->
        <router-link to="/settings" class="map-btn w-7 h-7 text-hud-mute hover:text-hud-text" title="Settings">
          <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </router-link>
      </div>
    </div>

    <!-- Connection error toast -->
    <div
      v-if="conn.error"
      class="mt-2 px-3 py-2 flex items-center gap-2 text-xs text-hud-danger rounded-lg backdrop-blur-xl"
      style="background: rgba(251,113,133,0.08); border: 1px solid rgba(251,113,133,0.25)"
      :title="conn.error"
    >
      <span class="truncate">{{ conn.error }}</span>
      <button class="text-hud-mute hover:text-hud-text ml-auto shrink-0" @click="conn.clearError()">✕</button>
    </div>

    <!-- Replay load error toast -->
    <div
      v-if="replayError"
      class="mt-2 px-3 py-2 flex items-center gap-2 text-xs text-hud-warn rounded-lg backdrop-blur-xl"
      style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25)"
    >
      <svg class="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
      <span class="truncate">{{ replayError }}</span>
      <button class="text-hud-mute hover:text-hud-text ml-auto shrink-0" @click="replayError = null">✕</button>
    </div>
  </div>
</template>

<style scoped>
/* Each status cell: fills full bar height, equal width, border dividers */
.hud-item {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 0 13px;
  flex: 1;
  min-width: 0;
  height: 100%;
  border-right: 1px solid rgba(255, 255, 255, 0.06);
}
.hud-item:first-child {
  border-left: 1px solid rgba(255, 255, 255, 0.06);
}

.hud-icon {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

/* Battery is portrait — needs extra height to show fill levels clearly */
.hud-batt {
  width: 13px;
  height: 22px;
  flex-shrink: 0;
}

.hud-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hud-val {
  font-size: 14px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.hud-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.14em;
  color: #4f5b6e;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
}

.disabled-field {
  opacity: 0.35;
}
</style>
