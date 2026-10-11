'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')
const preloadSource = fs.readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8')

test('main process forwards every update-check outcome to the renderer', () => {
  assert.match(mainSource, /autoUpdater\.on\('checking-for-update'/)
  assert.match(mainSource, /send\('update:checking'/)
  assert.match(mainSource, /autoUpdater\.on\('update-not-available'/)
  assert.match(mainSource, /send\('update:not-available'/)
  assert.match(mainSource, /send\('update:check-error'/)
  assert.match(mainSource, /currentVersion:\s*app\.getVersion\(\)/)
})

test('preload and main agree on update-check IPC channel names', () => {
  for (const channel of ['update:checking', 'update:not-available', 'update:check-error']) {
    assert.match(preloadSource, new RegExp(`subscribe\\('${channel.replace(':', '\\:')}'`))
    assert.match(mainSource, new RegExp(`send\\('${channel.replace(':', '\\:')}'`))
  }
})
