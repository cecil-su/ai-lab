# npm-supply-audit

针对 npm 供应链投毒（Shai-Hulud / Mini Shai-Hulud 等）的本地自查 CLI。

扫描你机器上的 npm/pnpm/yarn/bun lockfile，对照 OSV 恶意包数据库，定位"哪个项目装了恶意版本"。

## 安装

```bash
cargo install --path .
```

会同时装两个等价命令到 `~/.cargo/bin/`（确保该路径在 `PATH` 里）：

- `npm-supply-audit` — 完整名
- `nsa` — 简化短名，下面示例都用这个

或者直接用 `cargo run`：

```bash
cargo run --release -- audit . --only-malicious
```

## 用法

### audit — 扫描项目

```bash
# 日常体检：只看真投毒（推荐起点，~30s）
nsa audit . --only-malicious

# 完整漏洞扫描（含 GHSA CVE，慢，2-3 分钟）
nsa audit .

# 不联网快速排查（只看 lockfile + IOC + Claude hooks）
nsa audit . --offline

# JSON 输出，给 CI / 脚本消费
nsa audit . --json
```

路径可以是单项目，也可以是装着多个项目的父目录——会递归找所有 lockfile，每个项目分开报告。

### diff — 只扫 git diff 引入的新包

适合挂到 pre-commit hook 或 PR CI gate，把恶意包拦在合入主线之前。

```bash
# 默认对比 HEAD~1，只扫这次 commit 新增/升级的包
nsa diff

# 显式指定 base ref
nsa diff origin/main
nsa diff HEAD~5 --only-malicious
```

比起每次跑全量 audit（7000+ deps、2-3 分钟），diff 通常只扫 5-50 个新引入的包，秒级。

### --suspicious-publishing — 维护者爆发式发布检测（实验性）

OSV `MAL-*` 公告是事后通报，从攻击发生到录入有几小时空窗期。这个 flag 直接看 npm registry 上的发布行为本身：**同一维护者在很短时间内发布大量包**是 Shai-Hulud 类攻击的稳定指纹（AntV 5-19 那波：314 包 / 22 分钟）。

```bash
# 默认窗口 30 min、阈值 10 distinct packages
nsa audit . --suspicious-publishing

# 调阈值（在含多个被劫持维护者包的项目里灵敏度更高）
nsa audit . --suspicious-publishing --burst-threshold 5 --window-minutes 60

# 配合 diff，PR gate 里检查"新引入的包是不是在 burst 期发的"
nsa diff --suspicious-publishing --burst-threshold 5
```

**maintainer 反查**：lockfile 里通常只有同维护者的少数几个包（比如 atool 5-19 那波 314 个里你只装了 3 个），单看 lockfile 凑不够阈值。本工具会对"跨 scope 但还没到阈值"的可疑维护者做反查——通过 npm `search?text=maintainer:<name>` 拉出该账号名下全部包补进时间线，再跑 burst 检测。所以默认阈值 10 也能命中只装了 3 个包的项目。单 scope 维护者（rollup、esbuild 这类 monorepo + 平台二进制）不反查，避免噪声。

### explain — 查 OSV 公告详情

```bash
nsa explain MAL-2026-3849
nsa explain GHSA-qcp2-qp9h-qprg
```

输出 affected 版本精确列表 + references + 攻击细节，用来确认你的命中是不是真投毒。

## 输出示例

```
== npm-supply-audit report ==

28 lockfile(s) scanned, 7745 unique deps across all projects

Projects with issues (2):

[ALERT] .\NrsAms\yarn.lock  (2576 deps, 1 hit(s))
        - @antv/adjust@0.3.5  MAL-2026-3849  Malicious code in @antv/adjust (npm)

Clean projects (26):
  - .\other-project\pnpm-lock.yaml (1024 deps)
  ...

[OK]    No known IOC files under scan path
[OK]    Claude Code hooks configuration looks clean
```

## 退出码

| 码 | 含义 |
|---|---|
| 0 | 干净 |
| 2 | 发现恶意包 / IOC 文件 / 可疑 hooks |
| 1 | 工具本身报错（网络、解析等） |

写脚本用：

```bash
nsa audit . --only-malicious
if [ $? -eq 2 ]; then
  echo "Supply-chain alert!"
  exit 1
fi
```

## 支持的 lockfile

| 格式 | 状态 |
|---|---|
| `pnpm-lock.yaml`（v6–v9） | ✓ |
| `package-lock.json`（npm v6 / v7+） | ✓ |
| `yarn.lock`（v1 经典 + berry v2+） | ✓ |
| `bun.lock`（JSONC 含 trailing commas） | ✓ |

**pnpm workspace**：根 lockfile 覆盖所有子包，安全检测 100% 覆盖；目前不解析 `importers:` 段，命中无法定位到具体子包。

## 工作原理

1. **递归找 lockfile**（跳过 `node_modules` / `.git` / `target` / `dist` / `build`）
2. **解析依赖**：从每种 lockfile 抽出 `(package, version)` 列表
3. **批量查 OSV**：`POST /v1/querybatch`，1000 个 / 批
4. **本地版本精确匹配**：OSV `querybatch` 对 `MAL-*` 公告不按版本过滤，会无脑返回所有版本。本工具拉 `/v1/vulns/{id}` 详情后比对 `affected[].versions`，过滤误报
5. **取证扫描**：找 IOC 文件（`router_runtime.js` / `setup.mjs` 等）、检查 `~/.claude/settings.json` 的 hooks 配置

## 关于误报

- `fs@0.0.1-security`：npm 官方反 typo-squatting 占位包，OSV 真把它标了 `MAL-`，属已知误报，可忽略
- 老版本被新 `MAL-` 公告误标：本工具已通过本地版本匹配过滤（v0.1.0 起）

不确定某条命中真假？用 `nsa explain <ID>` 看公告原文的 affected 列表。

## 限制

- 仅 npm 生态（Rust crates / Python PyPI 不在范围）
- yarn berry 的非 `npm:` protocol（`patch:` / `workspace:` / `portal:` 等）被跳过，符合预期
- 没有 semver range 匹配——OSV 详情给精确 `versions:` 列表时精确匹配；只给 `ranges:` 时保守认为命中

## 构建与测试

```bash
cargo build --release
cargo test
```

## 数据源

- [OSV.dev](https://osv.dev/) — npm 恶意包（`MAL-*`）与 GHSA 公告
- 内置 IOC 文件名清单（来源：Snyk、StepSecurity、Unit42、Microsoft Security Blog 关于 Shai-Hulud / Mini Shai-Hulud 的报告）
