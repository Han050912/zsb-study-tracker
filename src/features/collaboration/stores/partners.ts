import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { partnersApi } from '../../../api/community/partners'
import type { PartnerItem, PartnerSuggestion } from '../../../types'
import { getErrorMessage } from '../../../utils/error'

export const usePartnerStore = defineStore('collaboration-partners', () => {
  const partnersById = ref<Record<string, PartnerItem>>({}),
    ids = ref<string[]>([]),
    incoming = ref<PartnerItem[]>([])
  const suggestions = ref<PartnerSuggestion[]>([]),
    updatedAt = ref(0),
    suggestionsUpdatedAt = ref(0),
    error = ref('')
  const partners = computed(() => ids.value.map((id) => partnersById.value[id]).filter(Boolean))
  let generation = 0,
    pending: Promise<{ partners: PartnerItem[]; incoming: PartnerItem[] }> | null = null
  let recommendations: Promise<void> | null = null
  async function load(force = false) {
    if (pending) return pending
    if (!force && Date.now() - updatedAt.value < 60_000) return { partners: partners.value, incoming: incoming.value }
    const owner = generation
    const request = partnersApi
      .partners()
      .then((res) => {
        if (generation === owner) {
          partnersById.value = Object.fromEntries(res.partners.map((p) => [p.userId, p]))
          ids.value = res.partners.map((p) => p.userId)
          incoming.value = res.incoming
          updatedAt.value = Date.now()
          error.value = ''
        }
        return res
      })
      .catch((e) => {
        if (generation === owner) error.value = getErrorMessage(e, '搭子加载失败')
        throw e
      })
      .finally(() => {
        if (pending === request) pending = null
      })
    pending = request
    return request
  }
  async function loadSuggestions(force = false) {
    if (recommendations) return recommendations
    if (!force && Date.now() - suggestionsUpdatedAt.value < 300_000) return
    const owner = generation
    const request = partnersApi
      .partnerSuggestions()
      .then((res) => {
        if (owner === generation) {
          suggestions.value = res.suggestions
          suggestionsUpdatedAt.value = Date.now()
        }
      })
      .finally(() => {
        if (recommendations === request) recommendations = null
      })
    recommendations = request
    return request
  }
  async function respond(reqId: string, action: 'accept' | 'reject') {
    const owner = generation
    await partnersApi.respondPartner(reqId, action)
    if (owner !== generation) return
    const partner = incoming.value.find((p) => p.reqId === reqId)
    incoming.value = incoming.value.filter((p) => p.reqId !== reqId)
    if (action === 'accept' && partner) {
      partnersById.value[partner.userId] = partner
      ids.value = [...new Set([...ids.value, partner.userId])]
    }
    updatedAt.value = 0
    void load(true).catch(() => {})
  }
  async function unbind(userId: string) {
    const owner = generation
    await partnersApi.unbindPartner(userId)
    if (owner !== generation) return
    ids.value = ids.value.filter((id) => id !== userId)
    delete partnersById.value[userId]
    updatedAt.value = Date.now()
    suggestionsUpdatedAt.value = 0
  }
  function resetState() {
    generation++
    pending = null
    recommendations = null
    partnersById.value = {}
    ids.value = []
    incoming.value = []
    suggestions.value = []
    updatedAt.value = 0
    suggestionsUpdatedAt.value = 0
    error.value = ''
  }
  return {
    partnersById,
    ids,
    partners,
    incoming,
    suggestions,
    updatedAt,
    error,
    load,
    loadSuggestions,
    respond,
    unbind,
    resetState
  }
})
