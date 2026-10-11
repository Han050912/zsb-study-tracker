import { ref, shallowRef } from 'vue'

/**
 * Renderer-wide update state. The updater event bridge is owned by
 * UpdateDialog, while App.vue reads this state to render the navigation badge.
 */
export interface UpdateInfo {
  version: string
  releaseName: string
  releaseNotes: string
  releaseDate: string
  source?: 'manual' | 'automatic'
}

export const AUTO_UPDATE_KEY = 'zsb-auto-update-enabled'
export const updateAvailable = ref(false)
export const updateInfo = shallowRef<UpdateInfo | null>(null)
export const updateDialogRequest = ref(0)

export function readAutoUpdatePreference(): boolean | null {
  if (typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(AUTO_UPDATE_KEY)
    return value === null ? null : value !== '0'
  } catch {
    return null
  }
}

export const autoUpdateEnabled = ref(readAutoUpdatePreference() ?? true)

export function setAutoUpdateEnabled(value: boolean) {
  autoUpdateEnabled.value = value
  try {
    window.localStorage.setItem(AUTO_UPDATE_KEY, value ? '1' : '0')
  } catch {
    /* localStorage can be unavailable in a restricted browser context. */
  }
}

export function requestUpdateDialog() {
  updateDialogRequest.value += 1
}
