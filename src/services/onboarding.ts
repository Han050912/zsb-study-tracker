import type { Settings } from '../types'

const completedUsers = new Set<string>()
const STORAGE_PREFIX = 'zsb_onboarded_v1:'

/** Skipping and finishing are permanent for this account, even before settings sync succeeds. */
export function restoreOnboarding(userId: string | null, settings: Settings): boolean {
  if (!userId) return false
  const wasOnboarded = settings.onboarded
  const key = STORAGE_PREFIX + userId
  if (!settings.onboarded && !completedUsers.has(userId)) {
    try {
      if (localStorage.getItem(key) !== '1') return false
    } catch {
      return false
    }
  }
  completedUsers.add(userId)
  settings.onboarded = true
  try {
    localStorage.setItem(key, '1')
  } catch {
    // The settings outbox still syncs the flag; retain it in memory if storage is unavailable.
  }
  return !wasOnboarded
}
