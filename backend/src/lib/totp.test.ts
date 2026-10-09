import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, newRecoveryCodes, normaliseRecoveryCode, otpauthUri, stepAt, totpCode, verifyTotp } from './totp.js';

// RFC 6238 appendix B: SHA-1 seed "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors (8 digits)', () => {
    const cases: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, code] of cases) expect(totpCode(RFC_SECRET, stepAt(t * 1000), 8)).toBe(code);
  });

  it('round-trips base32 and rejects junk', () => {
    const buf = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base32Decode(base32Encode(buf))).toEqual(buf);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(() => base32Decode('not base32!')).toThrow();
  });

  it('accepts the current code and one step either side, but never the same step twice', () => {
    const now = 1_790_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, null)).toBe(step);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 1), now, null)).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step + 1), now, null)).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step - 2), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, step), now, step)).toBeNull(); // replay
    expect(verifyTotp(RFC_SECRET, '12345', now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, ` ${totpCode(RFC_SECRET, step).slice(0, 3)} ${totpCode(RFC_SECRET, step).slice(3)} `, now, null)).toBe(step);
  });

  it('builds the otpauth link and readable recovery codes', () => {
    expect(otpauthUri('ABC', 'sam@example.com')).toBe('otpauth://totp/BucketNest%3Asam%40example.com?secret=ABC&issuer=BucketNest&algorithm=SHA1&digits=6&period=30');
    const codes = newRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
    expect(normaliseRecoveryCode(' K7M2 X9QP ')).toBe('k7m2x9qp');
  });
});
