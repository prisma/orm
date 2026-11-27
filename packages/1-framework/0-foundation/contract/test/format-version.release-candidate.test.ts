import { readFileSync } from 'node:fs';
import { join } from 'pathe';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CONTRACT_FORMAT,
  convertContractDocument,
  readFormatVersion,
  readStoredDocument,
  type StoredDocument,
  type StoredFormat,
} from '../src/format-version';

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

const REMOVE_FORMAT_VERSION_0 = [
  '8.0.0 must not read the files a release candidate wrote. Remove format version 0:',
  '- 0 from CONTRACT_FORMAT_VERSIONS_READ in packages/1-framework/0-foundation/contract/src/format-version.ts, and from the version lists in packages/1-framework/3-tooling/migration/src/formats/migration-metadata/versions.ts and formats/ref/versions.ts;',
  '- the converters the typecheck then reports: contractV1FromV0, migrationMetadataV1FromV0 and refV1FromV0;',
  '- the version 0 branch of writtenFormatVersion, and the version 0 cases in the error advice (where noReleaseWroteThisFile checks for version 0);',
  '- this test, migration/test/formats/release-candidate-format.test.ts, the other version 0 tests, and test/integration/test/release-candidate-projects/;',
  '- the version 0 text in ADR 331 and in docs/reference/error-reference.md;',
  '- the text that says this release still reads such files, in the stored-files-format-version upgrade instructions, app and extension.',
].join('\n');

const releaseCandidateContract = {
  schemaVersion: '1',
  targetFamily: 'sql',
  target: 'postgres',
  storage: { storageHash: 'h' },
};

describe('format version 0, which only a release candidate wrote', () => {
  it('is a contract with "schemaVersion": "1" and no formatVersion', () => {
    expect(
      readFormatVersion(releaseCandidateContract, {
        kind: 'contract',
        knownVersions: CONTRACT_FORMAT.versions,
      }),
    ).toBe(0);
  });

  it.each(['migration', 'ref'] as const)('is a %s file with no formatVersion', (kind) => {
    expect(readFormatVersion({ hash: 'h', invariants: [] }, { kind, knownVersions: [0, 1] })).toBe(
      0,
    );
  });

  it('is not a contract with neither formatVersion nor schemaVersion', () => {
    expect(
      caught(() =>
        readFormatVersion(
          { targetFamily: 'sql', storage: {} },
          { kind: 'contract', knownVersions: CONTRACT_FORMAT.versions },
        ),
      ),
    ).toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_MISSING' });
  });

  it.each([
    [{ schemaVersion: '2' }],
    [{ schemaVersion: 1 }],
    [{ schemaVersion: '1', formatVersion: 1 }],
    [{ formatVersion: 0 }],
  ])('is not the contract %j', (document) => {
    expect(
      caught(() =>
        readFormatVersion(document, { kind: 'contract', knownVersions: CONTRACT_FORMAT.versions }),
      ),
    ).toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_MISSING' });
  });

  it.each([[{ schemaVersion: '1' }], [{ formatVersion: 0 }]])(
    'is not the migration file %j',
    (document) => {
      expect(
        caught(() => readFormatVersion(document, { kind: 'migration', knownVersions: [0, 1] })),
      ).toMatchObject({ code: 'MIGRATION.FORMAT_VERSION_MISSING' });
    },
  );

  it('is refused by a reader that does not know version 0', () => {
    expect(
      caught(() =>
        readFormatVersion(releaseCandidateContract, { kind: 'contract', knownVersions: [1] }),
      ),
    ).toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_MISSING' });
  });
});

describe('readStoredDocument', () => {
  const format: StoredFormat<readonly [1, 2, 3]> = {
    kind: 'migration',
    versions: [1, 2, 3],
    conversions: {
      2: (document) => ({ ...document, formatVersion: 2, steps: ['to 2'] }),
      3: (document) => ({
        ...document,
        formatVersion: 3,
        steps: [...(Array.isArray(document['steps']) ? document['steps'] : []), 'to 3'],
      }),
    },
  };

  it('returns the newest version as its type', () => {
    expectTypeOf(readStoredDocument({ formatVersion: 3 }, format).formatVersion).toEqualTypeOf<3>();
  });

  it('converts a document one version at a time up to the newest', () => {
    expect(readStoredDocument({ formatVersion: 1, a: 1 }, format)).toEqual({
      formatVersion: 3,
      document: { formatVersion: 3, a: 1, steps: ['to 2', 'to 3'] },
    });
  });

  it('runs only the conversions after the version on disk', () => {
    expect(readStoredDocument({ formatVersion: 2, steps: [] }, format).document).toEqual({
      formatVersion: 3,
      steps: ['to 3'],
    });
  });

  it('returns a document in the newest version as it is', () => {
    const document = { formatVersion: 3, a: 1 };
    expect(readStoredDocument(document, format)).toEqual({ formatVersion: 3, document });
  });

  it('refuses a version it does not know before converting anything, naming the file', () => {
    expect(
      caught(() => readStoredDocument({ formatVersion: 4 }, format, { path: '/m.json' })),
    ).toMatchObject({ code: 'MIGRATION.FORMAT_VERSION_NEWER', where: { path: '/m.json' } });
  });
});

describe('a stored format with a version and no conversion into it', () => {
  it('does not type-check', () => {
    const convert = (document: StoredDocument) => document;
    // @ts-expect-error a conversion into each version after the oldest is required
    const missing: StoredFormat<readonly [1, 2]>['conversions'] = {};
    // @ts-expect-error the oldest version has no conversion into it
    const intoOldest: StoredFormat<readonly [1]>['conversions'] = { 1: convert };
    expect([missing, intoOldest]).toHaveLength(2);
  });

  it('is a bug in Prisma, reported as an internal error', () => {
    const format = {
      kind: 'ref',
      versions: [1, 2],
      conversions: {},
    } as unknown as StoredFormat<readonly [1, 2]>;
    expect(caught(() => readStoredDocument({ formatVersion: 1 }, format))).toMatchObject({
      name: 'InternalError',
      message: 'No conversion to ref format version 2',
    });
  });
});

describe('convertContractDocument', () => {
  it('converts a version 0 contract to the version 1 document the format script writes', () => {
    expect(convertContractDocument(releaseCandidateContract)).toEqual({
      formatVersion: 1,
      targetFamily: 'sql',
      target: 'postgres',
      storage: { storageHash: 'h' },
    });
  });

  it('returns a version 1 contract as it is', () => {
    const document = { formatVersion: 1, targetFamily: 'sql', storage: {} };
    expect(convertContractDocument(document)).toBe(document);
  });

  it('refuses a contract with neither version field, naming the file and the extension', () => {
    expect(
      caught(() =>
        convertContractDocument(
          { targetFamily: 'sql' },
          { path: 'contract.json', bundledIn: 'vectors' },
        ),
      ),
    ).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
      meta: { path: 'contract.json', bundledIn: 'vectors' },
    });
  });
});

describe('while this release reads the files a release candidate wrote', () => {
  it('is a pre-release, so 8.0.0 cannot ship reading them', () => {
    const rootPackage: { version: string } = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../../package.json'), 'utf8'),
    );
    const readsVersion0 = CONTRACT_FORMAT.versions.some((version) => version === 0);
    const isPreRelease = /^\d+\.\d+\.\d+-/.test(rootPackage.version);
    expect(readsVersion0 && !isPreRelease, REMOVE_FORMAT_VERSION_0).toBe(false);
  });
});
