import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const result = await build({
  stdin: {
    contents: "export { pomodoroActions } from './src/stores/app/pomodoro'; export { today } from './src/utils/date';",
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'capture-only-outbox',
      setup(builder) {
        builder.onResolve({ filter: /services\/syncOutbox$/ }, () => ({ path: 'outbox', namespace: 'capture' }))
        builder.onLoad({ filter: /.*/, namespace: 'capture' }, () => ({
          contents:
            'export const stageUpsert=(...args)=>globalThis.__pomodoroUpserts.push(structuredClone(args)); export const stageDelete=()=>{};'
        }))
      }
    }
  ]
})
await mkdir('.cache/pomodoro-tests', { recursive: true })
const filename = `.cache/pomodoro-tests/${crypto.randomUUID()}.mjs`
await writeFile(filename, result.outputFiles[0].text)
const { pomodoroActions, today } = await import(pathToFileURL(`${process.cwd()}/${filename}`).href)
await unlink(filename)

function store() {
  globalThis.__pomodoroUpserts = []
  return {
    pomodoro: { daily: {}, interruptions: [], records: [] },
    rewards: [],
    saves: 0,
    addPoints(...reward) {
      this.rewards.push(reward)
    },
    save() {
      this.saves++
    }
  }
}

test('提前结束记录实际时长和false完成状态，完成次数与奖励都不增加', () => {
  const app = store()
  assert.equal(pomodoroActions.recordPomodoro.call(app, 2, '试读', 'solo', undefined, false), true)
  assert.deepEqual(
    [app.pomodoro.daily[today()].count, app.pomodoro.daily[today()].minutes, app.pomodoro.records[0].completed],
    [0, 2, false]
  )
  assert.equal(app.rewards.length, 0)
  assert.equal(globalThis.__pomodoroUpserts.find((r) => r[1].startsWith('rec:'))[2].completed, false)
  assert.equal(pomodoroActions.recordPomodoro.call(app, 25, '完成', 'party', '搭子'), true)
  assert.equal(app.pomodoro.daily[today()].count, 1)
  assert.equal(app.pomodoro.daily[today()].minutes, 27)
  assert.equal(app.pomodoro.records[1].completed, true)
  assert.equal(app.rewards.length, 1)
  assert.equal(app.rewards[0][0], 5)
  assert.equal(app.rewards[0][2], app.pomodoro.records[1].id)
  assert.equal(app.saves, 2)
})

test('不足一分钟和非有限时长不生成记录、日计数、奖励或待同步操作', () => {
  const app = store()
  for (const minutes of [0, -1, 0.5, NaN, Infinity])
    assert.equal(pomodoroActions.recordPomodoro.call(app, minutes), false)
  assert.equal(app.pomodoro.records.length, 0)
  assert.equal(Object.keys(app.pomodoro.daily).length, 0)
  assert.equal(app.rewards.length, 0)
  assert.equal(globalThis.__pomodoroUpserts.length, 0)
  assert.equal(app.saves, 0)
})

test('two interruptions at the same millisecond keep distinct identities on the actual outgoing payload', () => {
  const app = store()
  const originalNow = Date.now
  Date.now = () => 100
  try {
    pomodoroActions.recordInterruption.call(app, 'phone')
    pomodoroActions.recordInterruption.call(app, 'phone')
    assert.notEqual(app.pomodoro.interruptions[0].id, app.pomodoro.interruptions[1].id)
    const entries = globalThis.__pomodoroUpserts.filter((row) => row[1].startsWith('itr:'))
    assert.deepEqual(
      entries.at(-1)[2].map((item) => item.id),
      app.pomodoro.interruptions.map((item) => item.id)
    )
    assert.equal(globalThis.__pomodoroUpserts.find((row) => row[1].startsWith('day:'))[2].derived, true)
  } finally {
    Date.now = originalNow
  }
})
