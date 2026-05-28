<script setup>
import { computed, ref, watch } from "vue";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useSettingsStore } from "../stores/settings.js";
import { useConnectionStore } from "../stores/connection.js";
import { PROTOCOL_FIELDS } from "../protocols/ProtocolDetector.js";

const CRSF_POWER = ["0mW", "10mW", "25mW", "100mW", "500mW", "1W", "2W", "250mW"];

const telemetry = useTelemetryStore();
const settings  = useSettingsStore();
const conn      = useConnectionStore();

const supports = (field) => {
  if (!conn.protocol) return true;
  return PROTOCOL_FIELDS[conn.protocol]?.has(field);
};

const fixLabel = computed(() => {
  const f = telemetry.fix;
  if (f == null) return telemetry.satellites > 3 ? "3D" : "NO FIX";
  if (f >= 4) return "RTK";
  if (f === 3) return "3D";
  if (f === 2) return "2D";
  return "NO FIX";
});

const fixBadgeCls = computed(() => {
  const f = telemetry.fix;
  if (f == null) return telemetry.satellites > 3 ? "badge-ok" : "badge-danger";
  if (f >= 3) return "badge-ok";
  if (f === 2) return "badge-warn";
  return "badge-danger";
});

// GPS quality: combines satellite count and fix mode. Used for the big-number
// color, the progress bar tint, and the bar fill percentage.
const GPS_SATS_MAX = 12;
function gpsState() {
  const sats = telemetry.satellites;
  const fix = telemetry.fix;
  if (sats == null && fix == null) return "mute";
  if ((sats != null && sats < 4) || (fix != null && fix < 2)) return "danger";
  if ((sats != null && sats < 8) || fix === 2) return "warn";
  return "ok";
}

const gpsColor = computed(() => {
  const s = gpsState();
  return s === "mute" ? "text-hud-mute" : `text-hud-${s}`;
});

const gpsBg = computed(() => `bar-${gpsState()}`);

const gpsBarPct = computed(() => {
  const sats = telemetry.satellites ?? 0;
  return Math.max(0, Math.min(100, (sats / GPS_SATS_MAX) * 100));
});

// Per-cell voltage range by chemistry. Used both for state classification
// and as a fallback percent estimate when telemetry.percent is unavailable.
const CHEM_RANGES = {
  "LI-PO":  { empty: 3.30, full: 4.20 },
  "LI-ION": { empty: 3.00, full: 4.20 },
  "LI-FE":  { empty: 2.50, full: 3.65 },
  "NIMH":   { empty: 1.00, full: 1.40 },
};

// Detect cell count from voltage: find smallest N where V/N falls within
// [chemistry-empty, user maxCellVoltage]. Falls back to ceil(V/max) so the
// displayed per-cell value can never exceed the configured maximum.
function detectCells(v) {
  const maxPerCell = settings.pack.maxCellVoltage || 4.2;
  const minPerCell = (CHEM_RANGES[settings.pack.chemistry] ?? CHEM_RANGES["LI-PO"]).empty;
  for (let n = 1; n <= 12; n++) {
    const perCell = v / n;
    if (perCell >= minPerCell && perCell <= maxPerCell) return n;
  }
  return Math.max(1, Math.ceil(v / maxPerCell));
}

// Snap once on first valid battery telemetry; immediate:true catches voltage already in store.
const detectedCells = ref(null);
watch(
  () => telemetry.voltage,
  (v) => {
    if (v != null && v > 2.0 && detectedCells.value == null)
      detectedCells.value = detectCells(v);
  },
  { immediate: true }
);
watch(() => conn.status, (s) => {
  if (s === "disconnected") detectedCells.value = null;
});
// Re-snap detection when the user changes chemistry or max-cell-voltage —
// otherwise a stale cellCount would keep showing wrong PER CELL values.
watch(
  () => [settings.pack.chemistry, settings.pack.maxCellVoltage],
  () => { detectedCells.value = null; }
);

const cellCount = computed(() => settings.pack?.cellsOverride || detectedCells.value);

const txPowerFmt = computed(() => {
  const v = telemetry.uplinkTxPower;
  if (v == null) return "—";
  return CRSF_POWER[v] ?? String(v);
});

// LQ-based state used for the headline number, progress bar, and badge.
// Thresholds match the STRONG / GOOD / WEAK badge bands.
function stateForLq(lq) {
  if (lq == null) return "mute";
  if (lq < 50) return "danger";
  if (lq < 80) return "warn";
  return "ok";
}

const lqFmt = computed(() => telemetry.uplinkLq == null ? "—" : Math.round(telemetry.uplinkLq));

const lqMainColor = computed(() => {
  const s = stateForLq(telemetry.uplinkLq);
  return s === "mute" ? "text-hud-mute" : `text-hud-${s}`;
});

const lqBg = computed(() => `bar-${stateForLq(telemetry.uplinkLq)}`);

const linkBadge = computed(() => {
  const lq = telemetry.uplinkLq;
  if (lq == null) return null;
  if (lq >= 80) return { label: "STRONG", cls: "badge-ok" };
  if (lq >= 50) return { label: "GOOD",   cls: "badge-warn" };
  return { label: "WEAK", cls: "badge-danger" };
});

const cellVoltageFmt = computed(() => {
  if (telemetry.voltage == null || !cellCount.value) return "—";
  return (telemetry.voltage / cellCount.value).toFixed(2);
});

// Percent: prefer measured (MAVLink BATTERY_STATUS); fall back to a linear
// voltage estimate within the chemistry's per-cell range, with the user's
// maxCellVoltage as the "full charge" upper bound.
const percentValue = computed(() => {
  if (telemetry.percent != null) return Math.max(0, Math.min(100, telemetry.percent));
  if (telemetry.voltage == null || !cellCount.value) return null;
  const perCell = telemetry.voltage / cellCount.value;
  const r = CHEM_RANGES[settings.pack.chemistry] ?? CHEM_RANGES["LI-PO"];
  const full = settings.pack.maxCellVoltage || r.full;
  return Math.max(0, Math.min(100, ((perCell - r.empty) / (full - r.empty)) * 100));
});

const percentFmt = computed(() => percentValue.value == null ? "—" : Math.round(percentValue.value));

function stateForPercent(p) {
  if (p == null) return "mute";
  if (p < 20) return "danger";
  if (p < 50) return "warn";
  return "ok";
}

const percentColor = computed(() => {
  const s = stateForPercent(percentValue.value);
  return s === "mute" ? "text-hud-mute" : `text-hud-${s}`;
});

const percentBg = computed(() => `bar-${stateForPercent(percentValue.value)}`);

// Used mAh: prefer telemetry; else derive from total × (1 − percent/100).
const usedMah = computed(() => {
  if (telemetry.capacity != null) return Math.round(telemetry.capacity);
  const total = settings.pack.totalCapacity;
  const p = percentValue.value;
  if (total && p != null) return Math.round(total * (1 - p / 100));
  return null;
});

const capacityFmt = computed(() => {
  const used = usedMah.value;
  const total = settings.pack.totalCapacity;
  if (total) return `${used ?? 0} / ${total} mAh`;
  if (used != null) return `${used} mAh used`;
  return "";
});

// Time remaining: needs totalCapacity, a percent reading, and a sane current draw.
const timeRemainingFmt = computed(() => {
  const total = settings.pack.totalCapacity;
  const p = percentValue.value;
  const i = telemetry.current;
  if (!total || p == null || i == null || i <= 0.1) return null;
  const hours = (total * (p / 100)) / 1000 / i;
  if (!isFinite(hours) || hours <= 0) return null;
  const mins = Math.round(hours * 60);
  if (mins < 1) return "<1 m left";
  if (mins < 60) return `${mins} m left`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
});

</script>

<template>
  <div class="flex flex-row md:flex-col gap-2 md:w-[230px]">
    <!-- LINK card -->
    <div v-if="settings.visibleSensors.rssi" class="card shrink-0 w-52 md:w-auto" :class="{ 'disabled-field': !supports('uplinkLq') }">
      <div class="card-header">
        <div class="flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 shrink-0" :class="lqMainColor" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="9" width="20" height="13" rx="2"/>
            <line x1="7"  y1="9" x2="7"  y2="3"/>
            <line x1="17" y1="9" x2="17" y2="3"/>
            <circle cx="8"  cy="16" r="2.5"/>
            <circle cx="16" cy="16" r="2.5"/>
          </svg>
          <span class="card-title">LINK</span>
        </div>
        <span v-if="linkBadge" class="badge" :class="linkBadge.cls">{{ linkBadge.label }}</span>
      </div>
      <!-- Big LQ % + RSSI echo -->
      <div class="flex items-end justify-between mt-1">
        <div class="flex items-baseline gap-1">
          <span class="text-4xl font-bold tabular-nums leading-none" :class="lqMainColor">{{ lqFmt }}</span>
          <span class="text-xs text-hud-mute">%</span>
        </div>
        <span v-if="telemetry.uplinkRssi1 != null" class="text-[11px] font-mono text-hud-mute text-right">
          {{ telemetry.uplinkRssi1 }} dBm
        </span>
      </div>
      <!-- Signal status bar (LQ 0–100) -->
      <div class="mt-2 h-1.5 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.05)">
        <div :class="lqBg" :style="{ width: (telemetry.uplinkLq ?? 0) + '%' }" />
      </div>
      <!-- 3-col RSSI / SNR / TX PWR -->
      <div class="mt-3 pt-2 grid grid-cols-3 gap-2 pt-2" style="border-top: 1px solid rgba(255,255,255,0.06)">
        <div class="stat-item">
          <span class="stat-label">RSSI</span>
          <div class="stat-row">
            <span class="stat-num">{{ telemetry.uplinkRssi1 ?? "—" }}</span>
            <span class="stat-unit">dBm</span>
          </div>
        </div>
        <div class="stat-item">
          <span class="stat-label">SNR</span>
          <div class="stat-row">
            <span class="stat-num">{{ telemetry.uplinkSnr ?? "—" }}</span>
            <span class="stat-unit">dB</span>
          </div>
        </div>
        <div class="stat-item">
          <span class="stat-label">TX PWR</span>
          <div class="stat-row">
            <span class="stat-num text-sm">{{ txPowerFmt }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- POWER card -->
    <div v-if="settings.visibleSensors.voltage || settings.visibleSensors.current" class="card shrink-0 w-52 md:w-auto" :class="{ 'disabled-field': !supports('voltage') }">
      <div class="card-header">
        <div class="flex items-center gap-1.5">
          <!-- battery icon with fill level -->
          <svg class="shrink-0" :class="percentColor" width="9" height="15" viewBox="0 0 12 22" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3.5" y="0" width="5" height="2.5" rx="0.8" fill="currentColor" stroke="none"/>
            <rect x="0.75" y="2.5" width="10.5" height="18.5" rx="1.8" stroke-width="1.5"/>
            <rect x="2.5" :y="4.25 + 15 * (1 - (percentValue ?? 0) / 100)" width="7" :height="Math.max(0, 15 * (percentValue ?? 0) / 100)" rx="0.8" fill="currentColor" stroke="none"/>
          </svg>
          <span class="card-title">POWER{{ cellCount ? ` · ${cellCount}S` : "" }} {{ settings.pack.chemistry }}</span>
        </div>
        <span v-if="timeRemainingFmt" class="text-[10px] font-mono text-hud-mute">{{ timeRemainingFmt }}</span>
      </div>
      <!-- Big percent + capacity fraction -->
      <div class="flex items-end justify-between mt-1">
        <div class="flex items-baseline gap-1">
          <span class="text-4xl font-bold tabular-nums leading-none" :class="percentColor">{{ percentFmt }}</span>
          <span class="text-xs text-hud-mute">%</span>
        </div>
        <span v-if="capacityFmt" class="text-[11px] font-mono text-hud-mute text-right">{{ capacityFmt }}</span>
      </div>
      <!-- Progress bar -->
      <div class="mt-2 h-1.5 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.05)">
        <div :class="percentBg" :style="{ width: (percentValue ?? 0) + '%' }" />
      </div>
      <!-- 3-col VOLTAGE / CURRENT / PER CELL -->
      <div class="mt-3 pt-2 grid grid-cols-3 gap-2 pt-2" style="border-top: 1px solid rgba(255,255,255,0.06)">
        <div v-if="settings.visibleSensors.voltage" class="stat-item">
          <span class="stat-label">VOLTAGE</span>
          <div class="stat-row">
            <span
              class="stat-num"
              :class="telemetry.voltage != null && telemetry.voltage <= settings.alerts.criticalVoltage ? 'text-hud-danger'
                : telemetry.voltage != null && telemetry.voltage <= settings.alerts.lowVoltage ? 'text-hud-warn' : ''"
            >{{ telemetry.voltage != null ? telemetry.voltage.toFixed(1) : "—" }}</span>
            <span class="stat-unit">V</span>
          </div>
        </div>
        <div v-if="settings.visibleSensors.current" class="stat-item">
          <span class="stat-label">CURRENT</span>
          <div class="stat-row">
            <span class="stat-num">{{ telemetry.current != null ? telemetry.current.toFixed(1) : "—" }}</span>
            <span class="stat-unit">A</span>
          </div>
        </div>
        <div v-if="settings.visibleSensors.voltage" class="stat-item">
          <span class="stat-label">PER CELL</span>
          <div class="stat-row">
            <span class="stat-num">{{ cellVoltageFmt }}</span>
            <span class="stat-unit">V</span>
          </div>
        </div>
      </div>
    </div>

    <!-- GPS card -->
    <div v-if="settings.visibleSensors.satellites" class="card shrink-0 w-52 md:w-auto" :class="{ 'disabled-field': !supports('satellites') }">
      <div class="card-header">
        <div class="flex items-center gap-1.5">
          <svg class="w-3.5 h-3.5 shrink-0" :class="gpsColor" viewBox="0 0 24 24" fill="currentColor">
            <g transform="rotate(-45 12 10)">
              <rect x="7" y="8" width="10" height="4" rx="1.5"/>
              <rect x="1.5" y="6" width="4.5" height="8" rx="1"/>
              <rect x="18" y="6" width="4.5" height="8" rx="1"/>
            </g>
            <path d="M13 19A4.5 4.5 0 0 1 19 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            <path d="M10.5 21.5A8 8 0 0 1 21.5 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <span class="card-title">GPS</span>
        </div>
        <span class="badge" :class="fixBadgeCls">{{ fixLabel }}</span>
      </div>
      <!-- Big SATS + HDOP echo -->
      <div class="flex items-end justify-between mt-1">
        <div class="flex items-baseline gap-1">
          <span class="text-4xl font-bold tabular-nums leading-none" :class="gpsColor">{{ telemetry.satellites ?? "—" }}</span>
          <span class="text-xs text-hud-mute">sats</span>
        </div>
        <span v-if="telemetry.hdop != null" class="text-[11px] font-mono text-hud-mute text-right">
          HDOP {{ telemetry.hdop.toFixed(1) }}
        </span>
      </div>
      <!-- Satellite-strength bar -->
      <div class="mt-2 h-1.5 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.05)">
        <div :class="gpsBg" :style="{ width: gpsBarPct + '%' }" />
      </div>
      <!-- POSITION line -->
      <div class="mt-3 pt-2 pt-2" style="border-top: 1px solid rgba(255,255,255,0.06)">
        <span class="stat-label block mb-0.5">POSITION</span>
        <div class="flex items-baseline gap-1">
          <span class="text-[11px] font-mono text-hud-text tabular-nums">
            {{ telemetry.lat != null ? telemetry.lat.toFixed(6) : "—" }}
          </span>
          <span class="text-[11px] font-mono text-hud-mute">/</span>
          <span class="text-[11px] font-mono text-hud-text tabular-nums">
            {{ telemetry.lon != null ? telemetry.lon.toFixed(6) : "—" }}
          </span>
        </div>
      </div>
    </div>

  </div>
</template>
