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

## Getting Started

```bash
# Enable corepack (manages pnpm version automatically)
corepack enable

# Install dependencies
pnpm install

# Build a specific package
pnpm -F create-lab build
```

## Requires

- Node.js >= 24
- pnpm (managed via corepack, no manual install needed)
