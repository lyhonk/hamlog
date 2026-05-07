<script setup lang="ts">
import type { Component } from 'vue';

defineProps<{
  title: string;
  value: number;
  subtitle: string;
  color: 'blue' | 'teal' | 'purple' | 'orange';
  icon: Component;
}>();
</script>

<template>
  <article class="stat-card" :class="color">
    <div class="stat-icon"><component :is="icon" :size="30" /></div>
    <div>
      <span>{{ title }}</span>
      <strong>{{ value.toLocaleString('zh-CN') }}</strong>
      <small>{{ subtitle }}</small>
    </div>
  </article>
</template>
