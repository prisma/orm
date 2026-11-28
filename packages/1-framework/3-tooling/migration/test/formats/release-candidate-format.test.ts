import { readFileSync } from 'node:fs';
import { isFormatVersionError } from '@internal/contract/format-version';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { parseMigrationMetadataDocument } from '../../src/formats/migration-metadata/versions';
import { parseRefDocument } from '../../src/formats/ref/versions';

function readsWithoutFormatVersion(read: () => unknown): boolean {
  try {
    read();
    return true;
  } catch (error) {
    if (isFormatVersionError(error)) return false;
    throw error;
  }
}

describe('while this release reads the migration.json and ref files a release candidate wrote', () => {
  it('is a pre-release, so 8.0.0 cannot ship reading them', () => {
    const rootPackage: { version: string } = JSON.parse(
      readFileSync(join(import.meta.dirname, '../../../../../../package.json'), 'utf8'),
    );
    const readsVersion0 = {
      migration: readsWithoutFormatVersion(() =>
        parseMigrationMetadataDocument({}, 'migration.json'),
      ),
      ref: readsWithoutFormatVersion(() => parseRefDocument({}, 'refs/head.json')),
    };
    const isPreRelease = /^\d+\.\d+\.\d+-/.test(rootPackage.version);
    expect(
      (readsVersion0.migration || readsVersion0.ref) && !isPreRelease,
      '8.0.0 must not read the files a release candidate wrote. Remove format version 0; packages/1-framework/0-foundation/contract/test/format-version.release-candidate.test.ts lists everything to remove.',
    ).toBe(false);
  });
});
