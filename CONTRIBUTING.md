# Contributing to BarclaudeGateway

This is a solo, self-hosted project, but it follows lightweight conventions so the history stays
clean and the release process is predictable. All code, comments, docs and commit messages are
written in **English**.

## Development setup

See [`docs/dev-setup.md`](docs/dev-setup.md). In short: Node 24 LTS + npm, then `npm install` at the
repository root.

## Quality gates

Before pushing, these must pass (CI runs the same on every push and pull request):

```bash
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run build
```

A **pre-commit hook** (Husky + lint-staged) automatically runs ESLint and Prettier on staged
`.ts`/`.tsx` files, so most formatting issues are caught before they ever reach a commit.

## Branch naming

Work happens on short-lived branches off `main`:

| Prefix     | Use for                             | Example                    |
| ---------- | ----------------------------------- | -------------------------- |
| `feature/` | A new capability                    | `feature/chronodrive-auth` |
| `fix/`     | A bug fix                           | `fix/token-refresh-race`   |
| `chore/`   | Tooling, deps, config, housekeeping | `chore/bump-eslint`        |
| `docs/`    | Documentation only                  | `docs/esphome-contract`    |

Use a short, lowercase, hyphenated slug after the prefix.

## Commit messages — Conventional Commits

Messages follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<optional scope>): <short summary in the imperative>
```

Common types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `build`.

Examples:

```
feat(auth): capture the __Host-SESSION cookie from the authorize step
fix(client): use a signed delta quantity for cart mutations
chore(deps): pin vitest to an exact version
ci: run the build step on pull requests
```

## Releasing a version

The application starts at **0.0.1**. Releases are **user-initiated** and driven by a Git tag:

1. Bump the `version` field in the relevant `package.json` file(s) following
   [semantic versioning](https://semver.org/) (e.g. `0.0.1` → `0.0.2`).
2. Commit the bump: `chore(release): v0.0.2`.
3. Create and push the matching tag:

   ```bash
   git tag v0.0.2
   git push origin v0.0.2
   ```

A routine push or pull request only runs the **checks** (lint + tests). Pushing a **`vX.Y.Z` tag**
is what will trigger the Docker image build & publish to GHCR — that workflow is added in **Phase 6**.
Until then, tags simply mark releases.
