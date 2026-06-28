# Chronodrive Private API — Contract Specification

**Document version:** 1.5.0
**Spec status:** Draft
**Last full verification:** 2026-06-26 (re-verified live 2026-06-27, Phase 7 — confirmed endpoints unchanged, `x-api-version` values identical; product/cart surface extended 2026-06-28 from a browser HAR — see 1.5.0)
**Auth flow live-verified:** 2026-06-26 — full login (Steps 1+2+3) **and** silent refresh (Steps 2+3) executed end-to-end against production by the middleware (not just a browser HAR).
**Primary source:** HAR captures from browser session (Firefox 152, authenticated) + live middleware run
**Maintainer:** Ivan Calmels

---

## How to use this document

This spec is a **living contract**. Chronodrive operates a private, undocumented API; it will change without notice. This document exists to:

1. Record exactly what was observed and when.
2. Distinguish confirmed behavior from inferred behavior.
3. Provide a structured diff target when something breaks — update the spec, then update the implementation.

### Confidence levels

| Level        | Meaning                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIRMED`  | Directly observed in a captured HAR. Request + response body on record.                                                                                 |
| `INFERRED`   | Not captured, but strongly implied by related data (OPTIONS headers, symmetric patterns, REST conventions). Must be validated before use in production. |
| `UNKNOWN`    | Gap in knowledge. Do not implement until captured.                                                                                                      |
| `DEPRECATED` | Was confirmed, no longer works. Kept for historical reference.                                                                                          |

### Verification procedure

Before each release cycle, run the **verification checklist** (see §6). If any endpoint returns an unexpected status or schema, mark it `BROKEN`, capture a new HAR, diff against this spec, open a patch issue, update this document, then update the implementation. Bump the document version each time a confirmed endpoint changes.

### Source traceability

Each endpoint entry references the HAR session that confirmed it. Keep HAR archives (sanitized: passwords and tokens redacted) alongside this document in version control.

---

## Changelog

| Version | Date       | Summary                                                                                                                                                                                              |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.5.0   | 2026-06-28 | **Product/cart surface extended** from a browser HAR (2 product sheets + non-empty cart). New endpoints: **§5.12** `GET /v1/products/{id}` (full product sheet — nutrition, ingredients, allergens, origin, images, packaging **weight**, prices incl. `lastPeriodLowestPrice`), **§5.13** `GET /v1/products?searchTerm=` (rich paginated search returning full product objects), **§5.14** `GET /v1/products?ids=` (batch), **§5.3b** `GET /v1/customers/me/carts/extended`. New **Products** `x-api-key` (§3.1). New **§5.12.1 nutrition code map** (INFERRED). Patches to existing entries: **§5.1** search-suggestions now returns the full product object (nutrition + weight + full prices), **§5.3** documents the non-empty cart schema (items + expanded amounts), **§5.4** response gains `requestedCompleteAnimation`. Product image host `static1.chronodrive.com` (§1). CMS endpoints noted as ignored (§6). |
| 1.4.3   | 2026-06-27 | §5.8 list add: duplicate add CONFIRMED **idempotent** — re-adding a product already in the list returns the same `204 No Content` and leaves the quantity unchanged, so the response is **indistinguishable** from a fresh add (membership must be read via §5.10). Captured by a live middleware probe (not a HAR), BL-005. |
| 1.4.2   | 2026-06-26 | §3 data-API `Origin`/`Referer` note downgraded INFERRED → CONFIRMED: `api.chronodrive.com` `/v1/search-suggestions` exercised live by the middleware with the headers present (`ingest:smoke`, Phase 3) → 200. Whether the data API would reject a call *without* them is still untested (the middleware always sends them, so enforcement is moot). |
| 1.4.1   | 2026-06-26 | Auth §2 live-verified by the middleware. Two corrections: (1) `/identity` + `/oauth/*` require `Origin`/`Referer` headers (else 400 "No origin or referer retrieved"); (2) Step 1 sets the initial Reach5 session cookie that must be forwarded to Step 2. Silent refresh now CONFIRMED live, not just inferred from the JWT. |
| 1.4.0   | 2026-06-26 | Auth §2: full session cookie mechanism documented. Refresh flow confirmed (Steps 2+3 only, no password, using \_\_Host-SESSION). Session TTL: 72h. No remaining gaps.                                |
| 1.3.0   | 2026-06-26 | §5.7 get shopping lists: CONFIRMED. §5.11 get single list: new CONFIRMED endpoint. All MVP endpoints now confirmed. Only token refresh remains unknown (non-blocking).                               |
| 1.2.0   | 2026-06-26 | §5.5+5.6 cart update/remove: CONFIRMED, unified endpoint with signed quantity delta. §5.5 and §5.6 collapsed. Known gaps: only §5.7 (get shopping lists) and token refresh endpoint remain.          |
| 1.1.0   | 2026-06-26 | §5.9 remove from list: CONFIRMED. §5.10 get list contents: new CONFIRMED endpoint. stock enum: NO_STOCK confirmed. Token refresh existence confirmed (auth_type:refresh in JWT). Known gaps updated. |
| 1.0.0   | 2026-06-26 | Initial capture. Auth flow, search, cart add, list add confirmed. Remove endpoints inferred, not yet captured.                                                                                       |

---

## §1 — Base URLs

| Service            | Base URL                          | Protocol        |
| ------------------ | --------------------------------- | --------------- |
| Chronodrive API    | `https://api.chronodrive.com/v1`  | HTTPS / HTTP2   |
| Reach5 Identity    | `https://connect.chronodrive.com` | HTTPS / HTTP1.1 |
| Static media (CDN) | `https://static1.chronodrive.com` | HTTPS           |
| Analytics (ignore) | `https://metrics.chronodrive.com` | —               |

> **Product images (CONFIRMED 1.5.0):** product image paths in API responses are **relative** (e.g.
> `img/PM/P/0/74/0P_91574.gif`). The absolute URL is `https://static1.chronodrive.com/` + path. Image
> kinds: `thumbnails` (small `.gif`), `views` (`.gif`), `zooms` (large `.jpg`). Path pattern embeds the
> product id and its last two digits (`…/P/0/74/0P_91574.gif` for product `91574`). No auth/api-key
> needed for the static host.

The API gateway is **Gravitee** (header `x-gravitee-transaction-id` present on all responses). Cloudflare sits in front (`cf-ray` headers, `__cf_bm` cookie). No hard anti-bot measures observed as of 2026-06-26; `__cf_bm` is emitted automatically and does not require interaction.

---

## §2 — Authentication

**Source:** HAR `www_chronodrive_com_Archive_26-06-26_13-08-58.har` (login flow)
**Status:** `CONFIRMED`

The authentication is a **Reach5 PKCE Authorization Code flow**, executed as three HTTP calls. No browser required — the `response_mode=web_message` mode returns the authorization code inline in an HTML body, parseable without rendering.

### 2.0 — Stateless-client requirements (added 1.4.1, live-verified)

A browser carries two things implicitly that a stateless HTTP client must reproduce, or the flow fails. Both were discovered when the middleware ran the flow for the first time (2026-06-26):

1. **`Origin` + `Referer` headers are mandatory on `connect.chronodrive.com` calls.** Without them, `GET /oauth/authorize` returns **HTTP 400** with body `No origin or referer retrieved`. Send `Origin: https://www.chronodrive.com` and `Referer: https://www.chronodrive.com/` (the `redirect_uri` origin) on Steps 1, 2 and 3. (Step 1 happens to succeed without them, but send them everywhere for safety.)
2. **Step 1 sets the initial Reach5 session cookie, which Step 2 needs.** `POST /identity/v1/password/login` returns `Set-Cookie` headers in addition to the `tkn`. These cookies must be forwarded in the `Cookie` header of the Step 2 `GET /oauth/authorize` request — `prompt=none` relies on that session existing. A stateless client that captures only the `tkn` (and drops the cookies) gets a 400.

With both in place, the full login **and** the cookie-only silent refresh were confirmed working live against production.

### 2.1 — Parameters

| Parameter      | Value                                                  | Notes                                                                                                 |
| -------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `client_id`    | `DrJyWDmbpV6yYP8ndN8m`                                 | Hardcoded in Chronodrive frontend JS. Static.                                                         |
| `redirect_uri` | `https://www.chronodrive.com`                          | Must match exactly.                                                                                   |
| `scope`        | `openid profile email phone full_write offline_access` | `offline_access` is declared but **refresh_token was not observed in the token response** (see §2.4). |

### 2.2 — Step 1: Password login

```
POST https://connect.chronodrive.com/identity/v1/password/login
Content-Type: application/json

{
  "client_id": "DrJyWDmbpV6yYP8ndN8m",
  "scope": "openid profile email phone full_write offline_access",
  "email": "<user_email>",
  "password": "<user_password>"
}
```

**Response 200:**

```json
{ "tkn": "<opaque_token>" }
```

The `tkn` is a short-lived Reach5 session token used to complete the PKCE flow. Its TTL is unknown; treat as single-use.

> **CONFIRMED (1.4.1) — Step 1 also sets cookies.** The response carries `Set-Cookie` headers establishing the initial Reach5 session. **Capture them and forward them in the `Cookie` header of the Step 2 request** (see §2.0), otherwise Step 2 fails with a 400. Also send `Origin`/`Referer` on this call.

### 2.3 — Step 2: Authorization code

Generate a PKCE pair before this call:

- `code_verifier`: 32 cryptographically random bytes, base64url-encoded (no padding)
- `code_challenge`: SHA-256 of the raw `code_verifier` bytes, base64url-encoded

```
GET https://connect.chronodrive.com/oauth/authorize
  ?client_id=DrJyWDmbpV6yYP8ndN8m
  &response_type=code
  &response_mode=web_message
  &prompt=none
  &redirect_uri=https://www.chronodrive.com
  &scope=openid%20profile%20email%20phone%20full_write%20offline_access
  &nonce=<random_integer>
  &persistent=true
  &code_challenge=<base64url_sha256_of_verifier>
  &code_challenge_method=S256
  &tkn=<tkn_from_step_1>
```

**Required headers (CONFIRMED 1.4.1):**

```
Origin: https://www.chronodrive.com
Referer: https://www.chronodrive.com/
Cookie: <cookies set by Step 1>          ; on initial login
Cookie: __Host-SESSION=...; __Host-SESSION_LEGACY=...   ; on silent refresh
```

Omitting `Origin`/`Referer` → **HTTP 400 `No origin or referer retrieved`**. Omitting the Step-1 cookies on initial login → 400 as well (`prompt=none` has no session to silently authorize).

**Response 200** — HTML body containing an inline script:

```html
<script>
  window.parent.postMessage(
    {
      type: 'authorization_response',
      response: { code: '<authorization_code>' },
    },
    'https://www.chronodrive.com',
  );
</script>
```

Parse the `code` value from this HTML with a regex or HTML parser. Do not render in a browser.

### 2.4 — Step 3: Token exchange

```
POST https://connect.chronodrive.com/oauth/token
Content-Type: application/json
Origin: https://www.chronodrive.com
Referer: https://www.chronodrive.com/

{
  "client_id": "DrJyWDmbpV6yYP8ndN8m",
  "grant_type": "authorization_code",
  "code_verifier": "<verifier_from_step_2>",
  "code": "<code_from_step_2>",
  "redirect_uri": "https://www.chronodrive.com"
}
```

**Response 200:**

```json
{
  "id_token": "<JWT>",
  "access_token": "<JWT>",
  "expires_in": 7200,
  "token_type": "Bearer"
}
```

> **CONFIRMED — Session cookie mechanism, no refresh_token.** The Reach5 platform does not issue a `refresh_token` in the response body. Instead, Step 2 (`GET /oauth/authorize`) sets two HttpOnly session cookies on `connect.chronodrive.com`:
>
> | Cookie                  | TTL           | Notes                                                                               |
> | ----------------------- | ------------- | ----------------------------------------------------------------------------------- |
> | `__Host-SESSION`        | 259200s (72h) | Primary session cookie. Must be stored after Step 2 and sent on refresh calls.      |
> | `__Host-SESSION_LEGACY` | 259200s (72h) | Identical value, no `SameSite=None`. Kept for browser compat; send both on refresh. |
>
> **Refresh flow (every ~2h, no password required) — CONFIRMED LIVE (1.4.1):** Re-execute Step 2 and Step 3 only, omitting Step 1. Send the stored `__Host-SESSION` and `__Host-SESSION_LEGACY` cookies in the `Cookie` header of the Step 2 request (plus `Origin`/`Referer`). A successful Step 2 returns a new authorization code; exchange it via Step 3 for a new `access_token`. This was exercised end-to-end by the middleware on 2026-06-26 and works — previously only inferred from the JWT `auth_type:refresh` claim.
>
> **Session expiry:** If Step 2 returns a `login_required` error (session > 72h old), fall back to full 3-step login (Step 1+2+3 with credentials).
>
> **`auth_type` values observed in JWT payloads:** `password` (after Step 1 login) vs `refresh` (after silent Step 2 refresh using session cookie).

The `access_token` JWT is used as the `Authorization: Bearer` value on all Chronodrive API calls. The `id_token` is used to populate the `chronosession` cookie on the frontend; the backend middleware only needs `access_token`.

**Token lifetime:** `expires_in: 7200` (2 hours). The `exp` claim in the JWT payload is authoritative. Refresh at `exp - 60s`.

---

## §3 — Common Request Headers

These headers appear on most API calls. Per-endpoint variations are noted in §5.

| Header                    | Value                         | Required                      |
| ------------------------- | ----------------------------- | ----------------------------- |
| `Authorization`           | `Bearer <access_token>`       | Always                        |
| `Content-Type`            | `application/json`            | Always                        |
| `x-device-type`           | `WEB`                         | Always                        |
| `x-api-key`               | See §4                        | Per service                   |
| `x-chronodrive-site-id`   | `1016` (Toulouse Basso Cambo) | On cart/list/search endpoints |
| `x-chronodrive-site-mode` | `DRIVE`                       | On cart/list/search endpoints |

> **`Origin`/`Referer` (CONFIRMED for `api.chronodrive.com`, 1.4.2):** the `connect.chronodrive.com` auth endpoints **require** them (§2.0). For the data API, the middleware exercised `/v1/search-suggestions` live end-to-end on 2026-06-26 (`ingest:smoke`, Phase 3) with `Origin: https://www.chronodrive.com` + `Referer: https://www.chronodrive.com/` present, and it returned 200 — so the data API **accepts** the call with them. Whether it would *reject* a call without them was not tested (the middleware always sends them, so enforcement is moot). The middleware sends them on all calls.

### 3.1 — x-api-key mapping

The gateway uses **different static API keys per service**. These are embedded in the frontend JS bundle and have not been observed to rotate since initial capture.

| Service                | x-api-key                              | Endpoints                                                                 |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------- |
| Search                 | `49a29e90-6842-4b90-8d09-07222f40b3ed` | `/v1/search-suggestions`                                                  |
| Products               | `34bfe4e1-82d1-458a-9a51-61198fff84b3` | `/v1/products/{id}`, `/v1/products?searchTerm=…`, `/v1/products?ids=…`    |
| Customer & Cart (read) | `c5e1b8ce-3a98-4871-842d-b7a60922ba97` | `/v1/customers/me`, `/v1/customers/me/carts`, `/v1/customers/me/settings` |
| Cart (write)           | `3f796a97-e16a-4f3f-bd29-9523c7f28edb` | `POST /v1/carts/{cartId}/items`                                           |
| Shopping lists         | `92f00545-3e4b-4d33-94d1-f535e934cece` | `/v1/shopping-lists/*`                                                    |

> **Products key added 1.5.0** — the product detail/search/batch endpoints (`/v1/products*`) use a
> distinct key from the lightweight `/v1/search-suggestions` autocomplete. Same rotation risk applies
> (§3.1 risk note): a Products-key rotation breaks only the `/v1/products*` calls.

> **Risk:** These keys are static application credentials, not user tokens. If Chronodrive rotates them (e.g. after a frontend deploy), all calls using the old key will return 401 or 403. Detection: start seeing 401s after a working session. Mitigation: re-extract from the JS bundle (search for the UUID pattern in `_nuxt/*.js`).

---

## §4 — Store Context

The `x-chronodrive-site-id` is per-user and tied to the user's preferred drive. It is returned by `/v1/customers/me` in the `lastVisitedSite.id` field.

| Field       | Value   | Notes                                                            |
| ----------- | ------- | ---------------------------------------------------------------- |
| `site_id`   | `1016`  | Toulouse Basso Cambo. Fetch dynamically from `/v1/customers/me`. |
| `site_mode` | `DRIVE` | Always `DRIVE` for drive orders.                                 |

---

## §5 — Endpoint Catalog

### 5.1 — Resolve EAN to product

**Status:** `CONFIRMED` — HAR `2026-06-26-search.har`

```
GET /v1/search-suggestions?searchTerm={ean}
x-api-key: 49a29e90-6842-4b90-8d09-07222f40b3ed
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

**Response 200:**

```json
{
  "keywords": ["<ean>"],
  "products": [
    {
      "id": "2555",
      "labels": {
        "productLabel": "Gros sel de mer",
        "brandLabel": "LA BALEINE",
        "unitQuantityLabel": "1 kg",
        "ticketLabel": "LA BALEINE: Gros sel iodé bte"
      },
      "eans": ["3183280000933"],
      "prices": { "defaultPrice": 0.79 },
      "remainingStock": 30,
      "stock": "HIGH_STOCK",
      "isEligible": true,
      "maxCartQuantity": 999,
      "trackingCode": "<opaque>"
    }
  ],
  "categories": []
}
```

Key fields: `products[0].id` (Chronodrive internal product ID), `products[0].isEligible` (false = unavailable at this drive), `products[0].stock` (`HIGH_STOCK` | `LOW_STOCK` | `OUT_OF_STOCK` — exact values not exhaustively confirmed).

Returns empty `products[]` if EAN not found in catalogue. Returns `isEligible: false` if product exists but is unavailable at the requested `site_id`.

> **PATCH 1.5.0 — schema is richer than the abbreviated example above.** As re-observed in the
> 2026-06-28 HAR, each `products[]` entry is the **full product object** (the same shape as the §5.12
> product sheet): it also carries `characteristics` (`features[]` = coded nutrition — see §5.12.1 —
> `ingredients`, `origin`), `packaging` (incl. **`weight`**), `flags`, `images`, `descriptions`,
> `complementaryProducts` / `substitutionProducts`, and the **full `prices`** block
> (`pricePerUnitMeasure`, `lastPeriodLowestPrice`, `vatRate`, `depositPrice`). Version unchanged
> (`x-api-version: 1.38.1`) — the original example was simply incomplete. So a single
> `GET /v1/search-suggestions?searchTerm={ean}` already returns nutrition + weight; the §5.13
> `GET /v1/products?searchTerm=` endpoint returns the same product shape with pagination + facets.

---

### 5.2 — Get customer profile

**Status:** `CONFIRMED` — HAR `2026-06-26-page-load.har`

```
GET /v1/customers/me
x-api-key: c5e1b8ce-3a98-4871-842d-b7a60922ba97
```

Returns customer ID, email, `lastVisitedSite` (use to derive `site_id` dynamically), order statistics.

---

### 5.3 — Get active cart

**Status:** `CONFIRMED` — HAR `2026-06-26-page-load.har`

```
GET /v1/customers/me/carts?withCoupons=true
x-api-key: c5e1b8ce-3a98-4871-842d-b7a60922ba97
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

**Response 200:**

```json
{
  "content": [
    {
      "id": "5808b118-43f0-4d9d-84f7-ca06c21f90e1",
      "items": [],
      "amounts": { "totalCartAmount": 0, "totalOrderAmount": 0 },
      "isOrdered": false
    }
  ]
}
```

The active cart is `content[0]` where `isOrdered: false`. The cart `id` (UUID) is stable across sessions for a given account. Cache it; re-fetch only if a 404 is received on a cart write.

> **PATCH 1.5.0 — non-empty cart schema (HAR 2026-06-28).** The example above is an *empty* cart. A
> populated cart's `content[0]` has these fields: `id`, `items[]`, `amounts{}`, `coupons{content:[]}`,
> `hasUnavailableProducts`, `unlockedLoyaltyBenefit`, `isOrdered`.
>
> **Each line item** (`items[]`):
>
> ```json
> {
>   "quantity": 1,
>   "wishedQuantity": 1,
>   "clientOrigin": "",
>   "isGift": false,
>   "product": { /* full §5.12 product sheet, plus per-line price fields: */
>     "prices": { "...": "...", "totalAmount": 2.19, "totalDepositAmount": 0 },
>     "maxCartQuantity": 999,
>     "family": { "id": 635 },
>     "associatedProducts": []
>   }
> }
> ```
>
> **`amounts{}`** (cart totals — useful for a budget view):
>
> ```json
> {
>   "totalCartAmount": 10.51,
>   "totalOrderAmount": 10.51,
>   "totalCartAmountWithoutDiscount": 10.51,
>   "totalDiscountAmount": 0,
>   "totalDepositAmount": 0,
>   "totalAdditionalCostsAmount": 0,
>   "totalLoyaltyEarnedAmount": 0.16,
>   "totalCouponLoyaltyEarnedAmount": 0,
>   "totalLoyaltyBurntAmount": 0,
>   "totalCreditsAmount": 0,
>   "loyaltiesDonation": [],
>   "additionalCosts": []
> }
> ```
>
> So a single `GET /v1/customers/me/carts?withCoupons=true` yields the full cart (line items with the
> complete product sheet, line totals, and cart-level totals) — enough for a "current cart" + budget
> aggregate without extra calls. `x-api-version: 1.9.0` (unchanged).

---

### 5.3b — Get active cart (extended, with delivery fees)

**Status:** `CONFIRMED` — HAR `www.chronodrive.com_Archive [26-06-28 13-06-29].har`

```
GET /v1/customers/me/carts/extended?withCoupons=true&withDeliveryFees=true
x-api-key: c5e1b8ce-3a98-4871-842d-b7a60922ba97
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

Same response shape as §5.3 (incl. the non-empty schema above). The `extended` variant additionally
resolves **delivery fees** into the `amounts`/`additionalCosts` when a delivery mode applies; in
`DRIVE` mode with no delivery selected, the two responses are identical. `x-api-version: 1.9.0`.

---

### 5.4 — Add item to cart

**Status:** `CONFIRMED` — HAR `2026-06-26-add-to-cart.har`

```
POST /v1/carts/{cartId}/items
x-api-key: 3f796a97-e16a-4f3f-bd29-9523c7f28edb
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE

{
  "content": [
    {
      "clientOrigin": "WEB|ARBO|{id}",
      "productId": "2555",
      "quantity": 1
    }
  ],
  "optimizedMode": true
}
```

The `clientOrigin` field is a tracking string. The literal value `"WEB|ARBO|{id}"` (with `{id}` unsubstituted) was observed in production and accepted without error. It can safely be hardcoded as-is.

Multiple products can be batched in the `content` array.

**Response 200:**

```json
{
  "content": [
    {
      "productId": "2555",
      "quantity": 1,
      "wishedQuantity": 1,
      "remainingStock": 30,
      "requestedQuantity": 1,
      "returnType": "SUCCESS"
    }
  ]
}
```

`returnType` must equal `"SUCCESS"`. Other observed values: unknown — treat anything else as an error.

> **PATCH 1.5.0 (HAR 2026-06-28):** each response `content[]` item also carries a boolean
> **`requestedCompleteAnimation`** (observed `false`) alongside the documented fields. It relates to
> the promotional "animation" block (§5.12) and is not needed for the add/remove decision — ignore it.
> The request body (`clientOrigin: "WEB|ARBO|{id}"`, `optimizedMode: true`, signed `quantity`) is
> unchanged and was re-confirmed. `x-api-version: 1.9.0`.

If `quantity` exceeds `maxCartQuantity`, behavior is unknown (not captured).

---

### 5.5 & 5.6 — Update cart item quantity / Remove item from cart

**Status:** `CONFIRMED` — HAR `2026-06-26-cart-quantity.har`

Cart mutations are **unified on a single endpoint** using signed quantities. There is no separate update or delete endpoint.

```
POST /v1/carts/{cartId}/items
x-api-key: 3f796a97-e16a-4f3f-bd29-9523c7f28edb
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE

{
  "content": [
    {
      "clientOrigin": "WEB|ARBO|{id}",
      "productId": "400863",
      "quantity": -1
    }
  ],
  "optimizedMode": true
}
```

**Quantity semantics — relative delta, not absolute value:**

| `quantity` value | Effect                                |
| ---------------- | ------------------------------------- |
| `+N` (positive)  | Add N units to current quantity       |
| `-N` (negative)  | Remove N units from current quantity  |
| Result reaches 0 | Product is removed from cart entirely |

This applies to §5.4 (add) as well: `quantity: 1` always means "add 1 more", not "set to 1".

**Observed sequences:**

- Cart at 0, POST `quantity: 1` → quantity becomes 1
- Cart at 1, POST `quantity: 1` → quantity becomes 2 (`requestedQuantity: 1`, `quantity: 2` in response)
- Cart at 2, POST `quantity: -1` → quantity becomes 1 (`requestedQuantity: -1`, `quantity: 1`)
- Cart at 1, POST `quantity: -1` → quantity becomes 0 (`requestedQuantity: -1`, `quantity: 0`) → product absent from next GET cart

**Response 200 when quantity > 0:**

```json
{
  "content": [
    {
      "productId": "400863",
      "quantity": 1,
      "wishedQuantity": 1,
      "remainingStock": 48,
      "requestedQuantity": -1,
      "returnType": "SUCCESS"
    }
  ]
}
```

**Response 200 when quantity reaches 0 (removal):**

```json
{
  "content": [
    {
      "productId": "400863",
      "quantity": 0,
      "wishedQuantity": 0,
      "remainingStock": 48,
      "requestedQuantity": -1,
      "returnType": "SUCCESS"
    }
  ]
}
```

The optional `minimalQuantity` field (observed when a promotional pack applies) is not required for standard add/remove operations.

To remove an item entirely in one call without knowing the current quantity: POST `quantity: -999` (or any sufficiently negative number — the API appears to floor at 0). Not yet explicitly tested; the safe approach is to read the current quantity first and POST the negative delta.

---

### 5.7 — Get shopping lists

**Status:** `CONFIRMED` — HAR `2026-06-26-get-lists.har`

```
GET /v1/shopping-lists?page=1&size=20
x-api-key: 92f00545-3e4b-4d33-94d1-f535e934cece
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

**Response 200:**

```json
{
  "content": [
    {
      "id": "223e153d-3919-4b4e-ab60-dff0011bf94f",
      "name": "Temp prochaine courses",
      "nbItems": 26,
      "hasAvailableProduct": true,
      "createdAt": "2025-03-22T15:58:49.295Z",
      "updatedAt": "2026-06-26T11:18:44.598Z"
    },
    {
      "id": "18a227d5-9002-4981-a6ca-0cec12a90456",
      "name": "Classiques",
      "nbItems": 191,
      "hasAvailableProduct": true,
      "createdAt": "2025-03-22T15:53:27.362Z",
      "updatedAt": "2026-04-13T10:11:24.562Z"
    }
  ],
  "page": {
    "size": 2,
    "totalElements": 2,
    "totalPages": 1,
    "number": 1,
    "hasNext": false,
    "hasPrevious": false,
    "isEmpty": false
  }
}
```

Pagination is 1-indexed; `size=20` is the default frontend value. `nbItems` is the total count of products in the list. `hasAvailableProduct` reflects whether at least one item is in stock at the current drive.

The list UUID is **stable** (created date from 2025 — unchanged across sessions). Fetching at startup and caching is the correct approach; re-fetch only if a list operation returns 404.

**Known lists as of 2026-06-26:**

| UUID                                   | Name                   | Items |
| -------------------------------------- | ---------------------- | ----- |
| `223e153d-3919-4b4e-ab60-dff0011bf94f` | Temp prochaine courses | 26    |
| `18a227d5-9002-4981-a6ca-0cec12a90456` | Classiques             | 191   |

---

### 5.11 — Get single shopping list

**Status:** `CONFIRMED` — HAR `2026-06-26-get-lists.har`

```
GET /v1/shopping-lists/{listId}
x-api-key: 92f00545-3e4b-4d33-94d1-f535e934cece
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

**Response 200:**

```json
{
  "id": "223e153d-3919-4b4e-ab60-dff0011bf94f",
  "name": "Temp prochaine courses",
  "nbItems": 22,
  "hasAvailableProduct": true,
  "createdAt": "2025-03-22T15:58:49.295Z",
  "updatedAt": "2026-06-26T11:18:44.598Z"
}
```

Useful for verifying a cached list UUID is still valid without fetching the full product list. The `nbItems` count updates in real time after add/remove operations.

---

### 5.8 — Add item to shopping list

**Status:** `CONFIRMED` — HAR `2026-06-26-add-to-list.har`

```
PATCH /v1/shopping-lists/{listId}
x-api-key: 92f00545-3e4b-4d33-94d1-f535e934cece
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE

{
  "objectsToAdd": [
    { "productId": "2555", "quantity": 1 }
  ]
}
```

**Response: 204 No Content.**

**Duplicate add is idempotent — CONFIRMED (1.4.3, live probe 2026-06-27).** Re-adding a product that is
already in the list returns the **same `204 No Content`**, and the product's quantity **stays unchanged**
(it does not increment). The response is therefore **indistinguishable** from a fresh add — there is no
status code or body field that signals "already present". To know whether a product is already on a list,
read the list contents first (§5.10). Capture source: `packages/backend/scripts/probe-duplicate-add.mjs`
(EAN `3495562466000` → product `451343`, list `223e153d-…`: baseline absent → add → `204`, qty 1 →
second add → `204`, qty still 1 → state restored).

> **Contrast with the cart (§5.4–5.6):** the cart uses a **signed delta**, so a cart re-add is _not_
> idempotent — it increments the quantity by the posted amount. List add and cart add differ here.

---

### 5.9 — Remove item from shopping list

**Status:** `CONFIRMED` — HAR `2026-06-26-remove-from-list.har`

```
PATCH /v1/shopping-lists/{listId}
x-api-key: 92f00545-3e4b-4d33-94d1-f535e934cece
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE

{
  "objectsToRemove": [
    { "productId": "400863" }
  ]
}
```

**Response: 204 No Content.**

The `productId` in `objectsToRemove` is the Chronodrive internal product ID (same format as used in `objectsToAdd` and in cart calls). No `quantity` field required.

Multiple products can be batched in the array (not explicitly tested, but consistent with the `objectsToAdd` pattern).

---

### 5.10 — Get shopping list contents

**Status:** `CONFIRMED` — HAR `2026-06-26-remove-from-list.har`

```
GET /v1/shopping-lists/{listId}/products?withEmerch=true&page=1&size={page_size}
x-api-key: 92f00545-3e4b-4d33-94d1-f535e934cece
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

**Response 200:**

```json
{
  "content": [
    {
      "quantity": 1,
      "product": {
        "id": "415672",
        "labels": { "productLabel": "...", "brandLabel": "...", "unitQuantityLabel": "..." },
        "eans": ["3596710466061"],
        "prices": { "defaultPrice": 4.89 },
        "remainingStock": 0,
        "stock": "NO_STOCK",
        "isEligible": true,
        "flags": { "isFresh": true, "isAuchan": true }
      }
    }
  ],
  "page": {
    "size": 1,
    "totalElements": 22,
    "totalPages": 22,
    "number": 1,
    "hasNext": true,
    "hasPrevious": false,
    "isEmpty": false
  },
  "facets": [ ... ],
  "sortableFields": [ ... ]
}
```

Pagination is 1-indexed (`page=1` is the first page). `withEmerch=true` appears required for full product data. `size` controls items per page.

This endpoint also confirms a third `stock` enum value: `NO_STOCK` (product exists in catalogue but is out of stock at the current drive).

---

### 5.12 — Get product sheet (full detail)

**Status:** `CONFIRMED` — HAR `www.chronodrive.com_Archive [26-06-28 13-06-29].har`

```
GET /v1/products/{productId}
x-api-key: 34bfe4e1-82d1-458a-9a51-61198fff84b3
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

The "product page" endpoint. Returns everything the catalogue holds for one product. `x-api-version: 1.38.1`.

**Response 200 (abridged — product `91574`, EAN `3596710335510`):**

```json
{
  "id": "91574",
  "labels": {
    "productLabel": "Mozzarella di bufala campana AOP",
    "brandLabel": "AUCHAN",
    "brandLineLabel": "Tavola In Italia",
    "unitQuantityLabel": "125 g",
    "ticketLabel": "AUCHAN: Mozzarella 125 g"
  },
  "eans": ["3596710335510"],
  "prices": {
    "defaultPrice": 1.79,
    "pricePerUnitMeasure": 14.32,
    "lastPeriodLowestPrice": 1.79,
    "depositPrice": 0,
    "vatRate": 5.5,
    "variantDiscount": 0,
    "bestBeforeDateRate": 0
  },
  "stock": "HIGH_STOCK",
  "remainingStock": 228,
  "isEligible": true,
  "packaging": {
    "unit": "kg",
    "unitMeasure": 0.125,
    "weight": 0.125,
    "height": 0.14, "length": 0.135, "width": 0.055
  },
  "images": {
    "thumbnails": ["img/PM/V/0/74/0V_91574.gif"],
    "views": ["img/PM/P/0/74/0P_91574.gif"],
    "zooms": ["img/PM/Z/0/74/0Z_91574.jpg"]
  },
  "characteristics": {
    "origin": "",
    "ingredients": "Ingrédients : LAIT de bufflonne pasteurisé, sel, présure. Produit conservé en saumure.",
    "allergens": [],
    "features": [ { "code": "243", "value": "262" }, "… (see §5.12.1)" ]
  },
  "descriptions": { "conservation": "À conserver entre 0°C et +4°C…", "usage": "…", "ecology": "…" },
  "flags": { "isAuchan": true, "isFresh": true, "isDiscount": true, "isFrozen": false, "…": "…" },
  "animation": { "type": "VIRTUAL_DYNAMIC_PACK", "label": "5% cagnottés (dès 2 produits achetés)", "discountRate": 5, "minimalQuantity": 2, "…": "…" },
  "seo": { "id": "P91574", "canonicalUrl": "/auchan--tavola-in-italia---mozzarella-di-bufala-campana-aop-P91574" },
  "masterCategories": [ { "id": "16531916", "level": 1 } ],
  "complementaryProducts": [ { "id": "122649", "images": { "…": "…" } } ],
  "substitutionProducts": [ { "id": "476601" } ]
}
```

Key fields for our use cases:

- **Identity / labels** — `id`, `eans[]`, `labels.productLabel`, `labels.brandLabel`,
  `labels.unitQuantityLabel` (human net quantity, e.g. `"125 g"`).
- **Weight / packaging** — `packaging.weight` (net weight, **kg**), `packaging.unit` (`kg`/`L`),
  `packaging.unitMeasure` (numeric quantity in that unit), plus physical `height`/`length`/`width` (m).
- **Price** — `prices.defaultPrice` (€), `prices.pricePerUnitMeasure` (€/kg or €/L),
  `prices.lastPeriodLowestPrice` (the EU "lowest price in the last 30 days" — useful for price-drop
  detection), `prices.vatRate` (%), `prices.depositPrice` (consigne).
- **Availability** — `stock` (`HIGH_STOCK`/`NO_STOCK`), `remainingStock`, `isEligible`.
- **Nutrition / composition** — `characteristics.ingredients` (free text), `characteristics.allergens`
  (often `[]`; the allergen statement is in `features` code `383`), and the coded
  `characteristics.features[]` → see **§5.12.1**.
- **Images** — relative paths; prefix with `https://static1.chronodrive.com/` (§1).
- **Promo** — `animation` (loyalty / dynamic pack), `flags.isDiscount`.

#### 5.12.1 — Nutrition code map (`characteristics.features[]`)

**Status:** `INFERRED` (deduced from two product samples on 2026-06-28; consistent across both and
matching the EU nutrition-declaration order + numeric sanity checks — **validate against a third
product before relying on it in production**).

`features` is an array of `{ code, value }`. `value` is a string for measured nutrients and a boolean
for label flags. **Nutrition values are per the base in code `563`** (observed `"100 g"`).

| code  | meaning                          | example (`91574` / `572811`) |
| ----- | -------------------------------- | ---------------------------- |
| `563` | nutrition reference base         | `100 g`                      |
| `157` | energy — kJ                      | `1084` / `2114`              |
| `243` | energy — kcal                    | `262` / `506`                |
| `159` | fat (lipides) — g                | `23` / `27`                  |
| `160` | of which saturates — g           | `16` / `5.4`                 |
| `163` | carbohydrate (glucides) — g      | `0.700` / `50`               |
| `164` | of which sugars — g              | `0.700` / `6.3`              |
| `167` | fibre — g                        | (absent) / `5.5`             |
| `168` | protein (protéines) — g          | `13` / `13`                  |
| `169` | salt (sel) — g                   | `0.570` / `1.8`              |
| `520` | Nutri-Score grade (`A`–`E`)      | `C` / `D`                    |
| `383` | allergen statement (free text)   | `Contient : Lait` / `BLÉ, GLUTEN, LAIT, ŒUF…` |
| `759` | origin (free text)               | `ITALIE pour AUCHAN SAS OIA` / `FRANCE` |
| `760` | origin country                   | `Italie` / (absent)          |

A nutrient field may be **absent** when the manufacturer did not declare it (e.g. fibre on `91574`).
All other `features` codes (≈50, mostly booleans: bio / AOP / frozen / local / packaging claims, plus
manufacturer name/address `351`/`353`, legal denomination `357`, contact `369`) are **intentionally
not mapped** — out of scope for the current use cases (decision recorded in `decisions.md`).

---

### 5.13 — Search products (rich, paginated)

**Status:** `CONFIRMED` — HAR `www.chronodrive.com_Archive [26-06-28 13-06-29].har`

```
GET /v1/products?searchTerm={ean|keywords}&page=1&size={n}
x-api-key: 34bfe4e1-82d1-458a-9a51-61198fff84b3
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

The catalogue search behind the site's search bar. Unlike the lightweight `/v1/search-suggestions`
(§5.1), the response `content[]` items are **full product objects** (the §5.12 shape, nutrition +
weight included), wrapped with pagination and facets. `x-api-version: 1.11.0`.

**Response 200 (abridged):**

```json
{
  "page": { "size": 1, "totalElements": 1, "totalPages": 1, "number": 1, "hasNext": false, "isEmpty": false },
  "sortableFields": [ { "code": "Prix croissants", "label": "Prix croissants", "active": false }, "…" ],
  "facets": [ { "code": "pred-sorted-pred-yuka", "label": "Score Yuka", "values": [ { "code": "00000002", "label": "Médiocre", "nbResults": 1 } ] } ],
  "content": [ { "id": "572811", "labels": { "…": "…" }, "characteristics": { "features": [ "…" ] }, "prices": { "…": "…" }, "packaging": { "weight": 0.1 } } ]
}
```

- **EAN → product**: `GET /v1/products?searchTerm={ean}&page=1&size=1` → `content[0]` is the full
  product (nutrition + weight) in **one call**. Returns empty `content[]` if not found.
- **Keyword search**: `searchTerm={keywords}&size={n}` → a page of products; `page` is 1-indexed.
- The frontend also sends `&withFeaturedSell=true&withPushLists=true&includeNavigationInFacets=false&withKamino=true&kaminoMode=ADVANCED`; these add merchandising blocks and are **optional** (the bare
  `searchTerm`/`page`/`size` form returns the products + facets shown above).
- `facets` expose `Score Yuka` and `Nutriscore` filters; `sortableFields` include price/relevance/best-sellers. Not required for a simple lookup.

---

### 5.14 — Get multiple products by id (batch)

**Status:** `CONFIRMED` — HAR `www.chronodrive.com_Archive [26-06-28 13-06-29].har`

```
GET /v1/products?ids=122649&ids=522947&ids=76003&ids=89700
x-api-key: 34bfe4e1-82d1-458a-9a51-61198fff84b3
x-chronodrive-site-id: {site_id}
x-chronodrive-site-mode: DRIVE
```

Repeated `ids` query params → an array of full product objects (the §5.12 shape). Used by the frontend
to hydrate complementary/substitution products in one round-trip. Useful for resolving several
products at once (e.g. a recipe's ingredient list). Response is a list of products (same item shape as
§5.13 `content[]`).

---

## §6 — Known Gaps

Endpoints that must be captured before full implementation. Priority order:

| Priority | Endpoint / topic                    | Blocking? | Capture method                                            |
| -------- | ----------------------------------- | --------- | --------------------------------------------------------- |
| Low      | Nutrition code map (§5.12.1)         | No        | Currently INFERRED from 2 samples — confirm against a 3rd product |
| Low      | Full `features` code dictionary      | No        | ~50 boolean/label codes intentionally **not** mapped (out of scope) |
| Low      | `stock` enum `LOW_STOCK`             | No        | Only `HIGH_STOCK`/`NO_STOCK` observed; `LOW_STOCK` still inferred |

> **Ignored surfaces (not in scope):** the CMS content endpoints seen alongside product/cart calls
> (`/cms/v3/content_types/bubble_message/entries/`, `/cms/v3/content_types/push_top_basket/entries/`)
> are marketing/banner content (tiny, often empty responses) and are deliberately not modelled.

Previously-listed gaps now closed: **Get shopping lists (§5.7)** — CONFIRMED since 1.3.0. **Token refresh** — CONFIRMED LIVE in 1.4.1 (silent Steps 2+3 exercised by the middleware, not a separate endpoint). **Full product schema (§5.12)** — CONFIRMED 1.5.0 (product sheet captured: nutrition, ingredients, allergens, origin, packaging weight, full prices, images). **Non-empty cart schema (§5.3)** — CONFIRMED 1.5.0.

**Confirmed since initial draft (2026-06-26):**

- §5.5+5.6 Cart update/remove: `CONFIRMED` — unified POST with signed delta quantity
- §5.9 Remove from list: `CONFIRMED`
- §5.10 Get list contents: `CONFIRMED`
- `stock` enum: `HIGH_STOCK` / `NO_STOCK` confirmed. `LOW_STOCK` still inferred.

---

## §7 — Change Management Process

### 7.1 — Detecting breakage

The middleware should expose a `/health` endpoint that makes a test call to each confirmed endpoint (with a known-stable EAN, read-only calls only). Run this health check on startup and periodically (e.g. every 6 hours via cron). Alert on non-200 responses or unexpected response schema.

Symptom patterns:

| Symptom                                                   | Likely cause                                 |
| --------------------------------------------------------- | -------------------------------------------- |
| All calls return 401                                      | Access token expired or auth flow changed    |
| Calls with a specific `x-api-key` return 401/403          | That API key was rotated                     |
| Response 200 but unexpected shape                         | Schema change on that endpoint               |
| `search-suggestions` returns empty products for known EAN | Catalogue restructure or EAN indexing change |
| Auth step 1 (`/identity/v1/password/login`) returns 4xx   | Reach5 login endpoint changed                |
| Auth step 2 returns 400 `No origin or referer retrieved`  | Missing `Origin`/`Referer` headers (§2.0)    |
| Auth step 2 returns 400 but Step 1 succeeded              | Step-1 session cookie not forwarded (§2.0)   |

### 7.2 — When something breaks

1. **Capture a fresh HAR** of the affected flow (with Preserve Logs enabled).
2. **Diff the new HAR against the relevant entries in this document.** Identify what changed: URL, method, headers, request body shape, response shape.
3. **Update this document:** change the endpoint's status to `BROKEN`, add a new entry with the corrected spec, note the observed change, bump the document version, add a changelog entry.
4. **Open a patch issue** in the codebase referencing the spec version that broke and the new spec version.
5. **Update the implementation** to match the new spec.
6. **Re-verify** all other endpoints are still functional; update `last_verified` dates.

### 7.3 — Spec version policy

- **Patch version (x.x.N):** Correction of an inferred endpoint to confirmed, or addition of a previously unknown field. No behavioral change.
- **Minor version (x.N.0):** New endpoint discovered. Existing endpoints unchanged.
- **Major version (N.0.0):** One or more confirmed endpoints changed in a breaking way (URL, method, required headers, payload shape).

### 7.4 — Periodic re-verification

Once a month (or after any Chronodrive frontend deploy detected via version header `x-api-version` changing): re-run the full capture procedure for all confirmed endpoints and compare responses against this document. The `x-api-version` response header is a useful signal — if it changes, assume schema verification is needed.

Observed API versions as of 2026-06-26:

- `/v1/search-suggestions`: `1.38.1`
- `/v1/products/{id}`: `1.38.1` · `/v1/products?searchTerm=` (search): `1.11.0` *(added 1.5.0, 2026-06-28)*
- `/v1/customers/me`, `/v1/customers/me/settings`: `1.4.0` / `1.1.0`
- `/v1/customers/me/carts`: `1.9.0`
- `/v1/carts/{cartId}/items`: `1.9.0`
- `/v1/shopping-lists/{listId}`: `1.5.0`

**Re-verified live 2026-06-27 (Phase 7, deployed middleware self-test):** all four probed endpoints
returned the same `x-api-version` values — `/v1/customers/me` `1.4.0`, `/v1/search-suggestions`
`1.38.1`, `/v1/customers/me/carts` `1.9.0`, `/v1/shopping-lists` `1.5.0`. No drift.

**Re-checked 2026-06-28 (browser HAR):** `/v1/search-suggestions` `1.38.1` and `/v1/customers/me/carts`
`1.9.0` unchanged (no drift on documented endpoints); the new `/v1/products*` endpoints reported
`1.38.1` (detail) / `1.11.0` (search).

---

## §8 — Security Notes

- **Credentials:** User email and password must be stored encrypted at rest (AES-256 or equivalent). Never log them.
- **Access tokens:** Short-lived (2h). Treat as ephemeral; store in memory only, not on disk.
- **API keys (x-api-key):** Static application credentials embedded in the frontend bundle. Store in config. Not secret in the traditional sense (anyone with a browser can extract them), but rotating them is Chronodrive's prerogative.
- **HAR archives:** Must be sanitized before storing in version control. Remove `Authorization` header values, `chronosession` cookie values, `postData` from auth calls. A script for automated sanitization is recommended.
- **Rate limits:** Unknown. No rate-limiting headers observed. Avoid tight loops; add a small delay between bulk scans.
- **Legal:** This integration uses a private, undocumented API against a personal account for personal use. Chronodrive's CGU likely prohibit automated access. Risk in practice: account suspension. No legal action precedent known for personal-use homebrew integrations of this type.
