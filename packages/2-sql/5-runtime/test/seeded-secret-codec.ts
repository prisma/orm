// ============================================================================ TEST-ONLY FIXTURE — do not copy into production code.
//
// This helper exists so the async-codec tests exercise the crypto shape of a real encrypted column. It uses AES-GCM with a random 12-byte IV per encryption, stored as `iv:ciphertext`, which is adequate for a test fixture but is not a production-grade codec: * the AES key is deterministically derived from a short string seed; * there is no key rotation, key identifier, associated-data binding, or authenticated envelope
// versioning. A production codec must source keys from a KMS, bind AAD, and carry version/rotation metadata. Treat this file strictly as test plumbing.
//
// Guard against accidental production use. ============================================================================

import { createDecipheriv, createHash } from 'node:crypto';
import { defineTestCodec } from './test-codec';

if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production') {
  throw new Error('seeded-secret-codec is a test fixture and must not be loaded in production');
}

const textEncoder = new TextEncoder();

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function digestBytes(value: string): Promise<Uint8Array<ArrayBuffer>> {
  const encoded = textEncoder.encode(value);
  const input = new Uint8Array(encoded.byteLength);
  input.set(encoded);
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', input));
}

async function importSeedKey(seed: string) {
  const keyBytes = await digestBytes(`${seed}:key`);
  return globalThis.crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptSecret(value: string, seed: string): Promise<string> {
  const key = await importSeedKey(seed);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    textEncoder.encode(value),
  );
  return `${toBase64(iv)}:${toBase64(new Uint8Array(ciphertext))}`;
}

export function decryptSecret(wire: string, seed: string): string {
  const [ivEncoded, ciphertextEncoded, extra] = wire.split(':');
  if (
    ivEncoded === undefined ||
    ciphertextEncoded === undefined ||
    extra !== undefined ||
    ivEncoded.length === 0 ||
    ciphertextEncoded.length === 0
  ) {
    throw new Error('invalid secret payload');
  }

  const key = createHash('sha256').update(`${seed}:key`).digest();
  const ciphertext = Buffer.from(ciphertextEncoded, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(ivEncoded, 'base64'));
  decipher.setAuthTag(ciphertext.subarray(-16));
  return Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]).toString(
    'utf8',
  );
}

/**
 * Build a test codec with WebCrypto async encoding and synchronous Node crypto decoding.
 */
export function createAsyncSecretCodec({
  seed,
  typeId = 'pg/secret@1',
  targetTypes = ['text'],
}: {
  seed: string;
  typeId?: string;
  targetTypes?: readonly string[];
}) {
  return defineTestCodec({
    typeId,
    targetTypes,
    encode: (value: string) => encryptSecret(value, seed),
    decode: (wire: string) => decryptSecret(wire, seed),
  });
}
