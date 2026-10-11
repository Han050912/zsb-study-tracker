import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { DatabaseSync } from 'node:sqlite'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const compiled = await build({
  stdin: {
    contents: `export { todosActions } from './src/stores/app/todos';
      export { pomodoroActions } from './src/stores/app/pomodoro';
      export * from './src/utils/studyTime';
      export { today } from './src/utils/date';
      export { applyChanges } from './src/services/syncDomains';
      export { pomodoroRecordStatement, pomodoroRecordFromRow } from './worker/src/api/pomodoro';
      export { todosMapping } from './worker/src/api/todos';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false,
  plugins: [
    {
      name: 'capture-focus-outbox',
      setup(builder) {
        builder.onResolve({ filter: /services\/syncOutbox$/ }, () => ({ path: 'outbox', namespace: 'capture' }))
        builder.onLoad({ filter: /.*/, namespace: 'capture' }, () => ({
          contents:
            'export const stageUpsert=(...args)=>globalThis.__focusUpserts.push(structuredClone(args)); export const stageDelete=()=>{};'
        }))
      }
    }
  ]
})
await mkdir('.cache/focus-tests', { recursive: true })
const file = `.cache/focus-tests/${crypto.randomUUID()}.mjs`
await writeFile(file, compiled.outputFiles[0].text)
const {
  todosActions,
  pomodoroActions,
  studyMinutesOn,
  subjectStudyRecordsOn,
  unassignedFocusMinutesOn,
  today,
  applyChanges,
  pomodoroRecordStatement,
  pomodoroRecordFromRow,
  todosMapping
} = await import(pathToFileURL(`${process.cwd()}/${file}`).href)
await unlink(file)

function state() {
  globalThis.__focusUpserts = []
  return {
    records: [],
    todos: [],
    pomodoro: { daily: {}, records: [], interruptions: [] },
    rewards: [],
    save() {},
    addPoints(...args) {
      this.rewards.push(args)
    }
  }
}

test('task-linked focus keeps one duration fact and survives outbound/pull metadata round trip', () => {
  const app = state()
  todosActions.addTodo.call(app, '重做极限题', undefined, today(), { subjectId: 'math', chapterId: 'limits' })
  const todo = app.todos[0]
  assert.equal(todo.subjectId, 'math')
  assert.equal(todo.chapterId, 'limits')
  todosActions.updateTodo.call(app, todo.id, '重做极限题', { subjectId: 'english', chapterId: 'reading' })
  assert.equal(todo.chapterId, 'reading', 'same title can update learning direction')
  pomodoroActions.recordPomodoro.call(app, 25, todo.text, 'solo', undefined, true, {
    todoId: todo.id,
    subjectId: todo.subjectId,
    chapterId: todo.chapterId
  })
  assert.equal(todo.done, false, 'focus completion never implicitly completes a task')
  assert.equal(app.records.length, 0, 'no duplicate manual learning record is written')
  assert.equal(studyMinutesOn(app, today()), 25)
  assert.equal(subjectStudyRecordsOn(app, today())[0].subjectId, 'english')
  assert.equal(unassignedFocusMinutesOn(app, today()), 0)
  const outgoing = globalThis.__focusUpserts.find((row) => row[1].startsWith('rec:'))
  assert.equal(outgoing[2].todoId, todo.id)
  const anotherDevice = state()
  applyChanges('pomodoro', anotherDevice, {
    upserts: [{ key: outgoing[1], value: outgoing[2], updatedAt: outgoing[3] }],
    deletes: []
  })
  assert.equal(anotherDevice.pomodoro.records[0].chapterId, 'reading')
  todosActions.updateTodo.call(app, todo.id, todo.text, {})
  assert.equal(todo.subjectId, undefined)
  assert.equal(todo.chapterId, undefined)
})

test('attribution keeps old unattributed totals and early-ended minutes, including deleted subject IDs', () => {
  const app = state()
  app.records.push({ id: 'manual', date: today(), subjectId: 'math', minutes: 10, createdAt: 1 })
  app.pomodoro.daily[today()] = { count: 1, minutes: 40, interruptions: 0 }
  app.pomodoro.records.push({ id: 'legacy', date: today(), time: 1, minutes: 25, description: '', source: 'solo' })
  pomodoroActions.recordPomodoro.call(app, 2, '未完成', 'solo', undefined, false, { subjectId: 'deleted-subject' })
  assert.equal(studyMinutesOn(app, today()), 52)
  assert.equal(unassignedFocusMinutesOn(app, today()), 40)
  const attributed = subjectStudyRecordsOn(app, today())
  assert.deepEqual(
    attributed.map((r) => [r.subjectId, r.minutes]),
    [
      ['math', 10],
      ['deleted-subject', 2]
    ]
  )
  assert.equal(app.pomodoro.daily[today()].count, 1)
  assert.equal(app.rewards.length, 0)
  assert.equal(
    attributed.reduce((sum, r) => sum + r.minutes, 0) + unassignedFocusMinutesOn(app, today()),
    studyMinutesOn(app, today())
  )
})

test('new DB fields persist links and old-client description edits preserve existing focus links', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(await readFile('worker/schema.sql', 'utf8'))
    db.exec("INSERT INTO users (id, username, password_hash, created_at) VALUES ('u', 'focus-test', 'unused', 0)")
    const env = {
      DB: {
        prepare(sql) {
          return {
            bind(...args) {
              return { run: () => db.prepare(sql).run(...args) }
            }
          }
        }
      }
    }
    const value = {
      date: '2026-10-11',
      time: 100,
      minutes: 2,
      completed: false,
      description: '题目',
      todoId: 'task-1',
      subjectId: 'math',
      chapterId: 'limits'
    }
    pomodoroRecordStatement(env, 'u', 'r', value, { updatedAt: 100, seq: 1 }).run()
    const row = db.prepare('SELECT * FROM pomodoro_records').get()
    assert.equal(row.todo_id, 'task-1')
    assert.equal(pomodoroRecordFromRow(row).chapterId, 'limits')
    pomodoroRecordStatement(
      env,
      'u',
      'r',
      { date: value.date, time: 100, minutes: 2, description: '旧客户端改备注' },
      { updatedAt: 200, seq: 2 }
    ).run()
    const edited = pomodoroRecordFromRow(db.prepare('SELECT * FROM pomodoro_records').get())
    assert.equal(edited.completed, false)
    assert.equal(edited.subjectId, 'math')
    assert.equal(edited.todoId, 'task-1')
    const mapping = todosMapping.mapping
    const todoRow = mapping.toRow('u', { date: value.date, text: '题目', subjectId: 'math', chapterId: 'limits' }, 't')
    assert.equal(mapping.fromRow(todoRow).subjectId, 'math')
    assert.equal(mapping.fromRow(todoRow).chapterId, 'limits')
  } finally {
    db.close()
  }
})

test('0012 upgrades existing tasks and focus records without changing their historical totals', async () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE todos (id TEXT, text TEXT); INSERT INTO todos VALUES ('t', 'existing');
      CREATE TABLE pomodoro_records (id TEXT, minutes INTEGER); INSERT INTO pomodoro_records VALUES ('r', 25);`)
    db.exec(await readFile('worker/migrations/0012_focus_task_links.sql', 'utf8'))
    assert.equal(db.prepare('SELECT minutes FROM pomodoro_records').get().minutes, 25)
    assert.equal(db.prepare('SELECT subject_id FROM todos').get().subject_id, null)
    assert.equal(db.prepare('SELECT todo_id FROM pomodoro_records').get().todo_id, null)
  } finally {
    db.close()
  }
})
