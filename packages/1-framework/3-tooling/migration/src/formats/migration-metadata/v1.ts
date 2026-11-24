import { notOk, ok, type Result } from '@internal/utils/result';
import { type } from 'arktype';
import type { MigrationMetadata } from '../../metadata';

/** `migration.json` in format version 1. It also covers the migration's `ops.json`. */
export interface MigrationMetadataDocumentV1 extends MigrationMetadata {
  readonly formatVersion: 1;
}

const MigrationMetadataDocumentV1Schema = type({
  '+': 'reject',
  formatVersion: '1',
  from: 'string > 0 | null',
  to: 'string',
  migrationHash: 'string',
  providedInvariants: 'string[]',
  createdAt: 'string',
});

/** The metadata a version 1 `migration.json` holds, or why it holds none. */
export function parseMigrationMetadataV1(document: unknown): Result<MigrationMetadata, string> {
  const parsed = MigrationMetadataDocumentV1Schema(document);
  if (parsed instanceof type.errors) return notOk(parsed.summary);
  const { formatVersion: _, ...metadata } = parsed;
  return ok(metadata);
}

export function printMigrationMetadataV1(metadata: MigrationMetadata): MigrationMetadataDocumentV1 {
  return {
    formatVersion: 1,
    from: metadata.from,
    to: metadata.to,
    providedInvariants: metadata.providedInvariants,
    createdAt: metadata.createdAt,
    migrationHash: metadata.migrationHash,
  };
}
