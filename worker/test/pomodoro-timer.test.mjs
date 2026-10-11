import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const component = await readFile('src/pages/Pomodoro.vue', 'utf8')
const script = component.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
const modules = {
  vue: 'export const ref=value=>({value}); export const computed=read=>({get value(){return read()}}); export const onMounted=()=>{};export const onUnmounted=()=>{};',
  'vue-router':
    'export const useRoute=()=>({query:{}});export const useRouter=()=>({push(){}});export const onBeforeRouteLeave=()=>{};',
  '@lucide/vue': 'export const Ban={},ArrowLeft={};',
  app: 'export const useAppStore=()=>globalThis.__timerTestStore;',
  studyTimer: 'export const useStudyTimerStore=()=>({session:null});',
  auth: 'export const sessionUser={value:{id:"timer-user"}};',
  partners: 'export const partnersApi={activeStudySession:async()=>({session:null})};',
  useToast: 'export const useToast=()=>()=>{};',
  useWallpaperRotation:
    'export const useWallpaperRotation=()=>({bgUrl:{value:""},startBgRotation(){},stopBgRotation(){}});',
  useClock: 'export const useClock=()=>({now:{value:new Date()},clockText:{value:""},dateText:{value:""}});',
  component: 'export default {};'
}
const result = await build({
  stdin: {
    contents: `${script}\nexport {start,tick,giveUp,stopTimer,focusMinutes,breakMinutes,phase,pause,restoreSoloState,todoId,subjectId,chapterId,settlement,confirmTaskComplete};`,
    resolveDir: `${process.cwd()}/src/pages`,
    loader: 'ts'
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'timer-browser-boundaries',
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /^(vue|vue-router|@lucide\/vue)$|stores\/(app|studyTimer)$|services\/auth$|api\/community\/partners$|composables\/(useToast|useWallpaperRotation|useClock)$|\.vue$/
          },
          ({ path }) => ({
            path: path.endsWith('.vue') ? 'component' : path === '@lucide/vue' ? '@lucide/vue' : path.split('/').at(-1),
            namespace: 'boundary'
          })
        )
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => ({ contents: modules[path] }))
      }
    }
  ]
})
await mkdir('.cache/timer-tests', { recursive: true })
const file = `.cache/timer-tests/${crypto.randomUUID()}.mjs`
await writeFile(file, result.outputFiles[0].text)

test('one-minute countdown settles on focus completion, without waiting for the break or counting it twice', async () => {
  const data = new Map()
  globalThis.localStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key)
  }
  globalThis.document = {
    documentElement: { requestFullscreen: async () => {} },
    activeElement: null,
    exitFullscreen: async () => {}
  }
  globalThis.__timerTestStore = {
    settings: { quotes: [] },
    subjectMap: {},
    todayPomodoro: { count: 0, minutes: 0 },
    pomodoro: { records: [], interruptions: [] },
    todos: [{ id: 'todo-1', text: '极限练习', done: false, subjectId: 'math', chapterId: 'limits' }],
    toggles: 0,
    toggleTodo(id) {
      this.todos.find((todo) => todo.id === id).done = true
      this.toggles++
    },
    completed: [],
    recordPomodoro(minutes, description, source, partnerName, completed, links) {
      this.completed.push({ minutes, description, completed, links: structuredClone(links) })
      return true
    }
  }
  const originalNow = Date.now
  let time = originalNow()
  Date.now = () => time
  const timer = await import(pathToFileURL(`${process.cwd()}/${file}`).href)
  try {
    timer.focusMinutes.value = 1
    timer.breakMinutes.value = 1
    timer.start()
    time += 60000
    timer.tick()
    assert.equal(timer.phase.value, 'break')
    assert.equal(globalThis.__timerTestStore.completed.length, 1)
    assert.equal(globalThis.__timerTestStore.completed[0].minutes, 1)
    time += 60000
    timer.tick()
    assert.equal(timer.phase.value, 'idle')
    assert.equal(globalThis.__timerTestStore.completed.length, 1)
    timer.giveUp()
    assert.equal(globalThis.__timerTestStore.completed.length, 1)

    // Restore a paused task-linked focus, then finish it after wall-clock waiting.
    timer.todoId.value = 'todo-1'
    timer.subjectId.value = 'math'
    timer.chapterId.value = 'limits'
    timer.start()
    time += 30000
    timer.pause()
    assert.equal(JSON.parse(data.get('zsb-pomodoro-solo-v1:timer-user')).activeLinks.todoId, 'todo-1')
    timer.subjectId.value = 'english'
    timer.chapterId.value = 'reading'
    timer.restoreSoloState()
    assert.equal(timer.subjectId.value, 'math')
    time += 120000 // Paused waiting is not part of recorded focus.
    timer.start()
    time += 30000
    timer.tick()
    const linked = globalThis.__timerTestStore.completed.at(-1)
    assert.deepEqual(linked.links, { todoId: 'todo-1', subjectId: 'math', chapterId: 'limits' })
    assert.equal(linked.minutes, 1)
    assert.equal(globalThis.__timerTestStore.todos[0].done, false)
    assert.equal(timer.settlement.value.todoId, 'todo-1')
    timer.confirmTaskComplete()
    timer.confirmTaskComplete()
    assert.equal(globalThis.__timerTestStore.toggles, 1, 'only explicit confirmation completes the task, once')
    assert.equal(globalThis.__timerTestStore.completed.length, 2, 'confirmation does not write duration again')
    timer.giveUp() // End the break, without another learning record.

    timer.focusMinutes.value = 25
    timer.start()
    time += 120000
    timer.giveUp()
    const early = globalThis.__timerTestStore.completed.at(-1)
    assert.equal(early.minutes, 2)
    assert.equal(early.completed, false)
    assert.equal(early.links.todoId, 'todo-1')
    assert.equal(globalThis.__timerTestStore.toggles, 1)
  } finally {
    timer.stopTimer()
    Date.now = originalNow
    await unlink(file)
  }
})
