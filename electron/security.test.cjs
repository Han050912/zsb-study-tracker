'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')

const {
  classifyWindowOpen,
  isAllowedExternalUrl,
  isInternalAppUrl,
  resolveNotificationIconUrl
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
