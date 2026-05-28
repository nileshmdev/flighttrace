<script setup>
import { computed } from "vue";
import { useTelemetryStore } from "../stores/telemetry.js";

const telemetry = useTelemetryStore();

const pitch = computed(() => clamp(telemetry.pitch ?? 0, -90, 90));
const roll = computed(() => telemetry.roll ?? 0);
const yaw = computed(() => ((telemetry.yaw ?? telemetry.heading ?? 0) + 360) % 360);

// Positive pitch = nose up → horizon must move DOWN (more sky) → negate
const pitchOffset = computed(() => -pitch.value * 3);

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

const ladderLines = computed(() => {
  const out = [];
  for (let p = -60; p <= 60; p += 10) {
    if (p === 0) continue;
    out.push({
      deg: p,
      y: -p * 3, // moves opposite to aircraft pitch (clipping mask handles relative motion)
      label: Math.abs(p),
      width: p % 30 === 0 ? 80 : 50,
    });
  }
  return out;
});
</script>

<template>
  <div
    class="panel relative w-[200px] h-[200px] overflow-hidden rounded-full select-none"
    style="box-shadow: 0 0 24px rgba(0,210,255,0.18)"
  >
    <!-- Sky/Ground horizon — rotated by roll, translated by pitch -->
    <div
      class="absolute inset-0"
      :style="{
        transform: `translateY(${pitchOffset}px) rotate(${roll}deg)`,
        transformOrigin: 'center center',
      }"
    >
      <div class="absolute left-[-50%] right-[-50%] top-[-100%] h-[150%] bg-gradient-to-b from-[#0e3a5f] to-[#1d6fa5]" />
      <div class="absolute left-[-50%] right-[-50%] top-[50%] h-[150%] bg-gradient-to-b from-[#7a4a1f] to-[#3a2410]" />
      <div class="absolute left-[-50%] right-[-50%] top-1/2 h-px bg-white/80" />

      <!-- Pitch ladder -->
      <div class="absolute left-1/2 top-1/2" style="transform: translate(-50%, 0)">
        <div
          v-for="l in ladderLines"
          :key="l.deg"
          class="absolute left-1/2 flex items-center justify-between text-[9px] font-mono text-white/85"
          :style="{
            top: l.y + 'px',
            transform: 'translateX(-50%)',
            width: l.width + 'px',
          }"
        >
          <span class="px-1">{{ l.label }}</span>
          <div class="flex-1 h-px bg-white/70 mx-1" />
          <span class="px-1">{{ l.label }}</span>
        </div>
      </div>
    </div>

    <!-- Fixed aircraft reticle -->
    <div class="absolute inset-0 flex items-center justify-center pointer-events-none">
      <svg width="120" height="40" viewBox="-60 -20 120 40">
        <line x1="-50" y1="0" x2="-15" y2="0" stroke="#fbbf24" stroke-width="3" />
        <line x1="15" y1="0" x2="50" y2="0" stroke="#fbbf24" stroke-width="3" />
        <circle cx="0" cy="0" r="3" fill="#fbbf24" />
      </svg>
    </div>

    <!-- Roll indicator arc -->
    <svg class="absolute inset-0 pointer-events-none" viewBox="0 0 200 200">
      <g transform="translate(100,100)">
        <g :transform="`rotate(${roll})`">
          <polygon points="0,-90 -5,-78 5,-78" fill="#fbbf24" />
        </g>
        <!-- Tick marks -->
        <g v-for="t in [-60, -45, -30, -15, 0, 15, 30, 45, 60]" :key="t" :transform="`rotate(${t})`">
          <line x1="0" y1="-94" x2="0" y2="-86" stroke="white" stroke-opacity="0.7" stroke-width="1.2" />
        </g>
      </g>
    </svg>

    <!-- Heading readout — raised so circle clip doesn't cut text -->
    <div
      class="absolute bottom-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded
             text-[11px] font-mono bg-black/60 text-hud-accent border border-hud-border whitespace-nowrap"
    >
      HDG {{ yaw.toFixed(0).padStart(3, "0") }}°
    </div>

    <!-- Pitch / Roll readout -->
    <div class="absolute top-2 left-2 text-[10px] font-mono text-white/90 bg-black/40 px-1.5 py-0.5 rounded">
      P {{ (telemetry.pitch ?? 0).toFixed(0) }}°
    </div>
    <div class="absolute top-2 right-2 text-[10px] font-mono text-white/90 bg-black/40 px-1.5 py-0.5 rounded">
      R {{ (telemetry.roll ?? 0).toFixed(0) }}°
    </div>
  </div>
</template>
