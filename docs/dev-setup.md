# Development environment setup

The project is developed on **Windows 11**. Docker is **not** used during development — it is only a
release artifact built by CI on a version tag (Phase 6). Everything below uses the npm toolchain.

## Required tools

| Tool       | Version used      | Why                                                  |
| ---------- | ----------------- | ---------------------------------------------------- |
| Node.js    | 24 LTS (≥ 24.0.0) | Runtime for the backend and the build/test toolchain |
| npm        | ≥ 11              | Package manager + workspaces (bundled with Node 24)  |
| Git        | ≥ 2.40            | Version control                                      |
| GitHub CLI | ≥ 2.x (`gh`)      | Create the repo, watch CI runs                       |

> The repository pins these in `package.json` (`engines`) and enforces them via `.npmrc`
> (`engine-strict=true`): an install will refuse to run on an unsupported Node/npm version.

### Verify your versions

```bash
node --version   # v24.x
npm --version    # 11.x
git --version    # 2.x
gh --version     # 2.x
```

### Installing / updating

- **Node.js 24 LTS** — download from <https://nodejs.org/> (the "LTS" installer ships npm 11), or use
  a version manager such as [`fnm`](https://github.com/Schniz/fnm) / `nvm-windows`.
- **Git** — <https://git-scm.com/download/win>.
- **GitHub CLI** — `winget install GitHub.cli`, then `gh auth login`.

## First-time install

From the repository root:

```bash
npm install
```

This installs all three workspaces (`shared`, `backend`, `frontend`) and sets up the Husky
pre-commit hook (via the `prepare` script).

## Everyday commands

All commands run from the repository root and cover every workspace:

```bash
npm run lint         # ESLint across the monorepo
npm run format       # Prettier — rewrite files
npm run format:check # Prettier — verify only (used in CI)
npm run typecheck    # TypeScript project references, no emit issues
npm run test         # Vitest (backend + frontend)
npm run build        # Build all workspaces
```

Run a single workspace with `-w`, e.g.:

```bash
npm run dev   -w @barclaudegateway/frontend   # Vite dev server
npm run test  -w @barclaudegateway/backend    # backend tests only
```

## Editor

Any editor honouring `.editorconfig` and ESLint/Prettier works. For VS Code, the recommended
extensions are **ESLint** (`dbaeumer.vscode-eslint`) and **Prettier** (`esbenp.prettier-vscode`);
enable "format on save" for the smoothest experience.

## What is intentionally NOT here

- **No Docker / Dockerfile** — added in Phase 6; never built or tested on Windows.
- **No GHCR credentials** — added in Phase 6.
- **No application code yet** — this is the Phase 1 skeleton.
