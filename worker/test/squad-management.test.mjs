import test, { afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc'
import { createRenderer, nextTick, reactive } from 'vue'

const components = new Set([
  'TeamDetail',
  'TeamHeaderCard',
  'TeamMemberList',
  'TeamJoinRequestList',
  'TeamChallengeList',
  'TeamEditModal',
  'KickConfirmModal',
  'LeaderLeaveModal',
  'CompanionProgress',
  'AppTabs',
  'AsyncState',
  'EmptyState'
])
const result = await build({
  stdin: {
    contents: `export { default as TeamDetail } from './src/pages/TeamDetail.vue';
      export { default as CompanionProgress } from './src/components/team/CompanionProgress.vue';`,
    resolveDir: process.cwd()
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  external: ['vue'],
  plugins: [
    {
      name: 'squad-interaction-boundaries',
      setup(builder) {
        builder.onResolve({ filter: /\.vue$/ }, (args) => ({
          path: resolve(args.resolveDir, args.path),
          namespace: 'component'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'component' }, async ({ path }) => {
          if (path.endsWith('/Modal.vue') || path.endsWith('\\Modal.vue'))
            return {
              contents: `import { h } from 'vue'; export default {
            props: ['show', 'title'], setup(props, { slots }) {
              return () => props.show ? h('section', { role: 'dialog', 'aria-label': props.title }, [slots.default?.(), slots.footer?.()]) : null;
            }
          };`
            }
          const name = path.split(/[\\/]/).pop().replace('.vue', '')
          if (!components.has(name)) return { contents: 'export default { render: () => null };' }
          const descriptor = parse(await readFile(path, 'utf8'), { filename: path }).descriptor
          const script = compileScript(descriptor, { id: name, genDefaultAs: 'Component' })
          const template = compileTemplate({
            source: descriptor.template.content,
            filename: path,
            id: name,
            compilerOptions: { bindingMetadata: script.bindings }
          })
          assert.deepEqual(template.errors, [])
          return {
            contents: `${script.content}\n${template.code}\nComponent.render = render; export default Component;`,
            loader: 'ts',
            resolveDir: dirname(path)
          }
        })
        builder.onResolve(
          { filter: /(?:api\/teams|stores\/squads|composables\/use(?:Toast|Confirm|Back)|vue-router|@lucide\/vue)$/ },
          ({ path }) => ({ path, namespace: 'boundary' })
        )
        builder.onLoad({ filter: /.*/, namespace: 'boundary' }, ({ path }) => {
          if (path.endsWith('stores/squads'))
            return { contents: 'export const useSquadStore = () => globalThis.__squads.store;' }
          if (path.endsWith('api/teams'))
            return {
              contents: [
                'applyTeam',
                'withdrawRequest',
                'resetInviteCode',
                'joinTeam',
                'approveRequest',
                'rejectRequest',
                'updateTeam',
                'removeTeamMember',
                'leaveTeam',
                'transferLeader',
                'disbandTeam',
                'transferAndLeave',
                'deleteChallenge',
                'cancelChallenge',
                'resumeChallenge'
              ]
                .map(
                  (name) =>
                    `export const ${name} = async (...args) => {
                globalThis.__squads.calls.push([${JSON.stringify(name)}, ...JSON.parse(JSON.stringify(args))]);
                if (globalThis.__squads.failure === ${JSON.stringify(name)}) throw new Error('网络连接中断，请重试');
              };`
                )
                .join('\n')
            }
          if (path.endsWith('useToast'))
            return { contents: 'export const useToast = () => message => globalThis.__squads.toasts.push(message);' }
          if (path.endsWith('useConfirm')) return { contents: 'export const useConfirm = () => async () => true;' }
          if (path.endsWith('useBack')) return { contents: 'export const useBack = () => ({ goBack() {} });' }
          if (path === 'vue-router')
            return {
              contents: `export const useRoute = () => ({ params: { teamId: 'team' }, query: {} });
          export const useRouter = () => ({ replace: route => globalThis.__squads.redirects.push(route) });`
            }
          return {
            contents: `const Icon = { render: () => null }; export {
          Icon as ArrowLeft, Icon as Crown, Icon as UserMinus, Icon as Flame, Icon as Timer,
          Icon as BookOpen, Icon as TriangleAlert, Icon as Inbox };`
          }
        })
      }
    }
  ]
})
await mkdir('.cache/squad-tests', { recursive: true })
const filename = resolve('.cache/squad-tests', `ui-${crypto.randomUUID()}.mjs`)
await writeFile(filename, result.outputFiles[0].text)
const { TeamDetail, CompanionProgress } = await import(pathToFileURL(filename).href)
await unlink(filename)

globalThis.Document = class Document {}
globalThis.document = Object.assign(new Document(), { activeElement: null })
function node(tag, text = '') {
  return {
    tag,
    text,
    props: {},
    children: [],
    parent: null,
    value: '',
    listeners: {},
    get parentElement() {
      return this.parent
    },
    get type() {
      return this.props.type
    },
    getRootNode: () => document,
    focus() {
      document.activeElement = this
    },
    scrollIntoView() {
      this.scrolled = true
    },
    closest(tag) {
      return this.tag === tag ? this : this.parent?.closest(tag)
    },
    removeAttribute(name) {
      delete this.props[name]
    },
    addEventListener(name, listener) {
      this.listeners[name] = listener
    },
    removeEventListener(name) {
      delete this.listeners[name]
    }
  }
}
const renderer = createRenderer({
  createElement: (tag) => node(tag),
  createText: (text) => node('#text', text),
  createComment: (text) => node('#comment', text),
  setText: (element, text) => {
    element.text = text
  },
  setElementText: (element, text) => {
    element.children = []
    element.text = text
  },
  patchProp: (element, key, _previous, value) => {
    element.props[key] = value
    if (key === 'value') element.value = element._value = value
    if (key === 'checked') element.checked = value
  },
  insert(element, parent, anchor = null) {
    if (element.parent) element.parent.children.splice(element.parent.children.indexOf(element), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, element)
    element.parent = parent
  },
  remove(element) {
    element.parent.children.splice(element.parent.children.indexOf(element), 1)
    element.parent = null
  },
  parentNode: (element) => element.parent,
  nextSibling: (element) => element.parent?.children[element.parent.children.indexOf(element) + 1] ?? null
})
const apps = []
const text = (element) => element.text + element.children.map(text).join('')
function find(root, predicate) {
  if (predicate(root)) return root
  for (const child of root.children) {
    const found = find(child, predicate)
    if (found) return found
  }
  return null
}
const button = (root, label) => find(root, (element) => element.tag === 'button' && text(element).trim() === label)
async function settle() {
  await new Promise((done) => setImmediate(done))
  await nextTick()
}
async function click(element) {
  assert.ok(element, 'expected an actionable button')
  await element.props.onClick({ currentTarget: element })
  await settle()
}
async function mount(component = TeamDetail, props = {}) {
  const root = node('root'),
    app = renderer.createApp(component, props)
  apps.push(app)
  app.mount(root)
  await settle()
  return root
}
const challenge = (myProgress = 0, type = 'streak', target = 7) => ({
  id: 'challenge',
  teamId: 'team',
  type,
  target,
  durationDays: 7,
  startDate: '2026-10-05',
  endDate: '2026-10-11',
  completedCount: 0,
  isCompleted: false,
  myProgress,
  myCompleted: myProgress >= target,
  isCancelled: false,
  createdAt: 1,
  status: 'active'
})
beforeEach(() => {
  const detail = reactive({
    team: {
      id: 'team',
      name: '高数冲刺',
      description: '一起坚持',
      creatorId: 'leader',
      memberCount: 2,
      maxMembers: 10,
      isPublic: true,
      myRole: 'leader',
      createdAt: 1
    },
    members: [
      { userId: 'leader', userName: '队长 A', role: 'leader', joinedAt: 1 },
      { userId: 'member', userName: '成员 B', role: 'member', joinedAt: 2 }
    ],
    challenges: [challenge()],
    inviteCode: null
  })
  const state = reactive({ requests: [], errors: {}, loading: {} })
  globalThis.__squads = {
    detail,
    state,
    calls: [],
    toasts: [],
    redirects: [],
    store: {
      detail: () => detail,
      details: { team: state },
      challengesById: {},
      loadDetail: async () => {},
      sync: async () => {},
      cancelDetail() {},
      reviewed(_id, userId, accepted) {
        state.requests = state.requests.filter((request) => request.userId !== userId)
        globalThis.__squads.calls.push(['reviewed', userId, accepted])
      }
    }
  }
  document.activeElement = null
})
afterEach(() => {
  for (const app of apps.splice(0)) app.unmount()
  delete globalThis.__squads
})

test('captain settings reveal management sections and preserve the mobile member tab selection', async () => {
  const root = await mount()
  for (const label of ['编辑小队', '成员管理', '加队审批', '转让队长', '解散小队']) assert.ok(button(root, label))
  await click(button(root, '成员管理'))
  assert.equal(find(root, (element) => element.props.id === 'squad-section-tab-members').props['aria-selected'], true)
  assert.equal(document.activeElement.props['aria-label'], '小队成员管理')
  assert.ok(document.activeElement.scrolled)
  await click(button(root, '加队审批'))
  assert.equal(document.activeElement.props['aria-label'], '小队加队审批')
  assert.match(text(root), /暂无待审核的加队申请/)
  await click(button(root, '转让队长'))
  await click(button(root, '设为队长'))
  assert.ok(__squads.calls.some((call) => call[0] === 'transferLeader' && call[2] === 'member'))
  await click(button(root, '踢出'))
  const dialog = find(root, (element) => element.props.role === 'dialog')
  assert.equal(dialog.props['aria-label'], '踢出成员')
  await click(button(dialog, '踢出'))
  assert.ok(__squads.calls.some((call) => call[0] === 'removeTeamMember' && call[2] === 'member'))
  assert.equal(
    find(root, (element) => element.props.role === 'dialog'),
    null
  )
})

test('non-captains cannot see member management actions or approval data', async () => {
  __squads.detail.team.myRole = 'member'
  __squads.state.requests = [{ userId: 'other', userName: '申请人', createdAt: 3 }]
  const root = await mount()
  for (const label of ['编辑小队', '成员管理', '加队审批', '转让队长', '解散小队', '设为队长', '踢出'])
    assert.equal(button(root, label), null)
  assert.doesNotMatch(text(root), /申请人/)
  assert.ok(button(root, '退出小队'))
})

test('approval actions update the list and failed requests retain the application for retry', async () => {
  __squads.state.requests = [{ userId: 'other', userName: '申请人', createdAt: 3 }]
  const root = await mount()
  __squads.failure = 'approveRequest'
  await click(button(root, '同意'))
  assert.match(text(root), /申请人/)
  assert.match(__squads.toasts.at(-1), /网络连接中断/)
  delete __squads.failure
  await click(button(root, '同意'))
  assert.ok(__squads.calls.some((call) => call[0] === 'reviewed' && call[1] === 'other' && call[2] === true))
  assert.match(text(root), /暂无待审核的加队申请/)
})

test('the visibility editor sends the selected boolean and preserves the form after a failed save', async () => {
  const root = await mount()
  await click(button(root, '编辑小队'))
  let checkbox = find(root, (element) => element.props.type === 'checkbox')
  assert.equal(checkbox.checked, true)
  checkbox.checked = false
  checkbox.listeners.change({ target: checkbox })
  await nextTick()
  __squads.failure = 'updateTeam'
  await click(button(root, '保存'))
  assert.equal(find(root, (element) => element.props.role === 'dialog').props['aria-label'], '编辑小队信息')
  assert.equal(checkbox.checked, false)
  delete __squads.failure
  await click(button(root, '保存'))
  const request = __squads.calls.filter((call) => call[0] === 'updateTeam').at(-1)
  assert.ok(request, JSON.stringify(__squads.toasts))
  assert.equal(request[2].isPublic, false)
  assert.equal(request[2].name, '高数冲刺')
  assert.equal(
    find(root, (element) => element.props.role === 'dialog'),
    null
  )
  __squads.detail.team.isPublic = false
  await click(button(root, '编辑小队'))
  checkbox = find(root, (element) => element.props.type === 'checkbox')
  assert.equal(checkbox.checked, false)
})

test('disband entry requires the squad name and submits dissolution without changing member roles', async () => {
  const root = await mount()
  await click(button(root, '解散小队'))
  const dialog = find(root, (element) => element.props.role === 'dialog')
  assert.equal(dialog.props['aria-label'], '解散小队')
  assert.equal(button(dialog, '转让队长并退出'), null)
  assert.equal(button(dialog, '确认').props.disabled, true)
  const input = find(dialog, (element) => element.props.id === 'disband-name')
  input.value = '高数冲刺'
  input.listeners.input({ target: input })
  await nextTick()
  assert.equal(button(dialog, '确认').props.disabled, false)
  await click(button(dialog, '确认'))
  assert.ok(__squads.calls.some((call) => call[0] === 'disbandTeam' && call[1] === 'team'))
  assert.deepEqual(__squads.redirects, [{ name: 'teams' }])
})

test('challenge bars and accessible descriptions use accomplished goals for zero, partial and full progress', async () => {
  for (const [current, type, target, unit, percent] of [
    [0, 'streak', 7, '天', 0],
    [1, 'streak', 7, '天', 14],
    [7, 'streak', 7, '天', 100],
    [90, 'minutes', 120, '分钟', 75],
    [150, 'problems', 100, '题', 100]
  ]) {
    const root = await mount(CompanionProgress, {
      challenge: challenge(current, type, target),
      memberCount: 2,
      showMine: true
    })
    const bar = find(root, (element) => element.props['aria-label'] === '我的挑战进度')
    assert.equal(bar.props['aria-valuenow'], percent)
    assert.match(bar.props['aria-valuetext'], new RegExp(`${current} / ${target} ${unit}，完成 ${percent}%`))
    assert.match(text(root), new RegExp(`${current} / ${target} ${unit} · ${percent}%`))
    assert.equal(bar.children[0].props.style.width, `${Math.min(100, (current / target) * 100)}%`)
  }
})
