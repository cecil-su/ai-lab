# Knowledge Feed 实现计划

**目标:** 实现 GitHub Actions 驱动的知识抓取工具，自动抓取 RSS/网页内容生成 Markdown 到仓库
**架构:** CLI 工具（tools/knowledge-feed），fetcher 分层架构，_seen.json 去重，Actions workflow 定时触发
**技术栈:** Node.js 24, TypeScript, ESM, feedsmith, yaml
**设计文档:** docs/designs/2026-04-08-knowledge-feed.md
**新增依赖:**
- `feedsmith` — RSS/Atom/JSON Feed 解析（MIT）
- `yaml` — YAML 配置解析（ISC）
- `vitest` — 测试框架（MIT，devDep）
**测试模式:** 仅关键路径（去重逻辑、配置校验、URL 标准化）

---

### Task 1: 项目骨架 + 依赖安装  ✅

**文件:**
- 创建: `tools/knowledge-feed/package.json`
- 创建: `tools/knowledge-feed/tsconfig.json`

**Step 1: 创建 package.json**

```json
{
  "name": "knowledge-feed",
  "version": "0.0.0",
  "description": "Automated knowledge feed fetcher for ai-lab",
  "type": "module",
  "bin": {
    "knowledge-feed": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "vitest run"
  },
  "keywords": ["rss", "feed", "knowledge", "automation"],
  "license": "MIT",
  "dependencies": {
    "feedsmith": "^2.8.0",
    "yaml": "^2.7.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.1.0"
  }
}
```

**Step 2: 创建 tsconfig.json**

继承 root tsconfig.base.json，与 create-lab 模式一致。

**Step 3: 验证**
运行: `pnpm install && pnpm -F knowledge-feed build`
预期: 安装成功，编译无错误（此时无 src 文件，需先创建空入口）

---

### Task 2: 类型定义 + 配置加载  ✅

**文件:**
- 创建: `tools/knowledge-feed/src/fetchers/types.ts`
- 创建: `tools/knowledge-feed/src/config.ts`
- 创建: `tools/knowledge-feed/src/__tests__/config.test.ts`

**Step 1: 写 types.ts**

核心类型定义（完整代码）：
- `SourceConfig`: name, url, type("rss"|"jina"), tags, enabled, max_items
- `FeedItem`: id, title, url, content, date
- `Fetcher`: `(source: SourceConfig) => Promise<FeedItem[]>`

**Step 2: 写 config.ts**

- 读取 yaml 文件 → `yaml.parse` → 校验必填字段（name, url, type, tags）
- 校验 type 枚举值（"rss" | "jina"）
- 填充默认值（enabled=true, max_items=20）
- 过滤 enabled=false 的源
- 校验失败抛出明确错误信息（fail fast）

**Step 3: 写配置校验测试**

测试用例：
- 有效配置 → 正确解析 + 默认值填充
- 缺少必填字段 → 抛错
- 无效 type → 抛错
- enabled=false → 被过滤

**Step 4: 验证**
运行: `pnpm -F knowledge-feed test`
预期: PASS

---

### Task 3: 去重模块  ✅

**文件:**
- 创建: `tools/knowledge-feed/src/dedup.ts`
- 创建: `tools/knowledge-feed/src/__tests__/dedup.test.ts`

**Step 1: 写 dedup.ts**

- `loadSeen(path)`: 读取 _seen.json，不存在返回 `{}`
- `saveSeen(path, index)`: 写回 _seen.json
- `getDeduplicationKey(item)`: 优先级 guid > normalized URL > title hash
- `normalizeUrl(url)`: 去 utm_* 参数、去尾部斜杠、hostname 小写
- `deduplicateItems(items, sourceName, seen)`: 过滤已见条目，更新 seen（FIFO 500 上限）

**Step 2: 写去重测试**

测试用例：
- guid 优先于 url
- url 优先于 title hash
- URL 标准化：去 utm 参数、去尾部斜杠
- 已见条目被过滤
- FIFO 500 上限：第 501 个 key 挤掉最早的
- _seen.json 不存在时返回空对象

**Step 3: 验证**
运行: `pnpm -F knowledge-feed test`
预期: PASS

---

### Task 4: Markdown 生成器  ✅

**文件:**
- 创建: `tools/knowledge-feed/src/generator.ts`

**Step 1: 写 generator.ts**

- `generateMarkdown(source, items, outputDir)`: 
  - 无条目时返回 null
  - 创建 `<outputDir>/<source.name>/` 目录
  - 生成 frontmatter（source, fetched, tags, items count）
  - 生成正文：一级标题 + 每条目二级标题 + 引用链接 + 内容 + `---` 分隔
  - 写入 `YYYY-MM-DD.md`
  - 同一天多次运行追加新条目到已有文件
  - 返回写入的文件路径

**Step 2: 验证**
运行: `pnpm -F knowledge-feed test`（现有测试仍通过）+ 手动验证在 Task 7 集成测试中

---

### Task 5: RSS Fetcher  ✅

**文件:**
- 创建: `tools/knowledge-feed/src/fetchers/rss.ts`

**Step 1: 写 rss.ts**

- `rssFetcher(source)`:
  - `fetch(source.url)` 获取 feed 内容
  - `feedsmith.parse(text)` 解析 RSS/Atom/JSON Feed
  - 映射到 FeedItem[]：
    - id = entry.id 或 entry.guid 或 ""
    - title = entry.title
    - url = entry.link（用 `new URL(link, source.url)` resolve 相对路径）
    - content = entry.content 或 entry.summary 或 ""
    - date = entry.published 或 entry.updated 或 null
  - 截断到 `source.max_items`

**Step 2: 验证**
运行: `pnpm -F knowledge-feed build`
预期: 编译通过。实际网络测试在 Task 7 集成测试中。

---

### Task 6: Jina Fetcher  ✅

**文件:**
- 创建: `tools/knowledge-feed/src/fetchers/jina.ts`

**Step 1: 写 jina.ts**

- `jinaFetcher(source)`:
  - `fetch("https://r.jina.ai/" + source.url)` + headers（Accept: text/markdown, Authorization 如有 JINA_API_KEY）
  - 解析返回的 Markdown 文本
  - 返回单条 FeedItem：id=""，title=页面标题（从响应提取），url=source.url，content=markdown 正文，date=今天
  - 超时设置 30 秒

**Step 2: 验证**
运行: `pnpm -F knowledge-feed build`
预期: 编译通过。

---

### Task 7: CLI 入口 + 集成验证  ✅

**文件:**
- 创建: `tools/knowledge-feed/src/index.ts`
- 创建: `docs/knowledge/_sources.yaml`（示例配置）

**Step 1: 写 index.ts**

- `parseArgs` 解析 CLI 参数：`--source <name>`、`--config <path>`、`--output <path>`
- 加载配置 → 按 --source 过滤
- 加载 _seen.json
- for...of 遍历源（try-catch 隔离每个源）
  - 按 type 选择 fetcher（rss/jina）
  - 抓取 → 截断 max_items → 去重 → 生成 Markdown
  - 记录结果
- 保存 _seen.json
- 打印摘要（N 源，M 新条目，K 失败）
- 退出码：全部失败=1，其他=0

**Step 2: 创建示例 _sources.yaml**

```yaml
sources:
  - name: "hn-ai"
    url: "https://hnrss.org/newest?q=AI&count=5"
    type: "rss"
    tags: ["ai", "news"]
    max_items: 5
```

**Step 3: 验证**
运行: `pnpm -F knowledge-feed build && node tools/knowledge-feed/dist/index.js --config docs/knowledge/_sources.yaml --output docs/knowledge`
预期:
- 输出摘要："处理 1 个源，新增 N 条，失败 0 个"
- 生成 `docs/knowledge/hn-ai/YYYY-MM-DD.md`
- 生成 `docs/knowledge/_seen.json`

运行第二次：
预期: "新增 0 条"（去重生效）

---

### Task 8: GitHub Actions workflow  ✅

**文件:**
- 创建: `.github/workflows/knowledge-feed.yml`

**Step 1: 写 workflow**

```yaml
name: Knowledge Feed
on:
  schedule:
    - cron: "0 8 * * *"
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
      - checkout
      - setup-node (node-version-file)
      - pnpm/action-setup
      - pnpm install --frozen-lockfile
      - pnpm -F knowledge-feed build
      - run knowledge-feed CLI (with JINA_API_KEY env)
      - git diff → git add docs/knowledge/ → git commit → git push
```

**Step 2: 验证**
运行: `cat .github/workflows/knowledge-feed.yml | node -e "require('fs').readFileSync('/dev/stdin','utf8')"` — 确认 YAML 语法正确
预期: 无报错。实际 Actions 验证需推送后在 GitHub 上确认。

---

### Task 9: 提交 + 推送  ✅

**Step 1: 运行全部测试**
运行: `pnpm -F knowledge-feed test`
预期: PASS

**Step 2: 完整构建验证**
运行: `pnpm -F knowledge-feed build && node tools/knowledge-feed/dist/index.js --config docs/knowledge/_sources.yaml --output docs/knowledge`
预期: 成功抓取并生成文件

**Step 3: 提交**
```bash
git add tools/knowledge-feed/ docs/knowledge/ .github/workflows/knowledge-feed.yml
git commit -m "feat: add knowledge-feed tool

- RSS/Atom/JSON Feed fetcher (feedsmith)
- Jina Reader fetcher for non-RSS sources
- _seen.json deduplication (guid > url > title hash)
- Markdown generation with frontmatter
- GitHub Actions workflow (daily cron + manual trigger)
- Tests for config validation and dedup logic"
```

**Step 4: 推送**
运行: `git push`
