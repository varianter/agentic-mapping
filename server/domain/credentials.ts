import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// Only hashes of browser tokens and link credentials are ever stored.
export const hashCredential = (credential: string) => createHash('sha256').update(credential).digest('hex');
export const sameDigest = (a: string, b: string) => timingSafeEqual(Buffer.from(hashCredential(a), 'hex'), Buffer.from(hashCredential(b), 'hex'));
export const newToken = () => randomBytes(32).toString('hex');
export const isToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
