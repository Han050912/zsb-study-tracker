<div align="center" style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:40px 20px 24px 20px;margin:16px 0;">

<img src="./public/logo.png" alt="Logo" width="120" style="margin-bottom:8px;" />

# [专升本学习助手](https://zsb-study-tracker.sryze.cc/)

**zsb-study-tracker** · 专升本备考打卡管理助手（Web + 桌面端）

<span style="color:#8b949e;">学习记录 · 番茄钟 · 游戏化激励 · 社区与搭子 · 云端多端同步</span>

<br/>

[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat-square&logo=vite&logoColor=white)](https://vitejs.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
[![Pinia](https://img.shields.io/badge/Pinia-2-FFD859?style=flat-square&logo=vuedotjs&logoColor=black)](https://pinia.vuejs.org/)
[![Vue Router](https://img.shields.io/badge/Vue_Router-4-4FC08D?style=flat-square&logo=vuedotjs&logoColor=white)](https://router.vuejs.org/)
[![ECharts](https://img.shields.io/badge/ECharts-5-AA344D?style=flat-square&logo=apacheecharts&logoColor=white)](https://echarts.apache.org/)
[![KaTeX](https://img.shields.io/badge/KaTeX-0.16-222222?style=flat-square&logo=katex&logoColor=white)](https://katex.org/)
[![Electron](https://img.shields.io/badge/Electron-43-47848F?style=flat-square&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![D1](https://img.shields.io/badge/D1-Database-F38020?style=flat-square&logo=cloudflare&logoColor=white)](https://developers.cloudflare.com/d1/)
[![PWA](https://img.shields.io/badge/PWA-Ready-5A0FC8?style=flat-square&logo=pwa&logoColor=white)](https://web.dev/progressive-web-apps/)

<br/>

[![Pages Deploy](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-pages.yml)
[![Worker Deploy](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-worker.yml/badge.svg)](https://github.com/Han050912/zsb-study-tracker/actions/workflows/deploy-worker.yml)

<br/>

> [:arrow_right: English version](./README_EN.md)

</div>

---

## 📑 目录

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

<table align="center">
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-项目简介" style="text-decoration:none;color:#58a6ff;">✨ 项目简介</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-功能特性" style="text-decoration:none;color:#58a6ff;">🧩 功能特性</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-效果图" style="text-decoration:none;color:#58a6ff;">📸 效果图</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-技术架构" style="text-decoration:none;color:#58a6ff;">🏗️ 技术架构</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-快速上手" style="text-decoration:none;color:#58a6ff;">🚀 快速上手</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-项目结构" style="text-decoration:none;color:#58a6ff;">📁 项目结构</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-部署" style="text-decoration:none;color:#58a6ff;">🌐 部署</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-参与贡献指南" style="text-decoration:none;color:#58a6ff;">🤝 贡献指南</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-许可证-license" style="text-decoration:none;color:#58a6ff;">📜 许可证</a></td>
  </tr>
  <tr>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-about-me" style="text-decoration:none;color:#58a6ff;">👤 About Me</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"><a href="#-请我喝咖啡" style="text-decoration:none;color:#58a6ff;">☕ 请我喝咖啡</a></td>
    <td align="center" width="33%" style="padding:6px 12px;"></td>
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
      <span style="color:#8b949e;">注册账号后数据全量同步到云端（Cloudflare D1），Web 与桌面端随时接着学；PWA 会缓存数据，断网时也能查看最近一次的内容</span>
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
      <strong style="color:#f78166;">🍅 番茄钟带任务描述</strong><br/>
      <span style="color:#8b949e;">正计时 / 倒计时两种模式，开始前可填写本次专注任务；独立的「最近完成」板块记录今日每个番茄的时刻、时长与任务，双击即可补充命名</span>
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
      <span style="color:#8b949e;">Windows / macOS 原生客户端：系统托盘、桌面原生通知、自动更新；Web 端可安装为 PWA 并离线缓存</span>
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
      <span style="color:#8b949e;">科目章节树与掌握度、学习时长记录、刷题会话、错题本、模考记录、每日待办</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📝 笔记与资料</strong><br/>
      <span style="color:#8b949e;">Markdown + KaTeX 公式笔记、资料库、PDF 上传与分片阅读</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📖 英语专项</strong><br/>
      <span style="color:#8b949e;">单词打卡（对接墨墨背单词）、完形、阅读、听力、作文模板与每日目标</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🍅 番茄专注</strong><br/>
      <span style="color:#8b949e;">正计时 / 倒计时、任务描述、最近完成明细、中断原因记录、专注壁纸</span>
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
      <span style="color:#8b949e;">注册登录（bcrypt 密码 + JWT HttpOnly Cookie）、Cloudflare Turnstile 人机验证、限流、敏感词本地词库 + Workers AI 复审</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">⚙️ 个性化</strong><br/>
      <span style="color:#8b949e;">考试日期倒计时、主题与深色模式、提醒与勿扰、头像裁剪、访客浏览模式、意见反馈直达 GitHub Issue</span>
    </td>
  </tr>
</table>

</div>

---

## 📸 效果图

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📊 首页仪表盘

<span style="color:#8b949e;">今日概览、待办、学习热力图、科目掌握度与今日名言，一屏掌握当日学习节奏。</span>

<br/><br/>

<img src="./public/screenshots/Home.png" alt="首页仪表盘" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📝 笔记中心（Markdown + LaTeX）

<span style="color:#8b949e;">基于 KaTeX 的数学公式渲染，支持 Markdown 全量语法与笔记检索。</span>

<br/><br/>

<img src="./public/screenshots/Notes.png" alt="笔记中心" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📖 英语打卡（搭配「墨墨背单词」App）

<span style="color:#8b949e;">与墨墨背单词 App 配合，自定义每日目标，完形、阅读、听力、作文模板多维记录，自动累计积分。</span>

<br/><br/>

<img src="./public/screenshots/English.png" alt="英语打卡" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 📅 每日总结

<span style="color:#8b949e;">自动聚合今日学习数据，支持情绪日志 + 三段式反思 + 明日计划，一键生成分享卡片。</span>

<br/><br/>

<img src="./public/screenshots/Summary.png" alt="每日总结" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:24px 0;">

### 🏆 成就激励

<span style="color:#8b949e;">青铜 → 王者段位体系、徽章墙、积分流水与连续学习天数，让坚持有看得见的回报。</span>

<br/><br/>

<img src="./public/screenshots/Rewards.png" alt="成就激励" width="100%" style="border-radius:6px;border:1px solid #30363d;" />

</div>

---

## 🏗️ 技术架构

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

| 层次 | 技术选型 |
| :--- | :--- |
| 前端 | Vue 3（`<script setup>`）、TypeScript、Vite 5、Vue Router 4（hash 模式）、Pinia 2、Tailwind CSS 3 |
| 可视化 / 富内容 | ECharts 5、KaTeX 0.16、markdown-it、pdfjs-dist、Lucide 图标（SVG 组件，不使用 emoji 图标） |
| 桌面端 | Electron 43、electron-builder、electron-updater（Windows 自动更新）、系统托盘与原生通知 |
| PWA | vite-plugin-pwa（可安装 + Service Worker 离线缓存，API 请求 NetworkFirst） |
| 后端 | Cloudflare Workers（TypeScript）、自研路由与中间件、bcryptjs 密码哈希、jose 签发 JWT |
| 数据 | Cloudflare D1（50+ 张业务表，见 `worker/schema.sql`）、R2（社区图片存储）、D1 定时任务（每周一推送周报） |
| 工程 | ESLint 之外的类型检查 `tsc --noEmit`、Worker 冒烟测试 `node test/smoke.mjs`、GitHub Actions 双流水线 |

</div>

---

## 🚀 快速上手

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

> 环境要求：**Node.js 18 或更高版本**（CI 与 Worker 部署使用 Node 22，可从 [nodejs.org](https://nodejs.org) 下载安装包）。

</div>

### 在浏览器里跑起来

打开终端（Windows 按 `Win+R` 输入 `cmd`，Mac 打开「终端」），依次敲下面几条命令：

```bash
# 把项目代码下载到本地
git clone https://github.com/Han050912/zsb-study-tracker.git
cd zsb-study-tracker

# 安装项目需要的依赖包（第一次会比较慢，后面就快了）
npm install

# 启动开发服务器，浏览器会自动打开页面
npm run dev
```

接口地址由 `VITE_API_BASE` 决定：开发模式默认请求本地 Worker `http://localhost:8787`（`.env.development`），生产构建指向线上 Worker `https://cn.zsbservice.de5.net`（`.env`）。也就是说，只跑 `npm run dev` 时同样需要本地 Worker 提供账号与数据接口，继续看下一节。

### 启动后端 Worker（本地开发必需）

```bash
cd worker
npm install

# 初始化本地 D1 数据库（首次执行，会在 .wrangler 下生成 SQLite）
npm run init:local

# 本地启动 Worker（默认 http://localhost:8787）
npx wrangler dev
```

后端密钥通过 `worker/.dev.vars` 提供（已 gitignore），本地开发至少需要：

| 变量 | 说明 |
| :--- | :--- |
| `JWT_SECRET` | JWT 签名密钥 |
| `TURNSTILE_SECRET` | Cloudflare Turnstile 密钥，本地可用官方测试密钥 |
| `DESKTOP_TOKEN` | 桌面端共享令牌，用于跳过人机验证（与前端构建期注入值一致） |
| `CF_API_TOKEN` / `CF_ACCOUNT_ID` | Workers AI 内容复审（可选，未配置则自动降级为仅本地词库） |

生产环境用 `npx wrangler secret put <NAME>` 写入，不要提交明文。

后端改动可跑冒烟测试验证：

```bash
cd worker
npm run smoke     # 对本地 http://localhost:8787 跑一轮接口自测
```

### 在桌面客户端里跑起来

```bash
# 浏览器和桌面端同时启动，改代码两边都会自动刷新
npm run electron:dev
```

### 打包成安装文件

想把应用打包成 `.exe` 或 `.dmg` 发给同学用？跑下面命令就行：

```bash
npm run dist:win    # 打包 Windows 安装包，输出在 release/ 文件夹
npm run dist:mac    # 打包 Mac 安装包（需要在 Mac 电脑上执行）
npm run dist        # 自动识别你当前的系统来打包
```

打包好的 Windows 桌面端会通过 GitHub Release 自动检查新版本并提示更新（electron-updater）。

---

## 📁 项目结构

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

```
zsb-study-tracker/
├── src/                     # Vue 3 前端源码
│   ├── pages/               # 页面组件（30+ 路由页面）
│   ├── components/          # 通用与业务组件
│   ├── stores/              # Pinia 状态（app / studyTimer / community…）
│   ├── services/            # 认证、通知、提醒等服务
│   ├── api/                 # 前端接口封装（client / sync / community）
│   ├── data/                # 默认状态与内置数据
│   ├── utils/               # 工具函数
│   ├── types/               # 全局类型定义
│   └── router/              # 路由与访问守卫
├── electron/                # Electron 主进程、preload 与打包图标
├── worker/                  # Cloudflare Worker 后端
│   ├── schema.sql           # D1 建表脚本（唯一数据源）
│   ├── src/api/             # 各业务 API 模块
│   ├── src/proxy/           # 第三方代理（墨墨、壁纸…）
│   ├── src/middleware/      # 鉴权、限流等中间件
│   └── test/smoke.mjs       # 接口冒烟测试
├── public/                  # 静态资源（PWA 图标、截图、打赏码）
├── docs/                    # 设计文档（本地，不随仓库发布）
├── vite.config.ts           # Vite + PWA 配置
├── tailwind.config.js       # Tailwind 主题
└── package.json             # 依赖与构建脚本
```

</div>

---

## 🌐 部署

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

项目有两条 GitHub Actions 流水线，均监听 **`master`** 分支：

| 流水线 | 触发条件 | 行为 |
| :--- | :--- | :--- |
| `deploy-pages.yml` | 推送到 `master` | `npm ci` → `npm run build` → 部署 `dist/` 到 GitHub Pages |
| `deploy-worker.yml` | 推送到 `master` 且 `worker/**` 有变更 | 在 `worker/` 下 `npm ci` → `npx wrangler deploy` |

部署需要的仓库 Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；Worker 运行期还需配置 `JWT_SECRET`、`TURNSTILE_SECRET`、`DESKTOP_TOKEN` 等变量，并创建 D1 数据库（`zsb-study-db`）与 R2 桶（`zsb-study-images`）。

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
- **安全问题**：请参考 [SECURITY.md](./SECURITY.md)

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

---

## ☕ 请我喝咖啡

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:24px;margin:16px 0;text-align:center;">

如果这个项目对你有帮助，欢迎请我喝杯咖啡，让工具持续迭代下去 ☕

<br/>

| 微信支付 | 支付宝 |
| :---: | :---: |
| <img src="./public/donate/wechat.jpg" alt="微信支付" width="220" style="border-radius:8px;" /> | <img src="./public/donate/alipay.jpg" alt="支付宝" width="220" style="border-radius:8px;" /> |

</div>
