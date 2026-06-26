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
}

/** Config-table column keys (one row per key). Kept as constants to avoid typos. */
export const CONFIG_KEYS = {
  clientId: 'client_id',
  redirectUri: 'redirect_uri',
  scope: 'scope',
  identityBaseUrl: 'identity_base_url',
  apiBaseUrl: 'api_base_url',
  apiKeySearch: 'x_api_key_search',
  apiKeyCustomerCartRead: 'x_api_key_customer_cart_read',
  apiKeyCartWrite: 'x_api_key_cart_write',
  apiKeyShoppingLists: 'x_api_key_shopping_lists',
  siteMode: 'site_mode',
  siteId: 'site_id',
  haWebhookUrl: 'ha_webhook_url',
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
    customerCartRead: 'c5e1b8ce-3a98-4871-842d-b7a60922ba97',
    cartWrite: '3f796a97-e16a-4f3f-bd29-9523c7f28edb',
    shoppingLists: '92f00545-3e4b-4d33-94d1-f535e934cece',
  },
  siteMode: 'DRIVE',
  siteId: '',
  haWebhookUrl: '',
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
    [CONFIG_KEYS.apiKeyCustomerCartRead, config.apiKeys.customerCartRead],
    [CONFIG_KEYS.apiKeyCartWrite, config.apiKeys.cartWrite],
    [CONFIG_KEYS.apiKeyShoppingLists, config.apiKeys.shoppingLists],
    [CONFIG_KEYS.siteMode, config.siteMode],
    [CONFIG_KEYS.siteId, config.siteId],
    [CONFIG_KEYS.haWebhookUrl, config.haWebhookUrl],
  ];
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
      customerCartRead: need(CONFIG_KEYS.apiKeyCustomerCartRead),
      cartWrite: need(CONFIG_KEYS.apiKeyCartWrite),
      shoppingLists: need(CONFIG_KEYS.apiKeyShoppingLists),
    },
    siteMode: need(CONFIG_KEYS.siteMode),
    // Optional: absent on databases seeded before Phase 4, and empty by default → dynamic detection.
    siteId: map.get(CONFIG_KEYS.siteId) ?? '',
    // Optional: absent on databases seeded before Phase 5, and empty by default → no HA alert.
    haWebhookUrl: map.get(CONFIG_KEYS.haWebhookUrl) ?? '',
  };
}
