import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({
  stdin: {
    contents: `export { settingsRecordStatements, getSettings } from './worker/src/api/settings'; export { decryptSecret } from './worker/src/crypto';
      import { registerUsersRoutes } from './worker/src/api/community/users'; registerUsersRoutes(); export { route } from './worker/src/router';`,
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false
})
const directory = path.join(root, '.cache', 'avatar-tests')
await mkdir(directory, { recursive: true })
const modulePath = path.join(directory, `settings-${crypto.randomUUID()}.mjs`)
await writeFile(modulePath, compiled.outputFiles[0].text)
const { settingsRecordStatements, getSettings, decryptSecret, route } = await import(pathToFileURL(modulePath).href)
await unlink(modulePath)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')

function setup() {
  const db = new DatabaseSync(':memory:')
  db.exec(schema)
  db.exec("INSERT INTO users (id, username, password_hash, created_at) VALUES ('me', '考生', 'unused', 1)")
  function statement(sql, args = []) {
    return {
      bind: (...values) => statement(sql, values),
      first: async () => db.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...args) }),
      run: async () => db.prepare(sql).run(...args)
    }
  }
  const env = {
    DB: { prepare: statement },
    JWT_SECRET: 'avatar-settings-test-secret',
    RL_30: { limit: async () => ({ success: true }) }
  }
  async function save(value, updatedAt = 2, seq = 2) {
    const statements = await settingsRecordStatements(env, 'me', value, { updatedAt, seq })
    db.exec('BEGIN')
    try {
      for (const item of statements) await item.run()
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
  }
  return { db, env, save }
}

test('头像上传后设置同步保留 URL，重新读取和后续编辑不会清空头像', async () => {
  const { db, env, save } = setup()
  try {
    const avatar = '/api/avatar/0123456789abcdef.webp'
    db.prepare('INSERT INTO user_settings (user_id, avatar) VALUES (?, ?)').run('me', avatar)
    await save({ userName: '备考同学', avatar, bio: '正在复习' })
    const refreshed = await getSettings(env, 'me')
    assert.equal(refreshed.avatar, avatar)
    await save({ ...refreshed, theme: 'dark', userName: '新昵称' }, 3, 3)
    assert.equal((await getSettings(env, 'me')).avatar, avatar)
    const row = db.prepare('SELECT avatar, updated_at, server_seq FROM user_settings WHERE user_id = ?').get('me')
    assert.deepEqual({ ...row }, { avatar, updated_at: 3, server_seq: 3 })
  } finally {
    db.close()
  }
})

test('设置插入和加密 Token 分支都能保存头像，读取不泄露 Token', async () => {
  const { db, env, save } = setup()
  try {
    const first = '/api/avatar/1111111111111111.png'
    await save({ userName: '备考同学', avatar: first })
    assert.equal((await getSettings(env, 'me')).avatar, first)
    const replacement = '/api/avatar/2222222222222222.webp'
    await save({ userName: '备考同学', avatar: replacement, maimemoToken: 'test-token' }, 3, 3)
    const cipher = db.prepare('SELECT maimemo_token FROM user_settings WHERE user_id = ?').get('me').maimemo_token
    assert.notEqual(cipher, 'test-token')
    assert.equal(await decryptSecret(env, cipher), 'test-token')
    const refreshed = await getSettings(env, 'me')
    assert.equal(refreshed.avatar, replacement)
    assert.equal(refreshed.maimemoConnected, true)
    assert.equal(refreshed.maimemoToken, undefined)
    await save(refreshed, 4, 4)
    assert.equal((await getSettings(env, 'me')).avatar, replacement)
    assert.equal(
      db.prepare('SELECT maimemo_token FROM user_settings WHERE user_id = ?').get('me').maimemo_token,
      cipher
    )
  } finally {
    db.close()
  }
})

test('未传头像不擦除已上传头像，显式空字符串仍可清除头像', async () => {
  const { db, env, save } = setup()
  try {
    await save({ userName: '备考同学', avatar: '/api/avatar/0123456789abcdef.webp' })
    await save({ userName: '修改昵称' }, 3, 3)
    assert.equal((await getSettings(env, 'me')).avatar, '/api/avatar/0123456789abcdef.webp')
    await save({ userName: '修改昵称', avatar: '' }, 4, 4)
    assert.equal((await getSettings(env, 'me')).avatar, '')
  } finally {
    db.close()
  }
})

test('移除头像保存后设置冷读与公开资料均为空，后续昵称编辑不恢复旧头像', async () => {
  const { db, env, save } = setup()
  const profile = async () => {
    const response = await route(new Request('https://avatar.invalid/api/community/users/me/profile'), env)
    assert.equal(response.status, 200)
    return response.json()
  }
  try {
    await save({ userName: '备考同学', avatar: '/api/avatar/0123456789abcdef.webp', profileVisibility: 'public' })
    assert.equal((await profile()).avatar, '/api/avatar/0123456789abcdef.webp')
    await save({ ...(await getSettings(env, 'me')), avatar: '' }, 3, 3)
    assert.equal((await getSettings(env, 'me')).avatar, '')
    assert.equal((await profile()).avatar, '')
    await save({ userName: '新昵称', profileVisibility: 'public' }, 4, 4)
    assert.equal((await getSettings(env, 'me')).avatar, '')
    assert.equal((await profile()).avatar, '')
    assert.equal((await profile()).userName, '新昵称')
  } finally {
    db.close()
  }
})
