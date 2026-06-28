/**
 * Home Assistant webhook notifier (Phase 5, CLARIFY-05 / DECISION-014).
 *
 * On a newly-detected critical incident the {@link ErrorMonitor} hands the error here; if a webhook URL
 * is configured we POST a compact, secret-free alert so the user is told even when not watching the UI.
 *
 * Firing policy (the user's choice): once per incident, with a cooldown. The monitor already only
 * surfaces a transition once per incident; the cooldown additionally suppresses re-fires if the same
 * incident flaps (active→clear→active) inside the window. The payload carries category/endpoint/
 * message/version/timestamp only — never tokens, cookies or passwords (contract.md §8).
 */

import { request } from 'undici';
import type { ErrorStateError } from '@barclaudegateway/shared';

import type { EmitEvent } from '../logging/eventLogger.js';

const DEFAULT_COOLDOWN_MS = 15 * 60 * 1_000;
const WEBHOOK_TIMEOUT_MS = 5_000;

export interface HaWebhookDeps {
  /** Read the configured URL lazily so config edits take effect without a restart. Empty = disabled. */
  getUrl: () => string;
  /** Optional operational-log emit (BL-003): each webhook send/failure is journalled as `other`. */
  emit?: EmitEvent;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
  /** Minimum gap before the same incident may alert again. Defaults to 15 minutes. */
  cooldownMs?: number;
}

/** The secret-free body POSTed to Home Assistant on a critical incident. */
export interface HaWebhookPayload {
  source: 'BarclaudeGateway';
  severity: 'critical';
  category: string;
  endpoint?: string;
  message: string;
  apiVersion?: string;
  at: number;
  /** True for the config-page "send test" button so HA automations can ignore drills. */
  test: boolean;
}

/** The secret-free body POSTed on a tracked-product price drop (BL-012). `kind` lets HA route it. */
export interface HaPriceDropPayload {
  source: 'BarclaudeGateway';
  severity: 'info';
  kind: 'price_drop';
  productId: string;
  label?: string;
  price: number;
  threshold: number;
  at: number;
  test: boolean;
}

type HaPayload = HaWebhookPayload | HaPriceDropPayload;

export interface HaWebhookResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export class HaWebhookNotifier {
  private readonly getUrl: () => string;
  private readonly emit?: EmitEvent;
  private readonly now: () => number;
  private readonly cooldownMs: number;
  private lastKey: string | undefined;
  private lastFiredAt = Number.NEGATIVE_INFINITY;

  constructor(deps: HaWebhookDeps) {
    this.getUrl = deps.getUrl;
    this.emit = deps.emit;
    this.now = deps.now ?? Date.now;
    this.cooldownMs = deps.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  }

  /** Alert on a critical incident. No-op when no URL is set or the same incident is within cooldown. */
  async notify(error: ErrorStateError): Promise<void> {
    const url = this.getUrl().trim();
    if (url === '') return;

    const key = `${error.category}|${error.endpoint ?? ''}`;
    const at = this.now();
    if (this.lastKey === key && at - this.lastFiredAt < this.cooldownMs) return;
    this.lastKey = key;
    this.lastFiredAt = at;

    const result = await this.post(url, this.payload(error, false));
    this.emit?.({
      category: 'other',
      type: 'ha_alert',
      level: result.ok ? 'info' : 'error',
      message: result.ok
        ? `Home Assistant alert sent (${error.category})`
        : `Home Assistant alert failed: ${result.error ?? 'unknown error'}`,
      detail: { category: error.category, endpoint: error.endpoint, ok: result.ok },
    });
  }

  /**
   * Alert on a tracked-product price drop (BL-012). No-op when no URL is set. No cooldown here — the
   * price scheduler's per-product re-arm flag already guarantees one alert per threshold crossing.
   */
  async notifyPriceDrop(info: {
    productId: string;
    label?: string;
    price: number;
    threshold: number;
    at: number;
  }): Promise<HaWebhookResult> {
    const url = this.getUrl().trim();
    if (url === '') return { ok: false, error: 'No Home Assistant webhook URL configured' };
    const payload: HaPriceDropPayload = {
      source: 'BarclaudeGateway',
      severity: 'info',
      kind: 'price_drop',
      productId: info.productId,
      ...(info.label !== undefined ? { label: info.label } : {}),
      price: info.price,
      threshold: info.threshold,
      at: info.at,
      test: false,
    };
    const result = await this.post(url, payload);
    this.emit?.({
      category: 'other',
      type: 'ha_alert',
      level: result.ok ? 'info' : 'error',
      message: result.ok
        ? `Home Assistant price-drop alert sent (${info.productId} @ ${String(info.price)})`
        : `Home Assistant price-drop alert failed: ${result.error ?? 'unknown error'}`,
      detail: {
        productId: info.productId,
        price: info.price,
        threshold: info.threshold,
        ok: result.ok,
      },
    });
    return result;
  }

  /** Send a clearly-marked sample alert for the config-page test button. Bypasses the cooldown. */
  async sendTest(): Promise<HaWebhookResult> {
    const url = this.getUrl().trim();
    if (url === '') return { ok: false, error: 'No Home Assistant webhook URL configured' };
    const sample: ErrorStateError = {
      category: 'server',
      endpoint: 'GET /customers/me',
      message: 'Test alert from BarclaudeGateway',
      at: this.now(),
    };
    return this.post(url, this.payload(sample, true));
  }

  private payload(error: ErrorStateError, test: boolean): HaWebhookPayload {
    return {
      source: 'BarclaudeGateway',
      severity: 'critical',
      category: error.category,
      endpoint: error.endpoint,
      message: error.message,
      apiVersion: error.apiVersion,
      at: error.at,
      test,
    };
  }

  private async post(url: string, payload: HaPayload): Promise<HaWebhookResult> {
    try {
      const res = await request(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
      });
      await res.body.dump(); // drain so the socket can be reused
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      return ok
        ? { ok: true, status: res.statusCode }
        : {
            ok: false,
            status: res.statusCode,
            error: `Home Assistant returned ${String(res.statusCode)}`,
          };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Webhook request failed',
      };
    }
  }
}
