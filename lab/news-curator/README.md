# news-curator

辅助资讯整理工作流的实验工具。下载网页为本地 Markdown，拆分长文方便逐段翻译。

LLM 相关工作（提取文章列表、翻译）留在 Cursor Chat / Claude Code 里完成。

## Setup

```bash
pnpm install
pnpm -F news-curator build
npx playwright install chromium
```

## Usage

### fetch - 下载网页为 Markdown

```bash
pnpm -F news-curator fetch <url> [--output <dir>]
```

- Playwright 渲染页面 → Readability 提取正文 → Turndown 转 Markdown
- 输出带 frontmatter（url、title、date）的 `.md` 文件
- 文件名从页面标题生成，中文标题 fallback 到 URL pathname
- `--output` 指定输出目录，默认当前目录

### split - 拆分长文

```bash
pnpm -F news-curator split <file.md>
```

- 文件 < 15000 字符时不拆分
- 按 h2 标题切分，超长段落（>15000 字符）再按段落二次切分
- 输出 `<原文件名>-part1.md`、`<原文件名>-part2.md`、...
- 每个分段保留原文 frontmatter

## Workflow

```
1. fetch 下载 newsletter        → wip/react-digest-xxx.md
2. Cursor Chat 提取文章列表      → wip.md（人工挑选）
3. fetch 下载选中的文章          → wip/some-article.md
4. 长文先 split                 → wip/some-article-part1.md ...
5. Cursor Chat 翻译             → 译：某篇文章.md
```

## RSS 源列表

以下是个人订阅的 RSS 源，按领域分类。标注 `*` 的表示 URL 未经验证或无公开 feed。

### 聚合

| 名称 | Feed URL |
|------|----------|
| Hacker News Daily | https://www.daemonology.net/hn-daily/index.rss |

### 提效

| 名称 | Feed URL |
|------|----------|
| 少数派 | https://sspai.com/feed |
| 少数派 - Matrix 社区 | *（包含在主 feed 中，无独立 feed） |
| 少数派会员 | *（需会员，个人专属 URL） |
| Untag | https://rss.utgd.net/feed/ |

### 个人博客

| 名称 | Feed URL |
|------|----------|
| 罗磊 | https://luolei.org/feed/ |
| linux_china（前阿里 Java 大佬） | * |
| Tinyfool | https://codechina.org/feed/ |
| 佐仔志 | https://www.jinbo123.com/feed |
| 土木坛子 | https://tumutanzi.com/feed |
| David Heinemeier Hansson（Rails 作者） | https://world.hey.com/dhh/feed.atom |
| oldj's blog（SwitchHosts 作者） | https://oldj.net/feed |
| Randy's Blog | https://lutaonan.com/rss.xml |
| zu1k | https://zu1k.com/rss.xml |
| Sindre Sorhus | https://sindresorhus.com/feed.xml |
| I'm TualatriX | https://imtx.me/feed/latest/ |

### AI

| 名称 | Feed URL |
|------|----------|
| Ben's Bites | * |

### Rust

| 名称 | Feed URL |
|------|----------|
| Awesome Rust Weekly | https://rust.libhunt.com/newsletter/feed |
| This Week in Rust | https://this-week-in-rust.org/atom.xml |
| Rust weekly newsletter - discu.eu | *（需付费） |

### 前端 - 个人博客

| 名称 | Feed URL |
|------|----------|
| Addy Osmani（Google） | https://addyosmani.com/feed.xml |
| 2ality（Axel Rauschmayer） | https://2ality.com/feeds/posts.atom |
| Anthony Fu | https://antfu.me/feed.xml |
| Bramus（CSS 大佬） | https://www.bram.us/feed/ |
| Christoph Nakazawa（Jest 作者） | https://cpojer.net/rss.xml |
| Daishi Kato（数据流大佬） | https://blog.axlight.com/feed/ |
| Dan Abramov | https://overreacted.io/rss.xml |
| Dave Ceddia | https://daveceddia.com/feed.xml |
| Nadia Makarevich（长文选手） | https://www.developerway.com/rss.xml |
| Frontend Mastery（长文选手） | https://frontendmastery.com/feed.xml |
| Josh W Comeau（长文选手） | https://www.joshwcomeau.com/rss.xml |
| Julia Evans | https://jvns.ca/atom.xml |
| Mark Erikson（Redux 维护者） | https://blog.isquaredsoftware.com/index.xml |
| Lee Robinson（Vercel VP DX） | https://leerob.io/feed.xml |
| Paweł Grzybek | https://pawelgrzybek.com/feed.xml |
| Robin Wieruch（长文选手） | https://www.robinwieruch.de/index.xml |
| Swizec Teller | https://swizec.com/rss.xml |
| SWYX | https://www.swyx.io/rss.xml |
| Li Hau Tan | https://lihautan.com/rss.xml |
| Tania Rascia | https://www.taniarascia.com/rss.xml |
| TkDodo（TanStack Query 维护者） | https://tkdodo.eu/blog/rss.xml |
| TypeOfNaN | https://typeofnan.dev/rss.xml |
| Salma Alam-Naylor | https://whitep4nth3r.com/feed.xml |

### 前端 - 周刊

| 名称 | Feed URL |
|------|----------|
| This Week In React | https://thisweekinreact.com/newsletter/rss.xml |
| Arne's Weekly | https://arne.me/feed.xml |
| Bytes | * |
| MDH Weekly 前端周刊 | https://mdhweekly.com/rss.xml |
| Daily Dev Tips | * |
| Vived | https://vived.substack.com/feed |
| JavaScript Weekly | https://javascriptweekly.com/rss |
| React Digest | * |

### 前端 - 技术产品

| 名称 | Feed URL |
|------|----------|
| Deno | https://deno.com/feed |
| TypeScript | https://devblogs.microsoft.com/typescript/feed/ |
| Vercel | https://vercel.com/atom |
| VS Code | https://code.visualstudio.com/feed.xml |
| GitHub Blog | https://github.blog/feed/ |
| Pnpm | https://pnpm.io/blog/atom.xml |
| Node.js | https://nodejs.org/en/feed/blog.xml |
| Tauri | https://tauri.app/blog/feed.json |
| web.dev | https://web.dev/blog/feed.xml |
| React 官方博客 | *（官方不提供 RSS） |
| Replit | * |

### 其他技术

| 名称 | Feed URL |
|------|----------|
| Changelog | https://changelog.com/feed |
| Bits and Pieces | https://blog.bitsrc.io/feed |
| LogRocket Blog | https://blog.logrocket.com/feed/ |
| RisingStack | https://blog.risingstack.com/rss/ |
| Sidebar | https://sidebar.io/feed.xml |

### Telegram 频道

无原生 RSS，可通过 [RSSHub](https://docs.rsshub.app/routes/social-media#telegram) 生成。

- A 姐分享
- 404 KIDS SEE GHOSTS
- Dejavu's Blog
- Newlearner 的自留地
- PKM - 个人知识管理频道
- 冰器库（Bing's Toolkit）
- 咲奈的平行时空
- 硬核小卒
- 快乐星球

### 微信公众号

无原生 RSS，可通过 [WeRss](https://werss.app/) 或 [RSSHub](https://docs.rsshub.app/routes/new-media#wechat) 生成。

- flomo 浮墨笔记
- L 先生说
- 吴鲁加（知识星球创始人）
- 梁孝永康
- 王建硕
- 前端之巅

### 游戏

| 名称 | Feed URL |
|------|----------|
| 游戏时光 vgtime.com | * |
| 小叽资源 | * |
