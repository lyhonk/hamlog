<script setup lang="ts">
import { ref } from 'vue';
import { useChart } from '../../composables/useChart';

const props = defineProps<{ data: Array<{ month: string; count: number }> }>();
const el = ref<HTMLElement | null>(null);

useChart(el, () => ({
  grid: { left: 36, right: 18, top: 24, bottom: 30 },
  xAxis: { type: 'category', data: props.data.map((item) => item.month), axisLine: { lineStyle: { color: '#d6e4f7' } } },
  yAxis: { type: 'value', splitLine: { lineStyle: { color: '#e8f0fa' } } },
  tooltip: { trigger: 'axis' },
  series: [{
    type: 'line',
    data: props.data.map((item) => item.count),
    smooth: true,
    symbolSize: 8,
    lineStyle: { width: 3, color: '#1689ff' },
    areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: 'rgba(22,137,255,.42)' }, { offset: 1, color: 'rgba(18,205,196,.08)' }] } }
  }]
}));
</script>

<template><div ref="el" class="chart"></div></template>
