# Phase 7 — End-to-end validation & hardening report

> Campaign run on 2026-06-27 against the published image deployed on the homelab Portainer stack.
> The system under test is `ghcr.io/machintrucbidule/barclaudegateway:0.0.2` deployed via
> [`deploy/stack.yml`](../../deploy/stack.yml) (Watchtower-enabled, named `appdata` volume,
> `restart: unless-stopped`), reached over the LAN on the host-published port.
>
> Scope was agreed with the operator: the ESP32 module had not yet arrived, so the rich
> `ScanResponse` states were proven with direct `POST /v1/scan` calls instead of a physical scan.
> Real ESP32 LED/buzzer validation is deferred and tracked as **[BL-001]** in
> [`specifications/BACKLOG.md`](../../specifications/BACKLOG.md).
>
> The barcodes used for the live scans were one-time values valid only on the test day and are
> deliberately **not recorded here**.

---

## 1. Deploy & end-to-end smoke

Deployed the real Portainer stack with `BCG_TAG=0.0.2`, a freshly generated `BCG_MASTER_KEY`
(kept off-repo), and a rarely-used host port.

### 1a. First run, before any credentials (DECISION-016)

| Check                  | Expected                                | Observed                                                       | Result |
| ---------------------- | --------------------------------------- | -------------------------------------------------------------- | ------ |
| SPA loads              | UI served by the single Fastify process | Dashboard loads                                                | ✅     |
| `GET /livez`           | 200                                     | `200`                                                          | ✅     |
| `GET /api/health`      | `configured:false`, no upstream call    | `{"ok":false,"configured":false,"checks":[],"apiVersions":{}}` | ✅     |
| Dashboard              | informational "configure me" card       | info card shown, **no** red maintenance banner                 | ✅     |
| `GET /api/error-state` | `{active:false}`                        | `{"active":false}`                                             | ✅     |

The empty `checks` array confirms **no upstream call is made before configuration** — an unconfigured
install reads as information, not a failure.

### 1b. After saving credentials (write-only)

Credentials entered on the Config page. The live Chronodrive self-test then passed end to end:

| Check                  | Observed                                                               | Result |
| ---------------------- | ---------------------------------------------------------------------- | ------ |
| `GET /api/health`      | `ok:true`, `configured:true`, dynamic `siteId` detected                | ✅     |
| Customer profile       | `GET /customers/me` → ok                                               | ✅     |
| EAN search             | `GET /search-suggestions` → ok (resolved a known product, in stock)    | ✅     |
| Active cart            | `GET /customers/me/carts` → ok                                         | ✅     |
| Shopping lists         | `GET /shopping-lists` → ok                                             | ✅     |
| Write-only credentials | `GET /api/config` returns only `credentials.set:true`, **no password** | ✅     |

Observed `x-api-version` values matched the contract — **no Chronodrive drift** (contract.md §7).

### 1c. The three `ScanResponse` states (live `POST /v1/scan`)

Destinations enabled for the test: cart + one shopping list.

| Target state          | Observed                                                                                                | HTTP | Result |
| --------------------- | ------------------------------------------------------------------------------------------------------- | ---- | ------ |
| `added`               | in-stock, eligible product → cart `written` + list `written`                                            | 200  | ✅     |
| `added_to_lists_only` | `NO_STOCK` product → cart `skipped_unavailable` (`out_of_stock`), list `written`, `reason:out_of_stock` | 200  | ✅     |
| `not_found`           | 12-digit input normalized to EAN-13 (leading zero), not in catalogue → `not_found`                      | 200  | ✅     |

Confirmed behaviours:

- **CLARIFY-08**: an unavailable product goes to lists only, **never the cart**.
- **UPC-A → EAN-13 normalization** works and resolves to `not_found` (not `invalid_ean`).
- Business outcomes return **HTTP 200**, per the ESPHome contract.
- The scan journal persisted all three (`/api/scans` → `count:3`), confirming the SSE/journal path.

**Deferred:** physical LED/buzzer feedback on the ESP32 (no module yet) — see **[BL-001]**.

---

## 2. Security & secret review

### 2a. Source-level evidence

| Property                       | Evidence                                                                                                                                               | Result |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Credentials encrypted at rest  | `storage/credentials.ts`: AES-256-**GCM**; a wrong key fails the auth tag and **throws** (never returns garbage); plaintext only transient in memory   | ✅     |
| Credentials write-only         | `http/apiRoutes.ts`: `PUT /credentials` returns only `{set:true}`; no route serializes the password                                                    | ✅     |
| HA webhook payload secret-free | `health/haWebhook.ts`: payload = source/severity/category/endpoint/message/apiVersion/at/test only                                                     | ✅     |
| Secrets never logged           | Chronodrive client never logs the bearer token; **every log record is now deep-redacted** via `redactLogObject` wired into the Fastify logger (see §4) | ✅     |
| No secret baked in the image   | `.dockerignore` excludes `.env*`, `*.sqlite`, `.git`; `Dockerfile` sets no secret ENV and copies no secret                                             | ✅     |

### 2b. Container-level evidence

| Property            | Evidence (running container)                                                                            | Result |
| ------------------- | ------------------------------------------------------------------------------------------------------- | ------ |
| Runs non-root       | `id` → `uid=1000(node) gid=1000(node)`                                                                  | ✅     |
| `/data` permissions | `ls -la /data` → directory and `barclaudegateway.sqlite` owned by `node`                                | ✅     |
| Local-only posture  | No application auth by design; reachable only on the LAN behind the Cloudflare Tunnel (PROJECT_CONTEXT) | ✅     |

### 2c. Finding (fixed this phase)

`redactSecrets` was implemented and unit-tested but **wired into no log path**, and a comment in
`http/errors.ts` overstated reality. No active leak existed (headers/bodies were never logged), but
the guarantee rested on "never log the wrong object." **Fixed in v0.0.3** (see §4).

---

## 3. Resilience & recovery

Agreed set: container restart + image update (DB persistence). Other failure modes (absent/wrong
master key, upstream down) are covered by the existing unit suite and by the GCM fail-closed design,
and were not exercised live.

| Test                        | Expected                                              | Observed                                                             | Result |
| --------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------- | ------ |
| **Container restart**       | config + scan journal survive (same container)        | `credentials.set:true`, `count:3`, destinations intact, `/livez` 200 | ✅     |
| **Image update (Recreate)** | DB persists across a brand-new container (Watchtower) | after recreate: `credentials.set:true`, `count:3`, `configured:true` | ✅     |

State survives both a restart and a full container recreation because the only state lives on the
`appdata` named volume — exactly what a Watchtower auto-update does.

### Backup finding (doc fix)

The DB runs in **SQLite WAL mode**: `/data` contains `barclaudegateway.sqlite` **plus** `-wal` and
`-shm` files, and recent writes live in `-wal` until checkpointed. Copying only the `.sqlite` file
would lose recent data. [`docs/deployment.md`](../deployment.md) was corrected with a WAL-safe
backup/restore procedure.

---

## 4. Fix shipped (v0.0.3)

**Wire `redactSecrets` as a central log filter + correct the misleading comment.**

- `logging/redact.ts`: new `redactLogObject(record)` helper.
- `ingest/server.ts`: Fastify logger configured with `formatters.log: redactLogObject`, so every log
  record (headers, bodies, serialized errors — present or future) is deep-redacted centrally.
- `http/errors.ts`: comment corrected to describe the real mechanism.
- `logging/redact.test.ts`: added a request-shaped log-record redaction test.

All gates green: lint · format · typecheck · test (153) · build. Releases as image **v0.0.3**,
published by CI when the `v0.0.3` tag is pushed (the fix is in the working tree; publish + redeploy
are the one remaining step).

---

## Outcome

End-to-end on the real deployment and the real Chronodrive API, the system behaves as specified:
the unconfigured first-run is informational, configuration brings it online, the three scan states
are correct, secrets are never exposed or logged, the container runs non-root, and state survives
both restart and image update. The one finding (unwired redaction) was hardened in v0.0.3, and the
backup docs were corrected for WAL mode. Remaining item: physical ESP32 validation (**[BL-001]**),
deferred until the module arrives.
