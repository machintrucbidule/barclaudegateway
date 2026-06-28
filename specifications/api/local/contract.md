# BarclaudeGateway Local API ("Layer B") — Contract Specification

**Document version:** 0.2.0
**Spec status:** Draft (foundation + products/search shipped; cart/lists/price-tracking planned)
**Last updated:** 2026-06-28 (BATCH-8 / BL-010 — search + product sheet, DECISION-024)
**Maintainer:** Ivan Calmels

---

## How to use this document

This is the **output** contract: the personal API that BarclaudeGateway *exposes* on the local network so
other devices and apps — notably the **macronome** integration — can query Chronodrive through the gateway
(product, nutrition, price, cart, lists). It is deliberately separate from two other contracts:

- the **upstream** Chronodrive private API we *consume* — [`../chronodrive/contract.md`](../chronodrive/contract.md);
- the **internal UI API** (`/api/*`) the React config/dashboard pages use — typed in
  `@barclaudegateway/shared` (`api/contract.ts`), not specified here.

Why two layers (DECISION-022): the consumed API and the exposed API change for different reasons and have
different audiences; keeping them as separate contracts means a Chronodrive-side change is diffed in one
document and our public surface is frozen in this one.

### Status legend

| Level         | Meaning                                                                |
| ------------- | ---------------------------------------------------------------------- |
| `IMPLEMENTED` | Shipped and tested in the current version.                             |
| `PLANNED`     | Specified here, built in a later batch (see the batch tag).            |

---

## §1 — Transport, prefix and versioning

| Property        | Value                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| Base            | the same Fastify app that serves `POST /v1/scan` and the UI `/api/*` (one origin) |
| Versioned prefix| **`/api/v1`** — distinct from the internal UI `/api/*` and the ESP `POST /v1/scan` |
| Content type    | `application/json` (request + response)                                          |
| Network         | local-only, behind the Cloudflare Tunnel isolation (PROJECT_CONTEXT §Deployment) |

The major version lives in the path (`/api/v1`). A breaking change to this surface introduces `/api/v2`
alongside `v1`; additive changes stay in `v1`. Bump this document's version on every contract change.

---

## §2 — Authentication: `X-API-Key`

Every request to `/api/v1/*` must carry a shared key in the **`X-API-Key`** request header. This is a
lightweight LAN guard, **not** strong auth (DECISION-022): it prevents an accidental local caller from
mutating the cart; it is not a substitute for the Cloudflare Tunnel isolation.

**Key management (DECISION-023, app-managed):**

- The key is **auto-generated on first boot** when none is stored, persisted to the SQLite `config` table
  (`local_api_key`), and surfaced **once** — a `local_api_key_generated` operational-log line (visible on
  the `/logs` "Logs techniques" page) plus a one-line stdout print (grabbable from the container logs).
  Copy it into your client's `X-API-Key` header.
- It is **not editable through the config UI** and is **never returned** by any endpoint (neither Layer B
  nor the internal `GET /api/config`). It is read fresh from config on every request, so a future rotation
  takes effect without a restart.
- A missing, empty, or wrong key → **HTTP 401** (an empty stored key means the surface is locked). The
  comparison is constant-time.

```
GET /api/v1/ping
X-API-Key: <key>
```

---

## §3 — Error model

Non-2xx responses share one secret-free envelope ({@link LocalApiError} in `@barclaudegateway/shared`):

```json
{ "error": "human-readable summary", "code": "machine_code" }
```

| HTTP | `code`          | When                                                            |
| ---- | --------------- | -------------------------------------------------------------- |
| 401  | `unauthorized`  | Missing / wrong / empty `X-API-Key`.                           |
| 404  | `not_found`     | Unknown route under `/api/v1`, or a queried entity not found.  |
| 400  | `bad_request`   | Malformed/invalid request body or query (PLANNED endpoints).   |
| 502  | `upstream_error`| A Chronodrive upstream call failed (PLANNED endpoints).        |

The `error` string is built from safe metadata only — never a token, cookie, password, or the API key
(contract.md §8).

---

## §4 — Observability

Every served `/api/v1/*` request is journalled as an **`api_local`** ("API interne") `LogEvent`
(`type: local_api_request`, BL-009), and every upstream Chronodrive call made to satisfy it is journalled
as a **`chronodrive`** ("API Chronodrive") `LogEvent`. Both are visible and filterable on the `/logs`
page. The `auth_mode` lazy/keep-alive policy (DECISION-021) is preserved: a Layer-B read that needs
Chronodrive triggers an on-demand login in lazy mode, but no new background/polling call runs while idle
(except the BATCH-10 price scheduler, which is itself gated/opt-in).

---

## §5 — Endpoints

### §5.0 `GET /api/v1/ping` — health stub · `IMPLEMENTED` (BATCH-7)

Proves the guard + routing. No Chronodrive call.

```
GET /api/v1/ping            →  200  { "status": "ok", "version": 1 }
(no/!wrong key)             →  401  { "error": "...", "code": "unauthorized" }
```

---

### §5.1 `GET /api/v1/search?q=` — product search · `IMPLEMENTED` (BATCH-8)

Keyword **or** EAN search. Resolves via upstream `GET /v1/products?searchTerm=` (chronodrive §5.13), which
returns full product objects; the local API projects each to a lean **`ProductSummary`** (identity,
`weightKg`, `price`, `stock`/`isEligible`, one `image` URL) — fetch §5.2 for nutrition. Empty `q` →
`400 bad_request`. Requires the upstream **Products** `x-api-key`.

```
GET /api/v1/search?q=mozzarella
→ 200 {
    "products": [ { "id": "91574", "eans": ["3596710335510"], "name": "Mozzarella…",
                    "brand": "AUCHAN", "unitQuantityLabel": "125 g", "weightKg": 0.125,
                    "price": { "default": 1.79, "lastPeriodLowest": 1.79 }, "stock": "HIGH_STOCK",
                    "isEligible": true, "image": "https://static1.chronodrive.com/img/PM/P/0/74/0P_91574.gif" } ],
    "page": { "number": 1, "size": 20, "totalElements": 1, "totalPages": 1, "hasNext": false }
  }
```

### §5.2 `GET /api/v1/products/{eanOrId}` — product sheet · `IMPLEMENTED` (BATCH-8)

The full normalized **`NormalizedProduct`**: identity, `weightKg`, `price` (incl. `lastPeriodLowest`),
`stock`/`remainingStock`/`isEligible`, **`nutrition`** (the essential §5.12.1 set: `energyKj`/`energyKcal`,
`fat`, `saturates`, `carbohydrate`, `sugars`, `fibre`, `protein`, `salt`, `nutriScore`, `allergens`,
`origin`, per the `base` — a field is **absent** when the manufacturer did not declare it), `ingredients`,
and absolute `images` (`thumbnails`/`views`/`zooms`). **Disambiguation:** if `{eanOrId}` is a valid GS1
barcode (`validateEan`) it resolves by EAN via upstream `GET /v1/products?searchTerm=` (§5.13); otherwise it
is treated as a Chronodrive product id via `GET /v1/products/{id}` (§5.12). Not found → `404 not_found`.
Requires the **Products** `x-api-key`.

```
GET /api/v1/products/3596710335510
→ 200 {
    "id": "91574", "eans": ["3596710335510"], "name": "Mozzarella di bufala campana AOP",
    "brand": "AUCHAN", "unitQuantityLabel": "125 g", "weightKg": 0.125,
    "price": { "default": 1.79, "perUnitMeasure": 14.32, "lastPeriodLowest": 1.79, "vatRate": 5.5 },
    "stock": "HIGH_STOCK", "remainingStock": 228, "isEligible": true,
    "nutrition": { "base": "100 g", "energyKcal": 262, "energyKj": 1084, "fat": 23, "saturates": 16,
                   "carbohydrate": 0.7, "sugars": 0.7, "protein": 13, "salt": 0.57, "nutriScore": "C",
                   "allergens": "Contient : Lait", "origin": "ITALIE pour AUCHAN SAS OIA" },
    "ingredients": "Ingrédients : LAIT…",
    "images": { "thumbnails": ["https://static1.chronodrive.com/…"], "views": ["…"], "zooms": ["…"] }
  }
```

> The endpoints below are **`PLANNED`** — specified now so this contract is the single design target;
> the handlers are added per batch. Shapes are normalized DTOs (defined in `@barclaudegateway/shared`),
> built from the upstream sections cited in parentheses.

### §5.3 `GET /api/v1/cart` — read cart · `PLANNED` (BATCH-9)

Normalized cart: line items (product summary + line totals) + cart totals (upstream `amounts`, chronodrive
§5.3/§5.3b).

### §5.4 `POST /api/v1/cart/items` — add/update cart (batch) · `PLANNED` (BATCH-9)

Body: a list of items, each by EAN or id with a **signed delta** quantity (chronodrive §5.4–5.6; `+1`
adds, `-1` removes, `0`/removal empties). Out-of-stock/ineligible items follow the scan rule (lists-only
semantics are a scan concern; here the caller controls the cart explicitly).

### §5.5 `DELETE /api/v1/cart/items/{id}` — remove a cart line · `PLANNED` (BATCH-9)

### §5.6 `GET /api/v1/cart/nutrition` — budget + nutrition aggregate · `PLANNED` (BATCH-9)

Sum of price (€) + macros across the cart (UC10). May also enrich `GET /api/v1/cart`.

### §5.7 `GET /api/v1/lists` · `GET /api/v1/lists/{id}` — read lists · `PLANNED` (BATCH-9)

Upstream chronodrive §5.7–5.11.

### §5.8 `POST|DELETE /api/v1/lists/{id}/items` — list add/remove · `PLANNED` (BATCH-9)

Idempotent add (chronodrive §5.8 / DECISION-019: re-adding is a `204`, quantity unchanged).

### §5.9 `POST /api/v1/recipe-fill` — fill cart/list from a recipe · `PLANNED` (BATCH-9)

Body: a set of EANs/names + a target (cart or list id). Resolves each via §5.1/§5.2 and adds them in one
call. Journalled with a `recipe_fill` event.

### §5.10 `GET|POST|DELETE /api/v1/price-tracking/*` — price tracking · `PLANNED` (BATCH-10)

CRUD over tracked products + per-product thresholds + price history. A gated/opt-in scheduler historises
prices and fires a **secret-free Home-Assistant webhook** on a qualifying drop (reuses the DECISION-014
`HaWebhookNotifier`, once-per-incident cooldown).

---

## §6 — Version history

| Version | Date       | Summary                                                                                     |
| ------- | ---------- | ------------------------------------------------------------------------------------------- |
| 0.2.0   | 2026-06-28 | Products & nutrition (BATCH-8 / BL-010): **§5.1 `GET /search`** and **§5.2 `GET /products/{eanOrId}`** now `IMPLEMENTED` — `ProductSummary` / `NormalizedProduct` + `ProductNutrition` (essential §5.12.1 set), EAN-vs-id disambiguation, absolute image URLs; requires the upstream Products `x-api-key`. |
| 0.1.0   | 2026-06-28 | Foundation (BATCH-7 / BL-008): prefix `/api/v1`, `X-API-Key` guard, error model, `GET /ping` stub, per-request `api_local` logging. All data endpoints (§5.1–§5.10) specified as `PLANNED`. |
