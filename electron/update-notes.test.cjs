'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { isReleaseForVersion, normalizeReleaseVersion } = require('./update-notes.cjs')

test('normalizeReleaseVersion accepts updater and GitHub tag spellings', () => {
  assert.equal(normalizeReleaseVersion('2.0.3'), '2.0.3')
  assert.equal(normalizeReleaseVersion(' v2.0.3 '), '2.0.3')
  assert.equal(normalizeReleaseVersion(2.03), '2.03')
  assert.equal(normalizeReleaseVersion(null), '')
})

test('isReleaseForVersion rejects notes from a different release', () => {
  assert.equal(isReleaseForVersion({ tag_name: 'v2.0.3' }, '2.0.3'), true)
  assert.equal(isReleaseForVersion({ version: '2.0.3' }, 'v2.0.3'), true)
  assert.equal(isReleaseForVersion({ tag_name: 'invalid', version: '2.0.3' }, '2.0.3'), true)
  assert.equal(isReleaseForVersion({ tag_name: 'v2.0.2' }, '2.0.3'), false)
  assert.equal(isReleaseForVersion({ name: 'v2.0.3' }, '2.0.3'), false)
  assert.equal(isReleaseForVersion({}, '2.0.3'), false)
})
