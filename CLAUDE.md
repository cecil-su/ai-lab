# AI Lab

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
