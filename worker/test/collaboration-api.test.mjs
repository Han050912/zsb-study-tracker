import test, { beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { build } from 'esbuild'
import { readFile, mkdir, writeFile, unlink } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../../', import.meta.url))
const code = await build({
  stdin: {
    contents: `import { registerTeamsRoutes } from './worker/src/api/teams/teams'; import { registerChallengeRoutes } from './worker/src/api/teams/challenges'; import { registerPostsRoutes } from './worker/src/api/community/posts'; import { registerMessagesRoutes } from './worker/src/api/community/messages'; import { registerCirclesRoutes } from './worker/src/api/community/circles'; import { registerPartnerShareRoutes } from './worker/src/api/partnerShares'; import { registerPartnerStudy } from './worker/src/api/partnerCollab'; export { route } from './worker/src/router'; registerTeamsRoutes(); registerChallengeRoutes(); registerPostsRoutes(); registerMessagesRoutes(); registerCirclesRoutes(); registerPartnerShareRoutes(); registerPartnerStudy();`,
    resolveDir: root
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
  plugins: [
    {
      name: 'local-auth',
      setup(builder) {
        builder.onResolve({ filter: /middleware\/(auth|rateLimit)$/ }, (args) => ({
          path: args.path,
          namespace: 'mock'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({
          contents: args.path.endsWith('auth')
            ? `export async function resolveAuth(request) { return { userId: request.headers.get('X-Test-User') || '', role: 'user' } }; export const tryGetAuth = resolveAuth; export const isDbAdmin = async () => false;`
            : `export async function rateLimit() {}`
        }))
      }
    }
  ]
})
const dir = path.join(root, '.cache/refactor-tests')
await mkdir(dir, { recursive: true })
const filename = path.join(dir, `api-${crypto.randomUUID()}.mjs`)
await writeFile(filename, code.outputFiles[0].text)
const { route } = await import(pathToFileURL(filename).href)
await unlink(filename)
const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8')
let db, env, beforeBatch, beforeRun, afterAll, batchQueue
function statement(sql, args = []) {
  return {
    bind: (...values) => statement(sql, values),
    all: async () => {
      const results = db.prepare(sql).all(...args)
      afterAll?.()
      afterAll = null
      return { results }
    },
    first: async () => db.prepare(sql).get(...args) ?? null,
    run: async () => {
      beforeRun?.(sql)
      return { meta: { changes: Number(db.prepare(sql).run(...args).changes) } }
    }
  }
}
beforeEach(() => {
  db = new DatabaseSync(':memory:')
  db.exec(schema)
  beforeBatch = null
  beforeRun = null
  afterAll = null
  batchQueue = Promise.resolve()
  env = {
    DB: {
      prepare: (sql) => statement(sql),
      batch: async (statements) => {
        const job = batchQueue.then(async () => {
          beforeBatch?.()
          beforeBatch = null
          db.exec('BEGIN')
          try {
            const result = []
            for (const sql of statements) result.push(await sql.run())
            db.exec('COMMIT')
            return result
          } catch (error) {
            db.exec('ROLLBACK')
            throw error
          }
        })
        batchQueue = job.catch(() => {})
        return job
      }
    },
    IMAGES: { delete: async () => {} }
  }
  for (const id of ['leader', 'member', 'other'])
    db.prepare('INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, 1)').run(id, id, 'unused')
  db.exec(
    "INSERT INTO study_teams (id,name,creator_id,member_count,created_at) VALUES ('team','高数冲刺','leader',2,100)"
  )
  db.exec(
    "INSERT INTO team_members (team_id,user_id,role,joined_at) VALUES ('team','leader','leader',1),('team','member','member',2)"
  )
})
afterEach(() => db.close())
async function api(url, user = 'leader', method = 'GET', body) {
  return route(
    new Request('http://localhost' + url, {
      method,
      headers: { 'X-Test-User': user, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {})
    }),
    env
  )
}

test('only the captain can review, remove, transfer, disband or change squad visibility', async () => {
  for (const user of ['member', 'other']) {
    for (const [url, method, body] of [
      ['/requests', 'GET'],
      ['/requests/other/approve', 'POST'],
      ['/requests/other/reject', 'POST', { reason: '人数已满' }],
      ['/remove-member', 'POST', { userId: 'member' }],
      ['/transfer-leader', 'POST', { newLeaderId: 'member' }],
      ['/disband', 'POST'],
      ['', 'PUT', { name: '高数冲刺', maxMembers: 10, isPublic: false }]
    ]) {
      await assert.rejects(api('/api/teams/team' + url, user, method, body), (error) => error.status === 403)
    }
  }
  assert.equal(db.prepare("SELECT member_count FROM study_teams WHERE id='team'").get().member_count, 2)
})

test('captain management reviews applications, removes members, transfers leadership and disbands', async () => {
  db.exec("INSERT INTO team_join_requests (team_id,user_id,created_at) VALUES ('team','other',3)")
  const requests = await (await api('/api/teams/team/requests')).json()
  assert.equal(requests[0].userId, 'other')
  assert.equal((await api('/api/teams/team/requests/other/approve', 'leader', 'POST')).status, 200)
  assert.equal(db.prepare("SELECT member_count FROM study_teams WHERE id='team'").get().member_count, 3)
  assert.equal((await api('/api/teams/team/remove-member', 'leader', 'POST', { userId: 'other' })).status, 200)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id='other'").get().n, 0)
  assert.equal((await api('/api/teams/team/transfer-leader', 'leader', 'POST', { newLeaderId: 'member' })).status, 200)
  await assert.rejects(api('/api/teams/team/disband', 'leader', 'POST'), (error) => error.status === 403)
  assert.equal((await api('/api/teams/team/disband', 'member', 'POST')).status, 200)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM study_teams WHERE id='team'").get().n, 0)
})

test('visibility edits persist, preserve members and pending requests, and issue fresh private invitations', async () => {
  const body = { name: '高数冲刺', description: '一起坚持', maxMembers: 10, isPublic: false }
  assert.equal((await api('/api/teams/team', 'leader', 'PUT', body)).status, 200)
  const privateDetail = await (await api('/api/teams/team')).json()
  assert.equal(privateDetail.team.isPublic, false)
  assert.equal(privateDetail.members.length, 2)
  assert.match(privateDetail.inviteCode, /^[A-Z0-9]{8}$/)
  assert.ok(privateDetail.inviteCodeExpiresAt > Date.now() / 1000)
  await assert.rejects(api('/api/teams/team', 'other'), (error) => error.status === 403)
  await assert.rejects(api('/api/teams/team/join', 'other', 'POST'), (error) => error.status === 403)
  await api('/api/teams/team/apply', 'other', 'POST', { inviteCode: privateDetail.inviteCode })
  await api('/api/teams/team', 'leader', 'PUT', { ...body, isPublic: true })
  const publicDetail = await (await api('/api/teams/team', 'other')).json()
  assert.equal(publicDetail.team.isPublic, true)
  assert.equal(db.prepare("SELECT invite_code FROM study_teams WHERE id='team'").get().invite_code, null)
  assert.equal((await (await api('/api/teams/team/requests')).json()).length, 1)
  await api('/api/teams/team/join', 'other', 'POST')
  assert.equal((await (await api('/api/teams/team/requests')).json()).length, 0)
  await api('/api/teams/team', 'leader', 'PUT', body)
  const newPrivateDetail = await (await api('/api/teams/team')).json()
  assert.notEqual(newPrivateDetail.inviteCode, privateDetail.inviteCode)
  assert.equal(newPrivateDetail.members.length, 3)
  await assert.rejects(
    api('/api/teams/by-invite?code=' + privateDetail.inviteCode, 'other'),
    (error) => error.status === 404
  )
})

test('legacy squad edits preserve visibility and reject invalid visibility without writing', async () => {
  const body = { name: '高数冲刺', maxMembers: 10 }
  await api('/api/teams/team', 'leader', 'PUT', body)
  assert.equal((await (await api('/api/teams/team')).json()).team.isPublic, true)
  await assert.rejects(
    api('/api/teams/team', 'leader', 'PUT', { ...body, isPublic: 'false' }),
    (error) => error.status === 400
  )
  assert.equal((await (await api('/api/teams/team')).json()).team.isPublic, true)
  await api('/api/teams/team', 'leader', 'PUT', { ...body, isPublic: false })
  const before = await (await api('/api/teams/team')).json()
  await api('/api/teams/team', 'leader', 'PUT', body)
  const after = await (await api('/api/teams/team')).json()
  assert.equal(after.team.isPublic, false)
  assert.equal(after.inviteCode, before.inviteCode)
})

test('a departing transfer target cannot leave the squad without a captain or emit a false notification', async () => {
  beforeBatch = () => db.exec("DELETE FROM team_members WHERE user_id='member'")
  await assert.rejects(
    api('/api/teams/team/transfer-leader', 'leader', 'POST', { newLeaderId: 'member' }),
    (error) => error.status === 409
  )
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='leader'").get().role, 'leader')
  assert.equal(db.prepare("SELECT creator_id FROM study_teams WHERE id='team'").get().creator_id, 'leader')
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_notifications').get().n, 0)
})

test('a former captain cannot disband a squad after leadership changes during the request', async () => {
  beforeBatch = () =>
    db.exec(
      "UPDATE team_members SET role='member' WHERE user_id='leader'; UPDATE team_members SET role='leader' WHERE user_id='member'; UPDATE study_teams SET creator_id='member' WHERE id='team'"
    )
  await assert.rejects(api('/api/teams/team/disband', 'leader', 'POST'), (error) => error.status === 409)
  assert.equal(db.prepare("SELECT member_count FROM study_teams WHERE id='team'").get().member_count, 2)
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='member'").get().role, 'leader')
})

test('visibility saves recheck captain authority at the write and do not apply a stale edit', async () => {
  beforeRun = (sql) => {
    if (!sql.startsWith('UPDATE study_teams SET name')) return
    beforeRun = null
    db.exec(
      "UPDATE team_members SET role='member' WHERE user_id='leader'; UPDATE team_members SET role='leader' WHERE user_id='member'; UPDATE study_teams SET creator_id='member' WHERE id='team'"
    )
  }
  await assert.rejects(
    api('/api/teams/team', 'leader', 'PUT', { name: '旧队长的修改', maxMembers: 10, isPublic: false }),
    (error) => error.status === 409
  )
  const row = db.prepare("SELECT name, is_public FROM study_teams WHERE id='team'").get()
  assert.equal(row.name, '高数冲刺')
  assert.equal(row.is_public, 1)
})

test('a new member arriving during an edit cannot lower the capacity below the current member count', async () => {
  beforeRun = (sql) => {
    if (!sql.startsWith('UPDATE study_teams SET name')) return
    beforeRun = null
    db.exec(
      "INSERT INTO team_members (team_id,user_id,role,joined_at) VALUES ('team','other','member',3); UPDATE study_teams SET member_count=3 WHERE id='team'"
    )
  }
  await assert.rejects(
    api('/api/teams/team', 'leader', 'PUT', { name: '高数冲刺', maxMembers: 2, isPublic: false }),
    (error) => error.status === 409
  )
  const row = db.prepare("SELECT max_members, is_public FROM study_teams WHERE id='team'").get()
  assert.equal(row.max_members, 10)
  assert.equal(row.is_public, 1)
})

test('joining after a private squad becomes public clears the old application in the member transaction', async () => {
  db.exec("INSERT INTO team_join_requests (team_id,user_id,created_at) VALUES ('team','other',3)")
  db.exec(
    "CREATE TRIGGER fail_request_cleanup BEFORE DELETE ON team_join_requests BEGIN SELECT RAISE(ABORT,'test rollback'); END"
  )
  await assert.rejects(api('/api/teams/team/join', 'other', 'POST'))
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE user_id='other'").get().n, 0)
  assert.equal(db.prepare("SELECT member_count FROM study_teams WHERE id='team'").get().member_count, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM team_join_requests').get().n, 1)
})

test('私信会话摘要不会混入搭子同秒发给第三人的消息', async () => {
  db.exec(`INSERT INTO community_messages (id,from_id,to_id,content,created_at) VALUES
    ('a-private','member','other','第三人私密内容',100),
    ('z-mine','member','leader','发给我的内容',100)`)
  const response = await (await api('/api/community/messages/conversations')).json()
  assert.equal(response.conversations.length, 1)
  assert.equal(response.conversations[0].lastContent, '发给我的内容')
})

test('私信已读仅覆盖本次返回的消息，历史页和读取间隙的新消息保持未读', async () => {
  for (let i = 0; i < 40; i++)
    db.prepare('INSERT INTO community_messages(id,from_id,to_id,content,created_at) VALUES(?,?,?,?,?)').run(
      'm' + String(i).padStart(2, '0'),
      'member',
      'leader',
      '私信',
      100
    )
  afterAll = () =>
    db.exec(
      "INSERT INTO community_messages(id,from_id,to_id,content,created_at) VALUES('new','member','leader','新到达',101)"
    )
  const page = await (await api('/api/community/messages/with/member')).json()
  assert.equal(page.messages.length, 30)
  assert.equal(page.markedRead, 30)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_messages WHERE is_read=0').get().n, 11)
  const older = await (
    await api('/api/community/messages/with/member?cursor=' + encodeURIComponent(page.nextCursor))
  ).json()
  assert.equal(older.markedRead, 10)
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM community_messages WHERE is_read=0').get().n, 1)
})

test('私信正向补拉：断网积累多页与同秒随机id不漏，保持历史分页独立', async () => {
  for (let i = 0; i < 75; i++)
    db.prepare('INSERT INTO community_messages(id,from_id,to_id,content,created_at) VALUES(?,?,?,?,?)').run(
      'm' + String(i).padStart(2, '0'),
      'member',
      'leader',
      '私信',
      100 + Math.floor(i / 10)
    )
  let cursor = '99_~'
  const seen = []
  do {
    const page = await (await api('/api/community/messages/with/member?after=' + encodeURIComponent(cursor))).json()
    seen.push(...page.messages.map((m) => m.id))
    cursor = page.nextCursor
  } while (cursor)
  assert.equal(seen.length, 75)
  assert.equal(new Set(seen).size, 75)
  db.exec(
    "INSERT INTO community_messages(id,from_id,to_id,content,created_at) VALUES('a-late','member','leader','同秒晚到',107)"
  )
  const overlap = await (await api('/api/community/messages/with/member?after=106_~')).json()
  assert.ok(overlap.messages.some((m) => m.id === 'a-late'))
  assert.equal(overlap.markedRead, 1)
  await assert.rejects(api('/api/community/messages/with/member?after=bad'), (e) => e.status === 400)
})

test('分享分页：双方记录严格限量且不重复，解绑记录不挤占当前搭子的页', async () => {
  db.exec(
    "INSERT INTO study_partners (id,from_id,to_id,pair_key,status,created_at,updated_at) VALUES ('pair','leader','member','leader:member','accepted',1,1)"
  )
  for (let i = 0; i < 5; i++)
    db.prepare(
      'INSERT INTO partner_shares(id,owner_id,partner_id,item_type,item_id,created_at) VALUES(?,?,?,?,?,?)'
    ).run('share' + i, i % 2 ? 'member' : 'leader', i % 2 ? 'leader' : 'member', 'note', 'note', 100)
  for (let i = 0; i < 5; i++)
    db.prepare(
      'INSERT INTO partner_shares(id,owner_id,partner_id,item_type,item_id,created_at) VALUES(?,?,?,?,?,?)'
    ).run('unbound' + i, 'leader', 'other', 'note', 'note', 200)
  const seen = []
  let cursor = null
  do {
    const page = await (
      await api('/api/partner-shares?limit=2' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''))
    ).json()
    const ids = [...page.received, ...page.sent].map((s) => s.id)
    assert.ok(ids.length <= 2)
    assert.ok(ids.every((id) => id.startsWith('share')))
    seen.push(...ids)
    cursor = page.nextCursor
  } while (cursor)
  assert.equal(seen.length, 5)
  assert.equal(new Set(seen).size, 5)
})

test('圈审批：不存在和重复请求不产生幽灵通过通知，成功仅通知一次', async () => {
  db.exec(
    "INSERT INTO community_circles(id,name,creator_id,is_public,member_count,created_at) VALUES('circle','高数','leader',0,1,1);INSERT INTO circle_members(circle_id,user_id,role,status,created_at) VALUES('circle','leader','owner','active',1)"
  )
  await assert.rejects(
    api('/api/community/circles/circle/members/member/approve', 'leader', 'PUT'),
    (e) => e.status === 404
  )
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE target_id='circle'").get().n, 0)
  db.exec(
    "INSERT INTO circle_members(circle_id,user_id,role,status,created_at) VALUES('circle','member','member','pending',1)"
  )
  assert.equal((await api('/api/community/circles/circle/members/member/approve', 'leader', 'PUT')).status, 200)
  await assert.rejects(
    api('/api/community/circles/circle/members/member/approve', 'leader', 'PUT'),
    (e) => e.status === 404
  )
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE target_id='circle'").get().n, 1)
  assert.equal(db.prepare("SELECT member_count FROM community_circles WHERE id='circle'").get().member_count, 2)
})

test('圈申请并发去重通知，审批与取消/拒绝交错时成员计数正确', async () => {
  db.exec(
    "INSERT INTO community_circles(id,name,creator_id,is_public,member_count,created_at) VALUES('circle','高数','leader',0,1,1);INSERT INTO circle_members(circle_id,user_id,role,status,created_at) VALUES('circle','leader','owner','active',1)"
  )
  await Promise.all([
    api('/api/community/circles/circle/join', 'member', 'PUT'),
    api('/api/community/circles/circle/join', 'member', 'PUT')
  ])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE target_id='circle'").get().n, 1)
  beforeBatch = () =>
    db.exec(
      "UPDATE circle_members SET status='active' WHERE circle_id='circle' AND user_id='member';UPDATE community_circles SET member_count=2 WHERE id='circle'"
    )
  await api('/api/community/circles/circle/join', 'member', 'PUT')
  assert.equal(db.prepare("SELECT member_count FROM community_circles WHERE id='circle'").get().member_count, 1)
  db.exec(
    "INSERT INTO circle_members(circle_id,user_id,role,status,created_at) VALUES('circle','member','member','pending',1)"
  )
  beforeBatch = () =>
    db.exec(
      "UPDATE circle_members SET status='active' WHERE circle_id='circle' AND user_id='member';UPDATE community_circles SET member_count=2 WHERE id='circle'"
    )
  await api('/api/community/circles/circle/members/member', 'leader', 'DELETE')
  assert.equal(db.prepare("SELECT member_count FROM community_circles WHERE id='circle'").get().member_count, 1)
})

test('双人倒计时：空值、零、负数和越界时长不能创建会话', async () => {
  db.exec(
    "INSERT INTO study_partners (id,from_id,to_id,pair_key,status,created_at,updated_at) VALUES ('pair','leader','member','leader:member','accepted',1,1)"
  )
  for (const focusMinutes of ['', 0, -1, 121, 'bad'])
    await assert.rejects(
      api('/api/partner-study/sessions', 'leader', 'POST', { partnerId: 'member', mode: 'countdown', focusMinutes }),
      (e) => e.status === 400
    )
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM partner_study_sessions').get().n, 0)
  assert.equal(
    (
      await api('/api/partner-study/sessions', 'leader', 'POST', {
        partnerId: 'member',
        mode: 'countdown',
        focusMinutes: 1
      })
    ).status,
    201
  )
})

test('双方并发邀请仅保留一个自习房间和一条邀请通知', async () => {
  db.exec(
    "INSERT INTO study_partners (id,from_id,to_id,pair_key,status,created_at,updated_at) VALUES ('pair','leader','member','leader:member','accepted',1,1)"
  )
  const results = await Promise.allSettled([
    api('/api/partner-study/sessions', 'leader', 'POST', { partnerId: 'member', focusMinutes: 25 }),
    api('/api/partner-study/sessions', 'member', 'POST', { partnerId: 'leader', focusMinutes: 25 })
  ])
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM partner_study_sessions WHERE status='active'").get().n, 1)
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE target_type='partner_study'").get().n,
    1
  )
})

test('双人结束状态：另一方心跳立即拿到done且无权用户不能读取，迟到focus不能倒退done侧', async () => {
  db.exec(
    "INSERT INTO study_partners (id,from_id,to_id,pair_key,status,created_at,updated_at) VALUES ('pair','leader','member','leader:member','accepted',1,1)"
  )
  const created = await (await api('/api/partner-study/sessions', 'leader', 'POST', { partnerId: 'member' })).json()
  await api('/api/partner-study/sessions/' + created.id, 'leader', 'PUT', { state: 'done', minutes: 25 })
  await api('/api/partner-study/sessions/' + created.id, 'leader', 'PUT', { state: 'focus', minutes: 1 })
  assert.equal(
    db.prepare('SELECT from_state FROM partner_study_sessions WHERE id=?').get(created.id).from_state,
    'done'
  )
  await api('/api/partner-study/sessions/' + created.id, 'leader', 'DELETE')
  const heartbeat = await (
    await api('/api/partner-study/sessions/' + created.id, 'member', 'PUT', { state: 'focus' })
  ).json()
  assert.equal(heartbeat.session.status, 'done')
  await assert.rejects(
    api('/api/partner-study/sessions/' + created.id, 'other', 'PUT', { state: 'focus' }),
    (e) => e.status === 403
  )
  assert.equal(db.prepare('SELECT to_state FROM partner_study_sessions WHERE id=?').get(created.id).to_state, 'idle')
})

test('自习创建：busy 检查后出现的新房间仍能阻止本次写入和幽灵通知', async () => {
  db.exec(
    "INSERT INTO study_partners (id,from_id,to_id,pair_key,status,created_at,updated_at) VALUES ('pair','leader','member','leader:member','accepted',1,1)"
  )
  beforeBatch = () =>
    db
      .prepare(
        "INSERT INTO partner_study_sessions (id,from_id,to_id,status,created_at,updated_at,last_active_at) VALUES ('racing','member','leader','active',?,?,?)"
      )
      .run(...Array(3).fill(Math.floor(Date.now() / 1000)))
  await assert.rejects(
    api('/api/partner-study/sessions', 'leader', 'POST', { partnerId: 'member' }),
    (error) => error.status === 409
  )
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM partner_study_sessions WHERE status='active'").get().n, 1)
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM community_notifications WHERE target_type='partner_study'").get().n,
    0
  )
})
test('transfer-and-leave: 同批转让、退出、成员计数与通知', async () => {
  const response = await api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' })
  assert.equal(response.status, 200)
  assert.equal(db.prepare("SELECT creator_id FROM study_teams WHERE id='team'").get().creator_id, 'member')
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM team_members WHERE team_id='team'").get().n, 1)
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='member'").get().role, 'leader')
  await assert.rejects(
    api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' }),
    (e) => e.status === 403
  )
})
test('transfer-and-leave: 中途失败整批回滚，目标成员在校验后离开也不丢队长', async () => {
  db.exec("CREATE TRIGGER fail_exit BEFORE DELETE ON team_members BEGIN SELECT RAISE(ABORT,'test rollback'); END")
  await assert.rejects(api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' }))
  assert.equal(db.prepare("SELECT creator_id FROM study_teams WHERE id='team'").get().creator_id, 'leader')
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='member'").get().role, 'member')
  db.exec('DROP TRIGGER fail_exit')
  beforeBatch = () => db.exec("DELETE FROM team_members WHERE user_id='member'")
  await assert.rejects(
    api('/api/teams/team/transfer-and-leave', 'leader', 'POST', { newLeaderId: 'member' }),
    (e) => e.status === 409
  )
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='leader'").get().role, 'leader')
})
test('sync-active: 五个 active 挑战一轮返回，排除未开始/取消/结束，并验证成员权限', async () => {
  const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  for (let i = 0; i < 5; i++) {
    db.prepare(
      'INSERT INTO team_challenges (id,team_id,type,target,duration_days,start_date,end_date,created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('c' + i, 'team', 'minutes', 100, 1, today, today, i)
    for (const id of ['leader', 'member'])
      db.prepare(
        'INSERT INTO team_challenge_progress (challenge_id,user_id,current_value,is_completed) VALUES (?, ?, 0, 0)'
      ).run('c' + i, id)
  }
  db.exec("UPDATE team_challenges SET is_cancelled=1 WHERE id='c4'")
  const result = await (await api('/api/teams/team/sync-active', 'leader', 'POST')).json()
  assert.equal(result.challenges.length, 5)
  assert.equal(result.challenges.filter((c) => c.status === 'active').length, 4)
  assert.equal(result.challenges[0].status, 'cancelled')
  await assert.rejects(api('/api/teams/team/sync-active', 'other', 'POST'), (e) => e.status === 403)
})

test('退出并发转让：校验后接任队长不能被旧退出请求删除', async () => {
  beforeBatch = () =>
    db.exec(
      "UPDATE team_members SET role='member' WHERE user_id='leader'; UPDATE team_members SET role='leader' WHERE user_id='member'; UPDATE study_teams SET creator_id='member' WHERE id='team'"
    )
  await assert.rejects(api('/api/teams/team/leave', 'member', 'POST'), (e) => e.status === 409)
  assert.equal(db.prepare("SELECT role FROM team_members WHERE user_id='member'").get().role, 'leader')
  assert.equal(db.prepare("SELECT member_count FROM study_teams WHERE id='team'").get().member_count, 2)
})

test('帖子关键词搜索：中文和通配符按原文匹配，隐藏内容不泄漏', async () => {
  const insert = db.prepare(
    'INSERT INTO community_posts (id,user_id,type,content,created_at,updated_at,is_hidden) VALUES (?, ?, ?, ?, 100, 1, ?)'
  )
  insert.run('a', 'leader', 'share', '复习100%_高数', 0)
  insert.run('b', 'leader', 'share', '复习1000分', 0)
  insert.run('c', 'leader', 'share', '复习100%_隐藏', 1)
  const result = await (await api('/api/community/posts?keyword=' + encodeURIComponent('100%_'))).json()
  assert.deepEqual(
    result.posts.map((p) => p.id),
    ['a']
  )
})
test('小队列表过滤/稳定游标和局部查询，私密组不会泄漏', async () => {
  for (let i = 0; i < 25; i++)
    db.prepare(
      'INSERT INTO study_teams (id,name,creator_id,member_count,max_members,created_at) VALUES (?, ?, ?, 2, 4, 100)'
    ).run('t' + String(i).padStart(2, '0'), '高数' + i, 'leader')
  const first = await (await api('/api/teams?paged=1&keyword=高数&capacity=available')).json()
  const second = await (
    await api('/api/teams?paged=1&keyword=高数&capacity=available&cursor=' + encodeURIComponent(first.nextCursor))
  ).json()
  assert.equal(first.teams.length, 20)
  assert.equal(new Set([...first.teams, ...second.teams].map((t) => t.id)).size, 26)
  const members = await (await api('/api/teams/team?section=members')).json()
  assert.equal(members.members.length, 2)
  assert.equal(members.challenges.length, 0)
  db.exec("UPDATE study_teams SET is_public=0 WHERE id='team'")
  await assert.rejects(api('/api/teams/team?section=members', 'other'), (e) => e.status === 403)
})
test('评论分页: 20 条根评论、回复按需、锚点定位、隐藏评论/父级权限与计数', async () => {
  db.exec(
    "INSERT INTO community_posts (id,user_id,type,content,created_at,updated_at) VALUES ('post','leader','question','微积分',1,1)"
  )
  for (let i = 0; i < 45; i++)
    db.prepare(
      'INSERT INTO community_comments (id,post_id,user_id,content,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 1)'
    ).run('r' + String(i).padStart(2, '0'), 'post', 'member', '回答', 100)
  for (let i = 0; i < 25; i++)
    db.prepare(
      'INSERT INTO community_comments (id,post_id,user_id,parent_id,content,created_at,updated_at) VALUES (?, ?, ?, ?, ?, ?, 1)'
    ).run('reply' + i, 'post', 'member', 'r44', '回复', i + 200)
  const page = await (await api('/api/community/posts/post?paginate=1&sort=latest')).json()
  assert.equal(page.comments.length, 20)
  assert.equal(page.comments[0].replyCount, 25)
  assert.equal(
    page.comments.some((c) => c.parentId),
    false
  )
  const next = await (
    await api('/api/community/posts/post/comments?sort=latest&cursor=' + encodeURIComponent(page.nextCursor))
  ).json()
  assert.equal(new Set([...page.comments, ...next.comments].map((c) => c.id)).size, 40)
  const replies = await (await api('/api/community/posts/post/comments?parentId=r44')).json()
  assert.equal(replies.comments.length, 20)
  assert.ok(replies.nextCursor)
  const anchor = await (await api('/api/community/posts/post/comments?aroundCommentId=reply24')).json()
  assert.deepEqual(new Set(anchor.comments.map((c) => c.id)), new Set(['r44', 'reply24']))
  db.exec("UPDATE community_comments SET is_hidden=1 WHERE id='r44'")
  await assert.rejects(api('/api/community/posts/post/comments?aroundCommentId=reply24'), (e) => e.status === 404)
  await assert.rejects(api('/api/community/posts/post/comments?parentId=r44'), (e) => e.status === 404)
})
