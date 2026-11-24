import { UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FORMAT_VERSIONS,
  carriesFormatVersion,
  formatVersionErrorAt,
  isContractBuiltInMemory,
  isFormatVersionError,
  readFormatVersion,
} from '../src/format-version';

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('readFormatVersion', () => {
  it('returns a version it knows', () => {
    expect(
      readFormatVersion(
        { formatVersion: 1, other: 'ignored here' },
        {
          kind: 'contract',
          knownVersions: CONTRACT_FORMAT_VERSIONS,
        },
      ),
    ).toBe(1);
  });

  describe('a version higher than any it knows', () => {
    it('is refused as written by a newer release, naming the file', () => {
      const error = caught(() =>
        readFormatVersion(
          { formatVersion: 2 },
          { kind: 'contract', knownVersions: [1], path: '/p/contract.json' },
        ),
      );
      expect(error).toMatchObject({
        code: 'CONTRACT.FORMAT_VERSION_NEWER',
        message: 'The contract file "/p/contract.json" was written by a newer release of Prisma',
        why: 'It is in format version 2, and this release of Prisma reads format version 1 only.',
        fix: 'Upgrade Prisma to the release that wrote the file, or a later one, and run the command again.',
        where: { path: '/p/contract.json' },
        meta: {
          fileKind: 'contract',
          formatVersion: 2,
          knownFormatVersions: [1],
          path: '/p/contract.json',
        },
      });
      expect(isFormatVersionError(error)).toBe(true);
    });

    it('uses the migration namespace for migration and ref files', () => {
      expect(
        caught(() =>
          readFormatVersion({ formatVersion: 7 }, { kind: 'migration', knownVersions: [1] }),
        ),
      ).toMatchObject({
        code: 'MIGRATION.FORMAT_VERSION_NEWER',
        message: 'The migration file (migration.json) was written by a newer release of Prisma',
      });
      expect(
        caught(() => readFormatVersion({ formatVersion: 7 }, { kind: 'ref', knownVersions: [1] })),
      ).toMatchObject({
        code: 'MIGRATION.FORMAT_VERSION_NEWER',
        message: 'The ref file was written by a newer release of Prisma',
      });
    });

    it('does not look at anything else in the file', () => {
      expect(
        caught(() =>
          readFormatVersion(
            { formatVersion: 2, schemaVersion: '1' },
            { kind: 'contract', knownVersions: [1] },
          ),
        ),
      ).toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_NEWER' });
    });
  });

  describe('no format version', () => {
    const missing = {
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
      message: 'The contract file "/p/contract.json" has no format version',
      fix: `A pre-release of Prisma 8 wrote this file. Follow the upgrade instructions of each release since the one that wrote it; they add the format version: ${UPGRADE_GUIDES_URL}`,
      nextActions: [
        { kind: 'open-url', label: 'Follow the upgrade instructions', url: UPGRADE_GUIDES_URL },
      ],
      where: { path: '/p/contract.json' },
    };
    const read = (document: unknown) =>
      caught(() =>
        readFormatVersion(document, {
          kind: 'contract',
          knownVersions: [1],
          path: '/p/contract.json',
        }),
      );

    it('is refused when the field is absent', () => {
      expect(read({ target: 'postgres' })).toMatchObject({
        ...missing,
        why: 'It has no "formatVersion" field. Files that Prisma 8.0.0 and later write have one; files that a pre-release of Prisma 8 wrote do not.',
      });
    });

    it('is refused when the file has the old schemaVersion field', () => {
      expect(read({ schemaVersion: '1', target: 'postgres' })).toMatchObject({
        ...missing,
        why: 'It has the field "schemaVersion", which a pre-release of Prisma 8 wrote in place of "formatVersion".',
      });
    });

    it('is refused when it has both the old and the new field', () => {
      expect(read({ formatVersion: 1, schemaVersion: '1' })).toMatchObject({
        code: 'CONTRACT.FORMAT_VERSION_MISSING',
      });
    });

    it.each([['1'], [0], [-1], [1.5], [null], [true]])(
      'is refused for formatVersion %j',
      (value) => {
        expect(read({ formatVersion: value })).toMatchObject({
          ...missing,
          why: `Its "formatVersion" is ${JSON.stringify(value)}, which is not a positive integer.`,
        });
      },
    );

    it.each([[null], [[]], ['text'], [3]])('is refused for a document that is %j', (document) => {
      expect(read(document)).toMatchObject({ code: 'CONTRACT.FORMAT_VERSION_MISSING' });
    });

    it('omits the path when the reader does not know it', () => {
      const error = caught(() => readFormatVersion({}, { kind: 'migration', knownVersions: [1] }));
      expect(error).toMatchObject({
        code: 'MIGRATION.FORMAT_VERSION_MISSING',
        message: 'The migration file (migration.json) has no format version',
      });
      expect(error).not.toHaveProperty('where');
    });
  });
});

describe('formatVersionErrorAt', () => {
  it('names the file in an error raised without a path', () => {
    const error = caught(() =>
      readFormatVersion({ formatVersion: 3 }, { kind: 'contract', knownVersions: [1] }),
    );
    if (!isFormatVersionError(error)) throw new Error('expected a format version error');
    expect(formatVersionErrorAt(error, '/q/contract.json')).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_NEWER',
      message: 'The contract file "/q/contract.json" was written by a newer release of Prisma',
      where: { path: '/q/contract.json' },
      meta: { path: '/q/contract.json', formatVersion: 3 },
    });
  });

  it('keeps an error that already names a file', () => {
    const error = caught(() =>
      readFormatVersion({}, { kind: 'ref', knownVersions: [1], path: '/r/head.json' }),
    );
    if (!isFormatVersionError(error)) throw new Error('expected a format version error');
    expect(formatVersionErrorAt(error, '/other.json')).toBe(error);
  });
});

describe('a file an extension package ships', () => {
  it('names the extension and the file, and says the extension must be upgraded or republished', () => {
    const error = caught(() =>
      readFormatVersion(
        { schemaVersion: '1' },
        { kind: 'contract', knownVersions: [1], path: 'contract.json', bundledIn: 'vectors' },
      ),
    );
    expect(error).toMatchObject({
      code: 'CONTRACT.FORMAT_VERSION_MISSING',
      message: 'The contract file "contract.json" of the extension "vectors" has no format version',
      fix: 'The extension "vectors" ships this file in its package, so the upgrade instructions cannot change it in your project. Upgrade the extension to a release built for this release of Prisma; if there is none, ask its author to republish it.',
      meta: { bundledIn: 'vectors', path: 'contract.json' },
    });
  });

  it('says a newer extension needs a newer Prisma, or a release of the extension built for this one', () => {
    const error = caught(() =>
      readFormatVersion(
        { formatVersion: 2 },
        { kind: 'ref', knownVersions: [1], path: 'refs/head.json', bundledIn: 'vectors' },
      ),
    );
    expect(error).toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_NEWER',
      message:
        'The ref file "refs/head.json" of the extension "vectors" was written by a newer release of Prisma',
      fix: 'The extension "vectors" was built for a newer release of Prisma. Upgrade Prisma, or use a release of the extension built for this one.',
    });
  });
});

describe('isFormatVersionError', () => {
  it('is false for other errors', () => {
    expect(isFormatVersionError(new Error('x'))).toBe(false);
    expect(isFormatVersionError({ code: 'CONTRACT.VALIDATION_FAILED', message: 'x' })).toBe(false);
  });
});

describe('carriesFormatVersion', () => {
  it('is true for a stored file, with the new or the old field', () => {
    expect(carriesFormatVersion({ formatVersion: 2 })).toBe(true);
    expect(carriesFormatVersion({ schemaVersion: '1' })).toBe(true);
  });

  it('is false for a contract in memory and for anything that is not an object', () => {
    expect(carriesFormatVersion({ target: 'postgres' })).toBe(false);
    expect(carriesFormatVersion(null)).toBe(false);
    expect(carriesFormatVersion([])).toBe(false);
  });
});

describe('isContractBuiltInMemory', () => {
  class StorageNode {
    readonly storageHash = 'sha256:x';
  }

  it('is true for a contract whose storage Prisma built as an object of a class', () => {
    expect(isContractBuiltInMemory({ target: 'postgres', storage: new StorageNode() })).toBe(true);
  });

  it('is false for a contract read from a file, whose storage is a plain object', () => {
    expect(isContractBuiltInMemory({ target: 'postgres', storage: { storageHash: 'x' } })).toBe(
      false,
    );
    expect(isContractBuiltInMemory(JSON.parse('{"storage":{"storageHash":"x"}}'))).toBe(false);
  });

  it('is false for a value with a version field, whatever its storage', () => {
    expect(isContractBuiltInMemory({ formatVersion: 1, storage: new StorageNode() })).toBe(false);
    expect(isContractBuiltInMemory({ schemaVersion: '1', storage: new StorageNode() })).toBe(false);
  });

  it('is false for a value with no storage, and for anything that is not an object', () => {
    expect(isContractBuiltInMemory({ target: 'postgres' })).toBe(false);
    expect(isContractBuiltInMemory(null)).toBe(false);
    expect(isContractBuiltInMemory([])).toBe(false);
  });
});
