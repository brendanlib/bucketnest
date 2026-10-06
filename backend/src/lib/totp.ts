import { createHmac, randomBytes } from 'node:crypto';

/** RFC 6238 TOTP with the settings every authenticator app supports: SHA-1, 30 s, 6 digits. */
export const TOTP_PERIOD_S = 30;
const DIGITS = 6;
/** Accept the previous and next step too, for clock drift (about ±30 s). */
const WINDOW = 1;

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 encoded (what authenticator apps expect). */
export const newTotpSecret = () => base32Encode(randomBytes(20));

export const stepAt = (nowMs: number) => Math.floor(nowMs / 1000 / TOTP_PERIOD_S);

export function totpCode(secretBase32: string, step: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secretBase32)).update(msg).digest();
  const off = h[h.length - 1]! & 0x0f;
  const bin = ((h[off]! & 0x7f) << 24) | (h[off + 1]! << 16) | (h[off + 2]! << 8) | h[off + 3]!;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

/**
 * The step a code is valid for, or null. Steps at or before `lastStep` are
 * refused, so a code can't be used twice (or an older one replayed).
 */
export function verifyTotp(secretBase32: string, code: string, nowMs: number, lastStep: number | null): number | null {
  const digits = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(digits)) return null;
  const now = stepAt(nowMs);
  for (let s = now - WINDOW; s <= now + WINDOW; s++) {
    if (lastStep !== null && s <= lastStep) continue;
    if (totpCode(secretBase32, s) === digits) return s;
  }
  return null;
}

export function otpauthUri(secretBase32: string, account: string, issuer = 'Home Budget'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const q = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_PERIOD_S) });
  return `otpauth://totp/${label}?${q}`;
}

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
/** Ten codes like "k7m2-x9qp". */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const b = randomBytes(8);
    const chars = [...b].map((x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
}

export const normaliseRecoveryCode = (code: string) => code.toLowerCase().replace(/[^a-z0-9]/g, '');
