'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

const {
  classifyWindowOpen,
  isAllowedExternalUrl,
  isInternalAppUrl,
  resolveNotificationIconUrl,
  resolveAppPath
} = require('./security.cjs')

const AVATAR = '/api/avatar/0123456789abcdef.png'
const PROD_API = 'https://cn.zsbservice.de5.net'

test('classifyWindowOpen: 外链协议交给系统浏览器', () => {
  assert.equal(classifyWindowOpen('https://example.com/a'), 'external')
  assert.equal(classifyWindowOpen('http://example.com/a'), 'external')
  assert.equal(classifyWindowOpen('ftp://example.com/a'), 'external')
})

test('classifyWindowOpen: 仅 blob: 允许应用内安全子窗口', () => {
  assert.equal(classifyWindowOpen('blob:app://localhost/11111111-2222-3333-4444-555555555555'), 'blob')
})

test('classifyWindowOpen: 其余一律拒绝', () => {
  assert.equal(classifyWindowOpen('data:text/html,<h1>x</h1>'), 'deny')
  assert.equal(classifyWindowOpen('javascript:alert(1)'), 'deny')
  assert.equal(classifyWindowOpen('file:///C:/Windows/System32/calc.exe'), 'deny')
  assert.equal(classifyWindowOpen('app://localhost/index.html'), 'deny')
  assert.equal(classifyWindowOpen('zbstudy://open'), 'deny')
  assert.equal(classifyWindowOpen(''), 'deny')
  assert.equal(classifyWindowOpen(undefined), 'deny')
  assert.equal(classifyWindowOpen('not a url'), 'deny')
})

test('isAllowedExternalUrl: 只认 http/https/ftp 绝对地址', () => {
  assert.equal(isAllowedExternalUrl('https://example.com'), true)
  assert.equal(isAllowedExternalUrl('ftp://example.com'), true)
  assert.equal(isAllowedExternalUrl('data:text/plain,x'), false)
  assert.equal(isAllowedExternalUrl('app://localhost/x'), false)
  assert.equal(isAllowedExternalUrl('garbage'), false)
})

test('isInternalAppUrl: 生产只认 app://localhost', () => {
  assert.equal(isInternalAppUrl('app://localhost/index.html', { isDev: false, devUrl: 'http://localhost:5173' }), true)
  assert.equal(
    isInternalAppUrl('app://evil.example/index.html', { isDev: false, devUrl: 'http://localhost:5173' }),
    false
  )
  assert.equal(isInternalAppUrl('https://example.com', { isDev: false, devUrl: 'http://localhost:5173' }), false)
  assert.equal(isInternalAppUrl('http://localhost:5173/', { isDev: false, devUrl: 'http://localhost:5173' }), false)
})

test('isInternalAppUrl: 开发只认 devUrl 同 origin（防前缀绕过）', () => {
  const opts = { isDev: true, devUrl: 'http://localhost:5173' }
  assert.equal(isInternalAppUrl('http://localhost:5173/index.html', opts), true)
  assert.equal(isInternalAppUrl('http://localhost:51730/index.html', opts), false)
  assert.equal(isInternalAppUrl('http://localhost:5173.evil.com/', opts), false)
  assert.equal(isInternalAppUrl('https://example.com', opts), false)
  assert.equal(isInternalAppUrl('app://localhost/index.html', opts), false)
})

test('resolveNotificationIconUrl: data:image 放行，其他 data: 拒绝', () => {
  assert.equal(
    resolveNotificationIconUrl('data:image/png;base64,iVBORw0KGgo=', { isDev: false, apiBase: PROD_API }),
    'data:image/png;base64,iVBORw0KGgo='
  )
  assert.equal(resolveNotificationIconUrl('data:text/html,<h1>x</h1>', { isDev: false, apiBase: PROD_API }), null)
})

test('resolveNotificationIconUrl: 生产只认自身头像路径', () => {
  const opts = { isDev: false, apiBase: PROD_API }
  const ok = `${PROD_API}${AVATAR}`
  assert.equal(resolveNotificationIconUrl(ok, opts), ok)
  // 同域非头像路径
  assert.equal(resolveNotificationIconUrl(`${PROD_API}/api/settings`, opts), null)
  // 任意第三方域
  assert.equal(resolveNotificationIconUrl(`https://evil.example${AVATAR}`, opts), null)
  // 生产不允许本地 Worker
  assert.equal(resolveNotificationIconUrl(`http://localhost:8787${AVATAR}`, opts), null)
  assert.equal(resolveNotificationIconUrl(`http://127.0.0.1:8787${AVATAR}`, opts), null)
  // 内网地址
  assert.equal(resolveNotificationIconUrl('http://169.254.169.254/latest/meta-data/', opts), null)
  // 协议不符
  assert.equal(resolveNotificationIconUrl(`file:///C:/x${AVATAR}`, opts), null)
  // 路径形态不符
  assert.equal(resolveNotificationIconUrl(`${PROD_API}/api/avatar/xxxx.png`, opts), null)
  assert.equal(resolveNotificationIconUrl(`${PROD_API}/api/avatar/0123456789abcdef.svg`, opts), null)
  assert.equal(resolveNotificationIconUrl('', opts), null)
  assert.equal(resolveNotificationIconUrl(undefined, opts), null)
})

test('resolveNotificationIconUrl: 开发额外放行本地 Worker', () => {
  const opts = { isDev: true, apiBase: PROD_API }
  assert.equal(resolveNotificationIconUrl(`http://localhost:8787${AVATAR}`, opts), `http://localhost:8787${AVATAR}`)
  assert.equal(resolveNotificationIconUrl(`http://127.0.0.1:8787${AVATAR}`, opts), `http://127.0.0.1:8787${AVATAR}`)
  // 开发也不允许非 8787 端口的本地服务
  assert.equal(resolveNotificationIconUrl(`http://localhost:9999${AVATAR}`, opts), null)
  assert.equal(resolveNotificationIconUrl(`${PROD_API}${AVATAR}`, opts), `${PROD_API}${AVATAR}`)
})

test('resolveNotificationIconUrl: apiBase 为空串时远程图标全拒（fail-closed）', () => {
  const opts = { isDev: false, apiBase: '' }
  assert.equal(resolveNotificationIconUrl(`${PROD_API}${AVATAR}`, opts), null)
  assert.equal(resolveNotificationIconUrl(`https://evil.example${AVATAR}`, opts), null)
  // data:image 不依赖白名单，仍放行
  assert.equal(
    resolveNotificationIconUrl('data:image/png;base64,iVBORw0KGgo=', opts),
    'data:image/png;base64,iVBORw0KGgo='
  )
})

test('resolveNotificationIconUrl: 白名单随 apiBase 走（换域名即放行新 origin）', () => {
  const opts = { isDev: false, apiBase: 'https://new.example.com' }
  const ok = `https://new.example.com${AVATAR}`
  assert.equal(resolveNotificationIconUrl(ok, opts), ok)
  // 旧域名不再放行
  assert.equal(resolveNotificationIconUrl(`${PROD_API}${AVATAR}`, opts), null)
})

test('isInternalAppUrl: blob: 视为应用自身内容（资料页打开已上传文件依赖它）', () => {
  const uuid = '11111111-2222-3333-4444-555555555555'
  assert.equal(isInternalAppUrl(`blob:app://localhost/${uuid}`, { isDev: false }), true)
  assert.equal(isInternalAppUrl(`blob:http://localhost:5173/${uuid}`, { isDev: true }), true)
})

test('resolveNotificationIconUrl: 拒绝携带 userinfo 的地址', () => {
  const opts = { isDev: false, apiBase: PROD_API }
  assert.equal(resolveNotificationIconUrl(`https://u:p@cn.zsbservice.de5.net${AVATAR}`, opts), null)
  assert.equal(resolveNotificationIconUrl(`https://cn.zsbservice.de5.net@evil.example${AVATAR}`, opts), null)
})

// ---------- app:// 路径解析（registerAppProtocol 的路径穿越/非法编码守卫） ----------

// 跨平台造一个绝对 dist 根：POSIX 为 /srv/dist，Windows 取当前盘符的 X:\srv\dist
const DIST_ROOT = path.join(path.parse(process.cwd()).root, 'srv', 'dist')

test('resolveAppPath: 正常资源映射到 dist 内', () => {
  const r = resolveAppPath('/assets/index-a1b2.js', DIST_ROOT)
  assert.equal(r.status, 200)
  assert.equal(r.pathname, '/assets/index-a1b2.js')
  assert.equal(r.filePath, path.join(DIST_ROOT, 'assets', 'index-a1b2.js'))
})

test('resolveAppPath: 根路径与空路径默认指向 index.html', () => {
  for (const p of ['/', '']) {
    const r = resolveAppPath(p, DIST_ROOT)
    assert.equal(r.status, 200)
    assert.equal(r.pathname, '/index.html')
    assert.equal(r.filePath, path.join(DIST_ROOT, 'index.html'))
  }
})

test('resolveAppPath: 带前导斜杠的 .. 被归一化夹回 dist 内（不逃逸）', () => {
  // normalize 会丢弃越过根的 ..，这类请求实际落在 dist 内（文件不存在由 main.cjs 的 existsSync 兜底 404）
  for (const p of ['/../secret', '/..%2f..%2fsecret', '/sub/../../secret', '/%2e%2e/x', '/..%2f..%2f']) {
    const r = resolveAppPath(p, DIST_ROOT)
    assert.equal(r.status, 200, p)
    assert.ok(r.filePath === DIST_ROOT || r.filePath.startsWith(DIST_ROOT + path.sep), `${p} 逃逸出 dist`)
  }
})

test('resolveAppPath: 无前导斜杠的相对 .. 穿越直接 404', () => {
  // 非权威形态 URL（app:...）的 pathname 可能不带前导斜杠，normalize 会保留 ..，必须拒绝
  for (const p of ['../../secret', '..%2f..%2fsecret', '../%2e%2e/secret']) {
    assert.equal(resolveAppPath(p, DIST_ROOT).status, 404, p)
  }
  // 反斜杠仅在 Windows 上是分隔符（POSIX 上只是普通文件名字符，不构成逃逸）
  if (process.platform === 'win32') {
    assert.equal(resolveAppPath('..%5c..%5csecret', DIST_ROOT).status, 404)
  }
})

test('resolveAppPath: 同前缀兄弟目录（dist-evil）不能绕过前缀校验', () => {
  // 守卫必须是 startsWith(distRoot + path.sep)：裸 startsWith(distRoot) 会把 dist-evil 误判为目录内
  const r = resolveAppPath('..%2fdist-evil%2fsecret.txt', DIST_ROOT)
  assert.equal(r.status, 404)
})

test('resolveAppPath: 非法百分号编码返回 400', () => {
  assert.equal(resolveAppPath('/%zz', DIST_ROOT).status, 400)
  assert.equal(resolveAppPath('/assets/%', DIST_ROOT).status, 400)
  assert.equal(resolveAppPath(undefined, DIST_ROOT).status, 400)
})
