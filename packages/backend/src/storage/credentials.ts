/**
 * Encrypted-at-rest Chronodrive credentials (DECISION-003, contract.md §8).
 *
 * The email/password pair is AES-256-GCM encrypted with the env-supplied master key and stored as a
 * single row. GCM is authenticated: a wrong key (or tampered ciphertext) fails the auth-tag check on
 * decrypt and throws — it never returns garbage. Plaintext credentials exist only transiently in
 * memory during encrypt/decrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { AuthError, NotConfiguredError } from '../http/errors.js';
import type { Credentials } from '../auth/login.js';
import type { Database } from './db.js';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // GCM standard nonce length

export interface EncryptedBlob {
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

export function encryptCredentials(key: Buffer, credentials: Credentials): EncryptedBlob {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(credentials), 'utf8');
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return { iv, authTag: cipher.getAuthTag(), ciphertext };
}

export function decryptCredentials(key: Buffer, blob: EncryptedBlob): Credentials {
  const decipher = createDecipheriv(ALGORITHM, key, blob.iv);
  decipher.setAuthTag(blob.authTag);
  const plaintext = Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString('utf8')) as Credentials;
}

/** Coerce a SQLite BLOB read (Uint8Array) into a Buffer for the crypto APIs. */
function toBuffer(value: unknown): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value as Uint8Array);
}

export class CredentialStore {
  constructor(
    private readonly db: Database,
    private readonly masterKey: Buffer,
    private readonly now: () => number = Date.now,
  ) {}

  /** Encrypt and store the credentials, replacing any previous row. */
  save(credentials: Credentials): void {
    const { iv, authTag, ciphertext } = encryptCredentials(this.masterKey, credentials);
    this.db
      .prepare(
        `INSERT INTO credentials (id, iv, auth_tag, ciphertext, updated_at) VALUES (1, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET iv = excluded.iv, auth_tag = excluded.auth_tag,
           ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`,
      )
      .run(iv, authTag, ciphertext, this.now());
  }

  /** Load and decrypt the credentials, or `null` if none are stored. Throws on a wrong master key. */
  load(): Credentials | null {
    const row = this.db
      .prepare('SELECT iv, auth_tag, ciphertext FROM credentials WHERE id = 1')
      .get() as { iv: Uint8Array; auth_tag: Uint8Array; ciphertext: Uint8Array } | undefined;
    if (!row) return null;
    try {
      return decryptCredentials(this.masterKey, {
        iv: toBuffer(row.iv),
        authTag: toBuffer(row.auth_tag),
        ciphertext: toBuffer(row.ciphertext),
      });
    } catch (cause) {
      throw new AuthError('Failed to decrypt stored credentials (wrong BCG_MASTER_KEY?)', {
        cause,
      });
    }
  }

  has(): boolean {
    const row = this.db.prepare('SELECT 1 AS present FROM credentials WHERE id = 1').get();
    return row !== undefined;
  }

  clear(): void {
    this.db.prepare('DELETE FROM credentials WHERE id = 1').run();
  }
}

/**
 * Bridge the credential store to the auth lifecycle: a loader that yields the stored credentials or
 * signals — via the benign {@link NotConfiguredError}, not an `auth` failure — that none are saved yet,
 * so callers (scan pipeline, health self-test, destinations) treat "not configured" as an
 * informational state rather than a critical breakage.
 */
export function createCredentialsLoader(store: CredentialStore): () => Promise<Credentials> {
  return async () => {
    const credentials = store.load();
    if (!credentials) {
      throw new NotConfiguredError('No Chronodrive credentials configured');
    }
    return credentials;
  };
}
