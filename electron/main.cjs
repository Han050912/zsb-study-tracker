/**
 * Electron 主进程：原生窗口 + 启动画面 + 系统托盘 + 自定义 app:// 协议
 *
 * 生产环境通过自定义 app:// 标准安全协议加载 dist 静态资源：
 * - 保证 crypto.subtle（安全上下文）、IndexedDB（sql.js 持久化）、Web Worker 等 Web 能力可用
 * - 开发环境直接加载 Vite Dev Server
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, protocol, net } = require('electron')
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, spellcheck: false }
  })

  mainWindow.once('ready-to-show', () => {
    closeSplash()
    showMainWindow()
  })

  // 点击关闭按钮时隐藏到系统托盘，而不是退出应用
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  mainWindow.on('closed', () => { mainWindow = null })

  if (isDev) mainWindow.loadURL(DEV_URL)
  else mainWindow.loadURL('app://localhost/index.html')
}

/** 系统托盘：图标 + 右键菜单（显示主界面 / 退出），单击切换窗口显隐 */
function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'logo.png'))
  tray = new Tray(icon.resize({ width: 18, height: 18 }))
  tray.setToolTip(APP_NAME)
  tray.setContextMenu(Menu.buildFromTemplate([
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
  if (!isDev) registerAppProtocol()
  createSplash()
  createMainWindow()
  createTray()

  // macOS：点击 Dock 图标时恢复窗口
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    else showMainWindow()
  })
}

app.on('before-quit', () => { isQuitting = true })
// 托盘常驻应用：所有窗口关闭后不自动退出，需通过托盘菜单或 Cmd+Q 退出
app.on('window-all-closed', () => {})
