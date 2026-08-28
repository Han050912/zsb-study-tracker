<div align="center" style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:32px 20px 20px 20px;margin:16px 0;">

# 🔐 安全政策

**zsb-study-tracker · 安全政策**

<span style="color:#8b949e;">我们非常重视用户数据安全与隐私保护。感谢每一位负责任地报告安全问题的研究者。</span>

</div>

> 最后更新：2026-08-28

---

## 📋 目录

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:20px 24px;margin:16px 0;">

| | |
| :--- | :--- |
| [🛡️ 支持的版本](#️-支持的版本) | 哪些版本会收到安全修复 |
| [🚨 报告安全漏洞](#-报告安全漏洞) | 提交渠道、响应时效与处理流程 |
| [🔒 安全设计](#-安全设计) | 认证、限流、内容安全、加密等实际措施 |
| [🗄️ 数据存储与隐私](#️-数据存储与隐私) | 数据存在哪里、存了什么、不存什么 |
| [🔬 安全测试须知](#-安全测试须知) | 研究者请遵守的测试边界 |
| [🙏 致谢](#-致谢) | 安全研究者名单 |

</div>

---

## 🛡️ 支持的版本

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

| 版本 | 是否支持安全修复 |
| :--- | :---: |
| **2.0.x**（当前 `2.0.3-beta.1`，云端同步架构） | ✅ 支持 |
| 1.x（旧版纯本地存储架构） | ❌ 已停止维护 |
| development 分支 | ⚠️ 开发中，仅跟进高危问题 |

当前版本以根目录 `package.json` 的 `version` 字段为准。1.x 与 2.x 的数据架构不同（2.x 起数据经账号同步至 Cloudflare D1），旧版本不再接收修复，请升级到最新稳定版。

</div>

---

## 🚨 报告安全漏洞

<div style="background-color:#0d1117;border:1px solid #21262d;border-left:4px solid #f85149;border-radius:4px;padding:20px 24px;margin:16px 0;">

> **请勿在公开 Issue 中披露漏洞细节。** 请通过下面的私密渠道提交，给我们时间修复与发布。

</div>

### 提交渠道（按优先级）

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

| 渠道 | 方式 | 说明 |
| :--- | :--- | :--- |
| **GitHub 私有漏洞报告**（推荐） | 仓库 → `Security` → `Report a vulnerability` | 仅维护者可见，支持私密讨论与后续联合披露 |
| **Telegram** | [@hanhaoyi888](https://t.me/hanhaoyi888) | 私有漏洞报告不可用时 |
| **Discord** | [加入服务器](https://discord.gg/49C9ZGqX4) 后私信维护者 | 同上 |

</div>

### 请尽量提供

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

- 漏洞类型（如越权、注入、XSS、CSRF、凭证泄露）
- 影响的具体页面或接口地址（`worker/src/api/` 下的路由或 Web 路由）
- 复现步骤与最小 PoC（**仅使用你自己的测试账号**）
- 影响范围与潜在危害评估
- 修复建议（可选）

</div>

### 响应时效

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

| 阶段 | 目标 |
| :--- | :--- |
| 确认收到 | **72 小时内** |
| 初步评估与严重级别判定 | 7 天内 |
| 修复与安全版本发布 | 高危 7 天内，中低危 30 天内 |
| 公开披露 | 修复发布后，按约定时间（默认 14 天后） |

我们会在修复发布后于本文档的「致谢」中署名（除非你希望匿名）。

</div>

---

## 🔒 安全设计

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

以下是当前代码中的实际实现（可对照 `worker/src/` 与 `electron/main.cjs` 查阅）：

<table align="center">
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🔑 认证与密码</strong><br/>
      <span style="color:#8b949e;">bcrypt（cost 10）单向哈希存储，绝不存明文；用户名 2–20 字符且需通过敏感词校验，密码至少 6 位；登录失败信息不区分「用户不存在 / 密码错误」</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🎫 会话与吊销</strong><br/>
      <span style="color:#8b949e;">jose 签发 JWT（含 jti），有效期 3 天；Cookie 使用 <code>HttpOnly</code> + <code>SameSite</code>（线上 <code>None</code> + <code>Secure</code>）；登出写入 <code>jwt_blacklist</code> 即时吊销</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🤖 人机验证</strong><br/>
      <span style="color:#8b949e;">注册与登录强制 Cloudflare Turnstile 校验；桌面客户端通过服务端共享令牌（<code>DESKTOP_TOKEN</code>）等效放行，前端拿不到该判定逻辑</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🚦 接口限流</strong><br/>
      <span style="color:#8b949e;">按 IP 限流：注册 3/分钟、登录 10/分钟、发帖 5/分钟、评论与举报 10/分钟、图片上传与反馈 20/分钟、壁纸代理 30/分钟</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🌐 来源与响应头</strong><br/>
      <span style="color:#8b949e;">CORS 白名单仅含生产域名、Pages 域名与 <code>app://localhost</code>（本地开发端口放行）；统一附加 <code>nosniff</code>、<code>X-Frame-Options: DENY</code>、<code>Referrer-Policy</code></span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🧹 内容安全</strong><br/>
      <span style="color:#8b949e;">本地词库（Aho-Corasick，含全角/谐音/拆字归一化）命中 HARD 直接拒绝、SOFT 标记待审；未命中再交由 Workers AI 语义复审（模型失败时 fail-open，不阻断发布）</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🛡️ 内容治理</strong><br/>
      <span style="color:#8b949e;">用户可举报帖子 / 评论，管理员审核后隐藏或删除并记录 <code>community_moderation_log</code>；删除内容联动回收积分流水，防止「发了删」刷分</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🖼️ 图片上传</strong><br/>
      <span style="color:#8b949e;">不信任客户端 Content-Type，以 Magic Bytes 嗅探真实图片格式；服务端剥离 JPEG/PNG/WebP 的 EXIF、XMP 与文本块元数据；对象 id 为 16 位随机串，不可枚举</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🗝️ 密钥与第三方凭证</strong><br/>
      <span style="color:#8b949e;"><code>JWT_SECRET</code>、<code>TURNSTILE_SECRET</code>、<code>DESKTOP_TOKEN</code>、<code>CF_API_TOKEN</code>、<code>GITHUB_TOKEN</code> 均走 Wrangler Secrets / <code>.dev.vars</code>；第三方凭证（墨墨 Token）以 AES-256-GCM 加密后入库，密钥由 <code>JWT_SECRET</code> 派生</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🖥️ 桌面端加固</strong><br/>
      <span style="color:#8b949e;">Electron 开启 <code>contextIsolation</code>、关闭 <code>nodeIntegration</code>；页面经 <code>app://</code> 协议加载；生产构建注入严格 CSP（仅开发环境因 HMR 保留 <code>unsafe-eval</code>）</span>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">📊 服务端权威结算</strong><br/>
      <span style="color:#8b949e;">积分、学习时长与番茄记录等激励数据以服务端结算为准（按 <code>refId</code> 去重），客户端提交的数值不作为最终依据</span>
    </td>
    <td width="50%" valign="top" style="padding:8px 16px;">
      <strong style="color:#58a6ff;">🔗 第三方调用收敛</strong><br/>
      <span style="color:#8b949e;">GitHub（反馈建 Issue）、墨墨开放 API、壁纸站等外部请求统一由 Worker 代理，令牌不出服务端，失败一律降级不抛错</span>
    </td>
  </tr>
</table>

</div>

---

## 🗄️ 数据存储与隐私

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

- **账号与业务数据**存放于 **Cloudflare D1**（`zsb-study-db`），表结构以 `worker/schema.sql` 为准；社区图片存于 **R2**（`zsb-study-images`）。
- **不会**以明文形式保存密码；第三方 API 凭证加密存储（AES-256-GCM）。
- 注册后，学习记录会随账号在 Web 与桌面端之间同步；未登录时仅可浏览公开社区内容与公开小组（这是设计行为，不是缺陷）。
- 上传图片会在服务端剥离 EXIF 等隐私元数据后再存储。
- 内容数据受 Cloudflare 平台合规与数据保护机制约束；请勿在帖子、笔记或反馈中填写真实身份证号、银行卡等敏感个人信息。
- 若你需要导出或删除自己的账号数据，请通过下方渠道联系维护者。

</div>

---

## 🔬 安全测试须知

<div style="background-color:#0d1117;border:1px solid #21262d;border-left:4px solid #d29922;border-radius:4px;padding:20px 24px;margin:16px 0;">

安全研究时请遵守以下边界：

- **只使用你自己的测试账号**，不要尝试登录、枚举或篡改他人账号与数据
- **不要对生产环境做压力测试、DoS/DDoS 或自动化全站扫描**（接口限流会拦截，必要时我们会封禁来源）
- **不要下载、留存或公开任何非你本人的用户数据**；PoC 中请打码
- 发现漏洞后请给予合理修复窗口，在修复发布前不要公开细节
- 建议在本地环境复现：`cd worker && npm run init:local && npx wrangler dev`

</div>

---

## 🙏 致谢

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

感谢以下安全研究者负责任地报告问题（按报告时间排序）：

<br/>

_目前还没有安全报告记录 —— 期待你的贡献。_

<br/>

我们会在此处署名（除非你希望匿名）。

</div>

---

## 📚 相关文档

<div style="background-color:#0d1117;border:1px solid #21262d;border-radius:12px;padding:20px 24px;margin:16px 0;">

- [README.md](./README.md) — 项目介绍与快速上手
- [CONTRIBUTING.md](./CONTRIBUTING.md) — 贡献流程与分支策略
- [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) — 行为准则
- [worker/schema.sql](./worker/schema.sql) — 数据库表结构（数据存储的实际范围）

</div>

---

<div align="center" style="background-color:#0d1117;border:1px solid #21262d;border-radius:8px;padding:16px;margin:16px 0;">

<span style="color:#8b949e;">🔐 安全问题请优先使用 GitHub 私有漏洞报告通道</span>

</div>
