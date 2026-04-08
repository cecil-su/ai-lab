# AI Lab Monorepo Scaffold - Phase 0 实现计划

**目标:** 搭建 monorepo 最小可用脚手架，能 `pnpm install` 并开始开发 create-lab
**架构:** pnpm workspace monorepo，root 配置 + tools/create-lab 项目骨架。vendor/ 和 playground/ 通过 .gitignore 排除。
**技术栈:** Node >= 24, pnpm 10.33.0, TypeScript
**设计文档:** docs/designs/2026-04-08-monorepo-scaffold.md
**新增依赖:** typescript（devDep，MIT）
**测试模式:** 非 TDD（纯脚手架，无业务逻辑）

---

### Task 1: 创建 .node-version 和 .gitignore  ✅

**文件:**
- 创建: `.node-version`
- 创建: `.gitignore`

**Step 1: 创建 .node-version**

```
24
```

**Step 2: 创建 .gitignore**

```gitignore
# Dependencies
node_modules/

# Build output
dist/

# Environment
.env
.env.*
!.env.example

# OS
.DS_Store
Thumbs.db

# IDE
.idea/
.vscode/
*.swp
*.swo

# Temporary directories (not tracked)
vendor/
playground/

# Lab common ignores
*.bin
*.onnx
*.safetensors
```

**Step 3: 验证**
运行: `cd /d/Workspace/ai/ai-lab && fnm use && node --version`
预期: `v24.x.x`

---

### Task 2: 创建 root package.json  ✅

**文件:**
- 创建: `package.json`

**Step 1: 创建 package.json**

```json
{
  "name": "ai-lab",
  "version": "0.0.0",
  "private": true,
  "description": "AI Lab - monorepo for AI experiments and tools",
  "packageManager": "pnpm@10.33.0",
  "engines": {
    "node": ">=24",
    "pnpm": ">=10"
  }
}
```

**Step 2: 验证**
运行: `cat package.json | node -e "const p=require('fs').readFileSync('/dev/stdin','utf8'); const j=JSON.parse(p); console.log(j.packageManager, j.engines.node)"`
预期: `pnpm@10.33.0 >=24`

---

### Task 3: 创建 pnpm-workspace.yaml  ✅

**文件:**
- 创建: `pnpm-workspace.yaml`

**Step 1: 创建 pnpm-workspace.yaml**

```yaml
packages:
  - "tools/*"
  - "lab/*"
```

Phase 0 只声明 tools/ 和 lab/。apps/ 和 packages/ 在对应项目出现时再追加。

**Step 2: 验证**
运行: `pnpm ls --json 2>/dev/null || echo "OK - no packages yet"`
预期: 空 workspace 或错误（因为还没有子包），不报 yaml 格式错误

---

### Task 4: 创建 tsconfig.base.json  ✅

**文件:**
- 创建: `tsconfig.base.json`

**Step 1: 创建 tsconfig.base.json**

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2024",
    "module": "Node16",
    "moduleResolution": "Node16",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

**Step 2: 验证**
运行: `node -e "JSON.parse(require('fs').readFileSync('tsconfig.base.json','utf8')); console.log('valid JSON')"`
预期: `valid JSON`

---

### Task 5: 创建 tools/create-lab 项目骨架  ✅

**文件:**
- 创建: `tools/create-lab/package.json`
- 创建: `tools/create-lab/tsconfig.json`
- 创建: `tools/create-lab/src/index.ts`

**Step 1: 创建 tools/create-lab/package.json**

```json
{
  "name": "create-lab",
  "version": "0.0.0",
  "description": "Scaffold CLI for ai-lab monorepo",
  "type": "module",
  "bin": {
    "create-lab": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "keywords": ["cli", "scaffold", "monorepo"],
  "license": "MIT",
  "devDependencies": {
    "typescript": "^5.8.0"
  }
}
```

**Step 2: 创建 tools/create-lab/tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

**Step 3: 创建 tools/create-lab/src/index.ts**

```typescript
#!/usr/bin/env node
console.log("create-lab: scaffold CLI for ai-lab monorepo")
```

**Step 4: 验证**
运行: `pnpm install && pnpm -F create-lab build && node tools/create-lab/dist/index.js`
预期: `create-lab: scaffold CLI for ai-lab monorepo`

---

### Task 6: 更新 README.md  ✅

**文件:**
- 修改: `README.md`

**Step 1: 更新 README.md**

简要说明项目用途、目录结构、快速开始。内容从设计文档的背景和目录决策树提炼。

关键段落：
- 项目简介（一句话）
- 目录结构概览（7 个目录 + 用途）
- 快速开始（clone → corepack enable → pnpm install）

**Step 2: 验证**
运行: `head -3 README.md`
预期: 包含 `# ai-lab` 和项目描述

---

### Task 7: 最终验证 + 提交  ⬜

**Step 1: 全量验证**
运行:
```bash
# 确认目录结构
ls -la
ls tools/create-lab/src/

# 确认 pnpm workspace 正常
pnpm install
pnpm -F create-lab build
node tools/create-lab/dist/index.js

# 确认 .gitignore 生效
mkdir -p vendor playground
touch vendor/test playground/test
git status  # vendor/ 和 playground/ 不应出现
```

预期:
- `pnpm install` 成功
- `create-lab build` 成功
- `node dist/index.js` 输出预期文本
- `git status` 中不出现 vendor/ 和 playground/

**Step 2: 提交**
```bash
git add .
git commit -m "feat: scaffold monorepo Phase 0 structure

- Add root workspace config (pnpm + Node 24 + TypeScript)
- Add tools/create-lab project skeleton
- Add .gitignore with vendor/ and playground/ exclusion
- Add .node-version for fnm/nvm auto-switch"
```
