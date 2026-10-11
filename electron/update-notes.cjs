'use strict'

/**
 * Normalize the two version spellings used by the updater and GitHub:
 * electron-updater reports `2.0.3`, while GitHub tags are usually `v2.0.3`.
 */
function normalizeReleaseVersion(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim().replace(/^v/i, '')
}

/**
 * Ensure a release response belongs to the update electron-updater announced.
 * The public endpoint normally returns the latest release, so accepting an
 * unqualified response could show notes for a different version during a
 * release rollout or while a stale cache entry is still active.
 */
function isReleaseForVersion(release, version) {
  if (!release || typeof release !== 'object') return false
  const expected = normalizeReleaseVersion(version)
  if (!expected) return false

  return [release.tag_name, release.version].some((value) => normalizeReleaseVersion(value) === expected)
}

module.exports = { isReleaseForVersion, normalizeReleaseVersion }
