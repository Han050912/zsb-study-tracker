# WAF 限流规则配置说明

面向项目所有者：**本文档描述的 WAF 边缘规则需在 Cloudflare 控制台手动完成**（不通过 Terraform 管理）；Worker 内的 binding 限流配置在 `worker/wrangler.toml` 的 `[[ratelimits]]` 段，随部署自动生效（见第 5 节）。

---

## 1. 背景

接口限流分层如下：

- **Worker 内（主防线）**：Workers 内置 Rate Limiting binding（`wrangler.toml` 的 `[[ratelimits]]`，2025-09 GA）。
  计数跨实例共享（按 key 分 colo，宽松最终一致——非全局精确），被拒请求不进入 D1。
  限值档位与实现见 `worker/src/middleware/rateLimit.ts` 的 `RateLimitTier`。
  局限：攻击者分散多城市节点时单 key 计数被稀释；binding period 仅支持 10/60 秒。
- **Worker 内（人机验证）**：Turnstile，作用于登录/注册，在限流**之后**执行（被限请求不触发 siteverify 外呼）。
- **边缘层**：免费版仅 1 条限流规则额度，已被平台自动创建的「Leaked credential check」占用，
  **自定义洪水限流规则未部署**（2026-09-12 控制台确认，维持现状）。若观察到大流量攻击压垮 Worker，
  再按第 3 节权衡是否切换。

---

## 2. 规则创建步骤

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)，选择域名 **`zsbservice.de5.net`**
   （Worker 自定义路由为 `cn.zsbservice.de5.net/*`，属于该域名，故安全策略在域名维度配置即可生效）。
2. 左侧导航进入 **Security → WAF → Rate limiting rules**。
3. 点击 **Create rule**。
4. 按下方「规则配置」表格逐项填写，然后 **Deploy / Save**。

> 提示：规则保存后通常在数十秒内在全球边缘节点生效。

---

## 3. 规则配置

> **⚠️ 创建前须知**：免费版仅提供 **1 条**限流规则额度，而当前该额度已被 Cloudflare 自动创建的 **「Leaked credential check」（泄露凭据检查）** 规则占用（表达式 `(cf.waf.credential_check.password_leaked)`）。
> 要创建本规则，**必须先删除那条规则**。删除后你将失去「请求体中的密码命中已知泄露库即拦截」的能力，请权衡（详见第 4 节「额度取舍」）。

| 配置项 | 值 |
|---|---|
| 规则名称 | `api-login-rate-limit` |
| 表达式（自定义 / Edit expression） | `(http.request.uri.path eq "/api/auth/login")` |
| 速率（Rate） | 每 IP **300 秒**内 **300 次**请求 |
| 特征（Characteristic） | IP 地址（默认唯一选项） |
| 动作（Action） | Block |
| 阻断时长（Duration） | 10 分钟 |

### 阈值说明（binding 层为主防线，WAF 超宽兜底）

- **主要防线是 binding 限流（登录 10 次 / 分钟）**：正常用户几乎不可能达到；它处理绝大多数爆破尝试，返回友好 JSON 429。
- WAF 层阈值（300 次 / 300 秒 ≈ 60 次 / 分钟）是 binding 层的 **6 倍**，极其宽松，**仅在出现洪水级攻击（每秒数十次以上）时兜底**——此时 binding 层已被打满、Worker/D1 资源被消耗，WAF 在边缘直接拦截。
- 阈值刻意设得远超正常使用：校园网 / 企业出口普遍是 **NAT 共享出口 IP**，同一 IP 背后可能有大量真实用户，过紧会批量误封。
- 若 WAF 层也开始误拦，优先在 binding 配置（`worker/wrangler.toml` 的 `[[ratelimits]]` 段）把 10 次 / 分调高，保持 WAF 层只做「洪水兜底」的定位。

---

## 4. 运维说明

- **查看命中记录**：`Security → Events`，在过滤器中按本规则名称筛选，可看到被拦截的请求、来源 IP、路径与时间点，用于判断是否误伤或是否真有攻击。
- **阈值调整**：若发现正常用户被拦（多见于校园网 / 企业 NAT 出口共 IP 场景），可**调高速率阈值**或**延长统计窗口**；先观察 Events 中的来源 IP 分布再决定改哪个参数。
- **误拦截临时处置**：`WAF → Rate limiting rules` 中将该规则 **Disable**，排查确认后重新 **Enable**。Disable 期间登录端点仍有 binding 限流（10 次 / 分钟）与 Turnstile 人机验证兜底。
- **与 Worker 内限流的关系**：注册端点已有 Turnstile 人机验证 + binding 限流（3 次 / 分钟），攻击面已被覆盖，**无需占用这唯一 1 条限流规则额度**；本规则仅覆盖登录端点。
- **额度取舍（重要）**：当前免费版仅提供 **1 条**限流规则额度，已被「Leaked credential check」占用。二选一：
  - **保留「Leaked credential check」**：继续拦截「格式合规但已被泄露」的密码登录（与代码层密码策略互补），但不创建本规则。若选此项，本文档仅作参考，无需操作。
  - **删除「Leaked credential check」并创建本规则**：得到登录端点的 WAF 洪水兜底，但失去泄露凭据拦截。本规则阈值已设为超宽，正常使用不会触发。
  - 若希望两者兼得：升级套餐（Pro / Business）可获得更多限流规则额度。
- **建议**：当前默认推荐**保留「Leaked credential check」**——它单点价值更高（直接拦截成功攻击），登录爆破已有 binding 限流 + Turnstile 覆盖。若确实观察到大流量爆破压垮 Worker，再切换为本规则。

---

## 5. 相关文件

- Worker 内限流实现（Rate Limiting binding）：`worker/src/middleware/rateLimit.ts`
- 速率限制绑定配置：`worker/wrangler.toml` 的 `[[ratelimits]]` 段
- 登录端点（POST `/api/auth/login`）：`worker/src/api/auth.ts`
- 设计文档：`docs/superpowers/specs/2026-08-30-security-hardening-design.md`
