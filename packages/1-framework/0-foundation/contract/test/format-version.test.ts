import { InternalError } from '@internal/utils/internal-error';
import { UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_FORMAT_VERSIONS,
  carriesFormatVersion,
  convertContractDocument,
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
    it('names only the versions a file can declare', () => {
      expect(
        caught(() =>
          readFormatVersion({ formatVersion: 2 }, { kind: 'migration', knownVersions: [0, 1] }),
        ),
      ).toMatchObject({
        why: 'It is in format version 2, and this release of Prisma reads format version 1 only.',
        meta: { knownFormatVersions: [1] },
      });
    });

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
      where: { path: '/p/contract.json' },
    };
    const upgradeAdvice = {
      fix: `A pre-release of Prisma 8 wrote this file. Follow the upgrade instructions of each release since the one that wrote it; they add the format version: ${UPGRADE_GUIDES_URL}`,
      nextActions: [
        { kind: 'open-url', label: 'Follow the upgrade instructions', url: UPGRADE_GUIDES_URL },
      ],
    };
    const emitAdvice = {
      fix: 'No release of Prisma wrote this file. Restore it from version control. If it is the contract.json that `{bin} contract emit` writes, you can emit it again instead; a contract snapshot in the migrations folder cannot be emitted again.',
      nextActions: [
        { kind: 'user-choice', label: 'Restore the file from version control' },
        {
          kind: 'run-command',
          label: 'Or, if it is the emitted contract.json, emit the contract again',
          command: '{bin} contract emit',
        },
      ],
    };
    const read = (document: unknown, knownVersions: readonly number[] = [1]) =>
      caught(() =>
        readFormatVersion(document, {
          kind: 'contract',
          knownVersions,
          path: '/p/contract.json',
        }),
      );

    it('advises a contract snapshot no release wrote to be restored, not emitted', () => {
      expect(
        caught(() =>
          convertContractDocument(
            { target: 'postgres' },
            { path: '/m/snapshots/abc/contract.json', snapshot: true },
          ),
        ),
      ).toMatchObject({
        code: 'CONTRACT.FORMAT_VERSION_MISSING',
        message: 'The contract snapshot "/m/snapshots/abc/contract.json" has no format version',
        fix: 'No release of Prisma wrote this file. Restore it from version control; `{bin} contract emit` does not rewrite a snapshot.',
        nextActions: [{ kind: 'user-choice', label: 'Restore the snapshot from version control' }],
      });
    });

    it('is refused when both fields are absent, as a contract no release wrote', () => {
      expect(read({ target: 'postgres' })).toMatchObject({
        ...missing,
        ...emitAdvice,
        why: 'It has neither "formatVersion" nor "schemaVersion". Every release of Prisma 8 wrote one of them into a contract.',
      });
    });

    it('is refused when the file has the old schemaVersion field, as a file a pre-release wrote', () => {
      expect(read({ schemaVersion: '1', target: 'postgres' })).toMatchObject({
        ...missing,
        ...upgradeAdvice,
        why: 'It has the field "schemaVersion", which a pre-release of Prisma 8 wrote in place of "formatVersion".',
      });
    });

    it('is refused as a contract no release wrote when the release candidate form is read and schemaVersion is not "1"', () => {
      expect(read({ schemaVersion: '2' }, [0, 1])).toMatchObject({
        ...missing,
        ...emitAdvice,
        why: 'It has the field "schemaVersion", but it is not the contract a release candidate wrote, which has "schemaVersion": "1" and no "formatVersion".',
        meta: { knownFormatVersions: [1] },
      });
    });

    it('advises the upgrade instructions for a migration file with no format version', () => {
      expect(
        caught(() => readFormatVersion({}, { kind: 'migration', knownVersions: [1] })),
      ).toMatchObject({
        ...upgradeAdvice,
        why: 'It has no "formatVersion" field. Files that Prisma 8.0.0 and later write have one; files that a pre-release of Prisma 8 wrote do not.',
      });
    });

    describe('both the old and the new field', () => {
      const bothFieldsAdvice = {
        fix: 'Delete the "schemaVersion" field from the file, or restore the file from version control.',
        nextActions: [
          { kind: 'user-choice', label: 'Delete the "schemaVersion" field from the file' },
          { kind: 'user-choice', label: 'Restore the file from version control' },
        ],
      };
      const bothFields = {
        why: 'It has "formatVersion", which Prisma writes, and also "schemaVersion", which a pre-release of Prisma 8 wrote in its place. No release of Prisma wrote both into one file.',
        ...bothFieldsAdvice,
      };

      it.each([[[1]], [[0, 1]]])(
        'is refused as a contract with both fields, advising to delete schemaVersion, reading versions %j',
        (knownVersions) => {
          expect(read({ formatVersion: 1, schemaVersion: '1' }, knownVersions)).toMatchObject({
            ...missing,
            message:
              'The contract file "/p/contract.json" has both "formatVersion" and "schemaVersion"',
            ...bothFields,
          });
        },
      );

      it.each(['migration', 'ref'] as const)(
        'is refused as a %s file with both fields, advising to delete schemaVersion',
        (kind) => {
          expect(
            caught(() =>
              readFormatVersion(
                { formatVersion: 1, schemaVersion: '1' },
                { kind, knownVersions: [0, 1] },
              ),
            ),
          ).toMatchObject({
            code: 'MIGRATION.FORMAT_VERSION_MISSING',
            message: expect.stringMatching(/has both "formatVersion" and "schemaVersion"$/),
            why: 'It has "formatVersion", which Prisma writes, and also "schemaVersion", which no release of Prisma wrote into this kind of file.',
            ...bothFieldsAdvice,
          });
        },
      );

      it('gives a contract snapshot with both fields the same advice', () => {
        expect(
          caught(() =>
            convertContractDocument(
              { formatVersion: 1, schemaVersion: '1' },
              { path: '/m/snapshots/abc/contract.json', snapshot: true },
            ),
          ),
        ).toMatchObject({
          message:
            'The contract snapshot "/m/snapshots/abc/contract.json" has both "formatVersion" and "schemaVersion"',
          ...bothFields,
        });
      });

      it('reports a formatVersion that is not valid before the schemaVersion beside it', () => {
        expect(read({ formatVersion: '1', schemaVersion: '1' }, [0, 1])).toMatchObject({
          message: 'The contract file "/p/contract.json" has a format version that is not valid',
          ...emitAdvice,
        });
      });
    });

    it('throws an internal error for a formatVersion that is neither known nor newer', () => {
      expect(() =>
        readFormatVersion({ formatVersion: 1 }, { kind: 'migration', knownVersions: [0, 2] }),
      ).toThrow(InternalError);
    });

    it.each([['1'], [0], [-1], [1.5], [null], [true]])(
      'is refused for formatVersion %j',
      (value) => {
        expect(read({ formatVersion: value })).toMatchObject({
          ...missing,
          message: 'The contract file "/p/contract.json" has a format version that is not valid',
          ...emitAdvice,
          why: `Its "formatVersion" is ${JSON.stringify(value)}, which is not a positive integer.`,
        });
      },
    );

    it.each([[null], [[]], ['text'], [3]])('is refused for a document that is %j', (document) => {
      expect(read(document)).toMatchObject({
        ...missing,
        message: 'The contract file "/p/contract.json" is not a JSON object',
        ...emitAdvice,
        why: 'Every file of this kind that Prisma writes is a JSON object with its format version in it.',
      });
    });

    describe('in a migration.json or ref file no release wrote', () => {
      const migrationAdvice = {
        fix: 'No release of Prisma wrote this file. Restore it from version control. If the migration has not been applied to any database, you can instead delete its folder and plan it again with `{bin} migration plan`.',
        nextActions: [
          { kind: 'user-choice', label: 'Restore the file from version control' },
          {
            kind: 'run-command',
            label:
              'Or, if the migration has not been applied to any database, delete its folder and plan it again',
            command: '{bin} migration plan',
          },
        ],
      };
      const refAdvice = {
        fix: 'No release of Prisma wrote this file. Restore it from version control, or delete the file and set the ref again with `{bin} migration ref set <name> <contract>`.',
        nextActions: [
          { kind: 'user-choice', label: 'Restore the file from version control' },
          {
            kind: 'run-command',
            label: 'Or delete the file and set the ref again',
            command: '{bin} migration ref set <name> <contract>',
          },
        ],
      };
      const readFile = (kind: 'migration' | 'ref', document: unknown) =>
        caught(() => readFormatVersion(document, { kind, knownVersions: [0, 1] }));

      it.each([
        ['migration', migrationAdvice],
        ['ref', refAdvice],
      ] as const)(
        'advises a %s file with an invalid formatVersion to be made again',
        (kind, advice) => {
          expect(readFile(kind, { formatVersion: '1' })).toMatchObject({
            code: 'MIGRATION.FORMAT_VERSION_MISSING',
            message: expect.stringMatching(/has a format version that is not valid$/),
            ...advice,
            why: 'Its "formatVersion" is "1", which is not a positive integer.',
          });
        },
      );

      it.each([
        ['migration', migrationAdvice],
        ['ref', refAdvice],
      ] as const)('advises a %s file with "schemaVersion" to be made again', (kind, advice) => {
        expect(readFile(kind, { schemaVersion: '1' })).toMatchObject({
          ...advice,
          why: 'It has the field "schemaVersion", which no release of Prisma wrote into this kind of file.',
        });
      });

      it('advises a migration file that is not a JSON object to be made again', () => {
        expect(readFile('migration', [])).toMatchObject({
          message: 'The migration file (migration.json) is not a JSON object',
          ...migrationAdvice,
        });
      });

      it('still advises the upgrade instructions for a file with neither field once version 0 is not read', () => {
        expect(
          caught(() => readFormatVersion({}, { kind: 'ref', knownVersions: [1] })),
        ).toMatchObject(upgradeAdvice);
      });
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
