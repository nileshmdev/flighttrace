<script setup>
defineProps({
  label: { type: String, required: true },
  value: { type: [String, Number], default: "—" },
  classValue: { type: String, default: "" },
  dim: { type: Boolean, default: false },
});
</script>

<template>
  <div :class="['flex flex-col items-start min-w-[56px]', dim ? 'disabled-field' : '']">
    <span class="text-[10px] uppercase tracking-label text-label font-medium leading-none mb-0.5">{{ label }}</span>
    <span class="text-sm font-mono font-semibold text-data tabular-nums leading-none whitespace-nowrap" :class="classValue">{{ value }}</span>
  </div>
</template>
