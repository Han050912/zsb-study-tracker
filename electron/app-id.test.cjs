'use strict'
/**
 * Windows 通知 AUMID 一致性校验
 *
 * electron-builder 会把 package.json 的 build.appId 通过 WinShell::SetLnkAUMI 写入
 * NSIS 快捷方式的 AppUserModelID；Electron 运行时必须用同一个值调用
 * app.setAppUserModelId，否则 Windows 不会把 toast 通知归属到本应用
 * （表现为通知图标丢失、甚至不弹出）。本测试把这条隐式约束变成可执行断言。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
const mainSource = fs.readFileSync(path.join(__dirname, 'main.cjs'), 'utf8')

/** 从 main.cjs 源码中提取运行时设置的 AppUserModelID（未找到返回 null） */
function readRuntimeAppUserModelId() {
  const matched = mainSource.match(/app\.setAppUserModelId\(\s*'([^']+)'\s*\)/)
  return matched ? matched[1] : null
}

test('package.json 的 build.appId 存在且为反向 DNS 形式', () => {
  const appId = pkg.build && pkg.build.appId
  assert.equal(typeof appId, 'string', 'package.json 缺少 build.appId')
  assert.match(appId, /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/, `build.appId 不是合法的反向 DNS 形式: ${appId}`)
})

test('运行时 AUMID 与 electron-builder appId 完全一致', () => {
  const appId = pkg.build && pkg.build.appId
  const runtimeId = readRuntimeAppUserModelId()
  assert.ok(runtimeId, "未能在 electron/main.cjs 中找到 app.setAppUserModelId('...') 调用")
  assert.equal(
    runtimeId,
    appId,
    '运行时 AUMID 必须与 build.appId 一致：electron-builder 按 appId 为快捷方式写入 AppUserModelID，不一致会导致 Windows 通知图标丢失或不弹出'
  )
})
