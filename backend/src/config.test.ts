import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.js';

const base = {
  DATABASE_URL: 'postgresql://x@localhost/db',
  PUBLIC_URL: 'https://budget.example.com',
  SESSION_SECRET: 'a'.repeat(64),
};

describe('config', () => {
  it('refuses to start without a strong SESSION_SECRET', () => {
    expect(() => loadConfig({ ...base, SESSION_SECRET: undefined })).toThrow(ConfigError);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'short' })).toThrow(/at least 32/);
    expect(() => loadConfig({ ...base, SESSION_SECRET: 'change-me' })).toThrow(ConfigError);
  });

  it('parses the registration switch', () => {
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: '' }).allowRegistration).toBeUndefined();
    expect(loadConfig(base).allowRegistration).toBeUndefined();
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: 'true' }).allowRegistration).toBe(true);
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: 'false' }).allowRegistration).toBe(false);
    expect(() => loadConfig({ ...base, ALLOW_REGISTRATION: 'maybe' })).toThrow(ConfigError);
  });

  it('ignores a trailing comment that Docker Compose passed through as the value', () => {
    // KEY=   # note  arrives as "# note" when the setting is blank.
    expect(loadConfig({ ...base, ALLOW_REGISTRATION: '# blank = open only until the first user' }).allowRegistration).toBeUndefined();
    expect(loadConfig({ ...base, COOKIE_SECURE: 'false   # plain-HTTP testing' }).cookieSecure).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: '1 # one proxy' }).trustProxy).toBeTypeOf('function');
    // Secrets are taken exactly as given.
    expect(loadConfig({ ...base, SMTP_HOST: 'smtp.example.com', SMTP_PASS: 'p#ss word' }).smtp?.pass).toBe('p#ss word');
    // And a bad value says what it got.
    expect(() => loadConfig({ ...base, ALLOW_REGISTRATION: 'yes' })).toThrow(/ALLOW_REGISTRATION.*got "yes"/);
  });

  it('derives cookie security and origin from PUBLIC_URL', () => {
    const https = loadConfig(base);
    expect(https.cookieSecure).toBe(true);
    expect(https.publicOrigin).toBe('https://budget.example.com');
    expect(loadConfig({ ...base, PUBLIC_URL: 'http://localhost:8080' }).cookieSecure).toBe(false);
    expect(loadConfig({ ...base, COOKIE_SECURE: 'false' }).cookieSecure).toBe(false);
  });

  it('parses TRUST_PROXY as off, hop count, true or an address list', () => {
    expect(loadConfig(base).trustProxy).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true);
    const hops = loadConfig({ ...base, TRUST_PROXY: '1' }).trustProxy as (a: string, i: number) => boolean;
    expect(hops('10.0.0.1', 0)).toBe(true);
    expect(hops('10.0.0.2', 1)).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: '172.16.0.0/12, 10.0.0.1' }).trustProxy).toEqual(['172.16.0.0/12', '10.0.0.1']);
  });

  it('adds the bundled nginx hop on top of TRUST_PROXY', () => {
    const onlyNginx = loadConfig({ ...base, INTERNAL_PROXY_HOPS: '1' }).trustProxy as (a: string, i: number) => boolean;
    expect(onlyNginx('172.18.0.3', 0)).toBe(true);
    expect(onlyNginx('203.0.113.9', 1)).toBe(false);
    const both = loadConfig({ ...base, TRUST_PROXY: '1', INTERNAL_PROXY_HOPS: '1' }).trustProxy as (a: string, i: number) => boolean;
    expect(both('x', 1)).toBe(true);
    expect(both('x', 2)).toBe(false);
    expect(loadConfig({ ...base, TRUST_PROXY: '10.0.0.1', INTERNAL_PROXY_HOPS: '1' }).trustProxy).toEqual(['10.0.0.1', 'uniquelocal', 'loopback']);
  });

  it('enables SMTP only when a host is set', () => {
    expect(loadConfig(base).smtp).toBeNull();
    expect(loadConfig({ ...base, SMTP_HOST: 'smtp.example.com' }).smtp).toMatchObject({ host: 'smtp.example.com', port: 587, from: 'BucketNest <no-reply@budget.example.com>' });
  });

  it('rejects an invalid default time zone', () => {
    expect(() => loadConfig({ ...base, DEFAULT_TIMEZONE: 'Nowhere/City' })).toThrow(/time zone/);
  });
});
