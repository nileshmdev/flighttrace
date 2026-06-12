<script setup>
import { computed, watch, ref, onUnmounted } from "vue";
import TopHud from "../components/TopHud.vue";
import MapView from "../components/MapView.vue";
import BottomLeftPanel from "../components/BottomLeftPanel.vue";
import InfoCards from "../components/InfoCards.vue";
import ReplayBar from "../components/ReplayBar.vue";
import { useTelemetryStore } from "../stores/telemetry.js";
import { useConnectionStore } from "../stores/connection.js";
import { useSettingsStore } from "../stores/settings.js";
import { useReplayStore } from "../stores/replay.js";
import { alertAudio } from "../utils/AlertAudio.js";

const APP_VERSION = __APP_VERSION__;

const telemetry = useTelemetryStore();
const conn = useConnectionStore();
const settings = useSettingsStore();
const replay = useReplayStore();

// Auto-set home every time the drone arms
watch(
  () => telemetry.armed,
  (armed) => {
    if (!armed || !settings.map.autoSetHome || telemetry.lat == null) return;
    telemetry.setHomeFromCurrent();
  }
);

// Arm sound — rising double chirp on arm
watch(
  () => telemetry.armed,
  (armed, wasArmed) => {
    if (!settings.alerts.audioEnabled || armed === wasArmed) return;
    if (armed) alertAudio.arm();
  }
);

// Home point sound — soft chime whenever home is set or updated
watch(
  () => telemetry.homeLat,
  (lat) => {
    if (!settings.alerts.audioEnabled || lat == null) return;
    alertAudio.homeSet();
  }
);

const alerts = computed(() => {
  const list = [];
  const v = telemetry.voltage;
  const lq = telemetry.uplinkLq;
  if (v != null && v <= settings.alerts.criticalVoltage) list.push("CRITICAL VOLTAGE");
  else if (v != null && v <= settings.alerts.lowVoltage) list.push("LOW VOLTAGE");
  if (lq != null && lq < settings.alerts.signalLoss) list.push("SIGNAL LOSS");
  if (telemetry.failsafe) list.push("FAILSAFE");
  return list;
});

// --- Audio alerts ---
const prevAlerts = ref(new Set());
let criticalRepeat = null;

watch(alerts, (current) => {
  if (!settings.alerts.audioEnabled) {
    prevAlerts.value = new Set(current);
    return;
  }

  // Play sound for each newly appearing alert
  for (const a of current) {
    if (!prevAlerts.value.has(a)) {
      if (a === "FAILSAFE")           alertAudio.failsafe();
      else if (a === "CRITICAL VOLTAGE") alertAudio.criticalVoltage();
      else if (a === "LOW VOLTAGE")   alertAudio.lowVoltage();
      else if (a === "SIGNAL LOSS")   alertAudio.signalLoss();
    }
  }

  // Repeat critical/failsafe every 8 s so the pilot can't miss it
  const hasCritical = current.some(a => a === "CRITICAL VOLTAGE" || a === "FAILSAFE");
  if (hasCritical && !criticalRepeat) {
    criticalRepeat = setInterval(() => {
      if (!settings.alerts.audioEnabled) return;
      if (alerts.value.includes("FAILSAFE")) alertAudio.failsafe();
      else alertAudio.criticalVoltage();
    }, 8000);
  } else if (!hasCritical && criticalRepeat) {
    clearInterval(criticalRepeat);
    criticalRepeat = null;
  }

  prevAlerts.value = new Set(current);
});

onUnmounted(() => {
  if (criticalRepeat) clearInterval(criticalRepeat);
});
</script>

<template>
  <div class="relative flex-1 flex flex-col">
    <!-- Map fills background -->
    <div class="absolute inset-0">
      <MapView />
    </div>

    <!-- Vignette + edge gradient overlay -->
    <div
      class="absolute inset-0 pointer-events-none z-[1]"
      style="background: radial-gradient(ellipse at center, transparent 30%, rgb(11 14 17 / 0.65) 100%), linear-gradient(180deg, rgb(11 14 17 / 0.55) 0%, transparent 12%, transparent 80%, rgb(11 14 17 / 0.5) 100%)"
    />

    <!-- Top HUD docked flush to the top edge; replay bar floats below it -->
    <div class="relative z-10 pointer-events-none flex flex-col gap-2">
      <div class="pointer-events-auto overflow-x-auto"><TopHud /></div>
      <div class="pointer-events-auto flex justify-center px-3"><ReplayBar /></div>
    </div>

    <!-- Spacer -->
    <div class="relative z-0 flex-1" />

    <!-- Bottom section -->
    <div class="relative z-10 pointer-events-none">
      <!-- Alert strip — all screen sizes -->
      <div v-if="alerts.length" class="flex justify-center flex-wrap gap-2 pb-2 px-3 pointer-events-none select-none">
        <div
          v-for="a in alerts" :key="a"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-card text-[11px] font-bold uppercase tracking-label backdrop-blur-md"
          :class="a.startsWith('CRITICAL') || a === 'FAILSAFE'
            ? 'text-status-critical'
            : 'text-status-caution'"
          :style="a.startsWith('CRITICAL') || a === 'FAILSAFE'
            ? 'background: rgb(248 113 113 / 0.18); border: 1px solid rgb(248 113 113 / 0.45)'
            : 'background: rgb(251 191 36 / 0.15); border: 1px solid rgb(251 191 36 / 0.4)'"
        >
          <span class="w-1.5 h-1.5 rounded-full mr-0.5" :class="a.startsWith('CRITICAL') || a === 'FAILSAFE' ? 'bg-status-critical animate-pulse' : 'bg-status-caution'" />
          {{ a }}
        </div>
      </div>

      <!-- Bottom row — horizontal scroll on mobile so all panels are reachable -->
      <div class="px-3 pb-3 relative flex items-end gap-3 overflow-x-auto md:overflow-visible">
        <!-- Left: attitude + flight stats -->
        <div class="pointer-events-auto shrink-0">
          <BottomLeftPanel />
        </div>

        <!-- Right: info cards — always visible; horizontal row on mobile, vertical on desktop -->
        <div class="ml-auto shrink-0 pointer-events-auto">
          <InfoCards />
        </div>
      </div>

    </div>

    <!-- Footer credit — absolute overlay inside the bottom row's padding,
         so it never shifts the panels above it -->
    <div class="absolute bottom-0.5 inset-x-0 z-10 flex justify-center pointer-events-none select-none">
      <span class="text-[9px] tracking-label text-label whitespace-nowrap" style="text-shadow: 0 1px 2px rgb(11 14 17 / 0.8)">
        Designed by Nilesh M · © 2026 · All rights reserved · v{{ APP_VERSION }}
      </span>
    </div>

    <!-- Detection overlay -->
    <div
      v-if="conn.status === 'connected' && conn.detectState === 'scoring'"
      class="absolute top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2 text-xs text-status-caution pointer-events-none rounded-card backdrop-blur-md"
      style="background: rgb(251 191 36 / 0.08); border: 1px solid rgb(251 191 36 / 0.25)"
    >
      Detecting protocol… CRSF {{ conn.detectScores.crsf }} · MAVLink
      {{ conn.detectScores.mavlink }} · LTM {{ conn.detectScores.ltm }}
    </div>
  </div>
</template>
