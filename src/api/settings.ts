import { request } from './client'
import type { Settings } from '../types'

export const settingsApi = {
  get: () => request<Settings>('/api/settings'),
  validate: (data: Pick<Settings, 'userName' | 'bio'>) =>
    request<{ userName: string; bio: string }>('/api/settings/validate', {
      method: 'POST',
      body: JSON.stringify(data)
    })
}
