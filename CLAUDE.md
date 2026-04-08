# AI Lab

## Guidelines

For trivial tasks, use judgment. Otherwise follow these rules.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## Project

Personal AI experiment monorepo. One repo for all AI-related ideas, tools, and experiments.

## Project Structure

```
apps/        - Full applications (web, desktop, mobile)
packages/    - Reusable libraries / SDKs
tools/       - CLI tools
skills/      - AI skills / prompts (not in workspace)
lab/         - Experiment sandbox (workspace, private: true)
vendor/      - Third-party repos for analysis (not tracked)
playground/  - Local build output verification (not tracked)
docs/        - Design docs and plans
```

## Directory Decision Tree

1. Quick experiment / prototype? -> lab/
2. Imported by other packages? -> packages/
3. Has UI (web/desktop/mobile)? -> apps/
4. CLI tool? -> tools/
5. Pure prompt / AI workflow? -> skills/
6. Unsure? -> lab/ (move later when it matures)

## Tech Stack

- **Runtime:** Node.js >= 24 (managed via `.node-version` + fnm)
- **Package Manager:** pnpm 10 (managed via corepack, `packageManager` field)
- **Language:** TypeScript (tsconfig.base.json at root, each package extends it)
- **Versioning:** release-please (to be introduced at M1 milestone)

## Workspace

- pnpm workspace covers: `tools/*`, `lab/*` (expand as needed)
- `skills/` is NOT in workspace
- `lab/*` projects must have `"private": true`

## Conventions

- Use **conventional commits** (`feat:`, `fix:`, `chore:`, etc.)
- New packages extend `tsconfig.base.json`
- `lab/` experiments: low ceremony, can be discarded
- Graduating from lab: `mv lab/foo tools/foo` + update package name + remove `"private": true`

## Commands

```bash
pnpm install                  # Install all dependencies
pnpm -F <package> build       # Build a specific package
pnpm -F <package> dev         # Dev mode for a specific package
```

## Design Docs

- Architecture: `docs/designs/2026-04-08-monorepo-scaffold.md`
- Plans: `docs/plans/`
