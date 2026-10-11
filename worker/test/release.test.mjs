import test from 'node:test'
import assert from 'node:assert/strict'

import { hasReleaseBody, normalizeReleaseTag } from '../src/releaseCache.ts'

test('hasReleaseBody accepts a non-empty release body', () => {
  assert.equal(hasReleaseBody({ body: '# Changes\n\n- Fix update notes' }), true)
})

test('hasReleaseBody rejects missing, non-string, and whitespace-only bodies', () => {
  assert.equal(hasReleaseBody(undefined), false)
  assert.equal(hasReleaseBody(null), false)
  assert.equal(hasReleaseBody({}), false)
  assert.equal(hasReleaseBody({ body: 123 }), false)
  assert.equal(hasReleaseBody({ body: ' \t\r\n' }), false)
})

test('normalizeReleaseTag accepts stable and prerelease versions only', () => {
  assert.equal(normalizeReleaseTag('2.0.3'), 'v2.0.3')
  assert.equal(normalizeReleaseTag('v2.0.3-beta.1'), 'v2.0.3-beta.1')
  assert.equal(normalizeReleaseTag('2.0.3+build.7'), 'v2.0.3+build.7')
  assert.equal(normalizeReleaseTag('latest'), null)
  assert.equal(normalizeReleaseTag('2.0'), null)
  assert.equal(normalizeReleaseTag('2.0.3/../../secret'), null)
})
