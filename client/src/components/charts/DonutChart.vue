<script setup lang="ts">
import { computed, ref } from 'vue';
import { useChart } from '../../composables/useChart';

const props = defineProps<{ data: Array<{ name: string; value: number }>; centerLabel: string }>();
const el = ref<HTMLElement | null>(null);
const total = computed(() => props.data.reduce((sum, item) => sum + item.value, 0));

useChart(el, () => ({
  tooltip: { trigger: 'item' },
  legend: { orient: 'vertical', right: 0, top: 'middle', itemWidth: 8, itemHeight: 8, textStyle: { color: '#17335d' } },
  graphic: [{ type: 'text', left: '25%', top: '43%', style: { text: `${total.value}\n${props.centerLabel}`, textAlign: 'center', fill: '#0d2a57', fontSize: 16, fontWeight: 700 } }],
  series: [{
    type: 'pie',
    radius: ['50%', '76%'],
    center: ['32%', '50%'],
    avoidLabelOverlap: true,
    label: { show: false },
    data: props.data
  }]
}));
</script>

<template><div ref="el" class="chart"></div></template>
