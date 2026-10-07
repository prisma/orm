// ============================================================================ TEST-ONLY FIXTURE — do not copy into production code.
//
// This helper exists so the async-codec tests exercise the crypto shape of a real encrypted column. It uses AES-GCM with a random 12-byte IV per encryption, stored as `iv:ciphertext`, which is adequate for a test fixture but is not a production-grade codec: * the AES key is deterministically derived from a short string seed; * there is no key rotation, key identifier, associated-data binding, or authenticated envelope
// versioning. A production codec must source keys from a KMS, bind AAD, and carry version/rotation metadata. Treat this file strictly as test plumbing.
//
// Guard against accidental production use. ============================================================================

import { defineTestCodec } from './test-codec';

if (typeof process !== 'undefined' && process.env?.['NODE_ENV'] === 'production') {
  throw new Error('seeded-secret-codec is a test fixture and must not be loaded in production');
}

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

// Return a `Uint8Array<ArrayBuffer>` (not `Uint8Array<ArrayBufferLike>`) so the value
// satisfies WebCrypto's `BufferSource` parameters, which require an `ArrayBuffer`-
// backed view in newer DOM lib typings.
function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const decoded = Buffer.from(value, 'base64');
  const out = new Uint8Array(decoded.byteLength);
  out.set(decoded);
  return out;
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

export async function decryptSecret(wire: string, seed: string): Promise<string> {
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

  const key = await importSeedKey(seed);
  const plaintext = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(ivEncoded) },
    key,
    fromBase64(ciphertextEncoded),
  );
  return textDecoder.decode(plaintext);
}

/**
 * Build a `Codec` whose query-time `encode` / `decode` are async crypto operations. Authors pass the underlying async functions directly to `defineTestCodec({...})`; the single-path runtime always awaits them, so the codec needs no async marker.
 */
export function createAsyncSecretCodec({
  seed,
  typeId = 'pg/secret@1',
}: {
  seed: string;
  typeId?: string;
}) {
  return defineTestCodec({
    typeId,
    encode: (value: string) => encryptSecret(value, seed),
    decode: (wire: string) => decryptSecret(wire, seed),
  });
}
