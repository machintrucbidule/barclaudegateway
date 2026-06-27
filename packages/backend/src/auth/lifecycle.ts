/**
 * Token lifecycle (contract.md §2.4).
 *
 * Keeps a valid access token available on its own:
 *  - first call performs a full login (no session yet);
 *  - a timer refreshes silently at `exp − 60s`;
 *  - a silent refresh that hits `login_required` falls back to a full re-login;
 *  - `getAccessToken()` refreshes on demand if the token is already past the skew window.
 *
 * Credentials are supplied via an injected loader so this module stays free of storage concerns
 * (the SQLite-backed loader is wired in Sub-phase 2.2).
 */

import { LoginRequiredError } from '../http/errors.js';
import type { HttpClient } from '../http/client.js';
import type { EmitEvent } from '../logging/eventLogger.js';
import type { AuthConfig, Credentials } from './login.js';
import { performFullLogin, performSilentRefresh } from './login.js';
import type { SessionState } from './session.js';
import { SessionStore } from './session.js';

/** Refresh 60 seconds before the token's `exp` (contract.md §2.4). */
export const REFRESH_SKEW_MS = 60_000;

export interface TokenLifecycleDeps {
  http: HttpClient;
  config: AuthConfig;
  loadCredentials: () => Promise<Credentials>;
  /** Optional sink called whenever the session changes (e.g. to persist the cookie in 2.2). */
  onSession?: (session: SessionState) => void;
  /** Optional operational-log emit (BL-003): per-PKCE-step + refresh/re-login lines. */
  emit?: EmitEvent;
  store?: SessionStore;
  skewMs?: number;
  /**
   * Whether to keep the token alive with a background refresh timer (BL-006). `true` (default) arms a
   * silent refresh ~`skewMs` before each `exp`; `false` (lazy mode) never arms the timer, so the token
   * is refreshed only on demand by `getAccessToken()` when a scan needs it. The default keeps the
   * historical keep-alive behaviour for callers that don't set it.
   */
  keepAlive?: boolean;
  /** Injectable clock for deterministic tests. */
  now?: () => number;
}

export class TokenLifecycle {
  private readonly http: HttpClient;
  private readonly config: AuthConfig;
  private readonly loadCredentials: () => Promise<Credentials>;
  private readonly onSession?: (session: SessionState) => void;
  private readonly emit?: EmitEvent;
  private readonly store: SessionStore;
  private readonly skewMs: number;
  private readonly keepAlive: boolean;
  private readonly now: () => number;

  private timer: ReturnType<typeof setTimeout> | null = null;
  /** De-dupes concurrent refreshes so callers share one in-flight attempt. */
  private inFlight: Promise<SessionState> | null = null;

  constructor(deps: TokenLifecycleDeps) {
    this.http = deps.http;
    this.config = deps.config;
    this.loadCredentials = deps.loadCredentials;
    this.onSession = deps.onSession;
    this.emit = deps.emit;
    this.store = deps.store ?? new SessionStore();
    this.skewMs = deps.skewMs ?? REFRESH_SKEW_MS;
    this.keepAlive = deps.keepAlive ?? true;
    this.now = deps.now ?? Date.now;
  }

  /** Milliseconds until the scheduled refresh, never negative. */
  msUntilRefresh(session: SessionState, from = this.now()): number {
    return Math.max(0, session.expiresAtMs - this.skewMs - from);
  }

  /** Ensure a valid session exists, then arm the refresh timer. */
  async start(): Promise<string> {
    const token = await this.getAccessToken();
    return token;
  }

  /** Return a valid access token, refreshing (or logging in) if needed. */
  async getAccessToken(): Promise<string> {
    const current = this.store.get();
    if (current && !this.store.isExpired(this.skewMs, this.now())) {
      return current.accessToken;
    }
    const session = await this.refresh();
    return session.accessToken;
  }

  /**
   * Refresh the session now: silent refresh when a cookie is available, full login otherwise or on
   * `login_required`. Concurrent calls await the same in-flight attempt.
   */
  async refresh(): Promise<SessionState> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.doRefresh().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async doRefresh(): Promise<SessionState> {
    const current = this.store.get();
    let session: SessionState;
    if (current?.cookieHeader) {
      try {
        session = await performSilentRefresh(
          this.http,
          this.config,
          current.cookieHeader,
          this.emit,
        );
      } catch (error) {
        if (error instanceof LoginRequiredError) {
          this.emit?.({
            category: 'auth',
            type: 'login_required',
            level: 'warn',
            message: 'Reach5 session expired (login_required) — performing a full re-login',
          });
          session = await performFullLogin(
            this.http,
            this.config,
            await this.loadCredentials(),
            this.emit,
          );
          this.emit?.({
            category: 'auth',
            type: 'full_relogin',
            level: 'info',
            message: 'Full re-login complete after login_required',
          });
        } else {
          throw error;
        }
      }
    } else {
      session = await performFullLogin(
        this.http,
        this.config,
        await this.loadCredentials(),
        this.emit,
      );
    }
    this.store.set(session);
    this.onSession?.(session);
    // Lazy mode (keepAlive=false) never arms the background timer: the token simply expires and the
    // next on-demand getAccessToken() refreshes it (BL-006).
    if (this.keepAlive) this.scheduleRefresh(session);
    return session;
  }

  private scheduleRefresh(session: SessionState): void {
    this.stop();
    const delay = this.msUntilRefresh(session);
    this.timer = setTimeout(() => {
      void this.refresh().catch(() => {
        // Swallow here: the next getAccessToken() retries and surfaces the error to the caller.
      });
    }, delay);
    // Don't keep the event loop alive solely for the refresh timer.
    this.timer.unref?.();
  }

  /** Cancel the scheduled refresh (e.g. on shutdown). */
  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** Current session snapshot, or `null`. */
  getSession(): SessionState | null {
    return this.store.get();
  }

  /**
   * Whether a *live* session exists — i.e. a non-expired access token (within the refresh skew). Used
   * by the lazy-mode health gate to decide whether the passive self-test should run without forcing a
   * login (BL-006). An expired-but-present session counts as not live.
   */
  hasLiveSession(): boolean {
    return !this.store.isExpired(this.skewMs, this.now());
  }
}
