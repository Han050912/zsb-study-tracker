'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(require('node:path').join(__dirname, 'preload.cjs'), 'utf8')

/** Execute preload.cjs with only the Electron APIs it is allowed to use. */
function loadPreload(platform) {
  const exposed = {}
  const listeners = new Map()
  const sent = []
  const ipcRenderer = {
    on(channel, listener) {
      listeners.set(channel, listener)
    },
    removeListener(channel, listener) {
      if (listeners.get(channel) === listener) listeners.delete(channel)
    },
    send(channel, payload) {
      sent.push({ channel, payload })
    },
    invoke: async (channel) => {
      sent.push({ channel, invoke: true })
      return 'desktop-token'
    }
  }
  const contextBridge = {
    exposeInMainWorld(name, value) {
      exposed[name] = value
    }
  }

  vm.runInNewContext(source, {
    require: (name) => {
      assert.equal(name, 'electron')
      return { contextBridge, ipcRenderer }
    },
    process: { platform },
    console
  })

  return { exposed, listeners, sent }
}

test('Windows updater bridge exposes check lifecycle events and unsubscribes listeners', async () => {
  const f = loadPreload('win32')
  const updater = f.exposed.updater
  assert.ok(updater)
  assert.equal(updater.available, true)

  updater.check()
  updater.download()
  updater.cancelDownload()
  updater.install()
  assert.deepEqual(
    f.sent.slice(0, 4).map(({ channel }) => channel),
    ['update:check', 'update:download', 'update:cancel-download', 'update:install']
  )

  const received = []
  const stopChecking = updater.onChecking((payload) => received.push(['checking', payload]))
  assert.equal(typeof stopChecking, 'function')
  assert.equal(f.listeners.has('update:checking'), true)
  f.listeners.get('update:checking')({}, { source: 'manual' })
  assert.deepEqual(received, [['checking', { source: 'manual' }]])
  stopChecking()
  assert.equal(f.listeners.has('update:checking'), false)

  for (const [method, channel, payload] of [
    ['onAvailable', 'update:available', { version: '2.0.4' }],
    ['onNotAvailable', 'update:not-available', { currentVersion: '2.0.3' }],
    ['onProgress', 'update:progress', { percent: 25 }],
    ['onDownloaded', 'update:downloaded', { version: '2.0.4' }],
    ['onError', 'update:error', 'network error'],
    ['onCheckError', 'update:check-error', { message: 'network error' }]
  ]) {
    const seen = []
    const stop = updater[method]((value) => seen.push(value))
    assert.equal(typeof stop, 'function', `${method} returns an unsubscribe function`)
    assert.equal(f.listeners.has(channel), true, `${method} subscribes to ${channel}`)
    f.listeners.get(channel)({}, payload)
    assert.deepEqual(seen, [payload], `${method} receives the IPC payload without the event object`)
    stop()
    assert.equal(f.listeners.has(channel), false, `${method} removes its listener`)
  }

  assert.equal(await f.exposed.desktopAuth.getToken(), 'desktop-token')
})

test('non-Windows preload keeps desktop metadata but does not expose updater', () => {
  const f = loadPreload('darwin')
  assert.equal(f.exposed.updater, undefined)
  assert.equal(f.exposed.desktopPlatform, 'darwin')
})
