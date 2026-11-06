import { describe, expect, it } from 'vitest';
import {
  contractSnapshotJsonSpecifier,
  contractSnapshotTypesSpecifier,
  isStorageHashHex,
  storageHashHex,
} from '../src/control/contract-snapshot-layout';

const VALID_HASH = 'a'.repeat(64);

describe('isStorageHashHex', () => {
  it('accepts 64 lowercase hex characters', () => {
    expect(isStorageHashHex(VALID_HASH)).toBe(true);
  });

  it('rejects a prefixed hash', () => {
    expect(isStorageHashHex(`sha256:${VALID_HASH}`)).toBe(false);
  });
});

describe('storageHashHex', () => {
  it('returns a valid 64-hex hash unchanged', () => {
    expect(storageHashHex(VALID_HASH)).toBe('a'.repeat(64));
  });

  it('throws on a legacy sha256:-prefixed hash', () => {
    expect(() => storageHashHex(`sha256:${'a'.repeat(64)}`)).toThrow();
  });

  it('throws on an algorithm-prefixed hash', () => {
    expect(() => storageHashHex(`md5:${'a'.repeat(64)}`)).toThrow();
  });

  it('throws when the hex portion is too short', () => {
    expect(() => storageHashHex('a'.repeat(63))).toThrow();
  });

  it('throws when the hex portion is too long', () => {
    expect(() => storageHashHex('a'.repeat(65))).toThrow();
  });

  it('throws on uppercase hex characters', () => {
    expect(() => storageHashHex('A'.repeat(64))).toThrow();
  });

  it('throws on non-hex characters', () => {
    expect(() => storageHashHex('g'.repeat(64))).toThrow();
  });

  it('throws on an empty string', () => {
    expect(() => storageHashHex('')).toThrow();
  });

  it('names the offending value in the error message', () => {
    expect(() => storageHashHex('bogus')).toThrow('bogus');
  });
});

describe('contractSnapshotJsonSpecifier', () => {
  it('builds the contract.json specifier', () => {
    expect(contractSnapshotJsonSpecifier('../../snapshots', VALID_HASH)).toBe(
      `../../snapshots/${'a'.repeat(64)}/contract.json`,
    );
  });

  it('throws on a malformed storage hash', () => {
    expect(() => contractSnapshotJsonSpecifier('../../snapshots', 'not-a-hash')).toThrow();
  });
});

describe('contractSnapshotTypesSpecifier', () => {
  it('builds the extension-less contract type specifier', () => {
    expect(contractSnapshotTypesSpecifier('../snapshots', VALID_HASH)).toBe(
      `../snapshots/${'a'.repeat(64)}/contract`,
    );
  });

  it('throws on a malformed storage hash', () => {
    expect(() => contractSnapshotTypesSpecifier('../snapshots', 'not-a-hash')).toThrow();
  });
});
