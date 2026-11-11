import { Buffer } from 'buffer';
import { sha256 } from '@bitauth/libauth';
export { Buffer };
export const hash256 = (bytes: Uint8Array): Buffer => Buffer.from(sha256.hash(sha256.hash(bytes)));
export const sha256Bytes = (bytes: Uint8Array): Buffer => Buffer.from(sha256.hash(bytes));
