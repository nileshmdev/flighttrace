<script setup>
import { computed } from "vue";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useSettingsStore } from "../stores/settings.js";
import { useConnectionStore } from "../stores/connection.js";
import { fmtAltitude, fmtDistance, fmtSpeed } from "../utils/units.js";
import { PROTOCOL_FIELDS } from "../protocols/ProtocolDetector.js";
import AttitudeIndicator from "./AttitudeIndicator.vue";

const telemetry = useTelemetryStore();
const settings = useSettingsStore();
const conn = useConnectionStore();

const supports = (field) => {
  if (!conn.protocol) return true;
  return PROTOCOL_FIELDS[conn.protocol]?.has(field);
};

const distanceFmt = computed(() => fmtDistance(telemetry.distanceFromHome, settings.units, 0));
const altitudeFmt = computed(() => fmtAltitude(telemetry.relAltitude ?? telemetry.altitude, settings.units));
const speedFmt    = computed(() => fmtSpeed(telemetry.groundSpeed, settings.units, 1));
const vspeedFmt   = computed(() => fmtSpeed(telemetry.verticalSpeed, settings.units, 1));

// Climb/descend is normal flight, not a status — the value stays neutral and
// the arrow icon alone shows direction. Red is reserved for true alarms.
const vspeedColor = computed(() =>
  telemetry.verticalSpeed == null ? "text-label" : "text-data"
);

const isClimbing  = computed(() => (telemetry.verticalSpeed ?? 0) >  0.3);
const isDescending = computed(() => (telemetry.verticalSpeed ?? 0) < -0.3);

const sensors = computed(() => settings.visibleSensors);
</script>

<template>
  <div class="flex items-end gap-3 select-none">
    <AttitudeIndicator />
    <div class="card flex items-stretch !py-0 !px-0 overflow-hidden">
      <!-- DIST -->
      <div
        v-if="sensors.distance"
        class="flex flex-col justify-center px-4 py-2.5 min-w-[84px]"
        :class="{ 'disabled-field': !telemetry.homeLat }"
      >
        <div class="flex items-center gap-1 mb-1">
          <svg class="w-3 h-3 text-label shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="2" y="9" width="20" height="6" rx="1.5"/>
            <line x1="6"  y1="9" x2="6"  y2="15"/>
            <line x1="10" y1="9" x2="10" y2="12"/>
            <line x1="14" y1="9" x2="14" y2="12"/>
            <line x1="18" y1="9" x2="18" y2="15"/>
          </svg>
          <span class="stat-label">Dist</span>
        </div>
        <span class="stat-value text-sm">{{ distanceFmt }}</span>
      </div>

      <!-- ALT -->
      <div
        v-if="sensors.altitude"
        class="flex flex-col justify-center px-4 py-2.5 min-w-[84px]"
        :class="{ 'disabled-field': !supports('altitude') }"
      >
        <div class="flex items-center gap-1 mb-1">
          <svg class="w-3 h-3 text-label shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 19V6"/><polyline points="7 11 12 6 17 11"/>
            <line x1="4" y1="20" x2="20" y2="20"/>
          </svg>
          <span class="stat-label">Alt</span>
        </div>
        <span class="stat-value text-sm">{{ altitudeFmt }}</span>
      </div>

      <!-- SPEED -->
      <div
        v-if="sensors.groundSpeed"
        class="flex flex-col justify-center px-4 py-2.5 min-w-[84px]"
        :class="{ 'disabled-field': !supports('groundSpeed') }"
      >
        <div class="flex items-center gap-1 mb-1">
          <svg class="w-3 h-3 text-label shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3.34 17a10 10 0 1 1 17.32 0"/>
            <path d="M12 12l3-5" stroke-linecap="round"/>
            <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>
          </svg>
          <span class="stat-label">Speed</span>
        </div>
        <span class="stat-value text-sm">{{ speedFmt }}</span>
      </div>

      <!-- V SPEED -->
      <div
        v-if="sensors.verticalSpeed"
        class="flex flex-col justify-center px-4 py-2.5 min-w-[84px]"
        :class="{ 'disabled-field': !supports('verticalSpeed') }"
      >
        <div class="flex items-center gap-1 mb-1">
          <svg class="w-3 h-3 shrink-0 text-label" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <!-- climbing: up arrow -->
            <path v-if="isClimbing"   d="M12 19V5m0 0l-5 5m5-5l5 5"/>
            <!-- descending: down arrow -->
            <path v-else-if="isDescending" d="M12 5v14m0 0l-5-5m5 5l5-5"/>
            <!-- neutral: up-down -->
            <path v-else d="M12 5v14M7 9l5-5 5 5M7 19l5 5 5-5"/>
          </svg>
          <span class="stat-label">V Speed</span>
        </div>
        <span class="stat-value text-sm" :class="vspeedColor">{{ vspeedFmt }}</span>
      </div>
    </div>
  </div>
</template>
