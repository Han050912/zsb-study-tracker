/**
 * worker/src/cors.ts 纯函数单测（node --test，无 Env/D1 依赖）。
 * CORS 来源白名单：生产站点 + Electron app:// 协议 + 显式开关的本机来源。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { ALLOWED_ORIGINS, isLocalHost, isAllowedOrigin, corsHeaders } from '../src/cors.ts'

test('isLocalHost: 本机主机名（可带任意端口）', () => {
  assert.equal(isLocalHost('localhost'), true)
  assert.equal(isLocalHost('127.0.0.1'), true)
  assert.equal(isLocalHost('localhost:5173'), true)
  assert.equal(isLocalHost('127.0.0.1:8787'), true)
  assert.equal(isLocalHost('evil.com'), false)
  assert.equal(isLocalHost('localhost.evil.com'), false)
  assert.equal(isLocalHost(''), false)
  assert.equal(isLocalHost(undefined), false)
})

test('isAllowedOrigin: 白名单内的生产来源始终放行', () => {
  assert.equal(isAllowedOrigin('https://zsb-study-tracker.sryze.cc', false), true)
  assert.equal(isAllowedOrigin('https://zsb-study-tracker.pages.dev', false), true)
  assert.equal(isAllowedOrigin('https://han050912.github.io', false), true)
  // Electron 桌面端的自定义协议来源
  assert.equal(isAllowedOrigin('app://localhost', false), true)
  assert.equal(ALLOWED_ORIGINS.has('app://localhost'), true)
})

test('isAllowedOrigin: 本机来源仅在显式允许时放行', () => {
  assert.equal(isAllowedOrigin('http://localhost:5173', true), true)
  assert.equal(isAllowedOrigin('http://127.0.0.1:8787', true), true)
  // 生产环境 allowLocal 恒为 false，本机来源一律拒绝
  assert.equal(isAllowedOrigin('http://localhost:5173', false), false)
})

test('isAllowedOrigin: 其他来源一律拒绝（防前缀绕过）', () => {
  assert.equal(isAllowedOrigin(null, true), false)
  assert.equal(isAllowedOrigin('', true), false)
  assert.equal(isAllowedOrigin('https://evil.com', true), false)
  // 同前缀但不同源
  assert.equal(isAllowedOrigin('https://zsb-study-tracker.sryze.cc.evil.com', false), false)
  // ftp 等非 http(s) 本机来源不放行
  assert.equal(isAllowedOrigin('ftp://localhost:5173', true), false)
})

test('corsHeaders: 放行来源回显 Allow-Origin 与凭据标记', () => {
  const headers = corsHeaders('https://zsb-study-tracker.sryze.cc', false)
  assert.equal(headers['Access-Control-Allow-Origin'], 'https://zsb-study-tracker.sryze.cc')
  assert.equal(headers['Access-Control-Allow-Credentials'], 'true')
  assert.equal(headers['Vary'], 'Origin')
  // 安全响应头始终携带
  assert.equal(headers['X-Content-Type-Options'], 'nosniff')
  assert.equal(headers['X-Frame-Options'], 'DENY')
})

test('corsHeaders: 拒绝来源不回显 Allow-Origin', () => {
  const headers = corsHeaders('https://evil.com', false)
  assert.equal('Access-Control-Allow-Origin' in headers, false)
  assert.equal('Access-Control-Allow-Credentials' in headers, false)
  // 方法与预检缓存等基础头仍在（预检响应由调用方按状态码拒绝）
  assert.equal(headers['Access-Control-Allow-Methods'], 'GET, POST, PUT, DELETE, OPTIONS')
})
