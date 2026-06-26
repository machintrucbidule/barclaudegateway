# BarclaudeGateway

Self-hosted middleware that bridges an **ESP32 barcode scanner** (ESPHome) with the **Chronodrive**
private grocery e-commerce API. Scanning an empty product adds it to your Chronodrive cart and/or
shopping lists. A local web UI handles configuration and monitoring.

> ⚠️ **Status:** early development. This is the Phase 1 skeleton — no application features yet.
> See [`specifications/ROADMAP.md`](specifications/ROADMAP.md) for the build plan.

## How it works (target architecture)

```
ESP32 + barcode scanner ──HTTP POST──▶ BarclaudeGateway ──▶ Chronodrive private API
   (ESPHome, LED/buzzer)                 (this app)             (cart & shopping lists)
                                              │
                                              ▼
                                    Local web UI (config, dashboard, live logs)
```

- **Backend:** Node.js / TypeScript
- **Frontend:** React + Vite
- **Storage:** SQLite (credentials encrypted at rest)
- **Deployment:** single Docker container behind a Cloudflare Tunnel (built in Phase 6)

Architecture decisions and rationale live in
[`specifications/decisions.md`](specifications/decisions.md); the living architecture state is in
[`specifications/PROJECT_CONTEXT.md`](specifications/PROJECT_CONTEXT.md).

## Repository layout

This is an **npm-workspaces monorepo**:

```
packages/
  shared/     Contract types shared by the backend and the frontend
  backend/    Node/TS service (auth, token lifecycle, Chronodrive client) — Phase 2+
  frontend/   React + Vite local web UI — Phase 4+
.github/workflows/ci.yml   Checks-only CI (lint + typecheck + tests + build)
docs/dev-setup.md          How to set up the dev environment
```

## Getting started

Prerequisites and the full setup walkthrough are in [`docs/dev-setup.md`](docs/dev-setup.md).
In short, from the repository root:

```bash
npm install        # install all workspaces
npm run lint       # ESLint
npm run typecheck  # TypeScript, no emit
npm run test       # Vitest
npm run build      # build all workspaces
```

To run the frontend dev server: `npm run dev -w @barclaudegateway/frontend`.

## Contributing

Branch naming, commit conventions and the release process are documented in
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## License

[MIT](LICENSE) © Ivan Calmels
