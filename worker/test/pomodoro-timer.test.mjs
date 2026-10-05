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
    contents: `${script}\nexport {start,tick,giveUp,stopTimer,focusMinutes,breakMinutes,phase};`,
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
    completed: [],
    recordPomodoro(minutes, description) {
      this.completed.push({ minutes, description })
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
  } finally {
    timer.stopTimer()
    Date.now = originalNow
    await unlink(file)
  }
})
