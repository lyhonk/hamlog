<script setup lang="ts">
import { Trophy } from 'lucide-vue-next';

defineProps<{ title: string; items: Array<{ name: string; value: number }> }>();
</script>

<template>
  <article class="rank-panel">
    <h3 class="title-with-icon"><Trophy :size="18" />{{ title }}</h3>
    <ol>
      <li v-for="(item, index) in items" :key="item.name">
        <span class="rank-index">{{ index + 1 }}</span>
        <span class="rank-name" :title="item.name">{{ item.name }}</span>
        <span class="rank-meter">
          <span class="rank-bar"><i :style="{ width: `${Math.max((item.value / Math.max(...items.map((x) => x.value))) * 100, 6)}%` }"></i></span>
          <b class="rank-value">{{ item.value.toLocaleString('zh-CN') }}</b>
        </span>
      </li>
    </ol>
  </article>
</template>
