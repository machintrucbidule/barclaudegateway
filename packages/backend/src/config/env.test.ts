import { describe, expect, it } from 'vitest';
import { generateMasterKeyHex, loadEnv, parseMasterKey, parsePort } from './env.js';

const HEX_32 = 'a'.repeat(64); // 32 bytes in hex

describe('parseMasterKey', () => {
  it('accepts 64 hex chars', () => {
    expect(parseMasterKey(HEX_32)).toHaveLength(32);
  });

  it('accepts base64 of 32 bytes', () => {
    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(parseMasterKey(b64)).toHaveLength(32);
  });

  it('rejects keys that do not decode to 32 bytes', () => {
    expect(() => parseMasterKey('tooshort')).toThrow(/32 bytes/);
    expect(() => parseMasterKey('ff'.repeat(16))).toThrow(/32 bytes/);
  });
});

describe('loadEnv', () => {
  it('throws a clear error when BCG_MASTER_KEY is missing', () => {
    expect(() => loadEnv({})).toThrow(/BCG_MASTER_KEY is required/);
    expect(() => loadEnv({ BCG_MASTER_KEY: '   ' })).toThrow(/BCG_MASTER_KEY is required/);
  });

  it('returns the parsed key and the default db path, port and host', () => {
    const env = loadEnv({ BCG_MASTER_KEY: HEX_32 });
    expect(env.masterKey).toHaveLength(32);
    expect(env.dbPath).toBe('./data/barclaudegateway.sqlite');
    expect(env.port).toBe(8090);
    expect(env.host).toBe('0.0.0.0');
  });

  it('honours BCG_DB_PATH, BCG_PORT and BCG_HOST when set', () => {
    const env = loadEnv({
      BCG_MASTER_KEY: HEX_32,
      BCG_DB_PATH: '/data/custom.sqlite',
      BCG_PORT: '9000',
      BCG_HOST: '127.0.0.1',
    });
    expect(env.dbPath).toBe('/data/custom.sqlite');
    expect(env.port).toBe(9000);
    expect(env.host).toBe('127.0.0.1');
  });
});

describe('parsePort', () => {
  it('defaults to 8090 when unset or blank', () => {
    expect(parsePort(undefined)).toBe(8090);
    expect(parsePort('  ')).toBe(8090);
  });

  it('parses a valid port', () => {
    expect(parsePort('3000')).toBe(3000);
  });

  it('rejects out-of-range or non-integer ports', () => {
    expect(() => parsePort('0')).toThrow(/1\.\.65535/);
    expect(() => parsePort('70000')).toThrow(/1\.\.65535/);
    expect(() => parsePort('abc')).toThrow(/1\.\.65535/);
  });
});

describe('generateMasterKeyHex', () => {
  it('produces a valid 64-hex-char key', () => {
    const hex = generateMasterKeyHex();
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    expect(parseMasterKey(hex)).toHaveLength(32);
  });
});
