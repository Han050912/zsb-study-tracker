<div align="center">

<img src="./public/logo.png" alt="Logo" width="120" />

# 专升本学习助手

**zsb-study-tracker** · 专升本备考打卡管理助手（Web + 桌面端）

学习记录 · 番茄钟 · 游戏化激励 · 数据可视化 · 多账号本地存储

[演示站点](https://zsb-study-tracker.sryze.cc/) · [Issues](https://github.com/Han050912/zsb-study-tracker/issues) · [Releases](https://github.com/Han050912/zsb-study-tracker/releases)

<br/>

[![Version](https://img.shields.io/github/package-json/v/Han050912/zsb-study-tracker?color=blue&label=version)](https://github.com/Han050912/zsb-study-tracker/blob/master/package.json)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Han050912/zsb-study-tracker/deploy.yml?branch=master&label=build)](https://github.com/Han050912/zsb-study-tracker/actions)
[![License](https://img.shields.io/github/license/Han050912/zsb-study-tracker?color=green)](./LICENSE)
[![Stars](https://img.shields.io/github/stars/Han050912/zsb-study-tracker?style=social)](https://github.com/Han050912/zsb-study-tracker/stargazers)
[![Issues](https://img.shields.io/github/issues/Han050912/zsb-study-tracker)](https://github.com/Han050912/zsb-study-tracker/issues)
[![GitHub Pages](https://img.shields.io/github/deployments/Han050912/zsb-study-tracker/github-pages?label=pages%20deploy)](https://Han050912.github.io/zsb-study-tracker/)

</div>

---

## 📑 目录

- [项目简介](#-项目简介)
- [🚀 快速上手](#-快速上手)
- [📦 安装与部署指南](#-安装与部署指南)
- [🤝 参与贡献指南](#-参与贡献指南)
- [📜 许可证 License](#-许可证-license)
- [📋 更新日志 Changelog](#-更新日志-changelog)
- [🙏 致谢与引用](#-致谢与引用)
- [👤 About Me](#-about-me)
- [⭐ Star History](#-star-history)
- [☕ 请我喝咖啡](#-请我喝咖啡)

---

## ✨ 项目简介

「专升本学习助手」是一款面向专升本考生的**备考打卡管理应用**，提供 **Web 版** 与 **Windows / macOS 桌面版**。所有数据均在本地保存，无需后端服务器，开箱即用、隐私可控。

> 核心定位：把「记录 → 专注 → 激励 → 复盘」串成一条完整的学习闭环。

### 功能亮点

| 模块 | 说明 |
| --- | --- |
| 📊 首页仪表盘 | 今日概览、待办、学习热力图、进度环、考试倒计时、每日名言 |
| 📐 高等数学 | 考纲章节树、学习计时、刷题记录、掌握度雷达、Markdown + LaTeX 笔记、真题趋势 |
| 📖 英语 | 逐条背单词打卡、阅读计时、听力记录、作文模板库、笔记检索 |
| 🛠️ 科目自定义 | 默认高数 / 英语（权重各 50%），支持修改权重、删除、新增任意科目 |
| 📝 笔记中心 | Markdown 编辑、全文检索，支持本地文件上传与拖拽（.md / .txt） |
| ❌ 错题本 | 图片上传（Base64）、分类、复习计数 |
| 🍅 番茄钟 | 正 / 倒计时、白噪音（WebAudio）、中断记录、全屏沉浸 |
| 🎮 游戏化积分 | 积分、等级（青铜 → 王者）、成就徽章墙、连胜计数，删除记录自动回收积分 |
| 📅 每日总结 | 自动聚合数据、情绪日志、三段式反思、分享卡片 |
| 📈 统计中心 | 时长 / 占比 / 正确率 / 题型 / 专注 / 情绪多维图表、周报 |
| 🔁 习惯追踪 | 四种量化方式、30 天热力、坏习惯克制打卡 |
| 📚 资料库 | 书籍进度条、链接、笔记摘抄 |
| 👥 多账号 | 基于 sql.js 的本地注册 / 登录，数据按账号隔离 |
| 🔔 每日提醒 | 浏览器 / 系统通知定时提醒学习 |
| 🖥️ 桌面端 | 原生窗口、启动画面、系统托盘、自动更新（electron-updater） |

---

## 🚀 快速上手

### 在线预览

- **演示站点**：https://zsb-study-tracker.sryze.cc/
- **GitHub Pages**：https://Han050912.github.io/zsb-study-tracker/

### 本地快速启动

> 环境要求：**Node.js 18+**

```bash
# 克隆仓库
git clone https://github.com/Han050912/zsb-study-tracker.git
cd zsb-study-tracker

# 安装依赖
npm install

# 启动 Web 开发服务器
npm run dev
```

启动后访问终端输出的本地地址（默认 `http://localhost:5173/`）即可使用。

---

## 📦 安装与部署指南

### 本地开发环境搭建

```bash
# 1. 安装依赖
npm install

# 2. Web 开发（Vite 热更新）
npm run dev

# 3. 桌面端开发（Vite Dev Server + Electron 热调试）
npm run electron:dev
```

### GitHub Pages 自动化部署（推荐 Action 方案）

在仓库中新建 `.github/workflows/deploy.yml`：

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [master]

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install & Build
        run: |
          npm ci
          npm run build

      - uses: actions/upload-pages-artifact@v3
        with:
          path: ./dist

      - name: Deploy
        uses: actions/deploy-pages@v4
```

然后在仓库 **Settings → Pages** 中将 Source 选为 **GitHub Actions** 即可。

### 桌面端打包构建说明

```bash
# 打包 Windows 安装包（NSIS，输出到 release/）
npm run dist:win

# 打包 macOS 安装包（DMG，需在 macOS 上执行）
npm run dist:mac

# 按当前系统平台打包
npm run dist
```

> 桌面端通过自定义 `app://` 安全协议加载本地静态资源，保证加密 API、IndexedDB、Web Worker 等能力可用；内置 electron-updater 自动更新，新版本发布至 GitHub Releases 后会推送提醒。

---

## 🤝 参与贡献指南

欢迎任何形式的贡献！标准流程如下：

1. **Fork** 本仓库到你的账号
2. **新建分支**：`git checkout -b feat/your-feature`（或 `fix/xxx`）
3. **编码** 并本地验证
4. **提交 PR** 到本仓库的 `development` 分支

### 代码规范

- 使用 **TypeScript**，遵循 Vue 3 `<script setup>` 风格
- 样式统一使用 **Tailwind CSS**，移动端优先响应式
- 保持现有目录结构与命名风格

### 提交规范

- 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)：`feat:` / `fix:` / `docs:` / `refactor:` 等
- 示例：`feat: 新增单词背诵统计图表`

### 反馈与建议

- **Bug 反馈**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)
- **需求建议**：同样通过 Issue 提出，并打上 `enhancement` 标签

---

## 📜 许可证 License

本项目基于 [MIT License](./LICENSE) 开源。

---

## 📋 更新日志 Changelog

完整的版本更新记录请前往 **[Releases 页面](https://github.com/Han050912/zsb-study-tracker/releases)** 查看。

每个版本的说明遵循如下格式：

```markdown
## v1.x.x

### ✨ 新增
- ...

### 🐞 修复
- ...

### ⚡ 优化
- ...
```

---

## 🙏 致谢与引用

本项目站在众多优秀开源项目的肩膀上：

- [Vue 3](https://vuejs.org/) · [Vite](https://vite.dev/) · [TypeScript](https://www.typescriptlang.org/)
- [Tailwind CSS](https://tailwindcss.com/) · [Pinia](https://pinia.vuejs.org/)
- [sql.js](https://github.com/sql-js/sql.js) · [ECharts](https://echarts.apache.org/) · [KaTeX](https://katex.org/)
- [Electron](https://www.electronjs.org/) · [electron-builder](https://www.electron.build/) · [electron-updater](https://github.com/electron-userland/electron-updater)
- [markdown-it](https://github.com/markdown-it/markdown-it) · [dayjs](https://day.js.org/)
- Logo 图标来自 Microsoft [Fluent Emoji](https://github.com/microsoft/fluentui-emoji)（MIT License）

---

## 👤 About Me

**Han050912** · 一名正在备考专升本、热爱折腾工具的开发者。

- 🏠 仓库地址：https://github.com/Han050912/zsb-study-tracker
- 🌐 演示站点：https://zsb-study-tracker.sryze.cc/

---

## ⭐ Star History

<a href="https://www.star-history.com/#Han050912/zsb-study-tracker&type=Date">
  <img src="https://api.star-history.com/svg?repos=Han050912/zsb-study-tracker&type=Date" alt="Star History Chart" />
</a>

---

## ☕ 请我喝咖啡

如果这个项目对你有帮助，欢迎请我喝杯咖啡，让工具持续迭代下去 ☕

<div align="center">

| 微信支付 | 支付宝 |
| :---: | :---: |
| <img src="https://your-domain.com/wechat-pay-qrcode.png" alt="微信支付" width="200" /> | <img src="https://your-domain.com/alipay-qrcode.png" alt="支付宝" width="200" /> |

</div>

---

<div align="center">

**如果这个项目对你有帮助，请不吝点亮一个 ⭐ Star，你的支持是我持续更新的最大动力！**

</div>
