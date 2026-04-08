# AI Lab Monorepo Scaffold

**日期:** 2026-04-08

## 背景

需要一个 GitHub monorepo 来记录和承载所有 AI 相关的想法和产出，包括 web app、CLI 工具、桌面软件、AI skills、随手实验等。要求可落地、可扩展，支持多种技术栈，同时具备自动化版本管理和发布能力。

## 讨论

### 探索的方案

**方案 A：按类型分区** — 目录按 `apps/`、`packages/`、`tools/`、`skills/` 分类。直觉清晰但缺少低门槛实验入口，且边界有时模糊。

**方案 B：按成熟度分区** — `lab/`（实验）和 `projects/`（正式）两层。实验零摩擦，但「毕业」需搬迁目录，按成熟度分不如按类型分直观。

**方案 C（最终选择）：类型 + 成熟度混合** — 方案 A 的分类 + 方案 B 的 lab 区。兼顾灵活和规范。

**方案 X（激进）：Turborepo + 自动分类** — 所有项目元数据驱动，CI 根据元数据自动决定策略。有趣但现阶段过度工程。

### 关键决策

- 项目是混合节奏的：有快速原型也有长期维护的工具/app
- 不限制技术栈，JS/TS 为一等公民，其他语言（Python、Rust 等）享受目录组织 + release-please 原生发版支持
- 发布目标多样：npm、GitHub Releases、仅打 tag
- 第一个项目是 `tools/create-lab` 脚手架 CLI

### 发版工具选型：release-please > changesets

经两轮评审对比，选择 **release-please** 而非 changesets：

| 维度 | changesets | release-please（选中） |
|------|-----------|----------------------|
| 日常摩擦 | 每次变更需 `pnpm changeset` | 零额外步骤，conventional commit 前缀即可 |
| 非 JS 项目 | 需 dummy package.json + 同步脚本 | 原生支持 18+ 语言（一行 `release-type` 配置） |
| GitHub Releases + artifacts | 间接，需额外编排 | 天然契合，`release_created` output 直接触发构建 |
| 渐进式引入 | 需修改项目文件 | 只加 2 个 JSON + 1 个 workflow，不改项目代码 |
| 一人团队适配 | 为多人协作设计，仪式感重 | conventional commit 即声明，AI 辅助编程下几乎无感 |

**落地策略：** 现阶段不引入任何发版工具。从第一天起养成 conventional commits 习惯（零成本），等第一个包真正需要发版时花 15 分钟加 release-please，用 `bootstrap-sha` 截断历史。

### lab/ 设计修订：加入 workspace

原设计中 lab/ 不参与 workspace，导致"零门槛实验"与"不能复用共享代码"矛盾。修订为：

- **lab/ 加入 pnpm workspace**，项目标记 `"private": true`
- 可正常 `import` workspace 内其他包的共享代码
- 纯非 JS 实验（如 Python 脚本）不需要 package.json，pnpm 会自动忽略
- 毕业路径：`mv lab/foo tools/foo` + 改 name + 删 private，四步原子操作

## 方案

采用**方案 C：类型 + 成熟度混合**，渐进式落地。

### 终态目录结构

```
ai-lab/
├── apps/                    # 完整应用（web、desktop、mobile）
├── packages/                # 可复用库/SDK
├── tools/                   # CLI 小工具
│   └── create-lab/          # 第一个项目：脚手架 CLI
├── skills/                  # AI skills/prompts（不参与 workspace）
├── lab/                     # 实验沙盒（workspace 内，private: true）
├── vendor/                  # 临时拉取的第三方库，分析和测试用（不提交）
├── playground/              # 自己项目的运行/构建产出验证（不提交）
├── docs/
│   └── designs/
├── .github/
│   └── workflows/
│       ├── ci.yml           # PR 检查（lint/test，路径过滤）
│       └── release.yml      # release-please 自动发版
├── .node-version            # 24（fnm/nvm 自动切换）
├── release-please-config.json
├── .release-please-manifest.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── eslint.config.js
├── .prettierrc
├── .npmrc
├── package.json             # root：脚本 + devDeps + engines
└── README.md
```

### Phase 0 实际文件（第一天）

```
ai-lab/
├── .gitignore
├── .node-version              # "24"
├── package.json               # root workspace
├── pnpm-workspace.yaml        # packages: ["tools/*", "lab/*"]
├── tsconfig.base.json         # 基础 TS 配置
├── tools/
│   └── create-lab/            # 第一个项目骨架
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           └── index.ts
├── docs/
│   └── designs/
│       └── 2026-04-08-monorepo-scaffold.md
└── README.md
```

CI、lint、prettier、release workflow —— 全部延后，按里程碑触发引入。

### 运行环境

| 工具 | 版本 | 管理方式 |
|------|------|----------|
| Node.js | >= 24 (LTS) | `.node-version` + `engines` |
| pnpm | 10.33.0 | `packageManager` 字段 + corepack |

### 目录决策树

新项目放哪？按顺序匹配第一个符合的：

```
1. 快速实验/原型/一次性脚本？ → lab/
2. 被其他项目 import？ → packages/
3. 有 UI 界面（web/desktop/mobile）？ → apps/
4. 命令行工具？ → tools/
5. 纯 prompt/AI workflow/agent skill？ → skills/
6. 纠结？ → lab/（先放实验区，成熟了再搬）
```

**补充规则：**
- `skills/` vs `packages/`：只有 prompt 文本 + 配置 → skills/；包含运行时代码 → packages/
- `tools/` vs `apps/`：无持久进程 → tools/；有持久进程（server/GUI）→ apps/

### 版本与发布策略

使用 release-please 独立版本模式，基于 conventional commits 自动管理。

| 类型 | 版本管理 | 发布目标 | release-type |
|------|----------|----------|-------------|
| `packages/*` | release-please | npm registry | `node` |
| `tools/*` | release-please | npm / GitHub Releases | `node` |
| `apps/*` (JS) | release-please | GitHub Releases + artifacts | `node` |
| `apps/*` (Rust) | release-please | GitHub Releases + binary | `rust` |
| `apps/*` (Python) | release-please | GitHub Releases | `python` |
| `skills/*` | 无 | 不发布 | — |
| `lab/*` | 无 | 不发布（`private: true`） | — |

### 发布流程（M1 引入后）

1. 日常用 conventional commit 格式提交（`feat:`, `fix:`, `chore:` 等）
2. release-please bot 自动维护一个始终打开的 Release PR，随每次推送更新
3. 准备发版时，合并 Release PR
4. 合并后 release-please 自动创建 git tag + GitHub Release
5. 后续 job 根据 `release_created` output 执行对应发布（npm publish / 构建二进制 / 上传 artifact）

### release-please 配置（M1 引入时）

```jsonc
// release-please-config.json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    "tools/create-lab": {
      "release-type": "node",
      "component": "create-lab"
    }
    // 新包加入时在这里追加
  }
}
```

```jsonc
// .release-please-manifest.json
{
  "tools/create-lab": "0.0.0"
  // 新包加入时在这里追加
}
```

### CI 策略（M2 引入后）

- `ci.yml`：PR 触发，初期跑全量 lint/test（项目少时全量比路径过滤更简单可靠）
- `release.yml`：main 分支触发，release-please 自动化发版
- 项目 >= 5 个且 CI 超过 5 分钟时，引入路径过滤或 Turborepo

## 渐进式里程碑

| 里程碑 | 触发条件 | 引入什么 | 收益 |
|--------|----------|----------|------|
| **M0 能开发** | 第一天 | root 配置 + create-lab 骨架 | 能 `pnpm install`、能写代码 |
| **M1 能发布** | 第一个包要 npm publish | release-please + release.yml | conventional commits 自动生成版本和 changelog |
| **M2 能质控** | 第二个项目加入 / 有人提 PR | ci.yml + eslint + prettier + .npmrc | PR 自动检查，代码风格统一 |
| **M3 能规模化** | 项目 >= 5 / 构建变慢 | Turborepo (turbo.json) | 构建缓存，不重复跑 |

**原则：每个里程碑的引入物都是前一个里程碑的"痛点解"，不是"预防性投资"。**

## 约束与非功能需求

- **JS/TS 一等公民**：通过 pnpm workspace 管理依赖和构建。其他语言享受目录组织 + release-please 原生发版支持，CI 按需单独配置
- **lab/ 低门槛**：加入 workspace 但 `private: true`，可复用共享代码；纯非 JS 实验不需要 package.json
- **渐进式**：按触发条件引入能力，不按时间线。第一天只需能开发
- **Conventional Commits**：从第一天养成，作为 changelog 和版本管理的基础
- Node.js 20 将于 2026-04-30 EOL，已排除

## 架构

### Root 配置

- `pnpm-workspace.yaml`：声明 workspace 范围 `["apps/*", "packages/*", "tools/*", "lab/*"]`（按需扩展，Phase 0 只有 `["tools/*", "lab/*"]`）
- `package.json`：`engines` 锁定 Node/pnpm 版本，`packageManager` 精确锁定 pnpm
- `.node-version`：fnm/nvm 自动切换
- TypeScript：root 放 `tsconfig.base.json`，各包 extends（M0 引入）
- ESLint / Prettier：root 统一配置，各包可覆盖，ignore 非 workspace 目录（M2 引入）
- `.npmrc`：pnpm 行为配置（M2 引入）

### 目录分类总览

| 目录 | 用途 | 参与 workspace | 提交到 git |
|------|------|---------------|-----------|
| `apps/` | 完整应用（web/desktop/mobile） | 是 | 是 |
| `packages/` | 可复用库/SDK | 是 | 是 |
| `tools/` | CLI 小工具 | 是 | 是 |
| `skills/` | AI skills/prompts | 否 | 是 |
| `lab/` | 实验沙盒 | 是（private: true） | 是 |
| `vendor/` | 临时拉取的第三方库，分析测试用 | 否 | 否 |
| `playground/` | 自己项目的运行/构建产出验证 | 否 | 否 |

### 项目生命周期

两种路径都合法：

```
路径 A（目标清晰时）：
  直接创建到 apps/ | tools/ | packages/ → 开发 → 发版

路径 B（探索阶段）：
  lab/（实验，private: true）
    ↓ 成熟后
  mv 到 apps/ | tools/ | packages/（改 name + 删 private）
    ↓
  加入 release-please 配置 → 自动版本管理和发布
```

### 待后续设计

- `tools/create-lab` 脚手架 CLI 的具体设计（模板、交互流程、promote 命令）
- 跨包依赖管理（`packages/*` 之间互相引用的约定）
- 包命名 scope 策略（`@ai-lab/*` vs 无 scope）
- `skills/` 的内容约定（格式、目录结构）
