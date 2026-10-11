<div align="center" style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:40px 20px 24px 20px;margin:16px 0;">

<img src="./public/logo.png" alt="Logo" width="120" style="margin-bottom:8px;" />

# [专升本学习助手](https://zsb-study-tracker.sryze.cc/)

**zsb-study-tracker** · 专升本备考打卡管理助手（Web + 桌面端）

<span style="color:#8b949e;">学习记录 · 番茄钟 · 游戏化激励 · 社区与搭子 · 云端多端同步</span>

<br/>

[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Pinia](https://img.shields.io/badge/Pinia-2-FFD859?style=flat-square&logo=vuedotjs&logoColor=black)](https://pinia.vuejs.org/)
[![Vue Router](https://img.shields.io/badge/Vue_Router-4-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://router.vuejs.org/)
[![ECharts](https://img.shields.io/badge/ECharts-6-AA344D?style=flat-square&logo=apacheecharts&logoColor=white)](https://echarts.apache.org/)
[![KaTeX](https://img.shields.io/badge/KaTeX-0.19-222222?style=flat-square&logo=katex&logoColor=white)](https://katex.org/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![D1](https://img.shields.io/badge/D1-Database-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

<br/>

[![CI](https://github.com/Han050912/zsb-study-tracker/actions/workflows/ci.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/ci.yml)
[![Pages Deploy](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-pages.yml)
[![Worker Deploy](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-worker.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-worker.yml)
[![Desktop Release](https://github.com/Han050912/zsb-study-tracker/actions/workflows/release-desktop.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/release-desktop.yml)

<br/>

开发与贡献说明见 [贡献指南](./CONTRIBUTING.md)，后端运行与部署见 [Worker 文档](./worker/README.md)。

</div>

---

## 📑 目录

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

<table align="center">
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-项目简介" style="text-decoration:none;color:#58a6ff;">✨ 项目简介</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-功能特性" style="text-decoration:none;color:#58a6ff;">🧩 功能特性</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-技术架构" style="text-decoration:none;color:#58a6ff;">🏗️ 技术架构</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-快速上手" style="text-decoration:none;color:#58a6ff;">🚀 快速上手</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-项目结构" style="text-decoration:none;color:#58a6ff;">📁 项目结构</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-部署" style="text-decoration:none;color:#58a6ff;">🌐 部署</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-参与贡献指南" style="text-decoration:none;color:#58a6ff;">🤝 贡献指南</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-许可证-license" style="text-decoration:none;color:#58a6ff;">📜 许可证</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-about-me" style="text-decoration:none;color:#58a6ff;">👤 About Me</a></td>
  </tr>
</table>

</div>

---

## ✨ 项目简介

<div style="background-color:#0d1117;border:1px solid #21262d;border-left:4px solid #f78166;border-radius:4px;padding:20px 24px;margin:16px 0;">

「专升本学习助手」是一款面向专升本考生的**备考打卡管理应用**，提供 **Web 版（PWA，可安装到桌面/手机）** 与 **Windows / macOS 桌面版**，由 **Cloudflare Worker + D1 数据库 + R2 存储** 提供云端账号与数据同步能力。注册登录后，学习记录在 Web 与桌面端保持一致。

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-left:4px solid #58a6ff;border-radius:4px;padding:16px 24px;margin:16px 0;">

> **核心定位**：把「记录 → 专注 → 激励 → 复盘」串成一条完整的学习闭环。

</div>

### 为什么选择这个项目

<table align="center">
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🔗 一条龙学习闭环</strong><br/>
      <span style="color:#8b949e;">每日打卡、番茄钟专注、刷题与错题整理、晚间总结反思，备考全流程在一个工具里搞定，不用在多个 App 间来回切换</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">☁️ 云端多端同步</strong><br/>
      <span style="color:#8b949e;">学习数据通过记录级增量同步保存到 Cloudflare D1，支持 Web 与桌面端继续学习；PWA 缓存应用外壳，笔记正文使用独立的本地缓存，账号与其他 API 功能需要联网</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🎮 游戏化让你坚持</strong><br/>
      <span style="color:#8b949e;">青铜 → 白银 → 黄金 → 铂金 → 钻石 → 王者的段位爬升、徽章墙、积分流水与连续学习天数，把枯燥的长期备考变成闯关体验</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">📐 高数与英语专项强化</strong><br/>
      <span style="color:#8b949e;">考纲章节树、Markdown + LaTeX 公式笔记、搭配「墨墨背单词」App 逐条打卡、完形 / 阅读 / 听力 / 作文模板多维记录</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🍅 从待办开始专注</strong><br/>
      <span style="color:#8b949e;">正计时 / 倒计时两种模式，可关联待办、科目与章节；保存实际专注时长，提前结束也留记录，结束后可确认完成待办，科目统计直接汇总关联时长</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">👥 社区广场与学习搭子</strong><br/>
      <span style="color:#8b949e;">发帖讨论、圈子、私信与通知；找搭子一起「开黑自习」、组队挑战、协作备考计划与复盘邀约，每周一自动推送学习周报</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">📊 图表一目了然</strong><br/>
      <span style="color:#8b949e;">ECharts 驱动的学习时长分布、各科目正确率趋势、专注分析，点击柱子还能下钻当天各科细分耗时</span>
    </td>
    <td width="50%" valign="top" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;">
      <strong style="color:#f78166;">🖥️ 桌面端 + PWA</strong><br/>
      <span style="color:#8b949e;">Windows / macOS 客户端支持系统托盘与原生通知；Windows 支持自动更新，macOS 手动更新；Web 端可安装为 PWA 并缓存应用外壳</span>
    </td>
  </tr>
</table>

---

## 🧩 功能特性

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

<table align="center">
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📚 学习记录</strong><br/>
      <span style="color:#8b949e;">首次学习设置、科目章节树与掌握度、可调整的学习计划、每日待办、学习时长、刷题会话、错题复习与模考记录</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📝 笔记与资料</strong><br/>
      <span style="color:#8b949e;">Markdown + KaTeX 公式笔记、保存状态与失败重试、冲突副本恢复、资料库、PDF 上传与分片阅读、含附件的完整备份</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📖 英语专项</strong><br/>
      <span style="color:#8b949e;">单词打卡（对接墨墨背单词）、完形、阅读、听力、作文模板与每日目标</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🍅 番茄专注</strong><br/>
      <span style="color:#8b949e;">正计时 / 倒计时、待办与科目章节关联、实际专注明细、中断原因记录、刷新恢复计时、专注壁纸</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">✅ 习惯与复盘</strong><br/>
      <span style="color:#8b949e;">习惯打卡与统计、每日总结（情绪 + 三段式反思 + 明日计划）、分享卡片</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🏆 成就激励</strong><br/>
      <span style="color:#8b949e;">积分与流水、六段位等级、徽章墙、连续学习天数</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">💬 社区</strong><br/>
      <span style="color:#8b949e;">帖子与评论、点赞、话题圈子、知识点讨论、私信、关注与通知中心、举报与管理员审核</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🤝 协作</strong><br/>
      <span style="color:#8b949e;">组队挑战与进度、学习搭子、开黑自习室、协作备考计划、复盘邀约、搭子分享与周报推送</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🔐 账号与安全</strong><br/>
      <span style="color:#8b949e;">注册登录（PBKDF2 密码哈希，Web 使用 JWT HttpOnly Cookie，桌面端使用 Bearer 会话）、Cloudflare Turnstile 人机验证、限流、敏感词本地词库与可选 Workers AI 复审</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">⚙️ 个性化</strong><br/>
      <span style="color:#8b949e;">考试日期倒计时、主题与深色模式、提醒与勿扰、头像裁剪、访客浏览模式、Windows 更新提示偏好与手动检查、意见反馈直达 GitHub Issue</span>
    </td>
  </tr>
</table>

</div>

### 从计划到复盘

1. 首次进入可设置考试日期、科目、每日学习时长和第一项待办；可以跳过，之后继续完善。
2. 学习计划结合科目权重、薄弱知识点、待复习错题和近两周刷题正确率分配每日时长。可调整日期、章节、分钟数和勾选项后加入待办，重复项会跳过。
3. 从待办进入专注，关联科目与章节。计时结束保存实际时长，并单独确认是否完成任务；关联时长直接进入科目统计，无需再补一条相同时长的学习记录。
4. 错题可按到期或逾期筛选，每次复习 5 或 10 题。根据“不会 / 勉强做对 / 独立做对”反馈安排下次复习，分别从 1 天、2 天或连续独立做对次数对应的间隔计算；已标记掌握的题目在独立做对后至少间隔 7 天。

---

## 🏗️ 技术架构

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

| 层次            | 技术选型                                                                                                                                    |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| 前端            | Vue 3（`<script setup>`）、TypeScript、Vite 7、Vue Router 4（hash 模式）、Pinia 2、Tailwind CSS 3                                           |
| 可视化 / 富内容 | ECharts 6、KaTeX 0.19、markdown-it、pdfjs-dist、Lucide 图标（SVG 组件，不使用 emoji 图标）                                                  |
| 桌面端          | Electron 43、electron-builder、electron-updater（Windows 自动更新）、系统托盘与原生通知                                                     |
| PWA             | vite-plugin-pwa；预缓存应用外壳，静态资源按需缓存；API 使用 `NetworkOnly`，笔记正文由 IndexedDB 缓存                                        |
| 后端            | Cloudflare Workers（TypeScript）、自研路由与中间件；新密码使用 PBKDF2-SHA-256，兼容旧 bcrypt 哈希并在登录后升级；jose 签发有效期 3 天的 JWT |
| 数据            | D1 保存业务记录、PDF 与笔记正文分片；R2 保存社区和错题图片；定时任务每小时维护、每周一 UTC+8 08:00 推送周报                                 |
| 工程            | 前端 `vue-tsc --noEmit`、Worker `tsc --noEmit`；ESLint、Prettier、`node --test`、Worker API 冒烟测试；GitHub Actions 共用 CI 门禁           |

</div>

---

## 🚀 快速上手

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

> 环境要求：**Node.js 22.18 或更高版本**、npm 与 Git。Worker 测试直接导入 `.ts` 源码；CI 使用 Node 22。依赖以根目录及 `worker/` 的 `package-lock.json` 为准。

</div>

### 在浏览器里跑起来

在仓库根目录执行以下命令：

```bash
# 下载代码
git clone https://github.com/Han050912/zsb-study-tracker.git
cd zsb-study-tracker

# 安装前后端锁定的依赖
npm ci
npm ci --prefix worker

# Bash：准备本地默认配置（已有文件时保留）
test -f .env || cp .env.example .env

# 本地开发覆盖：复制后将 VITE_API_BASE 改为 http://localhost:8787
test -f .env.development || cp .env.example .env.development

# 配置并启动下一节的 Worker 后，启动前端
npm run dev
```

PowerShell 首次准备配置可执行以下命令，保留已有文件；Windows cmd 可用 `if not exist` 配合 `copy`。然后打开 `.env.development`，将接口配置改为：

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
if (-not (Test-Path .env.development)) { Copy-Item .env.example .env.development }
```

```dotenv
VITE_API_BASE=http://localhost:8787
```

仓库中的 `.env` 和 `.env.example` 提供非敏感的线上 API 默认地址；不修改会继续请求线上服务。根 `.env` 已被 Git 跟踪，真实凭据或个人配置应放入被忽略的 `.env.local`、`.env.development` 或 `.env.desktop.local`，并保留已有配置。前端开发服务器通常位于 `http://localhost:5173`，启动后按终端显示的地址打开浏览器；`npm run dev` 不会自动启动 Worker。生产 Web 构建读取 `.env` 及适用的本地覆盖，CI 构建从 `.env.example` 恢复默认配置，均可通过环境变量 `VITE_API_BASE` 覆盖 API 地址。

### 启动后端 Worker（本地开发必需）

另开终端，从仓库根目录执行：

```bash
cd worker

# Bash；保留已有配置
test -f .dev.vars || cp .dev.vars.example .dev.vars

# 仅用于新建本地数据库；已有数据库按 Worker 文档升级
npm run init:local
node scripts/check-migration-baseline.mjs
npx wrangler d1 execute zsb-study-db --local --file=./schema-baseline.sql
npx wrangler d1 migrations list zsb-study-db --local

# 本地启动 Worker（默认 http://localhost:8787）
npm run dev
```

PowerShell 准备配置使用 `if (-not (Test-Path .dev.vars)) { Copy-Item .dev.vars.example .dev.vars }`。新库执行完整结构后还需登记迁移基线；已有数据库应应用增量迁移，当前包含 `0012` 的专注关联和 `0013` 的复习反馈字段，详见 [数据库初始化与升级](./worker/README.md#数据库初始化与升级)。

后端配置通过 `worker/.dev.vars` 提供，该文件已被 Git 忽略。模板包含本地 Turnstile 测试配置：

| 变量                             | 说明                                                                                                            |
| :------------------------------- | :-------------------------------------------------------------------------------------------------------------- |
| `JWT_SECRET`                     | JWT 签名密钥；模板值仅用于本地开发                                                                              |
| `TURNSTILE_SECRET`               | 与前端开发模式测试 sitekey 配套的测试密钥                                                                       |
| `ALLOW_LOCAL_ORIGINS=1`          | 本地开发允许 Vite 来源访问；生产环境不配置此开关                                                                |
| `DESKTOP_TOKEN`                  | 桌面构建及冒烟测试需要匹配的共享令牌；普通 Web 开发不需要                                                       |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | 可选 Workers AI 复审；`CF_ACCOUNT_ID` 已由 `wrangler.toml` 的 `[vars]` 提供，未配置 AI 令牌则仅运行本地词库过滤 |

自己的 Cloudflare 部署还需替换 `worker/wrangler.toml` 中的账号、域名、D1 与 R2 绑定。生产密钥使用 `npx wrangler secret put <NAME>` 写入，完整配置与数据库步骤见 [Worker 文档](./worker/README.md)。

后端改动可运行冒烟测试。先在本地 Worker 设置 `DESKTOP_TOKEN`，再在测试进程设置同值的 `SMOKE_DESKTOP_TOKEN`，具体命令与隔离数据库配置见 [Worker 冒烟测试](./worker/README.md#本地-worker-集成脚本)：

```bash
# 在 worker/ 目录，保持本地 Worker 运行
npm run smoke
```

### 在桌面客户端里跑起来

以下命令从仓库根目录执行：

```bash
# 启动 Vite 和 Electron 开发窗口
npm run electron:dev
```

该脚本使用普通 Vite 开发模式，适合调试界面；打包桌面认证路径使用 `build:desktop` 的编译标识，需用桌面构建产物核对。

### 打包成安装文件

在根目录创建已被 Git 忽略的 `.env.desktop.local`，设置 `VITE_API_BASE` 和与 Worker 一致的 `DESKTOP_TOKEN`。桌面模式会移除 Web 人机验证界面，缺少匹配令牌时登录无法通过；令牌写入 `dist/api-base.json`，由 Electron 主进程读取，并通过 IPC 提供给认证代码。Web 构建不写入该令牌。

```bash
npm run dist:win    # 打包 Windows 安装包，输出在 release/ 文件夹
npm run dist:mac    # 打包 Mac 安装包（需要在 Mac 电脑上执行）
npm run dist        # 自动识别你当前的系统来打包
```

打包后的 Windows 桌面端通过已发布的 GitHub Release 检查更新。设置中可关闭自动更新弹窗，之后仍可通过导航栏 `NEW` 提示和手动检查进入更新；下载中的状态会保留。macOS 支持本地打包，当前发版工作流只生成 Windows 安装包，macOS 需手动下载更新。

### 常用检查

安装根目录和 Worker 依赖后，在根目录执行：

```bash
npm run typecheck
npm run lint
npm run format:check
npm test
npm run typecheck --prefix worker
node worker/scripts/check-migration-baseline.mjs
npm run build
```

`npm test` 同时运行 Electron 与 Worker 单元测试。`npm run preview` 预览 Web 构建产物；`npm run build:desktop` 生成桌面渲染层。Markdown 当前被仓库 `.prettierignore` 排除，文档变更还需单独检查格式和链接。

### 数据备份与离线使用

设置中的“导出完整备份”生成版本化 JSON，包含学习数据、文字笔记及本机冲突副本、PDF 原文和错题图片。导出时会读取尚未缓存的正文和云端附件；缺失或读取失败时停止导出，不生成缺少内容的备份。附件合计上限为 128 MiB，整个备份文件上限为 192 MiB（1 MiB = 1024 × 1024 字节），外部学习资料仍保留为链接。

导入先校验文件内容，再确认当前修改已同步并自动下载导入前完整快照；附件准备成功后才替换学习数据。恢复同步先建立科目与附件引用，再清理旧数据；遇到限流会等待后续传。完整备份可在原附件删除后或换账号恢复，PDF 会使用新文件标识。旧版 JSON 仍可导入，但其中 PDF 和云端错题图片仅含引用，需要原账号中的文件仍然存在。清除全部数据还会删除上传的 PDF 与云端错题图片，请保留完整备份。

如果恢复时提示图片引用缺失，保留原完整备份和导入前快照，重新选择原完整备份可补回附件并继续同步。导入前的当前修改同步、快照导出或附件准备失败时，会停止替换；开始恢复后的云端同步可能分批成功，失败时需保留快照并重试，详见 [恢复顺序](./worker/README.md#完整备份与恢复顺序)。页面中仍未保存的笔记应先保存或下载正文。

笔记标题旁会分别显示未保存、仅在当前页面、已存本机待同步和正文已同步。本机存储失败时可重试保存或下载当前正文；仅在页面内的内容尚不能保证刷新后恢复。

PWA 预缓存应用外壳，并缓存已访问的部分静态资源。API 请求使用 `NetworkOnly`，不会在 Service Worker 中缓存账号数据；离线时可访问的内容取决于已有本地缓存和当前登录状态，登录、社区与协作操作需要联网。

---

## 📁 项目结构

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

```
zsb-study-tracker/
├── src/                     # Vue 3 前端源码
│   ├── pages/               # 页面组件（30+ 路由页面）
│   ├── components/          # 通用与业务组件
│   ├── features/            # 社区与协作功能模块
│   ├── shared/              # 共用组件、组合式函数与样式
│   ├── stores/              # Pinia 状态（app / studyTimer / community…）
│   ├── services/            # 认证、完整备份、通知与提醒
│   ├── api/                 # 前端接口封装（client / sync / community）
│   ├── data/                # 默认状态与内置数据
│   ├── utils/               # 学习计划、复习间隔、时长汇总与其他工具
│   ├── types/               # 全局类型定义
│   └── router/              # 路由与访问守卫
├── electron/                # Electron 主进程、preload 与打包图标
├── worker/                  # Cloudflare Worker 后端
│   ├── schema.sql           # 新建 D1 数据库的完整结构
│   ├── migrations/          # 已有数据库的增量升级
│   ├── src/api/             # 各业务 API 模块
│   ├── src/proxy/           # 第三方代理（墨墨、壁纸…）
│   ├── src/middleware/      # 鉴权、限流等中间件
│   └── test/                # 单元测试、接口冒烟与专项回归脚本
├── public/                  # PWA 图标、manifest 与字体许可证
├── vite.config.ts           # Vite + PWA 配置
├── tailwind.config.js       # Tailwind 主题
└── package.json             # 依赖与构建脚本
```

</div>

---

## 🌐 部署

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

项目有四条 GitHub Actions 流水线：一条 CI 检查、两条部署、一条桌面端发版。

| 流水线                | 触发条件                                                                        | 行为                                                                                                                                         |
| :-------------------- | :------------------------------------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`              | 推送到 `development` / `master`、任意 PR，或其他工作流通过 `workflow_call` 调用 | 前端 typecheck、lint、format、Electron/Worker 单元测试、Web 构建与 Worker typecheck                                                          |
| `deploy-pages.yml`    | 推送到 `master`（或手动触发）                                                   | 等待同一提交的共用 CI 门禁通过 → 构建 Web 产物 → 部署 `dist/` 到 GitHub Pages                                                                |
| `deploy-worker.yml`   | 推送到 `master` 且 `worker/**` 有变更（或手动触发）                             | 等待共用 CI → Worker typecheck → 应用远程 D1 迁移 → 部署 Worker                                                                              |
| `release-desktop.yml` | 打 `v*` tag（或手动触发）                                                       | 等待共用 CI → tag 触发时校验版本一致，检查 `DESKTOP_TOKEN` 非空 → 原生 Windows runner 构建及配置产物校验 → 发布安装包至 GitHub Releases 草稿 |

Worker 自动部署需要仓库 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`。桌面发版另需仓库 Secret `DESKTOP_TOKEN`，与 Worker 运行期配置一致；Release 草稿需手动发布后才进入自动更新渠道。

日常改动先合入 `development`；发布时将验证后的改动通过 PR 合入 `master`，触发 Web 部署，并在 `worker/**` 有变更时部署后端。桌面安装包需另行打匹配 `package.json` 版本的标签或手动触发工作流，合入 `master` 本身不会生成安装包。完整发布检查见 [贡献指南](./CONTRIBUTING.md)。

Worker 的 `JWT_SECRET`、`TURNSTILE_SECRET` 等运行期密钥独立配置，并绑定 D1 数据库 `zsb-study-db` 和 R2 桶 `zsb-study-images`。新库初始化与已有库升级步骤不同，直接执行 SQL 不会登记迁移状态；发布前按 [Worker 数据库说明](./worker/README.md#数据库初始化与升级) 完成检查。

</div>

---

## 🤝 参与贡献指南

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

欢迎任何形式的贡献！标准流程如下：

<br/>

<table align="center">
  <tr>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">1</span>
      <br/><strong>Fork</strong><br/>
      <span style="color:#8b949e;font-size:13px;">本仓库到你的账号</span>
    </td>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">2</span>
      <br/><strong>新建分支</strong><br/>
      <span style="color:#8b949e;font-size:13px;"><code>feat/xxx</code> 或 <code>fix/xxx</code></span>
    </td>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">3</span>
      <br/><strong>编码</strong><br/>
      <span style="color:#8b949e;font-size:13px;">本地验证通过</span>
    </td>
    <td align="center" width="25%" style="padding:12px;">
      <span style="display:inline-block;background-color:#1f6feb;color:#fff;border-radius:50%;width:28px;height:28px;line-height:28px;text-align:center;font-weight:700;font-size:14px;">4</span>
      <br/><strong>提交 PR</strong><br/>
      <span style="color:#8b949e;font-size:13px;">到 <code>development</code> 分支</span>
    </td>
  </tr>
</table>

</div>

### 代码规范

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px 24px;margin:16px 0;">

- 使用 **TypeScript**，遵循 Vue 3 `<script setup>` 风格
- 样式统一使用 **Tailwind CSS**，移动端优先响应式
- 图标使用 **SVG 组件（Lucide）**，不要用 emoji 当功能图标
- 保持现有目录结构与命名风格

</div>

### 提交规范

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px 24px;margin:16px 0;">

- 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`feat:` / `fix:` / `docs:` / `refactor:` 等
- 示例：`feat: 新增单词背诵统计图表`
- 改动涉及的分支策略、审查流程详见 [CONTRIBUTING.md](./CONTRIBUTING.md)

</div>

### 反馈与建议

- **Bug 反馈**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)
- **需求建议**：同样通过 Issue 提出，并打上 `enhancement` 标签
- **安全问题**：请通过 [GitHub 私有漏洞报告](https://github.com/Han050912/zsb-study-tracker/security/advisories/new) 提交，勿在公开 Issue 披露细节；入口未启用时可 [私信维护者](https://t.me/hanhaoyi888)。

---

## 📜 许可证 License

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px 24px;margin:16px 0;text-align:center;">

本项目基于 <a href="./LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT License" /></a> 开源。

</div>

---

## 👤 About Me

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:16px 0;text-align:center;">

**Han050912** · 一名正在备考专升本、热爱折腾工具的开发者。

<br/>

<a href="https://blog.csdn.net/hajai?spm=1000.2115.3001.5343">
  <img src="https://img.shields.io/badge/博客-CSDN-fc5531?style=for-the-badge&logo=rss&logoColor=white" alt="CSDN 博客" />
</a>
<a href="https://x.com/hanhaoyi888">
  <img src="https://img.shields.io/badge/X-@hanhaoyi888-000000?style=for-the-badge&logo=x&logoColor=white" alt="X (Twitter)" />
</a>
<a href="https://discord.gg/49C9ZGqX4">
  <img src="https://img.shields.io/badge/Discord-加入服务器-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord" />
</a>
<a href="https://t.me/hanhaoyi888">
  <img src="https://img.shields.io/badge/Telegram-@hanhaoyi888-26A5E4?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram" />
</a>

</div>
