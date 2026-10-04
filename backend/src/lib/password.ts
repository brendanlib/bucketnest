import argon2 from 'argon2';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

/** OWASP minimums for Argon2id: 19 MiB memory, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = { type: argon2.argon2id, memoryCost: 19 * 1024, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 256;

let common: Set<string> | null = null;
function commonPasswords(): Set<string> {
  if (!common) {
    const file = fileURLToPath(new URL('../seed/common-passwords.txt', import.meta.url));
    common = new Set(readFileSync(file, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean));
  }
  return common;
}

/** Returns a reason the password is unacceptable, or null if it is fine. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters`;
  const lower = password.toLowerCase();
  if (commonPasswords().has(lower)) return 'This password is too common. Choose something harder to guess';
  if (/^(.)\1+$/.test(password)) return 'This password is too easy to guess';
  if (context.email && lower === context.email.toLowerCase()) return 'Do not use your email address as your password';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** A hash to verify against when the user does not exist, so timing does not reveal accounts. */
let dummyHash: Promise<string> | null = null;
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  return dummyHash;
}

/** A readable random password for the CLI reset: 4 groups of 5 characters. */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(20);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]);
  return [0, 5, 10, 15].map((i) => chars.slice(i, i + 5).join('')).join('-');
}
