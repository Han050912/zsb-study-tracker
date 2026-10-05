<script setup lang="ts">
import { isLoggedIn } from '../services/auth'
</script>
<template>
  <section class="max-w-lg mx-auto px-5 py-16 text-center space-y-4">
    <p class="text-action dark:text-action font-data text-5xl font-bold">404</p>
    <h1 class="page-title">这个页面不存在</h1>
    <p class="text-sm text-slate-500 dark:text-slate-400">链接可能已失效，或地址输入有误。你可以返回继续学习。</p>
    <RouterLink class="btn-primary" :to="isLoggedIn ? '/' : '/login'">{{
      isLoggedIn ? '返回首页' : '前往登录'
    }}</RouterLink>
  </section>
</template>
