import { describe, expect, it } from 'vitest';
import * as publishedEntry from '../src/exports/format-version';
import * as internalEntry from '../src/exports/internal-format-version';

describe('format version entry points', () => {
  it('publish the reader that converts a stored contract to the newest version, the version a family writes, and the error test', () => {
    expect(Object.keys(publishedEntry).sort()).toEqual([
      'NEWEST_CONTRACT_FORMAT_VERSION',
      'convertContractDocument',
      'isFormatVersionError',
    ]);
  });

  it('keep how Prisma tells a contract built in memory, relabels an error with a path and converts a stored document in the internal entry', () => {
    expect(Object.keys(internalEntry).sort()).toEqual([
      'CONTRACT_FORMAT',
      'CONTRACT_FORMAT_VERSIONS_READ',
      'NEWEST_CONTRACT_FORMAT_VERSION',
      'carriesFormatVersion',
      'convertContractDocument',
      'formatVersionErrorAt',
      'isContractBuiltInMemory',
      'readStoredDocument',
    ]);
  });
});
