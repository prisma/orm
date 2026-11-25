import { describe, expect, it } from 'vitest';
import * as publishedEntry from '../src/exports/format-version';
import * as internalEntry from '../src/exports/internal-format-version';

describe('format version entry points', () => {
  it('publish what reads a stored file and tests its errors, and not the helpers only the Prisma tooling uses', () => {
    expect(Object.keys(publishedEntry).sort()).toEqual([
      'CONTRACT_FORMAT_VERSIONS',
      'isFormatVersionError',
      'readFormatVersion',
    ]);
  });

  it('keep how Prisma tells a contract built in memory and relabels an error with a path in the internal entry', () => {
    expect(Object.keys(internalEntry).sort()).toEqual([
      'carriesFormatVersion',
      'formatVersionErrorAt',
      'isContractBuiltInMemory',
    ]);
  });
});
