import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/** 256-bit random value, base64url encoded. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function hmac(secret: string, purpose: string, value: string): string {
  return createHmac('sha256', secret).update(`${purpose}:${value}`).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * AES-256-GCM for secrets the app must read back (bank tokens). The key is
 * derived from SESSION_SECRET with HKDF, so changing SESSION_SECRET means
 * reconnecting banks. Output: v1.<iv>.<tag>.<ciphertext>, base64url.
 */
function secretKey(secret: string, purpose: string): Buffer {
  // 'home-budget' (the app's old name) is part of the key. Don't rename it: stored Up tokens and
  // two-step secrets would no longer decrypt.
  return Buffer.from(hkdfSync('sha256', secret, 'home-budget', `secretbox:${purpose}`, 32));
}

export function seal(secret: string, purpose: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

/** Throws if the value was tampered with or sealed with another key. */
export function open(secret: string, purpose: string, sealed: string): string {
  const [v, iv, tag, body] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || body === undefined) throw new Error('Unrecognised sealed value');
  const decipher = createDecipheriv('aes-256-gcm', secretKey(secret, purpose), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}
