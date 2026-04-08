# News Curator - 资讯整理辅助工具

**日期:** 2026-04-08

## 背景

个人有大量 RSS 订阅源（前端、AI、Rust、个人博客、周刊等约 70+），日常需要整理资讯和翻译技术文章。现有工作流依赖 Cursor Chat：手动下载 newsletter → 用 prompt 提取文章列表 → 挑选文章 → 用 prompt 翻译成中文。

痛点：
- 下载网页为 Markdown 需要手动操作或跑零散脚本
- 长文翻译在 Cursor Chat 里会 cancel
- 希望保持 Local First + 纯文本，不做全自动（保留人的参与感）

## 讨论

### 探索的方案

**方案 A：CLI 工具** — 把下载、提取、翻译串成命令行工具。功能完整但提取和翻译需要调 LLM API，产生额外费用（Cursor 套餐和 Claude API 独立计费）。

**方案 B（最终选择）：辅助脚本 + Cursor Chat** — 工具只做 LLM 不擅长的事（下载网页、拆分长文），LLM 相关工作（提取列表、翻译）继续在 Cursor Chat 里完成，白嫖已有额度。

**方案 X（激进）：fetch 时自动检测长度并切分** — 下载即拆分，省掉 split 步骤。但失去"先浏览再决定翻译"的灵活性。

### 关键决策

**LLM 工作留在 Cursor Chat。** Cursor 套餐和 Claude API 是独立计费体系，既然 Cursor 额度用不完，没必要为 CLI 工具额外付 API 费用。

**技术选型：Playwright + Readability + Turndown。** 比 Jina Reader API 重（需装浏览器），但最可靠——能过 Cloudflare，不依赖第三方服务，符合 Local First 原则。

**放在 lab/ 而非 tools/。** 实验性质，跑通了再考虑升级。

**两个独立脚本而非单 CLI。** fetch 和 split 使用时机不同，拆开更自然，也符合 lab 的低仪式感。

## 方案

采用**方案 B：辅助脚本 + Cursor Chat**，实现 fetch 和 split 两个独立脚本。

### 在 monorepo 中的定位

放在 `lab/news-curator`，`private: true`，作为实验项目。

### 文件结构

```
lab/news-curator/
├── src/
│   ├── fetch.ts    # URL → 本地 Markdown
│   └── split.ts    # 长文 → 多段文件
├── package.json
├── tsconfig.json
└── README.md       # 使用说明 + RSS 源列表
```

### 数据流

```
1. fetch <url>
   Playwright 渲染 → Readability 提取正文 → Turndown 转 Markdown
   → 输出带 frontmatter 的 .md 文件（url, title, date）
   → 文件名从 title 生成（slugify），中文 fallback 到 URL pathname
   → 文件名冲突加 -1, -2 后缀

2. split <file.md>
   读取文件 → 检查是否 < 15000 字符（不拆分）
   → 按 h2 标题切分
   → 超长段落（>15000 字符）按段落二次切分
   → 每段保留原 frontmatter
   → 输出 <name>-part1.md, <name>-part2.md, ...
```

### 工作流（人 + 工具）

```
人: 发现新的 weekly newsletter
  ↓
工具: fetch <newsletter-url> --output wip/
  ↓
人: 在 Cursor Chat 用 prompt 提取文章列表 → wip.md
  ↓
人: 挑选感兴趣的文章
  ↓
工具: fetch <article-url> --output wip/
  ↓
工具: split wip/article.md（如果太长）
  ↓
人: 在 Cursor Chat 用 prompt 翻译 → 译：xxx.md
```

## 约束与非功能需求

- **Local First**：所有数据存本地纯文本，不依赖云服务
- **Playwright 浏览器**：首次需 `npx playwright install chromium`（~110MB）
- **无 LLM 依赖**：工具本身不调用任何 AI API
- **lab 级别**：低仪式感，无测试，跑通为主

## 架构

### 依赖

| 依赖 | 用途 |
|------|------|
| `playwright` | 无头浏览器渲染页面 |
| `jsdom` | 为 Readability 提供 DOM 环境 |
| `@mozilla/readability` | 从 HTML 提取正文 |
| `turndown` | HTML → Markdown |

### 代码量

~200 行 TypeScript（fetch ~105 行，split ~103 行）。

### 升级路径

| 阶段 | 触发条件 | 升级内容 |
|------|----------|----------|
| MVP | 现在 | fetch + split，手动操作 |
| M1 | 常用 prompt 固化 | 把 extract/translate prompt 模板化到 skills/ |
| M2 | 从 lab 毕业 | 迁移到 tools/，加测试，去掉 private |
