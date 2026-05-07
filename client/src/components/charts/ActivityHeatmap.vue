<script setup lang="ts">
const props = defineProps<{ data: Array<{ weekDay: string; month: string; count: number }> }>();
const months = ['5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '1月', '2月', '3月', '4月'];
const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function value(monthIndex: number, dayIndex: number) {
  const month = String(((monthIndex + 4) % 12) + 1).padStart(2, '0');
  const weekDay = String(dayIndex === 6 ? 0 : dayIndex + 1);
  return props.data.find((item) => item.month === month && item.weekDay === weekDay)?.count ?? 0;
}
</script>

<template>
  <div class="heatmap">
    <div class="heat-months"><span></span><b v-for="month in months" :key="month">{{ month }}</b></div>
    <div v-for="(day, dayIndex) in days" :key="day" class="heat-row">
      <span>{{ day }}</span>
      <i
        v-for="(_, monthIndex) in months"
        :key="monthIndex"
        :style="{ opacity: Math.min(0.18 + value(monthIndex, dayIndex) / 18, 1) }"
        :title="`${day} ${months[monthIndex]}: ${value(monthIndex, dayIndex)}`"
      ></i>
    </div>
  </div>
</template>
