import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const compiled = await build({
  stdin: {
    contents: `export { default as worker } from './worker/src/index';
      export { signToken, verifyTokenFull, hashPassword } from './worker/src/auth';
      export { resolveAuth } from './worker/src/middleware/auth';
      export { readBodyBytes, readBodyText } from './worker/src/db';
      export { cleanupR2Objects } from './worker/src/r2Cleanup';
      export { cleanupOrphanUploads, deleteUploads } from './worker/src/api/uploads';`,
    resolveDir: root
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  write: false
})
const directory = path.join(root, '.cache/security-tests')
await mkdir(directory, { recursive: true })
const filename = path.join(directory, `security-${crypto.randomUUID()}.mjs`)
await writeFile(filename, compiled.outputFiles[0].text)
const {
  worker,
  signToken,
  verifyTokenFull,
  hashPassword,
  resolveAuth,
  readBodyBytes,
  readBodyText,
  cleanupOrphanUploads,
  deleteUploads,
  cleanupR2Objects
} = await import(pathToFileURL(filename).href)
await unlink(filename)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
const migration = await readFile(new URL('../migrations/0001_maintenance_cursors.sql', import.meta.url), 'utf8')

class MemoryCache {
  entries = new Map()
  async match(key) {
    return this.entries.get(String(key))?.clone()
  }
  async put(key, response) {
    this.entries.set(String(key), response.clone())
  }
  async delete(key) {
    return this.entries.delete(String(key))
  }
}

let db, env, removed, objects, failR2, failSql, token, cacheBefore
function statement(sql, params = []) {
  if (params.length > 100) throw new Error(`D1 parameter limit exceeded: ${params.length}`)
  const prepare = () => {
    if (failSql?.(sql)) throw new Error('Injected D1 failure')
    return db.prepare(sql)
  }
  return {
    sql,
    params,
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: prepare().all(...params) }),
    first: async () => prepare().get(...params) ?? null,
    run: async () => {
      const query = prepare()
      return query.columns().length
        ? { results: query.all(...params), meta: { changes: 0 } }
        : { results: [], meta: { changes: Number(query.run(...params).changes) } }
    }
  }
}
beforeEach(async () => {
  db = new DatabaseSync(':memory:')
  db.exec(schema)
  // Also validates the migration is idempotent when fresh schema already contains the table.
  db.exec(migration)
  db.exec(migration)
  removed = []
  objects = new Map()
  failR2 = failSql = null
  env = {
    JWT_SECRET: 'security-test-fixture',
    DESKTOP_TOKEN: 'desktop-test-fixture',
    DB: {
      prepare: statement,
      async batch(statements) {
        db.exec('BEGIN')
        try {
          const result = []
          for (const item of statements) result.push(await item.run())
          db.exec('COMMIT')
          return result
        } catch (error) {
          db.exec('ROLLBACK')
          throw error
        }
      }
    },
    IMAGES: {
      async put(key, data) {
        objects.set(key, new Uint8Array(data).slice())
      },
      async get(key) {
        const data = objects.get(key)
        return data ? { body: data.slice() } : null
      },
      async delete(key) {
        if (failR2?.(key)) throw new Error('Injected R2 failure')
        removed.push(key)
        objects.delete(key)
      }
    }
  }
  for (const tier of [3, 5, 10, 20, 30, 60, 100, 120]) env[`RL_${tier}`] = { limit: async () => ({ success: true }) }
  db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, 1)').run(
    'me',
    'review-user',
    'unused'
  )
  db.prepare('INSERT INTO user_settings (user_id, user_name) VALUES (?, ?)').run('me', 'private fixture')
  token = await signToken('me', env.JWT_SECRET)
  cacheBefore = globalThis.caches
  globalThis.caches = { default: new MemoryCache() }
})
afterEach(() => {
  globalThis.caches = cacheBefore
  db.close()
})

async function api(url, options = {}, bearer = token) {
  const pending = []
  const headers = new Headers(options.headers)
  if (bearer) headers.set('Authorization', `Bearer ${bearer}`)
  const response = await worker.fetch(new Request(`https://review.invalid${url}`, { ...options, headers }), env, {
    waitUntil(promise) {
      pending.push(promise)
    }
  })
  await Promise.all(pending)
  return response
}
function expiredToken() {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({ sub: 'me', jti: 'expired-fixture', exp: 1 })).toString('base64url')
  const signature = createHmac('sha256', env.JWT_SECRET).update(`${head}.${payload}`).digest('base64url')
  return `${head}.${payload}.${signature}`
}
async function seedPrivateCache(bearer) {
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearer)))
    .subarray(0, 8)
    .toString('hex')
  await caches.default.put(
    `https://review.invalid/api/settings?_c=${hash}`,
    Response.json({ userName: 'stale private fixture' })
  )
  return hash
}

test('review schedule survives sync push, pull and legacy database migration with account isolation', async () => {
  db.exec(
    'ALTER TABLE error_questions DROP COLUMN last_reviewed_at; ALTER TABLE error_questions DROP COLUMN next_review_date'
  )
  db.exec(
    "INSERT INTO error_questions (id,user_id,subject_id,date,type,content,created_at,review_count) VALUES ('legacy','me','math','2026-10-05','选择','旧题',1,2)"
  )
  db.exec(await readFile(new URL('../migrations/0009_error_review_schedule.sql', import.meta.url), 'utf8'))
  assert.equal(
    db.prepare("SELECT next_review_date FROM error_questions WHERE id='legacy'").get().next_review_date,
    null
  )
  const value = {
    id: 'scheduled',
    subjectId: 'math',
    date: '2026-10-05',
    type: '选择',
    content: '排期题',
    reviewCount: 2,
    mastered: true,
    createdAt: 1,
    lastReviewedAt: 1791217800000,
    nextReviewDate: '2026-10-13'
  }
  const pushed = await api('/api/data/push', {
    method: 'POST',
    body: JSON.stringify({
      domains: { errorQuestions: { upserts: [{ ...value, updatedAt: Date.now() }], deletes: [] } }
    })
  })
  assert.equal(pushed.status, 200, await pushed.clone().text())
  const persisted = db
    .prepare("SELECT last_reviewed_at,next_review_date FROM error_questions WHERE id='scheduled' AND user_id='me'")
    .get()
  assert.equal(persisted.last_reviewed_at, value.lastReviewedAt)
  assert.equal(persisted.next_review_date, value.nextReviewDate)
  const errors = await (await api('/api/errors')).json()
  assert.equal(errors.find((question) => question.id === 'scheduled').nextReviewDate, value.nextReviewDate)
  assert.equal(errors.find((question) => question.id === 'legacy').nextReviewDate, undefined)
  const pulled = await (await api('/api/data/pull', { method: 'POST', body: JSON.stringify({ full: true }) })).json()
  assert.equal(
    pulled.changes.errorQuestions.upserts.find((item) => item.id === value.id).lastReviewedAt,
    value.lastReviewedAt
  )
  db.exec(
    "INSERT INTO users (id,username,password_hash,created_at) VALUES ('schedule-other','schedule-other','unused',1)"
  )
  assert.deepEqual(await (await api('/api/errors', {}, await signToken('schedule-other', env.JWT_SECRET))).json(), [])
})

test('私有响应始终鉴权：过期 JWT 和匿名缓存键不能读取历史私有缓存', async () => {
  const expired = expiredToken()
  const hash = await seedPrivateCache(expired)
  assert.equal(await verifyTokenFull(expired, env.JWT_SECRET), null)
  assert.equal((await api('/api/settings', {}, expired)).status, 401)
  assert.equal((await api(`/api/settings?_c=${hash}`, {}, null)).status, 401)
})

test('私有 GET 与错误响应禁止浏览器保存，切号和写入后不复用旧设置', async () => {
  await seedPrivateCache(token)
  let response = await api('/api/settings')
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.equal((await response.json()).userName, 'private fixture')
  db.exec("UPDATE user_settings SET user_name = 'updated fixture' WHERE user_id = 'me'")
  response = await api('/api/settings')
  assert.equal((await response.json()).userName, 'updated fixture')
  db.exec("INSERT INTO users (id, username, password_hash, created_at) VALUES ('other', 'other-user', 'unused', 1)")
  const other = await signToken('other', env.JWT_SECRET)
  const otherSettings = await (await api('/api/settings', {}, other)).json()
  assert.equal(otherSettings.userName, '升本人-other')
  assert.notEqual(otherSettings.userName, 'updated fixture')
  assert.equal((await api('/api/settings', {}, null)).headers.get('Cache-Control'), 'private, no-store')
})

test('公开头像仍可匿名命中缓存且不会混入私有缓存策略', async () => {
  const url = '/api/avatar/0123456789abcdef.png'
  objects.set('avatars/0123456789abcdef.png', new Uint8Array([1, 2, 3]))
  const first = await api(url, {}, null)
  assert.equal(first.status, 200)
  assert.match(first.headers.get('Cache-Control'), /public/)
  env.IMAGES.get = async () => {
    throw new Error('Cache miss')
  }
  const cached = await api(url, {}, null)
  assert.equal(cached.status, 200)
  assert.deepEqual(new Uint8Array(await cached.arrayBuffer()), new Uint8Array([1, 2, 3]))
})

test('登出后另一数据中心的旧未吊销标记不能放行任何私有读写', async () => {
  const payload = await verifyTokenFull(token, env.JWT_SECRET)
  const otherColo = new MemoryCache()
  await otherColo.put(`https://jwt-blacklist.internal/not-revoked/${payload.jti}`, new Response(null))
  assert.equal((await api('/api/auth/logout', { method: 'POST' })).status, 200)
  globalThis.caches.default = otherColo
  assert.equal((await api('/api/settings')).status, 401)
  assert.equal((await api('/api/settings/validate', { method: 'POST', body: '{}' })).status, 401)
  await assert.rejects(
    () =>
      resolveAuth(
        new Request('https://review.invalid/api/auth/me', {
          headers: { Authorization: `Bearer ${token}` }
        }),
        env
      ),
    (error) => error.status === 401
  )
})

test('保持登录控制 Cookie 生命周期，任何选项的退出均吊销 JWT 并清 Cookie', async () => {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword('Password123'), 'me')
  for (const remember of [true, false, undefined]) {
    const response = await api(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'X-Desktop-Token': env.DESKTOP_TOKEN },
        body: JSON.stringify({ username: 'review-user', password: 'Password123', remember })
      },
      null
    )
    assert.equal(response.status, 200)
    const cookie = response.headers.get('Set-Cookie')
    assert.equal(cookie.includes('Max-Age=259200'), remember !== false)
    assert.match(cookie, /HttpOnly.*SameSite=None.*Secure/)
    const issued = (await response.json()).token
    const logout = await api('/api/auth/logout', { method: 'POST' }, issued)
    assert.equal(logout.status, 200)
    assert.match(logout.headers.get('Set-Cookie'), /Max-Age=0/)
    assert.equal((await api('/api/auth/me', {}, issued)).status, 401)
  }
})

test('Siteverify 网络/服务故障返回可重试提示且不能签发登录会话', async (t) => {
  env.TURNSTILE_SECRET = 'turnstile-fixture'
  const headers = { 'X-CF-Turnstile-Response': 'test-verification' }
  let timeoutMs
  const controller = new AbortController()
  t.mock.method(AbortSignal, 'timeout', (value) => {
    timeoutMs = value
    return controller.signal
  })
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    assert.equal(options.signal, controller.signal)
    throw new TypeError('verification unavailable')
  })
  for (const failure of ['network', 'http', 'invalid-json']) {
    if (failure === 'http') globalThis.fetch = async () => new Response('unavailable', { status: 503 })
    if (failure === 'invalid-json') globalThis.fetch = async () => new Response('not-json')
    const response = await api(
      '/api/auth/login',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ username: 'review-user', password: 'password1' })
      },
      null
    )
    assert.equal(response.status, 503)
    assert.match((await response.json()).message, /人机验证服务暂时不可用/)
  }
  assert.equal(timeoutMs, 10_000)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_sessions').get().n, 0)
})

test('修改密码吊销其它已登记会话，新 token 继续有效', async () => {
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword('OldPass123!'), 'me')
  const second = await signToken('me', env.JWT_SECRET)
  for (const item of [token, second]) {
    const payload = await verifyTokenFull(item, env.JWT_SECRET)
    db.prepare('INSERT INTO user_sessions (jti, user_id, expires_at, created_at) VALUES (?, ?, ?, 1)').run(
      payload.jti,
      'me',
      payload.exp
    )
  }
  const changed = await api('/api/auth/password', {
    method: 'POST',
    headers: { 'X-Desktop-Token': env.DESKTOP_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPassword: 'OldPass123!', newPassword: 'NewPass123!' })
  })
  assert.equal(changed.status, 200)
  const replacement = (await changed.json()).token
  assert.equal((await api('/api/settings', {}, second)).status, 401)
  assert.equal((await api('/api/settings', {}, replacement)).status, 200)
})

function streamedRequest(chunks, headers = {}) {
  let consumed = 0,
    cancelled = false
  const stream = new ReadableStream(
    {
      pull(controller) {
        if (consumed === chunks.length) return controller.close()
        controller.enqueue(chunks[consumed++])
      },
      cancel() {
        cancelled = true
      }
    },
    { highWaterMark: 0 }
  )
  return {
    request: new Request('https://review.invalid/upload', { method: 'POST', body: stream, duplex: 'half', headers }),
    consumed: () => consumed,
    cancelled: () => cancelled
  }
}

test('流式请求超限立即取消，恰好上限与 UTF-8 跨块均正确', async () => {
  const parts = Array.from({ length: 16 }, () => new Uint8Array(64 * 1024))
  const source = streamedRequest(parts)
  await assert.rejects(
    () => readBodyText(source.request, 256 * 1024),
    (error) => error.status === 413
  )
  assert.equal(source.consumed(), 5)
  assert.equal(source.cancelled(), true)
  const encoded = new TextEncoder().encode('中文🙂')
  const split = streamedRequest([...encoded].map((byte) => new Uint8Array([byte])))
  assert.equal(await readBodyText(split.request, encoded.byteLength), '中文🙂')
  const over = streamedRequest([encoded, new Uint8Array([1])])
  await assert.rejects(
    () => readBodyBytes(over.request, encoded.byteLength),
    (error) => error.status === 413
  )
  assert.equal(over.cancelled(), true)
})

test('声明超限不消费正文；流读取失败转换成 400', async () => {
  const source = streamedRequest([new Uint8Array([1])], { 'Content-Length': '100' })
  await assert.rejects(
    () => readBodyBytes(source.request, 10),
    (error) => error.status === 413
  )
  assert.equal(source.consumed(), 0)
  assert.equal(source.cancelled(), true)
  const request = new Request('https://review.invalid/upload', {
    method: 'POST',
    duplex: 'half',
    body: new ReadableStream({
      pull(controller) {
        controller.error(new Error('network failed'))
      }
    })
  })
  await assert.rejects(
    () => readBodyBytes(request, 10),
    (error) => error.status === 400
  )
})

test('所有二进制入口拒绝无长度头的超限流并取消后续数据', async () => {
  for (const [url, method, maxMiB] of [
    ['/api/community/upload', 'POST', 5],
    ['/api/error-images', 'POST', 5],
    ['/api/note-bodies/note', 'PUT', 1],
    ['/api/pdfs/pdf', 'PUT', 30]
  ]) {
    const source = streamedRequest(Array.from({ length: maxMiB + 3 }, () => new Uint8Array(1024 * 1024)))
    const response = await api(url, { method, body: source.request.body, duplex: 'half' })
    assert.equal(response.status, 413, url)
    assert.equal(source.cancelled(), true, url)
    assert.equal(source.consumed(), maxMiB + 1, url)
  }
})

test('不足五字节的 PDF 是用户输入错误而非 500', async () => {
  assert.equal((await api('/api/pdfs/pdf', { method: 'PUT', body: '%PD' })).status, 400)
})

test('头像上传重试并发设置事务，更新同步版本且只回收提交时的旧头像', async () => {
  const oldFile = '1111111111111111.png'
  const concurrentFile = '2222222222222222.png'
  db.prepare('UPDATE user_settings SET avatar = ?, theme = ? WHERE user_id = ?').run(
    `/api/avatar/${oldFile}`,
    'dark',
    'me'
  )
  const originalBatch = env.DB.batch
  let calls = 0
  env.DB.batch = async (statements) => {
    if (calls++ === 0) {
      // 模拟设置同步在头像的预读与最终 batch 之间提交。
      db.prepare('UPDATE user_settings SET avatar = ?, server_seq = 4 WHERE user_id = ?').run(
        `/api/avatar/${concurrentFile}`,
        'me'
      )
      db.exec(`INSERT INTO sync_domain_versions (user_id,domain,version,updated_at)
        VALUES ('me','__push__',1,1), ('me','settings',4,1)`)
    }
    return originalBatch(statements)
  }
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0])
  const response = await api('/api/community/upload?variant=avatar', { method: 'POST', body: png })
  assert.equal(response.status, 201)
  const { url } = await response.json()
  const row = db.prepare('SELECT avatar, theme, server_seq FROM user_settings WHERE user_id = ?').get('me')
  assert.equal(row.avatar, url)
  assert.equal(row.theme, 'dark')
  assert.equal(row.server_seq, 5)
  assert.equal(calls, 2)
  assert.deepEqual(removed, [`avatars/${concurrentFile}`])
})

function uploads(count, referencedCount = 0) {
  const ids = []
  for (let i = 1; i <= count; i++) {
    const id = String(i).padStart(16, '0')
    ids.push(id)
    db.prepare(
      `INSERT INTO community_uploads
      (id,user_id,r2_key,url,size,content_type,created_at) VALUES (?, 'me', ?, ?, 1, 'image/png', ?)`
    ).run(id, `posts/${id}`, `/api/community/images/${id}`, i)
  }
  for (let i = 0; i < referencedCount; i += 9) {
    db.prepare(
      `INSERT INTO community_posts (id,user_id,content,image_urls,created_at,updated_at)
      VALUES (?, 'me', 'fixture', ?, 1, 1)`
    ).run(
      `post-${i}`,
      JSON.stringify(ids.slice(i, Math.min(i + 9, referencedCount)).map((id) => `/api/community/images/${id}`))
    )
  }
  return ids
}

test('200 张孤图在 D1 100 参数约束内完整清理', async () => {
  uploads(200)
  await cleanupOrphanUploads(env)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 0)
  assert.equal(removed.length, 200)
})

test('删除 101 张附件分块查询，仍被其它帖子引用的图片保留', async () => {
  const ids = uploads(102, 1)
  await deleteUploads(env, ids)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 1)
  assert.equal(removed.length, 101)
  assert.equal(removed.includes(`posts/${ids[0]}`), false)
})

test('前 1000 张被引用时第二轮继续扫描孤图，完整扫描后重置游标', async () => {
  uploads(1100, 1000)
  await cleanupOrphanUploads(env)
  assert.equal(removed.length, 0)
  assert.equal(db.prepare('SELECT created_at FROM maintenance_cursors').get().created_at, 1000)
  await cleanupOrphanUploads(env)
  assert.equal(removed.length, 100)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 1000)
  assert.equal(db.prepare('SELECT created_at FROM maintenance_cursors').get().created_at, -1)
  db.exec('DELETE FROM community_posts')
  await cleanupOrphanUploads(env)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 0)
})

test('R2 或 D1 删除失败保留重试依据，恢复后可继续清理', async () => {
  const ids = uploads(3)
  failR2 = (key) => key === `posts/${ids[1]}`
  await assert.rejects(() => cleanupOrphanUploads(env), /Injected R2 failure/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 3)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM maintenance_cursors').get().n, 0)
  failR2 = null
  failSql = (sql) => sql.startsWith('DELETE FROM community_uploads')
  await assert.rejects(() => cleanupOrphanUploads(env), /Injected D1 failure/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 3)
  failSql = null
  await cleanupOrphanUploads(env)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 0)
})

const pngFixture = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0, 73, 69, 78, 68, 0, 0, 0, 0])

test('错题上传已提交但响应丢失时，不删除或排队回收正在使用的新对象', async (t) => {
  t.mock.method(console, 'error', () => {})
  const originalBatch = env.DB.batch
  let first = true
  env.DB.batch = async (statements) => {
    const result = await originalBatch(statements)
    if (first) {
      first = false
      throw new Error('D1 response lost after commit')
    }
    return result
  }
  const response = await api('/api/error-images', { method: 'POST', body: pngFixture() })
  assert.equal(response.status, 500)
  const row = db.prepare('SELECT id, r2_key FROM error_images').get()
  assert.ok(row)
  assert.equal(objects.has(row.r2_key), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r2_cleanup_jobs').get().n, 0)
  await cleanupR2Objects(env)
  assert.equal((await api(`/api/error-images/${row.id}`)).status, 200)
  assert.equal(removed.length, 0)
})

test('错题上传真正回滚时排队回收；重传相同图片不复用待删 generation', async (t) => {
  t.mock.method(console, 'error', () => {})
  failSql = (sql) => {
    if (!sql.includes('INSERT INTO error_images')) return false
    failSql = null
    return true
  }
  assert.equal((await api('/api/error-images', { method: 'POST', body: pngFixture() })).status, 500)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM error_images').get().n, 0)
  const abandoned = db.prepare('SELECT r2_key FROM r2_cleanup_jobs').get().r2_key
  assert.equal(objects.has(abandoned), true)
  failR2 = () => true
  await assert.rejects(() => cleanupR2Objects(env), /R2 cleanup failed/)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r2_cleanup_jobs').get().n, 1)
  const uploaded = await api('/api/error-images', { method: 'POST', body: pngFixture() })
  assert.equal(uploaded.status, 201)
  const { id } = await uploaded.json()
  const replacement = db.prepare('SELECT r2_key FROM error_images WHERE id = ?').get(id).r2_key
  assert.notEqual(replacement, abandoned)
  failR2 = null
  await cleanupR2Objects(env)
  assert.equal(objects.has(abandoned), false)
  assert.equal(objects.has(replacement), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r2_cleanup_jobs').get().n, 0)
  assert.equal((await api(`/api/error-images/${id}`)).status, 200)
})

test('同批删除旧错题和新增图片引用时保图，最后引用删除才入回收队列', async () => {
  const upload = await api('/api/error-images', { method: 'POST', body: pngFixture() })
  assert.equal(upload.status, 201)
  const { id } = await upload.json()
  const oldGeneration = db.prepare('SELECT r2_key FROM error_images WHERE id = ?').get(id).r2_key
  const errorRecord = (key, updatedAt) => ({
    id: key,
    subjectId: 'math',
    date: '2026-09-27',
    type: 'fixture',
    content: 'fixture',
    image: `r2:${id}`,
    updatedAt
  })
  const sync = (upserts, deletes) =>
    api('/api/data/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domains: { errorQuestions: { upserts, deletes } } })
    })
  assert.equal((await sync([errorRecord('old', 100)], [])).status, 200)
  assert.equal((await sync([errorRecord('new', 200)], [{ key: 'old', deletedAt: 200 }])).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM error_images').get().n, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r2_cleanup_jobs').get().n, 0)
  assert.equal(objects.has(oldGeneration), true)
  assert.equal((await sync([], [{ key: 'new', deletedAt: 300 }])).status, 200)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM error_images').get().n, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM r2_cleanup_jobs').get().n, 1)
  const retried = await api('/api/error-images', { method: 'POST', body: pngFixture() })
  assert.equal((await retried.json()).id, id)
  const current = db.prepare('SELECT r2_key FROM error_images WHERE id = ?').get(id).r2_key
  await cleanupR2Objects(env)
  assert.equal(objects.has(oldGeneration), false)
  assert.equal(objects.has(current), true)
})

test('回收队列防御性跳过仍被映射引用的对象', async () => {
  const response = await api('/api/error-images', { method: 'POST', body: pngFixture() })
  assert.equal(response.status, 201)
  const row = db.prepare('SELECT r2_key FROM error_images').get()
  db.prepare('INSERT INTO r2_cleanup_jobs VALUES (?, 1)').run(row.r2_key)
  await cleanupR2Objects(env)
  assert.equal(objects.has(row.r2_key), true)
  assert.equal(removed.length, 0)
})

test('第 50 张图片的元数据和徽章同批回滚，重试后完整发放', async (t) => {
  t.mock.method(console, 'error', () => {})
  uploads(49)
  failSql = (sql) => sql.includes('INSERT OR IGNORE INTO user_badges')
  assert.equal((await api('/api/community/upload', { method: 'POST', body: pngFixture() })).status, 500)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 49)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM user_badges').get().n, 0)
  failSql = null
  assert.equal((await api('/api/community/upload', { method: 'POST', body: pngFixture() })).status, 201)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_uploads').get().n, 50)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM user_badges WHERE badge_key = 'image_50'").get().n, 1)
})

test('PDF 和笔记正文 finalize 超时后，清理守卫阻止迟到事务删除原正文', async (t) => {
  t.mock.method(console, 'error', () => {})
  for (const item of [
    { table: 'pdf_chunks', column: 'pdf_id', id: 'pdf', url: '/api/pdfs/pdf', old: '%PDF-old', next: '%PDF-new' },
    {
      table: 'note_body_chunks',
      column: 'note_id',
      id: 'note',
      url: '/api/note-bodies/note',
      old: 'old body',
      next: 'new body'
    }
  ]) {
    assert.equal(
      (await api(item.url, { method: 'PUT', body: item.old, headers: { 'X-Updated-At': '100' } })).status,
      200
    )
    const originalBatch = env.DB.batch
    let delayed
    env.DB.batch = async (statements) => {
      if (
        !delayed &&
        statements.some((entry) => entry.sql.startsWith(`DELETE FROM ${item.table}`) && entry.params[1] === item.id)
      ) {
        delayed = statements
        throw new Error('D1 transport timed out while finalize was queued')
      }
      return originalBatch(statements)
    }
    assert.equal(
      (await api(item.url, { method: 'PUT', body: item.next, headers: { 'X-Updated-At': '200' } })).status,
      500
    )
    assert.ok(delayed)
    await assert.rejects(() => originalBatch(delayed), /NOT NULL constraint failed: sync_domain_versions.version/)
    const row = db.prepare(`SELECT data FROM ${item.table} WHERE ${item.column} = ?`).get(item.id)
    assert.equal(new TextDecoder().decode(row.data), item.old)
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${item.table}`).get().n, 1)
    env.DB.batch = originalBatch
  }
})

test('每小时维护执行附件回收，周报只在原周一触发器运行', async () => {
  const statements = []
  const prepare = env.DB.prepare
  env.DB.prepare = (sql) => {
    statements.push(sql)
    return prepare(sql)
  }
  db.exec("INSERT INTO r2_cleanup_jobs VALUES ('old-generation', 1)")
  await worker.scheduled({ cron: '0 * * * *' }, env, { waitUntil() {} })
  assert.equal(db.prepare('SELECT count(*) AS n FROM r2_cleanup_jobs').get().n, 0)
  assert.equal(
    statements.some((sql) => sql.includes('weekly_report')),
    false
  )
  statements.length = 0
  await worker.scheduled({ cron: '0 0 * * 1' }, env, { waitUntil() {} })
  assert.equal(
    statements.some((sql) => sql.includes('weekly_report')),
    true
  )
})
