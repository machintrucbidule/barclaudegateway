# BarclaudeGateway

Self-hosted middleware that bridges an **ESP32 barcode scanner** (ESPHome) with the **Chronodrive**
private grocery e-commerce API. Scanning an empty product adds it to your Chronodrive cart and/or
shopping lists. A local web UI handles configuration and monitoring.

> **Status:** the scanner→cart/list bridge, the web UI, and the local **"Layer B" query API** (products,
> nutrition, cart, lists, recipe-fill, price tracking) are built and tested. The Layer-B epic ships as a
> single **0.3.0** release, cut when the maintainer decides. State:
> [`specifications/PROJECT_CONTEXT.md`](specifications/PROJECT_CONTEXT.md).

## How it works (target architecture)

```
ESP32 + barcode scanner ──HTTP POST──▶ BarclaudeGateway ──▶ Chronodrive private API
   (ESPHome, status LED)                 (this app)             (cart & shopping lists)
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

## Local API (Layer B)

Beyond the scanner bridge, the gateway exposes a **local query API** under `/api/v1/*` so other
devices/apps (notably a macronome integration) can search products, read nutrition, manage the cart and
lists, fill from a recipe, and track prices through Chronodrive. It is guarded by a single **`X-API-Key`**
(auto-generated; shown read-only in **Config → API locale**, regenerable there). The scanner ingestion is
part of it too: `POST /api/v1/scan`. Full contract:
[`specifications/api/local/contract.md`](specifications/api/local/contract.md). Firmware-facing scan
contract: [`docs/esphome-contract.md`](docs/esphome-contract.md).

> Stability policy (DECISION-027): the exposed contracts (Layer-B, the UI `/api/*`, the ESP scan) are
> stability-first — upstream Chronodrive changes are absorbed in the gateway's wiring, not by changing the
> exposed API; breaking changes only when unavoidable and after a clear heads-up.

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
