import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import * as echarts from 'echarts';

export function useChart(element: Ref<HTMLElement | null>, buildOptions: () => echarts.EChartsOption) {
  let chart: echarts.ECharts | null = null;

  const render = () => {
    if (!element.value) return;
    chart ??= echarts.init(element.value);
    chart.setOption(buildOptions(), true);
  };

  const resize = () => chart?.resize();

  onMounted(() => {
    render();
    window.addEventListener('resize', resize);
  });
  onBeforeUnmount(() => {
    window.removeEventListener('resize', resize);
    chart?.dispose();
  });
  watch(buildOptions, render, { deep: true });

  return { render };
}
