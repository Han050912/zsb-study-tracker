# 专升本学习助手

> 专升本备考打卡管理工具（Web + 桌面端）：学习记录 + 番茄钟 + 游戏化激励 + 数据可视化 + 多账号本地存储。

[演示站点](https://zsb-study-tracker.sryze.cc/) · [Issues](https://github.com/Han050912/zsb-study-tracker/issues) · [Releases](https://github.com/Han050912/zsb-study-tracker/releases)

---

## 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [快速开始](#快速开始)
- [桌面端（Electron）](#桌面端electron)
- [构建与部署](#构建与部署)
- [项目结构](#项目结构)
- [数据存储说明](#数据存储说明)
- [账号与隐私](#账号与隐私)
- [Logo 致谢](#logo-致谢)
- [许可证](#许可证)

---

## 项目简介

「专升本学习助手」是一款面向专升本考生的备考打卡管理应用，提供 **Web 版** 与 **Windows / macOS 桌面版**。所有数据均在本地保存，无需后端服务器，开箱即用、隐私可控。

核心定位：

- **记录**：高数 / 英语 / 自定义科目的学习与刷题一目了然
- **专注**：内置番茄钟与白噪音，帮助进入沉浸状态
- **激励**：积分、等级、成就徽章与连胜，把坚持变成游戏
- **复盘**：每日总结、习惯追踪、多维统计，看清自己的成长曲线

---

## 功能特性

- **首页仪表盘**：今日概览、待办（含完成时间记录）、学习热力图（点击格子查看当日明细）、进度环、考试倒计时、每日名言
- **高等数学**：考纲章节树、学习计时、刷题记录、掌握度雷达、Markdown + LaTeX 笔记、真题趋势
- **英语**：逐条背单词打卡（可删除并联动积分回收）、阅读计时、听力记录、作文模板库、笔记检索
- **科目全自定义**：默认高数 / 英语（权重各 50%），支持修改权重、删除、新增任意科目，导航与页面随科目动态增减
- **笔记中心**：Markdown 编辑、全文检索，支持本地文件手动选择上传与拖拽上传（.md / .markdown / .txt）
- **错题本**：图片上传（Base64）、分类、复习计数
- **番茄钟**：正 / 倒计时、白噪音（WebAudio 生成）、中断记录、全屏沉浸
- **游戏化积分**：积分、等级（青铜 → 王者）、成就徽章墙、连胜计数；删除任意原始记录（学习 / 刷题 / 错题 / 真题 / 待办 / 习惯打卡 / 背单词）自动回收对应积分并清除积分流水
- **每日总结**：自动聚合数据、情绪日志、三段式反思、分享卡片；点击日历往日日期弹出当日总结悬浮卡片（概览 / 心情 / 收获 / 反思 + 明日计划开关）
- **统计中心**：时长 / 占比 / 正确率 / 题型 / 专注 / 情绪多维图表（柱状图点击查看当日分科时长）、周报
- **习惯追踪**：四种量化方式、30 天热力、坏习惯每日克制打卡；「每日背单词」「每日做题」目标与设置页每日目标双向同步
- **资料库**：书籍进度条、链接、笔记摘抄
- **多账号系统**：基于 SQLite（sql.js）的本地注册 / 登录，数据按账号隔离
- **每日提醒**：浏览器通知定时提醒学习（需授权通知权限）

---

## 技术栈

- **Vue 3**（Composition API）+ **Vite** + **TypeScript**
- **Tailwind CSS**（移动端优先响应式）
- **Pinia** 状态管理
- **sql.js**（SQLite 编译为 WebAssembly）+ **IndexedDB** 本地持久化
- **ECharts** 数据可视化 / **KaTeX** 公式渲染
- **PBKDF2** 密码加密（SHA-256，10 万次迭代 + 随机盐）
- **Electron** 桌面端（原生窗口、启动画面、系统托盘、自定义 `app://` 安全协议）+ **electron-builder** 打包

---

## 快速开始

环境要求：Node.js 18+

```bash
# 安装依赖
npm install

# 启动 Web 开发服务器
npm run dev
```

启动后访问终端输出的本地地址（默认 `http://localhost:5173/`）即可使用。

---

## 桌面端（Electron）

桌面版完整移植 Web 端全部功能，并提供原生窗口体验：启动画面、系统托盘（关闭按钮最小化到托盘）、单实例锁、窗口 / 托盘 / 安装包图标。

```bash
# 开发模式（Vite Dev Server + Electron 热调试）
npm run electron:dev

# 打包 Windows 安装包（NSIS，输出到 release/）
npm run dist:win

# 打包 macOS 安装包（DMG，需在 macOS 上执行）
npm run dist:mac

# 按当前系统平台打包
npm run dist
```

> 生产环境通过自定义 `app://` 安全协议加载本地静态资源，保证加密 API、IndexedDB、Web Worker 等 Web 能力在桌面端可用。

---

## 构建与部署

```bash
# Web 生产构建，产物输出到 dist/
npm run build

# 本地预览构建产物
npm run preview
```

`dist/` 为纯静态文件，可直接部署到任意静态托管平台：

- **Cloudflare Pages**：构建命令 `npm run build`，输出目录 `dist`
- **GitHub Pages / Vercel / Netlify**：同样直接托管 `dist/` 即可

> 路由使用 hash 模式（`#/path`），无需服务端 rewrite 配置；`public/_redirects` 已配置 SPA 回退。

---

## 项目结构

```
├── electron/               # Electron 桌面端
│   ├── main.cjs            # 主进程（原生窗口 / 启动画面 / 系统托盘 / app:// 协议）
│   ├── splash.html         # 启动画面
│   └── assets/logo.png     # Logo（窗口 / 托盘 / 安装包图标，1024×1024）
├── public/                 # 静态资源（logo.png、_redirects 等）
├── src/
│   ├── components/         # 通用组件（科目面板 / 热力图 / 弹窗等）
│   ├── composables/        # useChart 等组合式函数
│   ├── data/               # 默认数据与常量
│   ├── db/                 # sql.js 数据库与 Worker
│   ├── pages/              # 页面（仪表盘 / 科目 / 统计 / 习惯 / 设置等）
│   ├── router/             # 路由（hash 模式）
│   ├── stores/             # Pinia 状态（app / auth / theme）
│   ├── types/              # TypeScript 类型
│   └── utils/              # 工具（日期 / 加密 / 校验）
├── index.html              # Web 入口
└── package.json            # 脚本与 electron-builder 配置
```

---

## 数据存储说明

- 应用数据保存在浏览器 / 桌面端 **IndexedDB** 中托管的 SQLite 数据库文件（键：`zsb-study-tracker.db`）。
- 旧版 localStorage 数据（键：`zsb-study-tracker-v1`）会在首次登录后自动迁移。
- 可在「设置 → 数据管理」导出 JSON 备份，或「个人中心」导出账号数据。

---

## 账号与隐私

- 账号系统**完全运行在本地**，不存在远程服务器，密码仅在本地经 PBKDF2 加密后存入 SQLite。
- 清除站点数据 / 卸载应用会导致本地数据不可恢复，请务必定期导出备份。
- 每日提醒依赖系统通知权限；若权限被拒绝，需在站点 / 系统设置中手动改为「允许」后重新开启。

---

## Logo 致谢

应用 Logo 为「Graduation Cap（毕业帽）」图标，来自 Microsoft **Fluent Emoji** 图标集：

- 来源：https://github.com/microsoft/fluentui-emoji
- 许可证：**MIT License**（允许商业用途，无需署名）

---

## 许可证

本项目基于 MIT License 开源。
