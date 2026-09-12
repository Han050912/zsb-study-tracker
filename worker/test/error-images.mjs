/**
 * 错题图片外置（/api/error-images）集成测试：上传 / 读取 / 隔离 / 校验 / 幂等 / 删除事件驱动的孤儿清理
 * （孤儿清理经记录级同步 POST /api/data/push 的 errorQuestions.deletes 墓碑触发）。
 * 前置：npx wrangler d1 execute zsb-study-db --local --file=./schema.sql && npx wrangler dev
 * 运行：node test/error-images.mjs [baseURL]（默认 http://localhost:8787）
 */
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

// 请求重试统一走 ./fetch-retry.mjs
import { fetchRetry } from './fetch-retry.mjs'

const BASE = process.argv[2] || 'http://localhost:8787'
const ORIGIN = 'http://localhost:5173'
const WORKER_DIR = fileURLToPath(new URL('..', import.meta.url))
const DESKTOP_TOKEN = process.env.SMOKE_DESKTOP_TOKEN || 'zsb-desktop-v2'

function d1(sql) {
  return execSync(`npx wrangler d1 execute zsb-study-db --local --json --command "${sql}"`, {
    cwd: WORKER_DIR
  }).toString()
}

let passed = 0
let failed = 0
function check(name, cond, extra = '') {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${extra ? ' — ' + extra : ''}`)
  }
}

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json', Origin: ORIGIN, 'X-Desktop-Token': DESKTOP_TOKEN }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchRetry(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 二进制响应 */
  }
  return { status: res.status, data }
}

/** full pull（记录级同步取数：错题记录在 changes.errorQuestions.upserts，元素即记录本身） */
const pullFullData = async (token) =>
  (await api('/api/data/pull', { method: 'POST', token, body: { full: true } })).data

/** 裸二进制上传（与前端 authFetch 的 POST 一致）；id 由服务端计算并返回 */
async function postImage(token, bytes, contentType = 'application/octet-stream') {
  const headers = { 'Content-Type': contentType, Origin: ORIGIN, 'X-Desktop-Token': DESKTOP_TOKEN }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchRetry(`${BASE}/api/error-images`, { method: 'POST', headers, body: bytes })
  let data = null
  try {
    data = await res.json()
  } catch {
    /* 可能为空 */
  }
  return { status: res.status, data }
}

async function getImage(id, token) {
  const headers = { Origin: ORIGIN, 'X-Desktop-Token': DESKTOP_TOKEN }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetchRetry(`${BASE}/api/error-images/${id}`, { headers })
  if (res.status !== 200) return { status: res.status, bytes: null, contentType: res.headers.get('content-type') }
  return {
    status: res.status,
    bytes: Buffer.from(await res.arrayBuffer()),
    contentType: res.headers.get('content-type')
  }
}

/** sha256 → 64 位小写 hex（与服务端 ID_RE 口径一致，用于校验不变式） */
async function sha256Hex(buf) {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(buf).digest('hex')
}

/** 取 error_images 中该用户的记录数 */
function imageRowCount(userId) {
  const out = d1(`SELECT COUNT(*) AS n FROM error_images WHERE user_id = '${userId}'`)
  const parsed = JSON.parse(out.slice(out.indexOf('[')))
  return parsed?.[0]?.results?.[0]?.n ?? -1
}

/**
 * 程序化生成 1×1 RGBA PNG（IHDR/IDAT/IEND + 正确 CRC32，无任何元数据块）。
 * 不依赖外部二进制 fixture：此类未跟踪文件一旦丢失会让整段测试无法运行，而服务端 stripPng
 * 对无 eXIf/文本块的 PNG 是逐字节原样返回，故字节往返断言要求输入本身必须结构自洽。
 */
function makePng1x1() {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  const crc = (buf) => {
    let c = 0xffffffff
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data])
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE(crc(body))
    return Buffer.concat([len, body, crcBuf])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0) // 宽
  ihdr.writeUInt32BE(1, 4) // 高
  ihdr[8] = 8 // 位深
  ihdr[9] = 6 // 颜色类型：RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from([0, 0, 0, 0, 0]))), // filter 0 + RGBA(0,0,0,0)
    chunk('IEND', Buffer.alloc(0))
  ])
}

const uniq = Date.now().toString(36)
const userA = { username: `imgtesta_${uniq}`, password: 'password123' }
const userB = { username: `imgtestb_${uniq}`, password: 'password123' }

async function main() {
  console.log(`目标: ${BASE}\n`)

  const regA = await api('/api/auth/register', { method: 'POST', body: userA })
  check('注册用户 A', regA.status === 201 && !!regA.data?.token, JSON.stringify(regA.data))
  const regB = await api('/api/auth/register', { method: 'POST', body: userB })
  check('注册用户 B', regB.status === 201 && !!regB.data?.token, JSON.stringify(regB.data))
  const tokenA = regA.data.token
  const tokenB = regB.data?.token
  const userAId = regA.data?.user?.id
  const userBId = regB.data?.user?.id

  const png = makePng1x1()
  const dummyId = 'a'.repeat(64)

  console.log('[校验]')
  check('未认证上传返回 401', (await postImage(null, png)).status === 401)
  check('未认证读取返回 401', (await getImage(dummyId, null)).status === 401)
  check('非法 id 读取返回 400', (await getImage('BAD_id', tokenA)).status === 400)
  check('非图片魔数返回 400', (await postImage(tokenA, Buffer.from('not an image'))).status === 400)
  check('空文件返回 400', (await postImage(tokenA, Buffer.alloc(0))).status === 400)
  check('超 5MB 返回 413', (await postImage(tokenA, Buffer.alloc(5 * 1024 * 1024 + 1, 0x41))).status === 413)

  console.log('[上传与读取]')
  const up = await postImage(tokenA, png)
  check(
    '上传返回 200 + 64 位 hex id + size',
    up.status === 200 && /^[a-f0-9]{64}$/.test(up.data?.id || '') && up.data?.size > 0,
    JSON.stringify(up.data)
  )
  const imageId = up.data?.id
  const got = await getImage(imageId, tokenA)
  check('读取返回 200 + 正确 Content-Type', got.status === 200 && got.contentType === 'image/png')
  check('字节往返一致', !!got.bytes && got.bytes.equals(png))
  check('内容寻址不变式：sha256(存储对象) === id', !!got.bytes && (await sha256Hex(got.bytes)) === imageId)

  console.log('[元数据剥离与寻址一致]')
  // 携带 EXIF(APP1) 段的 JPEG：剥离后落盘字节的 sha256 必须等于服务端返回的 id
  const jpegExif = Buffer.from([
    0xff, 0xd8, 0xff, 0xe1, 0x00, 0x10, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 1, 2, 3, 4, 5, 6, 7, 8, 0xff, 0xd9
  ])
  const upJpg = await postImage(tokenA, jpegExif, 'image/jpeg')
  check('上传带 EXIF 的 JPEG 返回 200', upJpg.status === 200, JSON.stringify(upJpg.data))
  const jpgGot = await getImage(upJpg.data?.id, tokenA)
  check('EXIF 已被服务端剥离', jpgGot.status === 200 && !jpgGot.bytes.includes(Buffer.from('Exif')))
  check('剥离后字节的 sha256 === 返回的 id（含元数据图片同样成立）', (await sha256Hex(jpgGot.bytes)) === upJpg.data?.id)

  console.log('[幂等]')
  const upAgain = await postImage(tokenA, png)
  check(
    '重复上传同一内容返回同一 id',
    upAgain.status === 200 && upAgain.data?.id === imageId,
    JSON.stringify(upAgain.data)
  )
  check('归属行数为 2（PNG 与 JPEG 各一行）', imageRowCount(userAId) === 2, `实际 ${imageRowCount(userAId)}`)
  check('重复上传后仍可读取', (await getImage(imageId, tokenA)).status === 200)

  console.log('[隔离]')
  check('跨用户读取返回 404', (await getImage(imageId, tokenB)).status === 404)

  console.log('[删除事件驱动的孤儿清理]')
  // 记录级同步（POST /api/data/push）：errorQuestions 域以 upserts/deletes 传输，
  // 「未引用对象被清理」改由删除事件驱动——错题删除被接受（写墓碑）时按 key 清理 error_images + R2。
  // A 的 PNG 此前未被任何错题引用（元数据剥离段上传），记录级协议不再做整域差集清理，该归属行会一直保留。
  const pushErrorQuestions = (token, upserts, deletes = []) =>
    api('/api/data/push', {
      method: 'POST',
      token,
      body: {
        domains: {
          errorQuestions: { upserts: upserts.map((q) => ({ ...q, updatedAt: Date.now() })), deletes }
        }
      }
    })

  // 跨用户隔离前置：B 引用自己上传的同内容图片（同 id、key 按用户隔离）
  const bUp = await postImage(tokenB, png)
  check('B 上传同内容图片成功', bUp.status === 200, JSON.stringify(bUp.data))
  await pushErrorQuestions(tokenB, [
    { id: 'b1', subjectId: 'math', date: '2026-09-11', type: '选择', content: 'b', image: `r2:${bUp.data?.id}` }
  ])
  check('B 的引用产生自己的归属行（行数=1）', imageRowCount(userBId) === 1, `实际 ${imageRowCount(userBId)}`)

  check(
    '推送含引用的记录成功',
    (
      await pushErrorQuestions(tokenA, [
        { id: 'e1', subjectId: 'math', date: '2026-09-11', type: '选择', content: 'q', image: `r2:${imageId}` }
      ])
    ).status === 200
  )
  check('引用中的对象仍可读取', (await getImage(imageId, tokenA)).status === 200)
  // 记录级协议不做差集清理：未被任何错题引用的 JPEG 归属行不会被顺手删掉
  check(
    '不做差集清理：未被引用的 JPEG 归属行仍保留（行数=2）',
    imageRowCount(userAId) === 2,
    `实际 ${imageRowCount(userAId)}`
  )

  const pulled = await pullFullData(tokenA)
  check(
    '引用往返：full pull 后 image 仍为 r2:<id>',
    pulled?.changes?.errorQuestions?.upserts?.[0]?.image === `r2:${imageId}`,
    JSON.stringify(pulled?.changes?.errorQuestions?.upserts?.[0])
  )
  check('A 的推送未影响 B 的归属行', imageRowCount(userBId) === 1, `实际 ${imageRowCount(userBId)}`)
  check('A 的推送未影响 B 的对象', (await getImage(bUp.data?.id, tokenB)).status === 200)

  // 引用计数护栏（内容寻址）：两条错题引用同一图片，删其一，归属行与对象必须保留
  check(
    '第二条错题引用同一图片成功',
    (
      await pushErrorQuestions(tokenA, [
        { id: 'e2', subjectId: 'math', date: '2026-09-11', type: '选择', content: 'q2', image: `r2:${imageId}` }
      ])
    ).status === 200
  )
  const delE1 = await pushErrorQuestions(tokenA, [], [{ key: 'e1', deletedAt: Date.now() }])
  check(
    '推送删除墓碑生效（deletes.errorQuestions === 1）',
    delE1.data?.deletes?.errorQuestions === 1,
    JSON.stringify(delE1.data)
  )
  check(
    '仍有其它错题引用 → 归属行（PNG + 未引用 JPEG = 2）与对象保留',
    imageRowCount(userAId) === 2 && (await getImage(imageId, tokenA)).status === 200,
    `实际 ${imageRowCount(userAId)}`
  )
  // 最后一条引用删除：归属行被清（只剩未引用的 JPEG 行）→ R2 对象被清（读取 404）→ 重复删除幂等
  check(
    '删除最后一条引用 e2 → 归属行被清（行数=1）',
    (await pushErrorQuestions(tokenA, [], [{ key: 'e2', deletedAt: Date.now() }])).status === 200 &&
      imageRowCount(userAId) === 1,
    `实际 ${imageRowCount(userAId)}`
  )
  check('PNG 对象已从 R2 清理（读取 404）', (await getImage(imageId, tokenA)).status === 404)
  const delAgain = await pushErrorQuestions(tokenA, [], [{ key: 'e2', deletedAt: Date.now() }])
  check(
    '重复删除幂等（200、归属行不变）',
    delAgain.status === 200 && imageRowCount(userAId) === 1,
    `实际 ${imageRowCount(userAId)}`
  )
  // 手工重插一条指向已不存在 R2 对象的归属行，并让一条错题引用它：删除该错题时清理归属行且对缺失对象不报错
  d1(
    `INSERT INTO error_images (id, user_id, r2_key, size, content_type, created_at) VALUES ('${dummyId}', '${userAId}', 'errors/${userAId}/${dummyId}.png', 1, 'image/png', 0)`
  )
  await pushErrorQuestions(tokenA, [
    { id: 'e3', subjectId: 'math', date: '2026-09-11', type: '选择', content: 'q3', image: `r2:${dummyId}` }
  ])
  check(
    '指向已不存在对象的归属行在引用错题删除后被清理且不报错',
    (await pushErrorQuestions(tokenA, [], [{ key: 'e3', deletedAt: Date.now() }])).status === 200 &&
      imageRowCount(userAId) === 1,
    `实际 ${imageRowCount(userAId)}`
  )

  console.log(`\n通过 ${passed} / 失败 ${failed}`)
  process.exit(failed ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
