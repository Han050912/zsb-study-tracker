/**
 * Electron 主进程：原生窗口 + 启动画面 + 系统托盘 + 自定义 app:// 协议
 *
 * 生产环境通过自定义 app:// 标准安全协议加载 dist 静态资源：
 * - 保证 crypto.subtle（安全上下文）等 Web 能力可用；数据经 Cloudflare Worker 云端存储
 * - 开发环境直接加载 Vite Dev Server
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, protocol, net, ipcMain, Notification } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')

const APP_NAME = '专升本学习助手'
const DEV_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173'
const isDev = !app.isPackaged
const DIST_ROOT = path.join(__dirname, '..', 'dist')

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

// ---- 自动更新（electron-updater，仅 Windows 打包端启用） ----
let autoUpdater = null
if (!isDev && process.platform === 'win32') {
  try {
    autoUpdater = require('electron-updater').autoUpdater
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
  function fetchReleaseNotes(version) {
    const url = 'https://cn.zsbservice.de5.net/api/latest-release'
    return new Promise((resolve) => {
      const https = require('node:https')
      const req = https.get(url, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'zsb-desktop'
        }
      }, (res) => {
        let data = ''
        res.on('data', (chunk) => { data += chunk })
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
      })
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
    else if (Array.isArray(info.releaseNotes)) notes = info.releaseNotes.map(n => n.note || '').filter(Boolean).join('\n')

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
    fetchReleaseNotes(info.version).then(({ notes: fetchedNotes, releaseDate: fetchedDate }) => {
      payload.releaseNotes = fetchedNotes
      if (fetchedDate && !payload.releaseDate) payload.releaseDate = fetchedDate
      send('update:available', payload)
    })
  })

  autoUpdater.on('download-progress', (p) => {
    send('update:progress', {
      percent: Math.round(p.percent * 10) / 10,
      transferred: p.transferred,
      total: p.total,
      bytesPerSecond: p.bytesPerSecond
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    send('update:downloaded', { version: info.version })
  })

  autoUpdater.on('error', (err) => {
    send('update:error', err && err.message ? err.message : String(err))
  })

  ipcMain.on('update:check', () => { autoUpdater.checkForUpdates().catch(() => {}) })
  ipcMain.on('update:download', () => { autoUpdater.downloadUpdate().catch(() => {}) })
  ipcMain.on('update:install', () => {
    quitForUpdate = true
    isQuitting = true
    autoUpdater.quitAndInstall()
  })

  // 启动后延迟检查，避免与启动画面争抢资源
  setTimeout(() => { autoUpdater.checkForUpdates().catch(() => {}) }, 5000)
}

/**
 * 桌面原生通知（学习提醒等），与浏览器端共用 src/services/notify.ts 一套逻辑。
 * 模块顶层注册：不依赖 autoUpdater，开发模式下桌面端同样可弹提醒。
 */
ipcMain.on('notify:show', async (_e, payload) => {
  if (!Notification.isSupported()) return
  const { title, body, icon } = payload || {}
  if (!title) return
  // 头像图标：data URL 直接解析；http(s) URL 由主进程 net.fetch 下载（不受渲染进程 CORS 限制）；失败降级默认图标
  let iconImage
  if (icon) {
    const s = String(icon)
    if (s.startsWith('data:')) {
      try {
        const img = nativeImage.createFromDataURL(s)
        if (!img.isEmpty()) iconImage = img
      } catch (e) {
        console.error('[notify] createFromDataURL 失败:', e)
      }
    } else if (/^https?:\/\//.test(s)) {
      try {
        const res = await net.fetch(s)
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
    }
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
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showMainWindow())
  app.whenReady().then(init)
}

/** 自定义 app:// 协议：将请求映射到 dist 目录（含路径穿越防护与非法编码防护） */
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    let pathname
    try {
      pathname = decodeURIComponent(new URL(request.url).pathname)
    } catch {
      // 非法百分号编码（如 %zz）会抛 URIError
      return new Response('Bad Request', { status: 400 })
    }
    if (pathname === '/' || pathname === '') pathname = '/index.html'
    const filePath = path.join(DIST_ROOT, path.normalize(pathname))
    // 必须以「DIST_ROOT + 分隔符」为前缀，防止 C:\x\dist-evil 这类同前缀目录绕过
    if ((!filePath.startsWith(DIST_ROOT + path.sep) && filePath !== DIST_ROOT) || !fs.existsSync(filePath)) {
      return new Response('Not Found', { status: 404 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
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
  splashWindow.loadFile(path.join(__dirname, 'splash.html'))
}

function closeSplash() {
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close()
  splashWindow = null
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

  mainWindow.on('closed', () => { mainWindow = null })

  if (isDev) mainWindow.loadURL(DEV_URL)
  else mainWindow.loadURL('app://localhost/index.html')
}

/** 系统托盘：图标 + 右键菜单（快捷操作 / 显示主界面 / 退出），单击切换窗口显隐 */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo.png'))
  tray = new Tray(icon.resize({ width: 18, height: 18 }))
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '开始专注', click: () => { showMainWindow(); mainWindow.webContents.send('nav', { path: '/pomodoro' }) } },
    { label: '今日总结', click: () => { showMainWindow(); mainWindow.webContents.send('nav', { path: '/daily-summary' }) } },
    { label: '快速笔记', click: () => { showMainWindow(); mainWindow.webContents.send('nav', { path: '/notes' }) } },
    { label: '今日词汇', click: () => { showMainWindow(); mainWindow.webContents.send('nav', { path: '/english', query: { tab: 'vocab' } }) } },
    { type: 'separator' },
    { label: '显示主界面', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } }
  ]))
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
  // Windows 通知（含图标）依赖稳定的 AppUserModelID；dev 环境未打包时默认值会导致通知图标不显示
  app.setAppUserModelId('com.zsb.study.helper')
  if (!isDev) registerAppProtocol()
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

app.on('before-quit', () => { isQuitting = true })
// 托盘常驻应用：所有窗口关闭后不自动退出，需通过托盘菜单或 Cmd+Q 退出
app.on('window-all-closed', () => {})
