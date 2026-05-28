<script setup>
import { onMounted, onUnmounted } from "vue";
import { useTelemetryStore } from "./stores/telemetry.js";

const telemetry = useTelemetryStore();
let timer = null;
onMounted(() => {
  timer = setInterval(() => telemetry.tickArmTimer(), 250);
});
onUnmounted(() => clearInterval(timer));
</script>

<template>
  <router-view />
</template>
