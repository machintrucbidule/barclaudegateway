import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthError, NotConfiguredError } from '../http/errors.js';
import type { Database } from './db.js';
import { openDatabase } from './db.js';
import {
  createCredentialsLoader,
  CredentialStore,
  decryptCredentials,
  encryptCredentials,
} from './credentials.js';

const KEY = randomBytes(32);
const CREDS = { email: 'user@example.com', password: 's3cr3t!' };

describe('AES-256-GCM round trip', () => {
  it('decrypts what it encrypts', () => {
    const blob = encryptCredentials(KEY, CREDS);
    expect(blob.iv).toHaveLength(12);
    expect(decryptCredentials(KEY, blob)).toEqual(CREDS);
  });

  it('fails the auth-tag check with a wrong key', () => {
    const blob = encryptCredentials(KEY, CREDS);
    expect(() => decryptCredentials(randomBytes(32), blob)).toThrow();
  });
});

describe('CredentialStore', () => {
  let db: Database;
  let store: CredentialStore;

  beforeEach(() => {
    db = openDatabase(':memory:');
    store = new CredentialStore(db, KEY);
  });

  afterEach(() => {
    db.close();
  });

  it('saves, loads, reports presence, and clears', () => {
    expect(store.has()).toBe(false);
    expect(store.load()).toBeNull();

    store.save(CREDS);
    expect(store.has()).toBe(true);
    expect(store.load()).toEqual(CREDS);

    store.clear();
    expect(store.has()).toBe(false);
    expect(store.load()).toBeNull();
  });

  it('overwrites the previous credentials on re-save', () => {
    store.save(CREDS);
    store.save({ email: 'new@example.com', password: 'other' });
    expect(store.load()).toEqual({ email: 'new@example.com', password: 'other' });
  });

  it('raises an AuthError when the master key is wrong', () => {
    store.save(CREDS);
    const wrongStore = new CredentialStore(db, randomBytes(32));
    expect(() => wrongStore.load()).toThrow(AuthError);
  });
});

describe('createCredentialsLoader', () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('yields stored credentials', async () => {
    const store = new CredentialStore(db, KEY);
    store.save(CREDS);
    await expect(createCredentialsLoader(store)()).resolves.toEqual(CREDS);
  });

  it('rejects with NotConfiguredError (benign, not an auth failure) when none are configured', async () => {
    const store = new CredentialStore(db, KEY);
    const rejection = createCredentialsLoader(store)();
    await expect(rejection).rejects.toBeInstanceOf(NotConfiguredError);
    await expect(rejection).rejects.toMatchObject({ category: 'not_configured' });
  });
});
