# Cloudflare AI 中转方案与部署清单

> 适用对象：想用 Cloudflare（+ 免费配套服务）搭建 AI 接口中转 / 个人全栈站的开发者。
> 日期：2026-05-30
> 状态：方案选型 + 可执行部署清单

## 1. 背景与目标

把对 OpenAI / Anthropic / Gemini 等 AI 接口的调用，经一层自有"中转"转发，以达成下列一个或多个目的：

- **藏 key**：真实 API key 留在服务端，前端/客户端只拿到受控的访问凭证。
- **解决访问**：借 Cloudflare 边缘节点转发，绕过国内直连不通的问题。
- **统一管理**：多厂商统一入口、key 池轮询、缓存、限流、用量统计。

## 2. Cloudflare 是什么 / 能干什么

全球网络基础设施与安全公司。流量先过 Cloudflare 边缘节点再到源站，这个"中间层"位置同时支撑加速与防护。与本方案相关的能力：

- **DNS**：免费权威解析（`1.1.1.1` 即其公共 DNS）。
- **Pages**：前端 / 全栈应用托管（类 Vercel），Git 推送即部署。
- **Workers**：边缘 serverless 函数，做纯 API 中转的首选。
- **AI Gateway**：官方的 AI 中转观测层（缓存 / 日志 / 统计），零部署。
- **R2 / D1 / KV / Durable Objects**：对象存储 / SQLite / KV / 有状态对象。

## 3. 国内访问的三个关键约束（务必先读）

1. **`*.workers.dev` / `*.pages.dev` 被墙**
   这两个根域名被 GFW 整体污染，国内访问任何子域名大概率不通。
   → **解决**：绑定自有域名（Custom Domain），且该域名本身未被单独封。
   → 注意：这跟"Cloudflare 整体被墙"是两码事，被针对的是默认域名，不是其网络。

2. **香港（HKG）出口不被 OpenAI 支持**
   靠近香港时，Cloudflare Worker 会从香港节点出口，而**香港不是 OpenAI 支持的区域**，请求可能被 OpenAI 拒。免费版无法指定出口区域。
   → **影响**：OpenAI 明确受限；**Anthropic 的支持区域同样不含香港，Claude 大概率也受影响**；Google Gemini 视服务而定，需自行确认。可靠不受限的是 DeepSeek 等国内厂商。
   → **解决**：转 OpenAI 优先用 Vercel Edge 部署，或换不限制香港的上游。

3. **"进得来" 与 "出得去" 难兼得**
   - 节点在国内 → 进得来快，但出口被墙、连不上 OpenAI。
   - 节点在境外 → 出得去，但国内进得慢 / 被墙。
   Cloudflare 免费版节点在境外，属"出得去、进得慢"；其国内节点（China Network）能技术上打通两端，但锁在 **企业版（年费数万美元）+ 域名备案** 之后，且备案后转发 OpenAI 几乎必然违规。**个人层面无干净解法。**
   → 给"裸连国内用户"用是死结；**自己用 + 能科学上网则毫无问题**。

## 4. 免费配套技术栈（做全栈站 / 准 One API）

| 组件 | 角色 | 免费额度（大致） | 注意 |
|------|------|------------------|------|
| Cloudflare DNS | 解析 + CDN + HTTPS | 完全免费 | — |
| Cloudflare Pages | 前端 / 全栈托管 | 无限请求，500 构建/月 | Functions 有 CPU 时间限制 |
| Cloudflare Workers | 边缘中转函数 | 10 万请求/天 | 同上 |
| Neon | Serverless Postgres | ~0.5 GB，自动休眠 | 边缘环境须用 HTTP driver |
| Upstash Redis | 缓存 / 限流 / 计数 | ~1 万命令/天 | 须用 REST client |

> ⚠️ 边缘环境（Workers/Pages）**必须用 HTTP / serverless 驱动**（`@neondatabase/serverless`、Upstash REST），不能用传统 TCP 长连接的 `pg`。

## 5. 开源方案能否直接上 Cloudflare

| 类型 | 代表项目 | 直接上 Cloudflare |
|------|----------|-------------------|
| 完整中转站（Go/Python + 数据库 + 后台 + 计费） | One API、New API、gpt-load | ❌ 需 Docker/VPS |
| 轻量代理 Worker（纯 JS，转发 / key 轮询） | flyisland/cf-openai-proxy 等 | ✅ `wrangler deploy` |
| 边缘多厂商网关 | blue-pen5805/llm-proxy-on-cloudflare-workers | ✅ 直接 |
| 官方观测层 | Cloudflare AI Gateway | ✅ 零部署 |

> One API 官方仅支持 Docker / Compose / 宝塔 / Sealos / Zeabur / Render + MySQL/PG，**无 Workers 选项**。要它的完整后台只能放 VPS，再用 Cloudflare 做前面的 DNS/CDN。

---

## 6. 部署清单

> 注意：下列命令与调用路径转录自各仓库 README（2026-05 时点）。**base URL 是否带 `/v1`、模型名格式等细节因 SDK 版本与项目更新而异，部署时以仓库最新 README 为准。**

### 通用前置（一次性）

```bash
# 1. Node 22+（本仓库已是 24）+ wrangler
npm i -g wrangler            # 或用 npx wrangler

# 2. 登录 Cloudflare
wrangler login

# 3. 准备一个未被 GFW 墙的自有域名，NS 托管到 Cloudflare
#    给国内用 → 必做；自己能翻墙 → 可跳过，直接用 *.workers.dev
```

### 方案 A — 自己用：藏 key + 解决访问

选 **`flyisland/cf-openai-proxy`**（用 `ACCESS_KEYS` 把真 key 藏在 Worker 里）。
> `egoist/openai-proxy` 是**透明代理**：key 由客户端透传、**不藏 key**，仅解决访问；要藏 key 用 flyisland。

```bash
git clone https://github.com/flyisland/cf-openai-proxy && cd cf-openai-proxy
npm install

# 生成访问密钥（发给客户端用，非真 key）
node src/key.mjs myname          # 输出形如 sk-myname-wMtF9kkGDu

# 写入两个 secret
wrangler secret put OPENAI_API_KEY   # 真正的 OpenAI key（藏在这）
wrangler secret put ACCESS_KEYS      # 上一步生成的 sk-myname-xxx（多个逗号分隔）

wrangler deploy
```

调用：
```python
openai.api_key  = "sk-myname-wMtF9kkGDu"     # 访问密钥
openai.api_base = "https://你的域名/v1"
```

收尾：
- [ ] Worker → Settings → Triggers → 绑 Custom Domain（国内必做）
- [ ] ⚠️ 转 OpenAI 遇香港区域报错 → 改 Vercel Edge 部署（egoist 支持）

### 方案 B — 多厂商 + key 池 + 简单管理

选 **`blue-pen5805/llm-proxy-on-cloudflare-workers`**（多厂商统一接口 + key 轮询 + 可挂 AI Gateway）。

```bash
git clone https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers && cd llm-proxy-on-cloudflare-workers
npm install            # 需 Node 22.12+
npm run cf:login

cp config.example.jsonc config.jsonc
# 在 config.jsonc 填：
#   各厂商 key，支持三种格式：
#     "OPENAI_API_KEY": "sk-..."                 单个
#     "OPENAI_API_KEY": "sk-1,sk-2,sk-3"         多个（key 池）
#     "OPENAI_API_KEY": ["sk-1","sk-2"]          数组
#   PROXY_API_KEY = 任意自定义字符串（客户端凭它访问）

npm run deploy
npm run secrets:deploy
```

调用（OpenAI 兼容，`model` 用 `厂商/模型`）：
```bash
curl https://你的域名/v1/chat/completions \
  -H "Authorization: Bearer <PROXY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}]}'
# 换厂商改 model：anthropic/claude-..., google-ai-studio/gemini-2.5-pro, deepseek/...
```

进阶：
- 全局 key 轮询：`ENABLE_GLOBAL_ROUND_ROBIN=true`（基于 Durable Objects）
- 指定 key：URL 加前缀 `/key/0/v1/...`（第 0 个）或 `/key/1-3/v1/...`（1–3 随机）
- 日志/缓存/统计：填 `CLOUDFLARE_ACCOUNT_ID` + `AI_GATEWAY_NAME` 挂到方案 C

收尾：
- [ ] 绑 Custom Domain（国内必做）
- [ ] ⚠️ OpenAI 香港出口问题同 A；要规避优先用 DeepSeek 等国内厂商（Claude/OpenAI 香港均可能受限）
- [ ] 加用量记录 → 配合 Neon 存日志 + Upstash 限流（第 4 节技术栈）

### 方案 C — 零部署：官方 AI Gateway（缓存/日志/统计）

不写代码、不部署。**仅透明记录层：有缓存/日志/延迟统计，无路由、无故障转移、无计费。**

控制台建网关：
1. 登录 Cloudflare Dashboard → 选账号
2. 左侧 **AI → AI Gateway**
3. **Create Gateway** → 填 Gateway name（≤64 字符）→ **Create**
4. 记下 `account_id`、`gateway_id`

改 base URL 即生效：
```
原始:  https://api.openai.com/v1
改为:  https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai
```
```python
client = OpenAI(
    api_key="sk-你的真实key",   # 注意：C 不藏 key，key 仍由客户端持有
    base_url="https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai"
)
```
换厂商把末尾 `openai` 改成 `anthropic` / `google-ai-studio` 等。

收尾：
- [ ] 控制台开 Caching（省 token）+ Rate limiting（防刷）
- [ ] Dashboard 看 Logs / 用量 / 花费
- [ ] ⚠️ 不藏 key、不解决"国内裸连"，只管观测

---

## 7. 选型速查

| 真实诉求 | 选 |
|----------|----|
| 自己用，藏 key，能翻墙 | **A**（flyisland），不必绑域名 |
| 多厂商 / 多 key 轮换，想要点管理 | **B**（blue-pen5805），最接近"中转站" |
| 已有 key，只要缓存+日志+省钱，懒得运维 | **C**（官方 Gateway），5 分钟搞定 |
| 终极形态 | **B + C 叠加 + Neon/Upstash** = 白嫖版 One API |

## 8. 合规与风险

- **厂商 ToS**：转发自己的 key 自用一般可以；转卖给第三方多属违规。
- **国内合规**：节点落地国内（备案）后转发境外 AI 服务几乎必然违规，备案主体担责。
- **免费额度**：个人 / demo 足够，上量需付费；注意 Workers CPU 时间、Neon 计算时长、Upstash 命令数。
- **香港出口**：转 OpenAI 的已知坑，见第 3 节。

## 9. 参考来源

- [songquanpeng/one-api](https://github.com/songquanpeng/one-api)
- [flyisland/cf-openai-proxy](https://github.com/flyisland/cf-openai-proxy)
- [egoist/openai-proxy](https://github.com/egoist/openai-proxy)
- [blue-pen5805/llm-proxy-on-cloudflare-workers](https://github.com/blue-pen5805/llm-proxy-on-cloudflare-workers)
- [x-dr/chatgptProxyAPI](https://github.com/x-dr/chatgptProxyAPI)
- [Cloudflare AI Gateway 文档](https://developers.cloudflare.com/ai-gateway/get-started/)
