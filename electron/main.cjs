/**
 * Electron 主进程：原生窗口 + 启动画面 + 系统托盘 + 自定义 app:// 协议
 *
 * 生产环境通过自定义 app:// 标准安全协议加载 dist 静态资源：
 * - 保证 crypto.subtle（安全上下文）等 Web 能力可用；数据经 Cloudflare Worker 云端存储
 * - 开发环境直接加载 Vite Dev Server
 */
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  protocol,
  net,
  ipcMain,
  Notification,
  dialog,
  session,
  shell
} = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const {
  classifyWindowOpen,
  isAllowedExternalUrl,
  isInternalAppUrl,
  resolveNotificationIconUrl,
  resolveAppPath
} = require('./security.cjs')

const APP_NAME = '专升本学习助手'
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const isDev = !app.isPackaged
const DIST_ROOT = path.join(__dirname, '..', 'dist')

// API 域名单一来源：构建期由 vite 写入 dist/api-base.json（源自 .env 的 VITE_API_BASE）。
// 读取失败时 API_BASE 为空串：CSP 不含 API 域、更新检查报错——比静默指向旧域名更可诊断
function readBuildConfig() {
  try {
    return JSON.parse(fs.readFileSync(path.join(DIST_ROOT, 'api-base.json'), 'utf8')) || {}
  } catch (e) {
    console.error('[api-base] 读取 dist/api-base.json 失败，桌面端将无法连接 API', e && e.message)
    return {}
  }
}
const BUILD_CONFIG = readBuildConfig()
const API_BASE = BUILD_CONFIG.apiBase || ''

// 桌面端认证令牌：仅存于主进程（经 IPC 提供给渲染进程换取，不编译进前端 JS 产物，见 preload.cjs）。
// 取值优先级：运行时环境变量（与 Worker env.DESKTOP_TOKEN 同名注入，便于 CI/本地覆盖）>
// 构建期产物 dist/api-base.json 的 desktopToken 字段（源自打包时环境变量/.env.desktop.local，与旧
// define 注入同一来源，保证打包产物离线可用）。都未配置时为空串，Worker 侧 fail-closed 要求
// 人机验证——桌面端无 Turnstile 组件，此时登录会失败，属部署配置错误。
const DESKTOP_TOKEN = process.env.DESKTOP_TOKEN || BUILD_CONFIG.desktopToken || ''

/**
 * Content-Security-Policy：开发 / 生产两套策略，由 isDev 环境自动切换，无需人工改代码。
 *
 * 背景：Electron 对含 'unsafe-eval' 的 CSP 抛出「Insecure Content-Security-Policy」安全警告。
 * Vite 开发热更新（HMR）依赖 'unsafe-eval'，但生产环境绝不允许保留。
 * 因此：开发保留 'unsafe-eval' + script 'unsafe-inline'；生产移除二者，输出严格 CSP。
 *
 * 注入方式（均为渲染进程入口动态注入，index.html 已移除静态 meta CSP）：
 * - 开发（isDev，走 http://localhost:*）：由 session.webRequest.onHeadersReceived 注入（setupDevCSP）。
 * - 生产（打包，走 app:// 自定义协议）：由 protocol.handle 对 HTML 文档注入响应头（registerAppProtocol）。
 *   原因：webRequest 仅对 http/https 生效，对 app:// 协议不生效，故生产必须走协议处理器注入。
 */

/** 开发 CSP：保留 'unsafe-eval'（Vite HMR 依赖）与 script 'unsafe-inline'；API 域名来自运行时读取的 API_BASE，localhost 供 vite dev */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  'frame-src https://challenges.cloudflare.com',
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' http://localhost:* ${API_BASE} https://challenges.cloudflare.com`,
  `img-src 'self' data: blob: http://localhost:* ${API_BASE}`,
  "font-src 'self' data:"
].join('; ')

/** 生产 CSP：移除 'unsafe-eval' 与 script 'unsafe-inline'，输出严格安全策略；connect-src 无需连本机故不含 localhost */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self' https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  'frame-src https://challenges.cloudflare.com',
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${API_BASE} https://challenges.cloudflare.com`,
  `img-src 'self' data: blob: http://localhost:* ${API_BASE}`,
  "font-src 'self' data:"
].join('; ')

// 必须在 app ready 之前注册特权协议（standard + secure 使 origin 成为安全上下文）
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

let mainWindow = null
let splashWindow = null
let tray = null
let isQuitting = false
// 更新安装前需要真正退出应用（绕过「关闭最小化到托盘」的拦截）
let quitForUpdate = false
// 主窗口加载失败提示是否已弹出：loadURL rejection 与 did-fail-load 是两条独立通道，
// 同一次失败可能先后触发，靠该标记去重避免弹窗叠罗汉；每次发起加载前复位
let mainLoadFailedDialogOpen = false
// 渲染进程崩溃提示是否已弹出：与加载失败提示同理去重，避免崩溃循环时弹窗叠罗汉
let renderCrashDialogOpen = false

// ---- 自动更新（electron-updater，仅 Windows 打包端启用；preload 同条件暴露 window.updater） ----
let autoUpdater = null
/** electron-updater 下载取消令牌构造器：与 autoUpdater 同模块加载，供「取消下载」使用 */
let UpdaterCancellationToken = null
if (!isDev && process.platform === 'win32') {
  try {
    const updaterModule = require('electron-updater')
    autoUpdater = updaterModule.autoUpdater
    UpdaterCancellationToken = updaterModule.CancellationToken
  } catch {
    autoUpdater = null
  }
}

/** 初始化自动更新：检测 → 通知渲染进程弹窗 → 用户确认后下载 → 下载完成重启安装 */
function setupAutoUpdater() {
  if (!autoUpdater) return
  // 发现更新先弹窗由用户确认，不自动下载；应用退出时自动完成安装
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  // ---- 下载会话：取消令牌 + 无进度看门狗（P6-05） ----
  // 60s 内没有任何 download-progress 事件即判为挂起，自动中止并回报失败，防下载永久阻塞
  const PROGRESS_TIMEOUT_MS = 60 * 1000
  let downloadToken = null
  let lastProgressAt = 0
  let progressWatchdog = null
  // 置位后吞掉紧随其后的「取消」类 error 事件：用户主动取消 / 超时中止不是失败
  let swallowCancelError = false

  function clearProgressWatchdog() {
    if (progressWatchdog) {
      clearInterval(progressWatchdog)
      progressWatchdog = null
    }
  }

  /** 结束下载会话：停看门狗、清令牌。完成/失败/取消三路都收敛到这里，保证之后可重新发起下载 */
  function endDownloadSession() {
    clearProgressWatchdog()
    downloadToken = null
  }

  /** 中止当前下载：取消 electron-updater 令牌并停看门狗 */
  function cancelDownload() {
    clearProgressWatchdog()
    const token = downloadToken
    downloadToken = null
    if (token) {
      swallowCancelError = true
      token.cancel()
    }
  }

  const send = (channel, payload) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
  }

  /**
   * 从 Worker 中转接口拉取 GitHub Release 信息（releaseNotes 兜底）。
   *
   * 问题背景：国内网络直接访问 api.github.com 存在严重的匿名限流与连接不稳定，
   * electron-updater 的 update-available 事件中 releaseNotes 几乎始终为空。
   *
   * 解决方案：Worker 服务端携带 GITHUB_TOKEN（PAT）请求 GitHub API，
   * 绕过匿名限流，客户端绝不接触令牌。Worker 端点：/api/latest-release
   *
   * 使用 node:https 替代 net.fetch，避免 Electron net 模块对 HTTPS 外部请求的不稳定支持。
   * 6 秒超时 + 全量异常捕获，失败不阻塞更新弹窗。
   */
  function fetchReleaseNotes() {
    const url = `${API_BASE}/api/latest-release`
    return new Promise((resolve) => {
      const https = require('node:https')
      const req = https.get(
        url,
        {
          headers: {
            Accept: 'application/json',
            'User-Agent': 'zsb-desktop'
          }
        },
        (res) => {
          let data = ''
          res.on('data', (chunk) => {
            data += chunk
          })
          res.on('end', () => {
            if (res.statusCode !== 200) {
              console.error(`[fetchReleaseNotes] Worker API status: ${res.statusCode}, body: ${data.slice(0, 200)}`)
              resolve({ notes: '', releaseDate: '' })
              return
            }
            try {
              const json = JSON.parse(data)
              if (!json.success || !json.data) {
                console.error('[fetchReleaseNotes] Worker API returned success=false or missing data')
                resolve({ notes: '', releaseDate: '' })
                return
              }
              const release = json.data
              const notes = release.body || ''
              const releaseDate = release.published_at || ''
              console.log(`[fetchReleaseNotes] fetched body length: ${notes.length}, published: ${releaseDate}`)
              resolve({ notes, releaseDate })
            } catch (err) {
              console.error('[fetchReleaseNotes] JSON parse error:', err.message)
              resolve({ notes: '', releaseDate: '' })
            }
          })
        }
      )
      req.on('error', (err) => {
        console.error('[fetchReleaseNotes] request error:', err.message)
        resolve({ notes: '', releaseDate: '' })
      })
      req.setTimeout(6000, () => {
        console.error('[fetchReleaseNotes] request timeout (6s)')
        req.destroy()
        resolve({ notes: '', releaseDate: '' })
      })
    })
  }

  autoUpdater.on('update-available', (info) => {
    // releaseNotes 可能是字符串（Markdown）或 [{version, note}] 数组，统一规整为字符串
    let notes = ''
    if (typeof info.releaseNotes === 'string') notes = info.releaseNotes
    else if (Array.isArray(info.releaseNotes))
      notes = info.releaseNotes
        .map((n) => n.note || '')
        .filter(Boolean)
        .join('\n')

    const payload = {
      version: info.version,
      releaseName: info.releaseName || '',
      releaseNotes: notes,
      releaseDate: info.releaseDate || ''
    }

    if (notes.trim()) {
      send('update:available', payload)
      return
    }

    // electron-updater 未返回 releaseNotes 时，通过 Worker 中转接口兜底拉取
    fetchReleaseNotes()
      .then(({ notes: fetchedNotes, releaseDate: fetchedDate }) => {
        payload.releaseNotes = fetchedNotes
        if (fetchedDate && !payload.releaseDate) payload.releaseDate = fetchedDate
        send('update:available', payload)
      })
      .catch((e) => console.error('[fetchReleaseNotes] 拉取失败', e && e.message))
  })

  autoUpdater.on('download-progress', (p) => {
    lastProgressAt = Date.now() // 喂看门狗：有进度就续期，避免误判挂起
    send('update:progress', {
      percent: Math.round(p.percent * 10) / 10,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    endDownloadSession()
    send('update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    const message = err && err.message ? err.message : String(err)
    // 用户主动取消 / 看门狗超时中止会引发取消类错误（code ERR_CANCELLLED）：
    // 属预期流程而非失败，吞掉以免覆盖超时提示或让用户看到莫名的「下载失败」
    const code = err && err.code ? String(err.code) : message
    if (swallowCancelError && /cancel/i.test(code)) {
      swallowCancelError = false
      return
    }
    endDownloadSession()
    send('update:error', message)
  })

  ipcMain.on('update:check', () => {
    autoUpdater.checkForUpdates().catch(() => {})
  })
  ipcMain.on('update:download', () => {
    // 已有下载在途：忽略重复触发，避免叠加多个下载任务
    if (downloadToken || !UpdaterCancellationToken) return
    swallowCancelError = false
    downloadToken = new UpdaterCancellationToken()
    lastProgressAt = Date.now()
    clearProgressWatchdog()
    progressWatchdog = setInterval(() => {
      if (Date.now() - lastProgressAt > PROGRESS_TIMEOUT_MS) {
        cancelDownload()
        send('update:error', '下载超时：超过 60 秒无进度已中止，请检查网络后重试')
      }
    }, 10 * 1000)
    autoUpdater
      .downloadUpdate(downloadToken)
      .catch(() => {})
      // 完成事件的清理已在 update-downloaded/error 中做，这里兜底收敛会话，不留死角
      .finally(() => endDownloadSession())
  })
  ipcMain.on('update:cancel-download', () => {
    cancelDownload()
  })
  ipcMain.on('update:install', () => {
    quitForUpdate = true
    isQuitting = true
    autoUpdater.quitAndInstall()
  })

  // 启动后延迟检查，避免与启动画面争抢资源
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {})
  }, 5000)
}

/**
 * 桌面原生通知（学习提醒等），与浏览器端共用 src/services/notify.ts 一套逻辑。
 * 模块顶层注册：不依赖 autoUpdater，开发模式下桌面端同样可弹提醒。
 */
ipcMain.on('notify:show', async (_e, payload) => {
  if (!Notification.isSupported()) return
  const { title, body, icon } = payload || {}
  if (!title) return
  // 图标来源白名单：仅 data:image 与应用自身头像资源（防止渲染进程借主进程网络栈发起任意请求）
  const allowedIcon = resolveNotificationIconUrl(icon, { isDev, apiBase: API_BASE })
  let iconImage
  if (allowedIcon && allowedIcon.startsWith('data:')) {
    try {
      const img = nativeImage.createFromDataURL(allowedIcon)
      if (!img.isEmpty()) iconImage = img
    } catch (e) {
      console.error('[notify] createFromDataURL 失败:', e)
    }
  } else if (allowedIcon) {
    try {
      // redirect: 'error' —— 白名单只校验入口 URL，禁止跟随跳转，避免被 302 引到任意主机
      const res = await net.fetch(allowedIcon, { redirect: 'error' })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        const img = nativeImage.createFromBuffer(buf)
        if (!img.isEmpty()) iconImage = img
      } else {
        console.error('[notify] net.fetch 头像失败, HTTP:', res.status)
      }
    } catch (e) {
      console.error('[notify] net.fetch 下载头像异常:', e)
    }
  } else if (icon) {
    console.warn('[notify] 通知图标来源未通过白名单，已忽略:', String(icon).slice(0, 120))
  }
  const n = new Notification({
    title: String(title),
    body: String(body || ''),
    silent: false,
    ...(iconImage ? { icon: iconImage } : {})
  })
  // 点击通知时唤起主窗口，便于用户直接进入学习
  n.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show()
      mainWindow.focus()
    }
  })
  n.show()
})

const gotLock = app.requestSingleInstanceLock()

// 桌面端认证令牌 IPC：渲染进程在发起登录/注册等需跳过人机验证的请求前，经此通道换取令牌
//（invoke 一次性换取后由渲染进程缓存在内存中，不落盘、不进产物）
ipcMain.handle('auth:desktop-token', () => DESKTOP_TOKEN)

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  // 初始化失败属于致命错误：无窗口可提示，故用 showErrorBox（不依赖任何窗口），随后显式退出
  app
    .whenReady()
    .then(init)
    .catch((err) => {
      const message = err && err.message ? err.message : String(err)
      console.error('[startup] 初始化失败:', message)
      dialog.showErrorBox(
        `${APP_NAME} 启动失败`,
        `应用初始化时发生异常，即将退出，请重新启动。\n\n技术信息：${message}`
      )
      app.quit()
    })
}

/** 自定义 app:// 协议：将请求映射到 dist 目录（含路径穿越防护与非法编码防护） */
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    // 路径解码/归一化/越界判定为纯函数（security.cjs，可单测），此处只做 HTTP 状态映射
    const resolved = resolveAppPath(new URL(request.url).pathname, DIST_ROOT)
    if (resolved.status === 400) {
      return new Response('Bad Request', { status: 400 })
    }
    if (resolved.status === 404 || !fs.existsSync(resolved.filePath)) {
      return new Response('Not Found', { status: 404 })
    }
    const { pathname, filePath } = resolved
    // 生产 CSP：仅对 HTML 文档注入严格 CSP 响应头（index.html 已移除 meta CSP，由主进程按环境注入）
    if (pathname.endsWith('.html')) {
      return new Response(fs.readFileSync(filePath), {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': PROD_CSP }
      })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

/** 开发环境：通过 session.webRequest 注入含 'unsafe-eval' 的 CSP，保障 Vite HMR 热更新 */
function setupDevCSP() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    // 仅对本地开发服务器的主文档响应注入，避免影响第三方（Turnstile 等）与静态资源
    if (details.resourceType === 'mainFrame' && details.url.startsWith(DEV_URL)) {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [DEV_CSP]
        }
      })
    } else {
      callback({ responseHeaders: details.responseHeaders })
    }
  })
}

/**
 * Web 权限默认拒绝（Electron 默认会放行大量权限请求）：仅放行通知与元素全屏。
 * - notifications：浏览器端平行的 Web Notification 兜底路径（src/services/notify.ts）；
 *   桌面原生通知走 preload 桥接的 IPC（notify:show），不经过本处理器。
 * - fullscreen：番茄钟专注模式的全屏（src/pages/Pomodoro.vue requestFullscreen），
 *   元素全屏属无害的展示态切换，放行。
 * 其余权限（media / geolocation / clipboard-read / pointerLock / midi 等）一律拒绝。
 * 挂在 defaultSession 上：主窗口、blob 子窗口与启动画面同属该会话，但它们本就不申请权限，行为不变。
 */
const ALLOWED = new Set(['notifications', 'fullscreen'])
function setupPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(ALLOWED.has(permission)))
  // 权限查询（如 Notification.permission）与请求保持同一判定，避免两端状态不一致
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission))
}

/** 外链统一交给系统默认浏览器；失败仅记日志，不影响应用本身 */
function openExternal(url) {
  shell.openExternal(url).catch((e) => console.error('[nav] openExternal 失败:', url, e))
}

/** blob: 子窗口（资料页打开已上传文件）的隔离配置：清空 preload + sandbox，确保拿不到任何 IPC 能力 */
const SAFE_BLOB_WINDOW_OPTIONS = {
  width: 1000,
  height: 720,
  autoHideMenuBar: true,
  backgroundColor: '#ffffff',
  webPreferences: {
    preload: '',
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
    webviewTag: false,
    spellcheck: false
  }
}

/**
 * 导航与开窗防护（Electron 官方安全清单硬性项）：
 * - window.open / target=_blank：外链交系统浏览器，仅 blob: 允许应用内安全子窗口，其余一律拒绝
 * - 页面跳转 / 服务端重定向：只允许应用自身 origin，外链交系统浏览器
 * 挂在 app.on('web-contents-created') 上，主窗口 / 启动画面 / 子窗口递归生效。
 */
function setupNavigationGuards() {
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      const kind = classifyWindowOpen(url)
      if (kind === 'external') {
        openExternal(url)
        return { action: 'deny' }
      }
      if (kind === 'blob') {
        return { action: 'allow', overrideBrowserWindowOptions: SAFE_BLOB_WINDOW_OPTIONS }
      }
      return { action: 'deny' }
    })

    const guardNavigation = (event, url) => {
      if (isInternalAppUrl(url, { isDev, devUrl: DEV_URL })) return
      event.preventDefault()
      if (isAllowedExternalUrl(url)) openExternal(url)
    }
    contents.on('will-navigate', guardNavigation)
    contents.on('will-redirect', guardNavigation)
  })
}

/** 启动画面：无边框小窗，主窗口就绪后关闭 */
function createSplash() {
  splashWindow = new BrowserWindow({
    width: 340,
    height: 420,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    center: true,
    show: true,
    skipTaskbar: true,
    backgroundColor: '#4f46e5',
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  })
  // 启动画面加载失败只记日志：缺了启动画面不应该拖垮整个启动流程（也不弹模态框打扰用户）
  splashWindow
    .loadFile(path.join(__dirname, 'splash.html'))
    .catch((e) => console.error('[splash] 启动画面加载失败，继续启动主窗口:', e))
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  splashWindow = null
}

/** 主窗口内容加载（初次加载与失败重试共用）：两条加载路径的失败都汇入 onMainWindowLoadFailed */
function loadMainWindowContent() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  // 发起新一轮加载前复位，避免上一轮的弹窗状态吞掉本轮第一次失败提示
  mainLoadFailedDialogOpen = false
  if (isDev) mainWindow.loadURL(DEV_URL).catch(onMainWindowLoadFailed)
  else mainWindow.loadURL('app://localhost/index.html').catch(onMainWindowLoadFailed)
}

/**
 * 主窗口加载失败兜底：关闭永驻的启动画面，给出可恢复提示（重试 / 退出）。
 *
 * 加载失败时 ready-to-show 永不触发，若不兜底，启动画面会一直停在最前，用户既进不去也无处退出。
 * 重试即重新发起同一次加载，失败会再次回到这里（由用户点击驱动，不会自旋）。
 */
function onMainWindowLoadFailed(err) {
  const message = err && err.message ? err.message : String(err)
  console.error('[nav] 主窗口加载失败:', message)
  closeSplash()
  // 窗口已销毁（如失败弹窗期间用户从托盘退出）：没有可恢复的对象，仅记日志
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainLoadFailedDialogOpen) return
  mainLoadFailedDialogOpen = true
  // 窗口此时是隐藏的（show: false 且 ready-to-show 未触发），先显出来，
  // 否则没有任何可见窗口，弹窗也可能被压在不可见的父窗口后面
  if (!mainWindow.isVisible()) mainWindow.show()

  dialog
    .showMessageBox(mainWindow, {
      type: 'error',
      title: APP_NAME,
      message: '页面加载失败',
      detail: `应用界面未能加载，可能由网络异常或安装文件损坏导致。\n\n技术信息：${message}`,
      buttons: ['重试', '退出'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    .then(({ response }) => {
      mainLoadFailedDialogOpen = false
      if (response === 0) {
        loadMainWindowContent()
      } else {
        isQuitting = true
        app.quit()
      }
    })
    .catch((e) => {
      mainLoadFailedDialogOpen = false
      console.error('[nav] 加载失败提示弹窗异常:', e)
    })
}

function showMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

/** 主窗口：原生桌面窗口体验（图标/最小尺寸/隐藏菜单栏/关闭最小化到托盘） */
function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    icon: path.join(__dirname, 'assets', 'logo.png'),
    title: APP_NAME,
    autoHideMenuBar: true,
    backgroundColor: '#f8fafc',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      // 窗口最小化 / 收进托盘后不节流定时器，保证待办开始与截止提醒按时弹出
      backgroundThrottling: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  })

  mainWindow.once('ready-to-show', () => {
    closeSplash()
    showMainWindow()
  })

  // 点击关闭按钮时隐藏到系统托盘，而不是退出应用（更新安装时除外）
  mainWindow.on('close', (e) => {
    if (!isQuitting && !quitForUpdate) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 渲染进程崩溃兜底：托盘常驻应用，崩溃后窗口永久白屏且界面无任何反馈，
  // 与加载失败同一套可恢复弹窗（重载 / 退出），去重标记防崩溃循环时弹窗叠罗汉
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    // clean-exit 为正常退出（如窗口正常关闭），仅 crashed / oom / killed 等真实崩溃需要兜底
    if (details.reason === 'clean-exit') return
    console.error('[render] 渲染进程异常退出:', details.reason, `exitCode=${details.exitCode}`)
    // 窗口已销毁（含主动 destroy 触发的 killed）：没有可恢复的对象，仅记日志
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (renderCrashDialogOpen) return
    renderCrashDialogOpen = true
    // 崩溃时窗口可能正收在托盘里，先显出来，否则弹窗会被压在不可见的父窗口后面
    if (!mainWindow.isVisible()) mainWindow.show()

    dialog
      .showMessageBox(mainWindow, {
        type: 'error',
        title: APP_NAME,
        message: '页面出现异常',
        detail: `应用界面意外中断，可尝试重新加载；反复出现请退出后重启应用。\n\n技术信息：${details.reason} (exitCode=${details.exitCode})`,
        buttons: ['重载', '退出'],
        defaultId: 0,
        cancelId: 1,
        noLink: true
      })
      .then(({ response }) => {
        renderCrashDialogOpen = false
        if (response === 0) {
          // 弹窗期间窗口可能已被销毁（如用户从托盘退出）
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.reload()
        } else {
          isQuitting = true
          app.quit()
        }
      })
      .catch((e) => {
        renderCrashDialogOpen = false
        console.error('[render] 崩溃提示弹窗异常:', e)
      })
  })

  // 兜底：app:// 协议处理器返回 404 等场景不会让 loadURL rejection，但会触发 did-fail-load
  mainWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // -3 为 ERR_ABORTED：普通导航中断（如重定向、被新导航取代），并非真实失败
    if (errorCode === -3 || !isMainFrame) return
    onMainWindowLoadFailed(new Error(`${errorDescription} (${errorCode}) ${validatedURL}`))
  })

  loadMainWindowContent()
}

/** 系统托盘：图标 + 右键菜单（快捷操作 / 显示主界面 / 退出），单击切换窗口显隐 */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo.png'))
  tray = new Tray(icon.resize({ width: 18, height: 18 }))
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: '开始专注',
        click: () => {
          showMainWindow()
          mainWindow.webContents.send('nav', { path: '/pomodoro' })
        }
      },
      {
        label: '今日总结',
        click: () => {
          showMainWindow()
          mainWindow.webContents.send('nav', { path: '/daily-summary' })
        }
      },
      {
        label: '快速笔记',
        click: () => {
          showMainWindow()
          mainWindow.webContents.send('nav', { path: '/notes' })
        }
      },
      {
        label: '今日词汇',
        click: () => {
          showMainWindow()
          mainWindow.webContents.send('nav', { path: '/english', query: { tab: 'vocab' } })
        }
      },
      { type: 'separator' },
      { label: '显示主界面', click: () => showMainWindow() },
      { type: 'separator' },
      {
        label: '退出',
        click: () => {
          isQuitting = true
          app.quit()
        }
      }
    ])
  )
  // macOS 托盘点击默认弹出菜单，不再绑定 click 切换窗口（避免菜单与显隐同时触发）
  if (process.platform !== 'darwin') {
    tray.on('click', () => {
      if (!mainWindow) return
      if (mainWindow.isVisible()) mainWindow.hide()
      else showMainWindow()
    })
  }
}

function init() {
  app.setName(APP_NAME)
  // Windows 通知（含图标）依赖稳定的 AppUserModelID；dev 环境未打包时默认值会导致通知图标不显示。
  // 该值必须与 package.json 的 build.appId 完全一致：electron-builder 会按 appId 为 NSIS 快捷方式
  // 写入 AppUserModelID（WinShell::SetLnkAUMI），不一致会导致通知图标丢失甚至不弹出。
  // 一致性由 electron/app-id.test.cjs 断言保护，改动其一必须同步另一处。
  app.setAppUserModelId('com.han.zsb-study-tracker')
  setupNavigationGuards()
  setupPermissions()
  if (!isDev) registerAppProtocol()
  else setupDevCSP() // 开发环境注入含 'unsafe-eval' 的 CSP（保障 HMR）
  createSplash()
  createMainWindow()
  createTray()
  setupAutoUpdater()

  // macOS：点击 Dock 图标时恢复窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })
}

app.on('before-quit', () => {
  isQuitting = true
})
// 托盘常驻应用：所有窗口关闭后不自动退出，需通过托盘菜单或 Cmd+Q 退出
app.on('window-all-closed', () => {})
