import { describe, expect, it } from 'vitest';
import { contractSpaceFromJson } from '../src/contract-space-from-json';
import { createTestMetadata } from './fixtures';

const HASH = 'd'.repeat(64);
const metadata = createTestMetadata({ to: HASH });
const inputs = {
  spaceId: 'vectors',
  contractJson: { formatVersion: 1, target: 'postgres', storage: { storageHash: HASH } },
  migrations: [
    { dirName: '20260101T0000_install', metadata: { formatVersion: 1, ...metadata }, ops: [] },
  ],
  headRef: { formatVersion: 1, hash: HASH, invariants: [] },
};

function refusal(run: () => unknown): Record<string, unknown> {
  try {
    run();
  } catch (error) {
    return Object(error);
  }
  throw new Error('expected contractSpaceFromJson to refuse the bundled files');
}

describe('contractSpaceFromJson', () => {
  it('reads the bundled files into the in-memory space', () => {
    const space = contractSpaceFromJson(inputs);
    expect(space.migrations).toEqual([{ dirName: '20260101T0000_install', metadata, ops: [] }]);
    expect(space.headRef).toEqual({ hash: HASH, invariants: [] });
    expect(space.contractJson).toBe(inputs.contractJson);
  });

  it('refuses a bundled contract written by a newer release, naming the extension and the file', () => {
    const error = refusal(() =>
      contractSpaceFromJson({
        ...inputs,
        contractJson: { ...inputs.contractJson, formatVersion: 2 },
      }),
    );
    expect(error).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_NEWER',
      message:
        'The contract file "contract.json" of the extension "vectors" was written by a newer release of Prisma',
    });
    expect(error['fix']).toContain('extension "vectors"');
  });

  it('reads every bundled file a release candidate wrote, in the newest format version', () => {
    const { formatVersion: _c, ...contractJson } = inputs.contractJson;
    const { formatVersion: _r, ...headRef } = inputs.headRef;
    const space = contractSpaceFromJson({
      ...inputs,
      contractJson: { schemaVersion: '1', ...contractJson },
      migrations: [{ dirName: '20260101T0000_install', metadata, ops: [] }],
      headRef,
    });
    expect(space).toEqual({
      contractJson: inputs.contractJson,
      migrations: [{ dirName: '20260101T0000_install', metadata, ops: [] }],
      headRef: { hash: HASH, invariants: [] },
    });
  });

  it('refuses a bundled contract with no version field at all, and says the extension must be upgraded or republished', () => {
    const { formatVersion: _, ...contractJson } = inputs.contractJson;
    const error = refusal(() => contractSpaceFromJson({ ...inputs, contractJson }));
    expect(error).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
      message: 'The contract file "contract.json" of the extension "vectors" has no format version',
      fix: 'The extension "vectors" ships this file in its package, so the upgrade instructions cannot change it in your project. Upgrade the extension to a release built for this release of Prisma; if there is none, ask its author to republish it.',
    });
  });

  it('refuses a bundled migration.json written by a newer release, naming the extension and the file', () => {
    const error = refusal(() =>
      contractSpaceFromJson({
        ...inputs,
        migrations: [{ dirName: 'm', metadata: { formatVersion: 2, ...metadata }, ops: [] }],
      }),
    );
    expect(error).toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_NEWER',
      message:
        'The migration file (migration.json) "m/migration.json" of the extension "vectors" was written by a newer release of Prisma',
    });
  });

  it('refuses a bundled migration.json with a field it does not know', () => {
    const error = refusal(() =>
      contractSpaceFromJson({
        ...inputs,
        migrations: [{ dirName: 'm', metadata: { formatVersion: 1, ...metadata, x: 1 }, ops: [] }],
      }),
    );
    expect(error).toMatchObject({ code: 'MIGRATION.INVALID_MANIFEST' });
    expect(JSON.stringify(error)).toContain('the extension \\"vectors\\"');
  });

  it('refuses a bundled head ref with the old schemaVersion field, naming the extension and the file', () => {
    const { formatVersion: _, ...headRef } = inputs.headRef;
    const error = refusal(() =>
      contractSpaceFromJson({ ...inputs, headRef: { schemaVersion: '1', ...headRef } }),
    );
    expect(error).toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_MISSING',
      message: 'The ref file "refs/head.json" of the extension "vectors" has no format version',
    });
  });

  it('refuses a bundled head ref written by a newer release', () => {
    expect(() =>
      contractSpaceFromJson({ ...inputs, headRef: { ...inputs.headRef, formatVersion: 2 } }),
    ).toThrowError(
      expect.objectContaining({ code: 'MIGRATION.FORMAT_VERSION_NEWER' }) as unknown as Error,
    );
  });

  it('refuses a bundled head ref whose hash is not a contract hash, naming the extension', () => {
    const error = refusal(() =>
      contractSpaceFromJson({ ...inputs, headRef: { ...inputs.headRef, hash: `sha256:${HASH}` } }),
    );
    expect(error).toMatchObject({ code: 'MIGRATION.INVALID_REF_FILE' });
    expect(error['why']).toContain('hash must be a contract hash of 64 lowercase hex characters');
    expect(error['why']).toContain('the extension "vectors"');
  });

  it('refuses a bundled head ref with a field the format does not know', () => {
    const error = refusal(() =>
      contractSpaceFromJson({ ...inputs, headRef: { ...inputs.headRef, note: 'x' } }),
    );
    expect(error).toMatchObject({ code: 'MIGRATION.INVALID_REF_FILE' });
    expect(JSON.stringify(error)).toContain('note');
  });

  it('refuses a bundled head ref that declares policies, which a head ref may not', () => {
    const error = refusal(() =>
      contractSpaceFromJson({ ...inputs, headRef: { ...inputs.headRef, policies: {} } }),
    );
    expect(error).toMatchObject({ code: 'MIGRATION.INVALID_REF_FILE' });
    expect(JSON.stringify(error)).toContain('the head ref declares no policies');
  });
});
