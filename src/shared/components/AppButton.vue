<script setup lang="ts">
withDefaults(defineProps<{ pending?: boolean; variant?: 'primary' | 'ghost' | 'danger'; disabled?: boolean }>(), {
  variant: 'primary'
})
</script>
<template>
  <button type="button" :class="`btn-${variant}`" :disabled="pending || disabled" :aria-busy="pending || undefined">
    <span
      v-if="pending"
      aria-hidden="true"
      class="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent"
    ></span
    ><slot />
  </button>
</template>
