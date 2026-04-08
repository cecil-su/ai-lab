# News Curator 实现计划

**目标:** 实现辅助资讯整理的实验工具，下载网页为 Markdown + 拆分长文
**架构:** 两个独立脚本（fetch.ts, split.ts），放在 lab/news-curator
**技术栈:** Node.js 24, TypeScript, ESM, Playwright, Readability, Turndown
**设计文档:** docs/designs/2026-04-08-news-curator.md
**新增依赖:**
- `playwright` — 无头浏览器（MIT）
- `@mozilla/readability` — 正文提取（Apache-2.0）
- `turndown` — HTML→Markdown（MIT）
- `jsdom` — DOM 环境（MIT）

---

### Task 1: 项目骨架 ✅

**文件:**
- 创建: `lab/news-curator/package.json`
- 创建: `lab/news-curator/tsconfig.json`

**验证:** `pnpm install && pnpm -F news-curator build` 通过

---

### Task 2: fetch.ts — URL → Markdown ✅

**文件:**
- 创建: `lab/news-curator/src/fetch.ts`

**核心逻辑:**
1. `parseArgs` 解析 URL（positional）和 `--output`（默认 `.`）
2. Playwright `chromium.launch()` → `page.goto(url, { waitUntil: "networkidle" })`
3. `JSDOM` + `Readability.parse()` 提取正文
4. `TurndownService` 转 Markdown（atx heading, fenced code）
5. 生成 frontmatter（url, title, date）
6. `slugify(title)` 生成文件名，中文 fallback 到 URL pathname
7. 文件名冲突检测（`access()` + 后缀递增）
8. 写入文件

**验证:** `pnpm -F news-curator fetch https://tkdodo.eu/blog/why-you-want-react-query --output playground` 成功输出带 frontmatter 的 Markdown

---

### Task 3: split.ts — 长文拆分 ✅

**文件:**
- 创建: `lab/news-curator/src/split.ts`

**核心逻辑:**
1. 读取文件，< 15000 字符则提示不拆分并退出
2. 解析并保留 frontmatter
3. 按 `## ` (h2) 切分为 sections
4. 超长 section（>15000 字符）按 `\n\n+`（段落）二次切分
5. 每段文件保留原 frontmatter，输出 `<name>-partN.md`

**验证:** 对 16881 字符的文章成功拆分为 10 段

---

### Task 4: Playwright 浏览器安装 ✅

**命令:** `npx playwright install chromium`

**验证:** Chromium Headless Shell 下载成功

---

### Task 5: README.md + RSS 源列表 ✅

**文件:**
- 创建: `lab/news-curator/README.md`

**内容:**
- 使用说明（fetch, split 命令）
- 工作流描述
- ~70 个 RSS 源按 11 个分类整理，附 feed URL
- 无公开 feed 的标注 `*`，Telegram/微信提供 RSSHub 替代方案
