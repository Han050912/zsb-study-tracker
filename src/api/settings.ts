import { request } from './client'
import type { Settings } from '../types'

export const settingsApi = {
  get: () => request<Settings>('/api/settings'),
  update: (data: Settings) =>
    request<Settings>('/api/settings', { method: 'PUT', body: JSON.stringify(data) })
}
