# ai-lab

AI Lab - monorepo for all AI-related ideas, experiments, and tools.

## Directory Structure

| Directory | Purpose | Tracked in Git |
|-----------|---------|---------------|
| `apps/` | Full applications (web, desktop, mobile) | Yes |
| `packages/` | Reusable libraries / SDKs | Yes |
| `tools/` | CLI tools | Yes |
| `skills/` | AI skills / prompts | Yes |
| `lab/` | Experiment sandbox | Yes |
| `vendor/` | Third-party repos for analysis | No |
| `playground/` | Local build output verification | No |

## Projects

### tools/

| 名称 | 说明 | 设计文档 |
|------|------|---------|
| [create-lab](tools/create-lab/) | lab 项目脚手架 | - |
| [knowledge-feed](tools/knowledge-feed/) | 自动化知识抓取（RSS + Jina Reader） | [设计](docs/designs/2026-04-08-knowledge-feed.md) \| [计划](docs/plans/2026-04-08-knowledge-feed.md) |

### lab/

| 名称 | 说明 | 设计文档 |
|------|------|---------|
| [news-curator](lab/news-curator/) | 资讯下载 + 长文拆分辅助工具 | [设计](docs/designs/2026-04-08-news-curator.md) \| [计划](docs/plans/2026-04-08-news-curator.md) |

## Getting Started

```bash
# Enable corepack (manages pnpm version automatically)
corepack enable

# Install dependencies
pnpm install

# Build a specific package
pnpm -F create-lab build
pnpm -F knowledge-feed build
pnpm -F news-curator build
```

## Requires

- Node.js >= 24
- pnpm (managed via corepack, no manual install needed)
