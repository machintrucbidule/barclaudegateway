/**
 * Static Chronodrive API parameters (contract.md §2.1, §3.1).
 *
 * These are not secret — they are embedded in Chronodrive's public frontend bundle — but Chronodrive
 * may rotate the per-service `x-api-key`s after a deploy. They are seeded into the SQLite `config`
 * table on first run (INSERT OR IGNORE) so the Phase 4 UI can edit them without a redeploy when a
 * key rotates. Code keeps the known-good values as the seed.
 */

export interface ApiKeys {
  search: string;
  /** Products service (contract.md §3.1, added 1.5.0): `/v1/products/{id}`, `?searchTerm=`, `?ids=`. */
  products: string;
  customerCartRead: string;
  cartWrite: string;
  shoppingLists: string;
}

export interface AppConfig {
  clientId: string;
  redirectUri: string;
  scope: string;
  /** Reach5 identity host, e.g. `https://connect.chronodrive.com`. */
  identityBaseUrl: string;
  /** Chronodrive API host incl. `/v1`, e.g. `https://api.chronodrive.com/v1`. */
  apiBaseUrl: string;
  apiKeys: ApiKeys;
  /** `x-chronodrive-site-mode`, always `DRIVE` for drive orders. */
  siteMode: string;
  /**
   * Optional `x-chronodrive-site-id` override (Phase 4). Empty by default: the client then derives the
   * id dynamically from the customer profile (`lastVisitedSite.id`). Set it in the UI to pin a store.
   */
  siteId: string;
  /**
   * Optional Home Assistant webhook URL (Phase 5, CLARIFY-05). Empty by default: when set, a critical
   * API error POSTs a secret-free alert there. Edited in the config UI like the other static params.
   */
  haWebhookUrl: string;
  /**
   * Auth-token lifecycle policy (BL-006, DECISION-021):
   *  - `keepalive`: a background timer refreshes the token ~60s before `exp` (≈ every 2h) and the
   *    startup + 6h self-test connect proactively. Snappy scans, regular background calls.
   *  - `lazy`: no refresh timer and no forced login at startup; the app authenticates only when a scan
   *    needs it, and the passive self-test/health reads are skipped while idle. Fewer background calls,
   *    slower first scan after idle, breakage detection dormant while idle.
   * Fresh installs default to `lazy`; a database upgraded from before BL-006 (no `auth_mode` row)
   * resolves to `keepalive` so existing deployments keep today's behaviour until switched in the UI.
   */
  authMode: 'lazy' | 'keepalive';
  /**
   * Shared key guarding the local "Layer B" API (`/api/v1/*`, BL-008/DECISION-023). Empty by default;
   * the backend **auto-generates** one on first boot when empty (see `bootstrap.ts`) and surfaces it
   * once in the operational logs so it can be copied into a client's `X-API-Key` header.
   *
   * It is **app-managed, not user-editable**: deliberately absent from {@link appConfigToEntries} (so
   * neither `ConfigStore.seedDefaults` nor the user-facing `PUT /api/config` writer can touch it) and
   * absent from the shared `ApiConfig` (so `GET/PUT /api/config` never expose or accept it). It is
   * written only via `ConfigStore.set` by the boot-time generation step, and read here by the guard.
   *
   * Optional in the type because it is not part of the core required config and is set out-of-band;
   * {@link appConfigFromMap} always normalises it to a string (`''` until generated).
   */
  localApiKey?: string;
}

/** Config-table column keys (one row per key). Kept as constants to avoid typos. */
export const CONFIG_KEYS = {
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  scope: 'scope',
  identityBaseUrl: 'identity_base_url',
  apiBaseUrl: 'api_base_url',
  apiKeySearch: 'x_api_key_search',
  apiKeyProducts: 'x_api_key_products',
  apiKeyCustomerCartRead: 'x_api_key_customer_cart_read',
  apiKeyCartWrite: 'x_api_key_cart_write',
  apiKeyShoppingLists: 'x_api_key_shopping_lists',
  siteMode: 'site_mode',
  siteId: 'site_id',
  haWebhookUrl: 'ha_webhook_url',
  authMode: 'auth_mode',
  localApiKey: 'local_api_key',
} as const;

/** Known-good seed values, verified 2026-06-26 (contract.md §2.1, §3.1, §4). */
export const DEFAULT_APP_CONFIG: AppConfig = {
  clientId: 'DrJyWDmbpV6yYP8ndN8m',
  redirectUri: 'https://www.chronodrive.com',
  scope: 'openid profile email phone full_write offline_access',
  identityBaseUrl: 'https://connect.chronodrive.com',
  apiBaseUrl: 'https://api.chronodrive.com/v1',
  apiKeys: {
    search: '49a29e90-6842-4b90-8d09-07222f40b3ed',
    products: '34bfe4e1-82d1-458a-9a51-61198fff84b3',
    customerCartRead: 'c5e1b8ce-3a98-4871-842d-b7a60922ba97',
    cartWrite: '3f796a97-e16a-4f3f-bd29-9523c7f28edb',
    shoppingLists: '92f00545-3e4b-4d33-94d1-f535e934cece',
  },
  siteMode: 'DRIVE',
  siteId: '',
  haWebhookUrl: '',
  // Fresh installs default to the on-demand (lazy) policy — minimal background calls (BL-006).
  authMode: 'lazy',
  // Empty seed: the backend auto-generates a key on first boot when this is empty (BL-008). Never
  // seeded/written via appConfigToEntries — see the field doc on AppConfig.
  localApiKey: '',
};

/** Flatten an {@link AppConfig} into config-table `[key, value]` rows. */
export function appConfigToEntries(config: AppConfig): Array<[string, string]> {
  return [
    [CONFIG_KEYS.clientId, config.clientId],
    [CONFIG_KEYS.redirectUri, config.redirectUri],
    [CONFIG_KEYS.scope, config.scope],
    [CONFIG_KEYS.identityBaseUrl, config.identityBaseUrl],
    [CONFIG_KEYS.apiBaseUrl, config.apiBaseUrl],
    [CONFIG_KEYS.apiKeySearch, config.apiKeys.search],
    [CONFIG_KEYS.apiKeyProducts, config.apiKeys.products],
    [CONFIG_KEYS.apiKeyCustomerCartRead, config.apiKeys.customerCartRead],
    [CONFIG_KEYS.apiKeyCartWrite, config.apiKeys.cartWrite],
    [CONFIG_KEYS.apiKeyShoppingLists, config.apiKeys.shoppingLists],
    [CONFIG_KEYS.siteMode, config.siteMode],
    [CONFIG_KEYS.siteId, config.siteId],
    [CONFIG_KEYS.haWebhookUrl, config.haWebhookUrl],
    [CONFIG_KEYS.authMode, config.authMode],
    // NOTE: `localApiKey` is intentionally NOT listed. It is app-managed (auto-generated at boot) and
    // must never be written by the default seed or the user-facing `PUT /api/config` path — both go
    // through this function. It is persisted only via `ConfigStore.set` and read in appConfigFromMap.
  ];
}

/** Coerce a stored `auth_mode` value to the enum, defaulting to `keepalive` (missing/invalid). */
function toAuthMode(value: string | undefined): AppConfig['authMode'] {
  return value === 'lazy' || value === 'keepalive' ? value : 'keepalive';
}

/** Rebuild an {@link AppConfig} from a `key → value` map, throwing if a required key is missing. */
export function appConfigFromMap(map: ReadonlyMap<string, string>): AppConfig {
  const need = (key: string): string => {
    const value = map.get(key);
    if (value === undefined) throw new Error(`Missing config key: ${key}`);
    return value;
  };
  return {
    clientId: need(CONFIG_KEYS.clientId),
    redirectUri: need(CONFIG_KEYS.redirectUri),
    scope: need(CONFIG_KEYS.scope),
    identityBaseUrl: need(CONFIG_KEYS.identityBaseUrl),
    apiBaseUrl: need(CONFIG_KEYS.apiBaseUrl),
    apiKeys: {
      search: need(CONFIG_KEYS.apiKeySearch),
      // Optional: absent on databases seeded before 1.5.0 → fall back to the known-good seed (the row is
      // added by seedDefaults' INSERT OR IGNORE on the next boot). Never `need()` it, or an upgraded DB
      // would fail to load.
      products: map.get(CONFIG_KEYS.apiKeyProducts) ?? DEFAULT_APP_CONFIG.apiKeys.products,
      customerCartRead: need(CONFIG_KEYS.apiKeyCustomerCartRead),
      cartWrite: need(CONFIG_KEYS.apiKeyCartWrite),
      shoppingLists: need(CONFIG_KEYS.apiKeyShoppingLists),
    },
    siteMode: need(CONFIG_KEYS.siteMode),
    // Optional: absent on databases seeded before Phase 4, and empty by default → dynamic detection.
    siteId: map.get(CONFIG_KEYS.siteId) ?? '',
    // Optional: absent on databases seeded before Phase 5, and empty by default → no HA alert.
    haWebhookUrl: map.get(CONFIG_KEYS.haWebhookUrl) ?? '',
    // Optional: absent on databases seeded before BL-006 → keep today's keep-alive behaviour. A fresh
    // install seeds `lazy` explicitly (see ConfigStore.seedDefaults), so "missing" only ever means an
    // upgraded DB, never a new one.
    authMode: toAuthMode(map.get(CONFIG_KEYS.authMode)),
    // Optional: empty until the boot-time generator writes it (BL-008). Never seeded via this map's
    // writer (appConfigToEntries) — only set directly by ConfigStore.set in bootstrap.
    localApiKey: map.get(CONFIG_KEYS.localApiKey) ?? '',
  };
}
