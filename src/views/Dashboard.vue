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
      style="background: radial-gradient(ellipse at center, transparent 30%, rgba(5,7,9,0.65) 100%), linear-gradient(180deg, rgba(5,7,9,0.55) 0%, transparent 12%, transparent 80%, rgba(5,7,9,0.5) 100%)"
    />

    <!-- Top HUD + Replay bar — floating glass cards with inset margins -->
    <div class="relative z-10 pointer-events-none px-3 pt-3 flex flex-col gap-2">
      <div class="pointer-events-auto overflow-x-auto"><TopHud /></div>
      <div class="pointer-events-auto flex justify-center"><ReplayBar /></div>
    </div>

    <!-- Spacer -->
    <div class="relative z-0 flex-1" />

    <!-- Bottom section -->
    <div class="relative z-10 pointer-events-none">
      <!-- Alert strip — all screen sizes -->
      <div v-if="alerts.length" class="flex justify-center flex-wrap gap-2 pb-2 px-3 pointer-events-none select-none">
        <div
          v-for="a in alerts" :key="a"
          class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-[0.15em] backdrop-blur-xl"
          :class="a.startsWith('CRITICAL') || a === 'FAILSAFE'
            ? 'text-hud-danger'
            : 'text-hud-warn'"
          :style="a.startsWith('CRITICAL') || a === 'FAILSAFE'
            ? 'background: rgba(251,113,133,0.18); border: 1px solid rgba(251,113,133,0.45); box-shadow: 0 0 20px -4px rgba(251,113,133,0.4)'
            : 'background: rgba(251,191,36,0.15); border: 1px solid rgba(251,191,36,0.4)'"
        >
          <span class="w-1.5 h-1.5 rounded-full mr-0.5" :class="a.startsWith('CRITICAL') || a === 'FAILSAFE' ? 'bg-hud-danger animate-pulse' : 'bg-hud-warn'" />
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

    <!-- Detection overlay -->
    <div
      v-if="conn.status === 'connected' && conn.detectState === 'scoring'"
      class="absolute top-20 left-1/2 -translate-x-1/2 z-20 px-4 py-2 text-xs text-hud-warn pointer-events-none rounded-lg backdrop-blur-xl"
      style="background: rgba(251,191,36,0.08); border: 1px solid rgba(251,191,36,0.25)"
    >
      Detecting protocol… CRSF {{ conn.detectScores.crsf }} · MAVLink
      {{ conn.detectScores.mavlink }} · LTM {{ conn.detectScores.ltm }}
    </div>
  </div>
</template>
