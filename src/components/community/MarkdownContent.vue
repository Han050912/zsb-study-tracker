<script setup lang="ts">
import { useMarkdownHtml } from '../../composables/useMarkdownHtml'
const props = defineProps<{ content: string }>()
const html = useMarkdownHtml(() => props.content)
</script>
<template><div class="text-sm md-body break-words" v-html="html"></div></template>
