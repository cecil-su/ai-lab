# roundtable CLI — 实施计划

依赖顺序:store → adapters → engine → 命令面 → TUI → 真实模型冒烟。每步有独立验证,失败不进入下一步。

## 进度(2026-07-29 暂停点)

- ✅ 步骤 1–3 完成并通过 trellis-check(修复 2 处:JSONL 半行容错、移除超设计的 round_start 事件;21 单测全绿;doctor 四家检出)。
- ✅ 步骤 4(四家真实适配器 + smoke)完成(2026-07-30):四家 smoke 全绿,记忆续接全部跑通。exec.ts 统一子进程层;codex resume 改 `-c sandbox_mode`;reasonix 会话定位摸清(diff sessions 目录取绝对路径,直跑 node bin 绕 GBK)。sessionRef 字段与命令已回填 design.md §3。32 单测全绿。待 trellis-check。
- ✅ 步骤 5(引擎+命令面)完成:runner 回合循环/暂停恢复/loop guard,new/list/continue/stop/show --follow,mock e2e 全绿。
- ✅ 步骤 6(debate + 裁决轮)完成:mode 策略单文件分派,裁决人新会话不污染立场,verdict + summary;补齐开题 seq-1 system 事件。
- ✅ 步骤 7(视角模板库)完成:6 个内置模板(architect/security/cost/ux/redteam/pragmatist),charter 测试锁住;53 单测全绿。
- ✅ 步骤 8(Ink TUI)完成:Windows 跑通无需降级;id 竞争选方案①(attach 写锁,零改 store);61 单测全绿。⚠️ 真机键盘交互(useInput)在非 TTY 子代理环境用 isRawModeSupported 守卫 + 程序化模拟验证,真实终端敲键待用户/步骤 9 确认。
- ✅ 步骤 9(精简真实冒烟,用户选)完成:claude+codex roundtable 2 轮,第 2 轮两家均引用对方第 1 轮观点=会话续接跨轮真实生效;list/json/continue 守卫/summary.md 全部正确。暂停/恢复由 mock e2e 覆盖(provider 无关),真实 token 未再验;完整四家/debate/attach 真机键盘留用户手动。成本观察:codex 单话题 input ~16 万 token(基线注入大),claude 仅 7.6k。
- ✅ 步骤 10(README)完成:命令/flag 全部对着源码核过。
- 🏁 全部 10 步实现完成,61 单测 + typecheck 全绿,真实链路冒烟通过。待收尾:spec 更新(可选)、commit(需用户授权)、finish-work。
- 已知环境事实:claude 已升至 2.1.220;本机 reasonix 双装(npm 1.8.0-rc.1 为正)。

## 检查清单

1. **脚手架**:`lab/agent-roundtable/` 建包(`"private": true`,bin `roundtable`,tsx/tsc,vitest,Ink 依赖);pnpm workspace 已覆盖 `lab/*` 无需改根配置。
   - 验证:`pnpm install && pnpm -F agent-roundtable typecheck`
2. **store 层**:topic.json 状态机、transcript.jsonl 追加/seq/读取/tail 订阅、inbox.jsonl、runner.lock(死 pid 接管)。
   - 验证:vitest 单测(seq 连续性、并发 tail、锁接管);`pnpm -F agent-roundtable test`
3. **adapter 契约 + mock + doctor**:types.ts、mock.ts(脚本化发言)、`roundtable doctor`(四家 detect + 版本)。
   - 验证:`roundtable doctor` 本机输出与调研版本一致
4. **四家真实 adapter**:claude/codex/opencode/reasonix 的 speak + sessionRef 捕获;每家一个集成 smoke 脚本(单次真实调用 + 一次续接调用,验证记忆延续)。⚠️ 本步消耗少量真实 token;codex thread id 与 reasonix 会话路径的捕获字段在此步实测确认并回填 design.md 表格。
   - 验证:`pnpm -F agent-roundtable smoke:adapters`(逐家可跳过缺失 CLI)
5. **引擎 roundtable 模式 + 核心命令**:runner 回合循环、prompt 组装(charter/立场摘要/上一轮全文)、SIGINT 优雅暂停;`new`(向导 + flags)、`list`、`continue`、`stop`、`show [--follow --json]`(纯流式,兼作 TUI 保底与调试通道)。
   - 验证:mock provider e2e——开题→2 轮→Ctrl+C 暂停→continue→跑完→transcript 断言(vitest);`roundtable list --json` 结构断言
6. **debate 模式 + 裁决轮 + summary.md**:对抗指令注入、裁决者新会话、verdict 事件、loop guard(立场行连续重复提前收尾)。
   - 验证:mock e2e:辩论 3 轮 + 裁决轮 + summary.md 生成断言
7. **视角模板 + charter 生成**:6 个内置模板、自由文本、charter.md 渲染。
   - 验证:单测(模板注入的 prompt 快照)
8. **attach TUI(Ink)**:History/StatusBar/InputBox、transcript+inbox 合并订阅、插话、`:stop`、退出不影响 runner。
   - 验证:mock runner 跑长讨论,attach 实时跟随 + 插话下一轮生效 + 退出重进(人工验证脚本 `smoke:tui`);Windows Terminal 下过一遍
9. **真实模型冒烟(验收对齐)**:四终端 debate 一题,≥2 轮 + 裁决;中途暂停/恢复;attach 插话被回应;记录 token/耗时到冒烟报告。
   - 验证:prd Acceptance Criteria 逐条勾对
10. **README**:安装、快速开始、命令参考、已知限制(前台模型、Windows 终端要求)。

## 验证命令汇总

```powershell
pnpm -F agent-roundtable typecheck
pnpm -F agent-roundtable test
pnpm -F agent-roundtable smoke:adapters   # 消耗真实 token,逐家可跳
pnpm -F agent-roundtable smoke:e2e        # mock,零成本
```

## 风险文件与回滚点

- 全部改动限于 `lab/agent-roundtable/`(新目录),不触碰仓库既有代码;回滚 = 删目录。
- 步骤 4 是最大不确定点(session 引用捕获);若某家无法可靠续接,降级策略:该家以"无记忆参与者"加入(每轮全量投喂立场摘要),在 doctor 与 charter 中注明。
- 步骤 8 若 Ink 在 Windows 不可用,保底交付 `show --follow` + `say` 命令组合,TUI 顺延 v2(需回报用户)。

## task.py start 前检查

- [x] prd.md 收敛(无 Open Questions)
- [x] design.md / implement.md 就绪
- [ ] implement.jsonl / check.jsonl 已策展(非 _example)
- [ ] 用户对最终规划摘要明确批准
