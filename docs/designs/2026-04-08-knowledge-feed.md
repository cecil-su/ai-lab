# Knowledge Feed - 自动化知识抓取工具

**日期:** 2026-04-08

## 背景

希望通过 GitHub Actions 自动化抓取各类网站信息（AI 文档更新、技术博客、changelog、论文等），生成 Markdown 文档到仓库中，作为个人知识库。支持定时自动和手动触发两种方式。

## 讨论

### 探索的方案

**方案 A：纯爬虫脚本** — 在 repo 内写抓取脚本，直接解析 HTML。完全自控但维护成本高，网站改版就挂。

**方案 B：第三方 API 聚合** — 不自己爬，全部通过 RSS/Jina Reader/官方 API 获取内容。不用维护解析逻辑，但依赖第三方服务。

**方案 C（最终选择）：混合分层策略** — RSS 优先 + Jina Reader 兜底。按数据源类型选最合适的获取方式。

**方案 X（激进）：AI Agent 自主抓取 + 摘要** — 用 LLM API 阅读后生成摘要、打标签、关联已有项目。成本高，可作为未来扩展。

### 关键决策

**RSS 覆盖面远超预期。** 以下"看似需要专用 fetcher"的源都可直接用 RSS/Atom feed 覆盖：
- GitHub releases → `/releases.atom`
- YouTube 频道 → `/feeds/videos.xml?channel_id=XXX`
- Substack newsletter → `/<name>.substack.com/feed`
- Hacker News → `hnrss.org/newest?q=keyword`
- Reddit → `/r/xxx/.rss`
- ArXiv 论文 → `export.arxiv.org/api/query?...`

因此 MVP 只需 **rss + jina** 两个 fetcher，不需要 github-releases 和 json-api。

**Jina Reader 的风险。** Cloudflare 2025 年 7 月起默认屏蔽 AI 爬虫，Jina 官方承认无法绕过。Jina 角色从"通用兜底"降级为"少数无 feed 站点的备选"。长期替代方案是 Playwright + Readability（完全免费、Cloudflare 处理最强），作为升级路径保留。

**发版工具选型：release-please > changesets** — 原因见 monorepo scaffold 设计文档。

### RSS 解析库选型

选择 **feedsmith** 而非 rss-parser：
- 同时支持 RSS 2.0 / Atom / RDF / JSON Feed
- 积极维护（rss-parser 3 年未更新）
- 统一输出格式，无需处理不同 feed 格式差异

## 方案

采用**方案 C：混合分层策略**，MVP 只做 rss + jina。

### 在 monorepo 中的定位

放在 `tools/knowledge-feed`，是 ai-lab 的第二个工具项目。

### 文件结构

```
tools/knowledge-feed/
├── src/
│   ├── index.ts              # CLI 入口：parseArgs、编排流程、输出摘要
│   ├── config.ts             # 读取并校验 _sources.yaml
│   ├── dedup.ts              # _seen.json 读写 + 去重判定
│   ├── generator.ts          # 标准化条目 → Markdown 文件写入
│   └── fetchers/
│       ├── types.ts          # Fetcher 统一接口 + 标准化类型
│       ├── rss.ts            # RSS/Atom/JSON Feed fetcher（feedsmith）
│       └── jina.ts           # Jina Reader fetcher
├── package.json
└── tsconfig.json

docs/knowledge/               # 产出目录
├── _sources.yaml             # 数据源声明（手动维护）
├── _seen.json                # 去重索引（自动生成，git 跟踪）
└── <source-name>/
    └── YYYY-MM-DD.md

.github/workflows/
└── knowledge-feed.yml
```

### 数据源配置

`_sources.yaml` 是唯一需要手动维护的文件：

```yaml
sources:
  - name: "openai-changelog"        # 必填，唯一标识 [a-z0-9-]
    url: "https://platform.openai.com/docs/changelog/rss.xml"
    type: "rss"                      # "rss" | "jina"
    tags: ["ai", "openai"]
    # enabled: true                  # 可选，默认 true
    # max_items: 20                  # 可选，默认 20

  - name: "anthropic-news"
    url: "https://www.anthropic.com/news"
    type: "jina"
    tags: ["ai", "anthropic"]
    max_items: 10

  - name: "nodejs-releases"
    url: "https://github.com/nodejs/node/releases.atom"
    type: "rss"                      # GitHub releases 有 Atom feed
    tags: ["runtime", "nodejs"]
```

| 字段 | 类型 | 必填 | 默认值 | 说明 |
|------|------|------|--------|------|
| `name` | string | 是 | - | 源唯一标识，同时作为产出子目录名 |
| `url` | string | 是 | - | 抓取地址 |
| `type` | `"rss"` \| `"jina"` | 是 | - | 获取策略 |
| `tags` | string[] | 是 | - | 标签，写入 Markdown frontmatter |
| `enabled` | boolean | 否 | `true` | 设为 false 可禁用 |
| `max_items` | number | 否 | `20` | 每次最多取几条条目 |

### 核心类型

```typescript
// 标准化条目（所有 fetcher 输出此格式）
interface FeedItem {
  id: string;              // RSS guid/Atom id，或空字符串
  title: string;
  url: string;
  content: string;         // Markdown 格式正文
  date: string | null;     // ISO 8601
}

// Fetcher 统一签名
type Fetcher = (source: SourceConfig) => Promise<FeedItem[]>;
```

### 数据流

```
1. CLI 入口 (index.ts)
   parseArgs: --source <name> | --config <path> | --output <path>
       ↓
2. 加载配置 (config.ts)
   _sources.yaml → 校验 → 过滤 enabled=false → 过滤 --source
       ↓
3. 加载去重索引 (dedup.ts)
   读取 _seen.json（不存在则 {}）
       ↓
4. 遍历每个源（try-catch 隔离，单个失败不影响其他）
   a. 按 type 选择 fetcher
   b. fetcher(source) → FeedItem[]
   c. 截断到 max_items
   d. deduplicateItems() → 过滤已见条目
   e. generateMarkdown() → 写文件
       ↓
5. 保存去重索引
   写回 _seen.json
       ↓
6. 输出摘要到 stdout
   "处理 N 个源，新增 M 条，失败 K 个"
   退出码：全部失败=1，其他=0
       ↓
7. Git 操作（仅在 Actions workflow shell step 中）
   git diff → git add → git commit → git push
```

**关键设计：** Git 操作不在 Node 代码中，而在 workflow shell step 里。本地运行只写文件，不自动 commit。

### 去重策略

使用 `_seen.json` 轻量索引文件，纳入 git 跟踪。

**去重 key 优先级：**
1. `guid:<item.id>` — RSS 的 `<guid>` / Atom 的 `<id>`
2. `url:<normalizedUrl>` — URL 标准化后（去 utm 参数、统一 scheme、去尾部斜杠）
3. `title:<sha256Hash8>` — 标题的 SHA256 前 8 位

**容量控制：** 每源最多保留 500 条 key（FIFO），防止文件无限增长。

```jsonc
// _seen.json
{
  "openai-changelog": [
    "guid:abc123",
    "url:https://example.com/post/456",
    "title:a1b2c3d4"
  ]
}
```

### 生成的 Markdown 格式

文件路径：`docs/knowledge/<source-name>/YYYY-MM-DD.md`

```markdown
---
source: openai-changelog
fetched: "2026-04-08"
tags: [ai, openai]
items: 3
---

# openai-changelog | 2026-04-08

## GPT-5 API 正式发布

> https://platform.openai.com/docs/changelog/gpt5-api

摘要内容...

---

## Function Calling v3

> https://platform.openai.com/docs/changelog/function-calling-v3

摘要内容...
```

### GitHub Actions 集成

```yaml
name: Knowledge Feed

on:
  schedule:
    - cron: "0 8 * * *"                 # 每天 UTC 8:00
  workflow_dispatch:
    inputs:
      source:
        description: "指定源名称（留空=全部）"
        required: false
        type: string

concurrency:
  group: knowledge-feed
  cancel-in-progress: false

permissions:
  contents: write

jobs:
  feed:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version-file: ".node-version"
      - uses: pnpm/action-setup@v4
      - run: pnpm install --frozen-lockfile
      - run: pnpm -F knowledge-feed build
      - run: node tools/knowledge-feed/dist/index.js
              ${{ inputs.source && format('--source {0}', inputs.source) || '' }}
        env:
          JINA_API_KEY: ${{ secrets.JINA_API_KEY }}
      - name: Commit and push
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add docs/knowledge/
          if git diff --cached --quiet; then
            echo "No new content"
          else
            git commit -m "chore: update knowledge feed $(date -u +%Y-%m-%d)"
            git push
          fi
```

## 约束与非功能需求

- **版权合规**：个人知识库自用。如果 repo 为 public，建议只存摘要 + 链接，不存全文
- **Actions 额度**：每次运行约 3-5 分钟，每天一次约 90-150 分钟/月（免费 2000 分钟/月）
- **Jina Reader 风险**：Cloudflare 封锁趋势，角色降级为备选。长期替代：Playwright + Readability
- **新增源零代码**：只需编辑 `_sources.yaml`
- **Repo 膨胀控制**：`max_items` 限制条目数，Jina 抓取内容考虑截断到合理长度
- **错误隔离**：每源 try-catch，部分失败提交成功部分，退出码标记异常
- **配置校验**：启动时校验 _sources.yaml（type 枚举、URL 格式、必填字段），fail fast

## 架构

### 核心组件

- **CLI 入口** (`index.ts`)：解析命令行参数，加载配置，编排抓取流程，输出摘要
- **配置** (`config.ts`)：读取并校验 `_sources.yaml`，填充默认值
- **去重** (`dedup.ts`)：`_seen.json` 读写，guid > URL > title hash 优先级去重
- **生成** (`generator.ts`)：接收标准化条目，写 Markdown 文件
- **Fetcher 层** (`fetchers/`)：统一接口，每种 type 一个 fetcher

### 依赖

| 依赖 | 用途 | 说明 |
|------|------|------|
| `feedsmith` | RSS/Atom/JSON Feed 解析 | 唯一的 feed 解析依赖 |
| `yaml` | YAML 配置解析 | 轻量，零依赖 |
| Node 内置 `fetch` | HTTP 请求 | Node 24 原生支持 |
| Node 内置 `parseArgs` | CLI 参数解析 | `node:util` |
| `typescript` | 编译 | devDependency |

### 代码量预估

~388 行 TS + ~50 行 workflow YAML。

### 升级路径

| 阶段 | 触发条件 | 升级内容 |
|------|----------|----------|
| MVP | 现在 | rss + jina，串行，无重试 |
| M1 | Jina 频繁失败 | 加入 Readability + Turndown 作为 jina 的前置轻量路径 |
| M2 | Cloudflare 站点多 | 加入 Playwright 无头浏览器（fetch → Readability → Playwright → Jina 分层） |
| M3 | 源 > 20 个 | 并行抓取 + `_index.md` 索引 + `_state.json` 状态追踪 |
