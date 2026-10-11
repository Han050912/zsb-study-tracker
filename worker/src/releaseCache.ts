/**
 * Return whether a GitHub release payload has usable release notes.
 *
 * GitHub can expose a release before its description is populated. The
 * updater must retry that transient state instead of caching an empty body.
 */
export function hasReleaseBody(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const body = (data as { body?: unknown }).body
  return typeof body === 'string' && body.trim().length > 0
}

/** Normalize an updater version into a safe GitHub release tag. */
export function normalizeReleaseTag(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const version = String(value).trim().replace(/^v/i, '')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) return null
  return `v${version}`
}
