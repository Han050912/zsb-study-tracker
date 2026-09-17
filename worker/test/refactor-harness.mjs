import { build } from 'esbuild'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
/** 将真实 TS store 编译为 Node 可测试模块，仅替换浏览器/网络边界。 */
export async function loadFrontend() {
  const result = await build({
    stdin: {
      contents: `export * from './src/stores/community/entities'; export * from './src/stores/community/feed-store'; export * from './src/features/collaboration/stores/partners'; export * from './src/features/collaboration/stores/squads'; export * from './src/stores/studyTimer'; export * from './src/features/collaboration/connection'`,
      resolveDir: root
    },
    bundle: true,
    format: 'esm',
    platform: 'node',
    external: ['vue', 'pinia'],
    write: false,
    plugins: [
      {
        name: 'test-boundaries',
        setup(builder) {
          builder.onResolve(
            { filter: /(?:api\/(?:community\/\w+|teams|gamification|client)|stores\/app|\.\.?\/app|services\/auth)$/ },
            (args) => ({ path: args.path, namespace: 'mock' })
          )
          builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => {
            const part = args.path.split('/').at(-1)
            if (part === 'auth') return { contents: `export const sessionUser = { value: { id: 'me' } };` }
            if (part === 'app')
              return {
                contents: `export function useAppStore() { return { settings: { avatar: '', dndMutedTypes: [] }, $patch() {}, recordPomodoro() {} } }`
              }
            if (part === 'teams')
              return {
                contents: ['getTeams', 'getTeamDetail', 'getTeamRequests', 'syncActiveChallenges']
                  .map((n) => `export const ${n} = (...args) => globalThis.__refactorApi.${n}(...args);`)
                  .join('\n')
              }
            if (part === 'client') return { contents: 'export function requestKeepalive() {}' }
            return {
              contents: `export const ${part}Api = new Proxy({}, { get: (_, name) => (...args) => globalThis.__refactorApi[name](...args) });`
            }
          })
        }
      }
    ]
  })
  const dir = path.join(root, '.cache', 'refactor-tests')
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `stores-${crypto.randomUUID()}.mjs`)
  await writeFile(file, result.outputFiles[0].text)
  try {
    return await import(pathToFileURL(file).href)
  } finally {
    await unlink(file)
  }
}

export const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
export const settle = () => new Promise((resolve) => setImmediate(resolve))
