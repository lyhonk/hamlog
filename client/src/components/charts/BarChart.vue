<script setup lang="ts">
import { ref } from 'vue';
import { useChart } from '../../composables/useChart';

const props = defineProps<{ data: Array<{ month: string; count: number }> }>();
const el = ref<HTMLElement | null>(null);

useChart(el, () => ({
  grid: { left: 34, right: 12, top: 18, bottom: 28 },
  xAxis: { type: 'category', data: props.data.map((item) => item.month) },
  yAxis: { type: 'value', splitLine: { lineStyle: { color: '#e8f0fa' } } },
  tooltip: { trigger: 'axis' },
  series: [{ type: 'bar', data: props.data.map((item) => item.count), barWidth: 14, itemStyle: { color: '#13c9c3', borderRadius: [6, 6, 0, 0] } }]
}));
</script>

<template><div ref="el" class="chart"></div></template>
