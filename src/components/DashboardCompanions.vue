<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Users, ArrowRight } from '@lucide/vue'
import { usePartnerStore } from '../features/collaboration/stores/partners'

const partners = usePartnerStore()
const loading = ref(true)
async function load() {
  loading.value = true
  try {
    await partners.load(true)
  } catch {
    /* store 保留错误，页面提供重试。 */
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>

<template>
  <aside class="dashboard-companions" aria-labelledby="dashboard-companions-title">
    <header class="dashboard-companions-heading">
      <h2 id="dashboard-companions-title"><Users :size="18" aria-hidden="true" />一起备考</h2>
      <RouterLink to="/teams?mode=partners" class="text-xs arrow-link"
        >{{ partners.partners.length ? '查看搭子' : '找搭子' }}
        <ArrowRight class="arrow-inline" :size="16" aria-hidden="true"
      /></RouterLink>
    </header>
    <p class="dashboard-companions-copy" :role="loading ? 'status' : undefined">
      <template v-if="loading">正在查看你的搭子…</template>
      <template v-else-if="partners.error">搭子列表未能加载</template>
      <template v-else-if="partners.partners.length">
        <strong>{{
          partners.partners
            .slice(0, 2)
            .map((p) => p.userName)
            .join('、')
        }}</strong
        >{{ partners.partners.length > 2 ? ` 等 ${partners.partners.length} 位搭子` : '' }} 和你一起备考
      </template>
      <template v-else>找个搭子，交换错题，也聊聊今天。</template>
      <span v-if="!loading && !partners.error && partners.incoming.length" class="text-muted">
        · {{ partners.incoming.length }} 个邀请待处理</span
      >
    </p>
    <button v-if="partners.error && !loading" type="button" class="study-link text-sm" @click="load">重新加载</button>
    <p v-else-if="!loading" class="dashboard-companions-hint">在搭子与小队中查看学习近况、处理邀请。</p>
  </aside>
</template>

<style scoped>
.dashboard-companions {
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: var(--radius-card);
  background: var(--surface);
}
.dashboard-companions-heading,
.dashboard-companions-heading h2 {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dashboard-companions-heading {
  justify-content: space-between;
  gap: 16px;
}
.dashboard-companions-heading h2 {
  font-size: 16px;
  font-weight: 700;
}
.dashboard-companions-heading .arrow-link {
  flex-shrink: 0;
  min-height: 32px;
}
.dashboard-companions-copy {
  margin-top: 12px;
  font-size: 14px;
  overflow-wrap: anywhere;
}
.dashboard-companions-hint {
  margin-top: 8px;
  font-size: 13px;
  color: var(--muted);
}
</style>
