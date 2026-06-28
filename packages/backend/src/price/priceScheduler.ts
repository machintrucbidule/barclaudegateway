/**
 * Gated price-tracking scheduler (BL-012, DECISION-026).
 *
 * The epic's one sanctioned background exception: when `priceTrackingEnabled` is on, this periodically
 * re-reads each tracked product's price, appends it to history, and fires a Home Assistant alert on a
 * qualifying drop. **Off by default** — an idle install makes no background Chronodrive call.
 *
 * Alert dedup is the store's per-product `armed` flag: a drop fires once when the price crosses at/below
 * the threshold (then disarms); it re-arms only when the price recovers above the threshold. So a price
 * sitting below the threshold does not re-alert every cycle.
 *
 * Like {@link TokenLifecycle}, the timer is `unref()`d (never keeps the process alive) and cleared via
 * {@link PriceScheduler.stop}. {@link PriceScheduler.applyConfig} restarts it after a settings change.
 */

import type { ChronodriveClient } from '../chronodrive/client.js';
import type { ConfigStore } from '../storage/config.js';
import type { PriceTrackingStore } from '../storage/priceTracking.js';
import type { HaWebhookNotifier } from '../health/haWebhook.js';
import type { EmitEvent } from '../logging/eventLogger.js';

export interface PriceSchedulerDeps {
  chronodrive: Pick<ChronodriveClient, 'getProduct'>;
  store: PriceTrackingStore;
  notifier: Pick<HaWebhookNotifier, 'notifyPriceDrop'>;
  configStore: Pick<ConfigStore, 'readAppConfig'>;
  emit: EmitEvent;
  now?: () => number;
}

export interface CheckSummary {
  checked: number;
  alerts: number;
}

export class PriceScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: PriceSchedulerDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Read every tracked product's current price once, recording history and firing drop alerts. */
  async runOnce(): Promise<CheckSummary> {
    const products = this.deps.store.list();
    let checked = 0;
    let alerts = 0;
    for (const p of products) {
      try {
        const product = await this.deps.chronodrive.getProduct(p.productId);
        const price = product.prices?.defaultPrice;
        if (price === undefined) {
          this.deps.emit({
            category: 'chronodrive',
            type: 'price_check',
            level: 'warn',
            message: `price check ${p.productId} → no price`,
          });
          continue;
        }
        const at = this.now();
        this.deps.store.recordPrice(p.productId, price, at);
        checked += 1;
        this.deps.emit({
          category: 'chronodrive',
          type: 'price_check',
          level: 'info',
          message: `price check ${p.productId} → ${String(price)} (seuil ${String(p.threshold)})`,
        });
        if (price <= p.threshold && p.armed) {
          await this.deps.notifier.notifyPriceDrop({
            productId: p.productId,
            ...(p.label !== null ? { label: p.label } : {}),
            price,
            threshold: p.threshold,
            at,
          });
          this.deps.store.markAlerted(p.productId, at);
          alerts += 1;
        } else if (price > p.threshold && !p.armed) {
          this.deps.store.setArmed(p.productId, true);
        }
      } catch {
        this.deps.emit({
          category: 'chronodrive',
          type: 'price_check',
          level: 'error',
          message: `price check ${p.productId} failed`,
        });
      }
    }
    return { checked, alerts };
  }

  /** Manual "Vérifier maintenant" — run a cycle on demand regardless of the enabled flag. */
  async trigger(): Promise<CheckSummary> {
    return this.runOnce();
  }

  /** Arm the periodic timer if enabled in config; idempotent (clears any prior timer first). */
  start(): void {
    this.stop();
    const config = this.deps.configStore.readAppConfig();
    if (!config.priceTrackingEnabled) return;
    const intervalMs = Math.max(1, config.priceTrackingIntervalHours ?? 12) * 60 * 60 * 1_000;
    this.timer = setInterval(() => {
      void this.runOnce().catch(() => {
        // A scheduler cycle that throws must never take the process down.
      });
    }, intervalMs);
    this.timer.unref();
  }

  /** Re-read config and (re)start or stop the timer — called after a settings change. */
  applyConfig(): void {
    this.start();
  }

  /** Cancel the scheduled timer (shutdown / disable). */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
