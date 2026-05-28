<script setup>
import { ref, computed } from "vue";
import { useReplayStore } from "../stores/replay.js";

const replay = useReplayStore();

// Local seek position while user is dragging — decoupled from store progress
// so the fill bar updates instantly without triggering expensive seekTo().
const seekPos = ref(null);
const isDragging = ref(false);

const displayProgress = computed(() => seekPos.value ?? replay.progress);

function onSeekInput(e) {
  seekPos.value = parseFloat(e.target.value);
  isDragging.value = true;
}
function onSeekChange(e) {
  replay.seekTo(parseFloat(e.target.value));
  seekPos.value = null;
  isDragging.value = false;
}

function togglePlay() {
  if (replay.status === "playing") replay.pause();
  else replay.play();
}

const SPEEDS = [0.25, 0.5, 1, 2, 4, 10];
</script>

<template>
  <div
    v-if="replay.status !== 'idle'"
    class="panel flex items-center gap-2 px-3 select-none"
    style="height: 38px; border-radius: 0.625rem; overflow: hidden"
  >
    <!-- REPLAY label -->
    <span class="text-[9.5px] tracking-[0.22em] uppercase font-semibold shrink-0" style="color: #a78bfa">
      REPLAY
    </span>

    <div class="w-px self-stretch" style="background: rgba(255,255,255,0.07)" />

    <!-- Play / Pause -->
    <button
      class="map-btn w-7 h-7 shrink-0"
      :title="replay.status === 'playing' ? 'Pause' : 'Play'"
      @click="togglePlay"
    >
      <!-- Pause -->
      <svg v-if="replay.status === 'playing'" class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <rect x="5" y="3" width="4" height="18" rx="1"/>
        <rect x="15" y="3" width="4" height="18" rx="1"/>
      </svg>
      <!-- Play -->
      <svg v-else class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <polygon points="5,3 19,12 5,21"/>
      </svg>
    </button>

    <!-- Stop (resets replay entirely) -->
    <button class="map-btn w-7 h-7 shrink-0" title="Stop replay" @click="replay.stop()">
      <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
        <rect x="4" y="4" width="16" height="16" rx="2"/>
      </svg>
    </button>

    <!-- Time + Scrubber + Total -->
    <div class="flex items-center gap-2 min-w-[200px] max-w-[400px] flex-1">
      <span class="text-[11px] font-mono shrink-0" style="color: #4f5b6e; min-width: 36px; text-align:right">
        {{ replay.currentTimeStr }}
      </span>

      <!-- Track -->
      <div class="flex-1 relative" style="height: 18px; display:flex; align-items:center">
        <!-- Fill bar -->
        <div class="absolute inset-x-0 h-1.5 rounded-full overflow-hidden" style="background: rgba(255,255,255,0.08)">
          <div
            class="h-full rounded-full"
            :class="replay.status === 'done' ? 'bar-ok' : 'bar-accent'"
            :style="{ width: (displayProgress * 100).toFixed(2) + '%', transition: isDragging ? 'none' : 'width 0.15s linear' }"
          />
        </div>
        <!-- Thumb dot -->
        <div
          class="absolute h-3 w-3 rounded-full border-2 pointer-events-none"
          style="background: #a78bfa; border-color: rgba(5,7,9,0.8); margin-left: -6px; transition: none"
          :style="{ left: (displayProgress * 100).toFixed(2) + '%' }"
        />
        <!-- Invisible range input on top -->
        <input
          type="range"
          min="0" max="1" step="0.0001"
          :value="displayProgress"
          class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style="margin: 0"
          @input="onSeekInput"
          @change="onSeekChange"
        />
      </div>

      <span class="text-[11px] font-mono shrink-0" style="color: #4f5b6e; min-width: 36px">
        {{ replay.totalTimeStr }}
      </span>
    </div>

    <!-- Speed selector -->
    <div class="transport-chip shrink-0 gap-1.5" style="height:30px; padding: 0 10px">
      <select
        :value="replay.speed"
        class="transport-select"
        style="font-size: 11px; width: auto"
        @change="e => replay.speed = Number(e.target.value)"
      >
        <option v-for="s in SPEEDS" :key="s" :value="s">{{ s }}×</option>
      </select>
      <svg class="w-2.5 h-2.5 shrink-0 pointer-events-none" style="color:#4f5b6e" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6"/>
      </svg>
    </div>

    <div class="w-px self-stretch" style="background: rgba(255,255,255,0.07)" />

    <!-- Filename -->
    <span
      class="text-[10px] font-mono truncate shrink-0 max-w-[160px]"
      style="color: #4f5b6e"
      :title="replay.filename"
    >
      {{ replay.filename }}
    </span>
  </div>
</template>
