import { describe, expect, it } from 'vitest';
import { contractSpaceFromJson } from '../src/contract-space-from-json';
import { createTestMetadata } from './fixtures';

const HASH = 'd'.repeat(64);
const metadata = createTestMetadata({ to: HASH });
const inputs = {
  contractJson: { formatVersion: 1, target: 'postgres', storage: { storageHash: HASH } },
  migrations: [
    { dirName: '20260101T0000_install', metadata: { formatVersion: 1, ...metadata }, ops: [] },
  ],
  headRef: { formatVersion: 1, hash: HASH, invariants: [] },
};

describe('contractSpaceFromJson', () => {
  it('reads the bundled files into the in-memory space', () => {
    const space = contractSpaceFromJson(inputs);
    expect(space.migrations).toEqual([{ dirName: '20260101T0000_install', metadata, ops: [] }]);
    expect(space.headRef).toEqual({ hash: HASH, invariants: [] });
    expect(space.contractJson).toBe(inputs.contractJson);
  });

  it('refuses a bundled contract written by a newer release', () => {
    expect(() =>
      contractSpaceFromJson({
        ...inputs,
        contractJson: { ...inputs.contractJson, formatVersion: 2 },
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'CONTRACT.FORMAT_VERSION_NEWER' }) as unknown as Error,
    );
  });

  it('refuses a bundled contract with no format version', () => {
    const { formatVersion: _, ...contractJson } = inputs.contractJson;
    expect(() =>
      contractSpaceFromJson({ ...inputs, contractJson: { schemaVersion: '1', ...contractJson } }),
    ).toThrowError(
      expect.objectContaining({ code: 'CONTRACT.FORMAT_VERSION_MISSING' }) as unknown as Error,
    );
  });

  it('refuses a bundled migration.json written by a newer release', () => {
    expect(() =>
      contractSpaceFromJson({
        ...inputs,
        migrations: [{ dirName: 'm', metadata: { formatVersion: 2, ...metadata }, ops: [] }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'MIGRATION.FORMAT_VERSION_NEWER' }) as unknown as Error,
    );
  });

  it('refuses a bundled migration.json with a field it does not know', () => {
    expect(() =>
      contractSpaceFromJson({
        ...inputs,
        migrations: [{ dirName: 'm', metadata: { formatVersion: 1, ...metadata, x: 1 }, ops: [] }],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'MIGRATION.INVALID_MANIFEST' }) as unknown as Error,
    );
  });

  it('refuses a bundled head ref written by a newer release', () => {
    expect(() =>
      contractSpaceFromJson({ ...inputs, headRef: { ...inputs.headRef, formatVersion: 2 } }),
    ).toThrowError(
      expect.objectContaining({ code: 'MIGRATION.FORMAT_VERSION_NEWER' }) as unknown as Error,
    );
  });

  it('refuses a bundled head ref with a field it does not know', () => {
    expect(() =>
      contractSpaceFromJson({ ...inputs, headRef: { ...inputs.headRef, policies: {} } }),
    ).toThrowError(
      expect.objectContaining({ code: 'MIGRATION.INVALID_REF_FILE' }) as unknown as Error,
    );
  });
});
