# 贡献指南 · Contributing

感谢你对 **专升本学习助手（zsb-study-tracker）** 的关注！本项目欢迎任何形式的贡献：Bug 报告、功能建议、文档改进、代码提交。

## 目录

- [行为准则](#行为准则)
- [快速开始](#快速开始)
- [开发环境搭建](#开发环境搭建)
- [项目结构](#项目结构)
- [分支策略](#分支策略)
- [代码规范](#代码规范)
- [提交 Commit](#提交-commit)
- [提交 Pull Request](#提交-pull-request)
- [反馈与建议](#反馈与建议)

---

## 行为准则

参与本项目即表示您同意遵守 [参与者公约](./CODE_OF_CONDUCT.md)。请保持尊重和包容。

---

## 快速开始

> 环境要求：**Node.js 18+**

```bash
git clone https://github.com/Han050912/zsb-study-tracker.git
cd zsb-study-tracker
npm install
npm run dev          # 启动 Web 开发服务器（http://localhost:5173）
npm run electron:dev # 启动桌面端开发（Vite + Electron 热调试）
```

---

## 开发环境搭建

### Web 端

```bash
npm install          # 安装依赖
npm run dev          # Vite HMR 开发服务器
npm run build        # 生产构建（输出到 dist/）
npm run preview      # 预览生产构建
```

### 桌面端（Electron）

```bash
npm run electron:dev # 同时启动 Vite 和 Electron，支持热重载
npm run dist:win     # 打包 Windows 安装包（NSIS，输出到 release/）
npm run dist:mac     # 打包 macOS DMG（需在 macOS 上执行）
```

桌面端通过自定义 `app://` 安全协议加载本地静态资源，保证加密 API、IndexedDB、Web Worker 等能力可用。electron-updater 在检测到新 Release 后会自动推送更新。

### Cloudflare Worker 后端

Worker 代码位于 `worker/` 目录，提供代理 API（灵感笔记、壁纸等）。

```bash
cd worker
npm install
npx wrangler dev      # 本地调试
npx wrangler deploy    # 部署到 Cloudflare
```

---

## 项目结构

```
zsb-study-tracker/
├── src/                  # Vue 3 前端源码
│   ├── components/       # 通用组件
│   ├── views/            # 页面视图
│   ├── stores/           # Pinia 状态管理
│   ├── utils/            # 工具函数
│   └── ...
├── electron/             # Electron 桌面端入口与配置
├── worker/               # Cloudflare Worker 后端
│   └── src/
│       ├── index.ts      # Worker 入口
│       ├── router.ts     # 路由注册
│       ├── proxy/        # 第三方 API 代理
│       └── middleware/   # 中间件（限流等）
├── public/               # 静态资源
├── index.html            # HTML 入口
├── vite.config.ts        # Vite 配置
├── tailwind.config.js    # Tailwind CSS 配置
└── package.json          # 项目配置与脚本
```

---

## 分支策略

- **`master`**：稳定发布分支，每次 Release 从 development 合并
- **`development`**：日常开发分支，所有 PR 合入此分支

请从 `development` 分支创建功能/修复分支：

```bash
git checkout development
git pull origin development
git checkout -b feat/your-feature   # 新功能
git checkout -b fix/your-bug        # Bug 修复
```

---

## 代码规范

### 通用

- 使用 **TypeScript**，充分利用类型系统
- **不要新增兼容层、降级逻辑或迁移方案**——直接修改
- 保持改动最小化、外科手术式精准编辑
- 优先复用现有依赖，不重复造轮子

### 前端

- 使用 Vue 3 **`<script setup>`** 语法
- 样式统一使用 **Tailwind CSS** 原子类，移动端优先响应式
- 新页面/组件放在对应目录，保持命名风格一致
- 图标使用 SVG 组件（Lucide），**不要用 emoji 作图标**

### Worker

- 只能使用 **Web 标准 API**（`fetch`、`crypto.subtle` 等），不要引入 Node 专有模块
- 第三方 API 代理放在 `worker/src/proxy/` 下，路由注册在 `index.ts`

---

## 提交 Commit

遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/) 规范：

| 类型 | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | Bug 修复 |
| `docs:` | 文档更新 |
| `style:` | 代码格式（不影响逻辑） |
| `refactor:` | 重构（既非新功能也非修复） |
| `perf:` | 性能优化 |
| `test:` | 测试相关 |
| `chore:` | 构建/工具链杂项 |

示例：

```
feat: 新增单词背诵统计图表
fix: 修复番茄钟暂停后时间归零的问题
docs: 更新桌面端打包指南
```

---

## 提交 Pull Request

1. **Fork** 本仓库到你的 GitHub 账号
2. 基于 `development` 创建功能/修复分支并编码
3. 本地验证（确保 `npm run dev` 和 `npm run build` 均正常）
4. 提交 PR，目标分支为 **`development`**
5. PR 标题遵循 Conventional Commits 格式
6. 在 PR 描述中说明改动内容、动机和验证结果

> 维护者将在 3 个工作日内回复。如需修改，请在同一分支上追加 commit 即可，PR 会自动更新。

---

## 反馈与建议

- **Bug 反馈**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)，附上复现步骤和运行环境
- **功能建议**：[提交 Issue](https://github.com/Han050912/zsb-study-tracker/issues/new)，打上 `enhancement` 标签
- **安全问题**：请参考 [安全政策](./SECURITY.md)

---

再次感谢你的贡献！
