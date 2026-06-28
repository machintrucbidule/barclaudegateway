# ESPHome ↔ BarclaudeGateway — Ingestion HTTP Contract

**Audience:** the ESP32/ESPHome firmware author.
**Status:** Phase 3 (DECISION-001, DECISION-009, CLARIFY-04); feedback is **LED-only** (DECISION-020 —
the buzzer was dropped) and **validated on real hardware** (BL-001). Shared response types live in
`@barclaudegateway/shared` (`ScanResponse`); this doc is the firmware-facing view.

The ESP32 scans a barcode and sends it to the middleware over the local network. The middleware
answers **synchronously** with a JSON body rich enough to drive a **LED colour** **without any app
change** — the firmware switches on the `status` field first. The reference build uses a single WS2812
LED (no buzzer).

> **Stability policy (DECISION-027):** this is an **exposed device contract** — changing it forces a
> firmware update. It is **stability-first**: fields/states are **added**, never silently changed or
> removed. An upstream Chronodrive change is absorbed in the gateway's wiring, not here. A breaking change
> ships **only when unavoidable and after the user is clearly warned**.

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

**Drive feedback from `status`.** The HTTP code is secondary (see the last column). Feedback is
**LED-only** — the reference firmware lights the WS2812 **white while the request is in flight**, then
holds the result colour for ~1.5 s.

| `status`              | Meaning                                                       | LED    | HTTP |
| --------------------- | ------------------------------------------------------------- | ------ | ---- |
| _(in flight)_         | Request sent, awaiting the ScanResponse                       | White  | —    |
| `added`               | Found, orderable, written to every enabled destination        | Green  | 200  |
| `added_to_lists_only` | Found but unavailable (`reason`): lists written, cart skipped | Orange | 200  |
| `duplicate_ignored`   | Same EAN repeated inside the ~3 s debounce window; no action  | Green  | 200  |
| `partial`             | Some destinations written, at least one failed                | Orange | 200  |
| `not_found`           | EAN absent from the Chronodrive catalogue                     | Red    | 200  |
| `invalid_ean`         | Barcode failed validation — Chronodrive was never queried     | Red    | 400  |
| `error`               | Nothing written — Chronodrive/network failure (`category`)    | Red    | 502  |
| _(no response)_       | Server unreachable / WiFi down (the POST got no reply)        | Red    | —    |

> The simplest firmware can collapse this to **green = `added`**, **orange = `added_to_lists_only`**,
> **red = everything else** (`not_found` / `invalid_ean` / `error` / unreachable). The white in-flight
> colour is optional. Firmware may also use blink patterns to distinguish the reds — the middleware only
> guarantees the `status` strings and the JSON shape.

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

## Home Assistant integration (optional)

The reference firmware also exposes itself to Home Assistant (encrypted API), so a scan can be driven —
and observed — without the physical scanner:

- **Manual EAN** (`text`) — type/set an EAN; it is pushed through the **same** `POST /v1/scan` pipeline
  as a physical scan (same `ScanResponse`, same LED feedback).
- **Resend EAN** (`button`) — re-sends the current Manual EAN even if unchanged.
- **Last EAN** / **Last status** (`text_sensor`) — the last processed EAN and the last `status` string,
  updated by both physical scans and manual sends (handy for dashboards/automations and for confirming
  what the middleware returned).

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

> A complete, ready-to-flash configuration for an **ESP32-C6 + GM861S** (UART) with an external WS2812
> LED (LED-only, no buzzer) plus the optional Home Assistant integration above lives at
> [`firmware/esphome/barclaude-scanner.yaml`](../firmware/esphome/barclaude-scanner.yaml). The sketch
> below is the minimal illustration.

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
          request_headers:
            Content-Type: application/json
          json:
            ean: !lambda 'return ean;'
          on_response:
            then:
              - lambda: |-
                  json::parse_json(body, [=](JsonObject root) -> bool {
                    std::string status = root["status"] | "error";
                    if (status == "added")                    { /* green */ }
                    else if (status == "added_to_lists_only")  { /* orange */ }
                    else if (status == "duplicate_ignored")    { /* green */ }
                    else if (status == "partial")              { /* orange */ }
                    else                                       { /* red: not_found/invalid_ean/error */ }
                    return true;
                  });
```

The exact LED wiring and colour/blink choices are the firmware's; the middleware only guarantees the
`status` values above and their JSON shape.
