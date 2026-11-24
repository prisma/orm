import { describe, expect, it } from 'vitest';
import {
  parseMigrationMetadataDocument,
  printMigrationMetadataDocument,
} from '../../src/formats/migration-metadata/versions';
import type { MigrationMetadata } from '../../src/metadata';

const metadata: MigrationMetadata = {
  from: null,
  to: 'a'.repeat(64),
  migrationHash: 'b'.repeat(64),
  providedInvariants: ['backfill-users'],
  createdAt: '2026-11-24T00:00:00.000Z',
};

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

describe('migration.json format version 1', () => {
  it('prints the format version first', () => {
    const document = printMigrationMetadataDocument(metadata);
    expect(Object.keys(document)[0]).toBe('formatVersion');
    expect(document).toEqual({ formatVersion: 1, ...metadata });
  });

  it('parses what it prints into the same metadata', () => {
    const printed = JSON.parse(JSON.stringify(printMigrationMetadataDocument(metadata)));
    expect(parseMigrationMetadataDocument(printed, '/m/migration.json').assertOk()).toEqual(
      metadata,
    );
  });

  it('refuses a file written by a newer release', () => {
    expect(
      caught(() =>
        parseMigrationMetadataDocument({ ...metadata, formatVersion: 2 }, '/m/migration.json'),
      ),
    ).toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_NEWER',
      where: { path: '/m/migration.json' },
    });
  });

  it('refuses a file with no format version', () => {
    expect(
      caught(() => parseMigrationMetadataDocument(metadata, '/m/migration.json')),
    ).toMatchObject({
      code: 'MIGRATION.FORMAT_VERSION_MISSING',
      where: { path: '/m/migration.json' },
    });
  });

  it('refuses a file with the old schemaVersion field', () => {
    expect(
      caught(() =>
        parseMigrationMetadataDocument({ schemaVersion: '1', ...metadata }, '/m/migration.json'),
      ),
    ).toMatchObject({ code: 'MIGRATION.FORMAT_VERSION_MISSING' });
  });

  it('refuses a field it does not know', () => {
    const result = parseMigrationMetadataDocument(
      { formatVersion: 1, ...metadata, labels: ['x'] },
      '/m/migration.json',
    );
    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.failure).toContain('labels');
  });
});
