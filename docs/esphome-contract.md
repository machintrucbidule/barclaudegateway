# ESPHome ↔ BarclaudeGateway — Ingestion HTTP Contract

**Audience:** the ESP32/ESPHome firmware author.
**Status:** Phase 3 (DECISION-001, DECISION-009, CLARIFY-04). Shared response types live in
`@barclaudegateway/shared` (`ScanResponse`); this doc is the firmware-facing view.

The ESP32 scans a barcode and sends it to the middleware over the local network. The middleware
answers **synchronously** with a JSON body rich enough to drive a LED colour + a buzzer pattern
**without any app change** — the firmware switches on the `status` field first.

---

## Request

```
POST http://<middleware-host>:8090/v1/scan
Content-Type: application/json

{ "ean": "3183280000933" }
```

- `ean` — the raw barcode string from the scanner (EAN-8, UPC-A or EAN-13). The middleware trims
  whitespace, validates the length and the GS1 check digit, and normalises UPC-A to EAN-13.
- No authentication (local-only network behind a Cloudflare Tunnel).

## Response

`Content-Type: application/json`. Always a `ScanResponse`:

```jsonc
{
  "status": "added", // the field the firmware switches on
  "ean": "3183280000933",
  "reason": "out_of_stock", // only on added_to_lists_only
  "category": "server", // only on error / partial
  "product": {
    "id": "2555",
    "label": "Gros sel de mer",
    "brand": "LA BALEINE",
    "price": 0.79,
    "stock": "HIGH_STOCK",
    "isEligible": true,
  },
  "destinations": [
    { "kind": "cart", "id": "CART-1", "name": "Panier", "result": "written" },
    { "kind": "list", "id": "LIST-1", "name": "Classiques", "result": "written" },
  ],
  "message": "Added \"Gros sel de mer\"",
}
```

**Drive feedback from `status`.** The HTTP code is secondary (see the last column).

| `status`              | Meaning                                                       | Suggested LED      | Suggested buzzer            | HTTP |
| --------------------- | ------------------------------------------------------------- | ------------------ | --------------------------- | ---- |
| `added`               | Found, orderable, written to every enabled destination        | Green              | 1 short beep                | 200  |
| `added_to_lists_only` | Found but unavailable (`reason`): lists written, cart skipped | Orange             | 2 short beeps               | 200  |
| `duplicate_ignored`   | Same EAN repeated inside the ~3 s debounce window; no action  | Brief green blink  | none (or 1 very short tick) | 200  |
| `not_found`           | EAN absent from the Chronodrive catalogue                     | Red                | 1 long beep                 | 200  |
| `partial`             | Some destinations written, at least one failed                | Orange blink       | 2 short + 1 long            | 200  |
| `error`               | Nothing written — Chronodrive/network failure (`category`)    | Red blink          | 3 short beeps               | 502  |
| `invalid_ean`         | Barcode failed validation — Chronodrive was never queried     | Red (double blink) | 1 long beep                 | 400  |

> The simplest firmware can collapse this to **green = `added`**, **orange = `added_to_lists_only`**,
> **red = everything else**. The richer mapping above is available when you want it.

### `reason` (only on `added_to_lists_only`)

- `out_of_stock` — the product is in the catalogue but `NO_STOCK` at your drive.
- `ineligible` — the product exists but is not sold at your drive (`isEligible: false`).

In both cases the product is added to the enabled **lists** but **never the cart** (CLARIFY-08).
Note: if you enabled _only_ the cart and scan an unavailable product, the status is still
`added_to_lists_only` (the firmware shows "unavailable" / orange) but `destinations` will show the
cart `skipped_unavailable` and no list written — read `destinations` if you need the detail.

### `category` (only on `error` / `partial`)

The failure class, mirroring the Chronodrive error taxonomy (contract.md §7.1):
`auth` · `api_key` · `schema` · `not_found` · `rate_limit` · `server` · `network` · `timeout` · `unknown`,
plus the app-internal `not_configured` (no Chronodrive credentials saved yet — set them in the web UI).
Phase 5 turns the critical ones into the maintenance page + a Home Assistant alert; `not_found`,
`rate_limit` and `not_configured` are benign and never alert (DECISION-016).

### `destinations[]`

Per-destination outcome, useful for logging/diagnostics:

- `kind`: `cart` | `list`; `id`/`name`: the cart/list identifier and label.
- `result`: `written` | `skipped_unavailable` (cart skipped for an unavailable product) | `failed`.

---

## Worked examples

**Added to cart + a list**

```
→ POST /v1/scan  { "ean": "3183280000933" }
← 200  { "status": "added", "ean": "3183280000933",
         "product": { "id": "2555", "label": "Gros sel de mer" },
         "destinations": [ { "kind": "cart", "result": "written" },
                           { "kind": "list", "name": "Classiques", "result": "written" } ] }
```

**Out of stock → lists only**

```
← 200  { "status": "added_to_lists_only", "reason": "out_of_stock", "ean": "...",
         "destinations": [ { "kind": "cart", "result": "skipped_unavailable", "detail": "out_of_stock" },
                           { "kind": "list", "result": "written" } ] }
```

**Unknown barcode**

```
← 200  { "status": "not_found", "ean": "0000000000000",
         "message": "Product not found in Chronodrive catalogue" }
```

**Hardware double-read**

```
← 200  { "status": "duplicate_ignored", "ean": "...", "message": "Repeated scan ignored (debounce window)" }
```

**Bad barcode (never reaches Chronodrive)**

```
← 400  { "status": "invalid_ean", "ean": "123", "message": "EAN must be 8, 12 or 13 digits (got 3)" }
```

**Chronodrive unreachable**

```
← 502  { "status": "error", "category": "network", "ean": "...", "message": "Chronodrive request failed" }
```

---

## ESPHome sketch (HTTP request + response parsing)

```yaml
# Minimal illustration — adapt pins/IDs to your board.
http_request:
  useragent: barclaude-scanner
  timeout: 8s

script:
  - id: send_scan
    parameters:
      ean: string
    then:
      - http_request.post:
          url: 'http://192.168.1.50:8090/v1/scan'
          headers:
            Content-Type: application/json
          json:
            ean: !lambda 'return ean;'
          on_response:
            then:
              - lambda: |-
                  json::parse_json(body, [=](JsonObject root) -> bool {
                    std::string status = root["status"] | "error";
                    if (status == "added")                    { /* green + 1 beep */ }
                    else if (status == "added_to_lists_only")  { /* orange + 2 beeps */ }
                    else if (status == "duplicate_ignored")    { /* short green blink */ }
                    else                                       { /* red + error beeps */ }
                    return true;
                  });
```

The exact LED/buzzer wiring is the firmware's choice; the middleware only guarantees the `status`
values above and their JSON shape.
