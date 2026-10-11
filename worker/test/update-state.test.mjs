import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const root = process.cwd()
const compiled = await build({
  stdin: {
    contents: `export * from './src/composables/useUpdateState'`,
    resolveDir: root,
    sourcefile: 'update-state-fixture.ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue']
})

await mkdir(path.join(root, '.cache', 'update-state-tests'), { recursive: true })
const fixture = path.join(root, '.cache', 'update-state-tests', `state-${crypto.randomUUID()}.mjs`)
await writeFile(fixture, compiled.outputFiles[0].text)

function localStorage(initial = null) {
  const values = new Map(initial === null ? [] : [['zsb-auto-update-enabled', initial]])
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    value: () => values.get('zsb-auto-update-enabled')
  }
}

test('auto-update preference defaults on and persists a device-level opt-out', async () => {
  const storage = localStorage()
  globalThis.window = { localStorage: storage }
  const state = await import(`${pathToFileURL(fixture).href}?default`)

  assert.equal(state.autoUpdateEnabled.value, true)
  state.setAutoUpdateEnabled(false)
  assert.equal(state.autoUpdateEnabled.value, false)
  assert.equal(storage.value(), '0')
  state.setAutoUpdateEnabled(true)
  assert.equal(state.autoUpdateEnabled.value, true)
  assert.equal(storage.value(), '1')
})

test('persisted opt-out is restored on a fresh module load and dialog requests are monotonic', async () => {
  const storage = localStorage('0')
  globalThis.window = { localStorage: storage }
  const state = await import(`${pathToFileURL(fixture).href}?disabled`)

  assert.equal(state.autoUpdateEnabled.value, false)
  assert.equal(state.updateDialogRequest.value, 0)
  state.requestUpdateDialog()
  state.requestUpdateDialog()
  assert.equal(state.updateDialogRequest.value, 2)
})

test.after(async () => {
  await unlink(fixture)
})
