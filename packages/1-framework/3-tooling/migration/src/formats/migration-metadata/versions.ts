import {
  type NewestFormatVersion,
  readStoredDocument,
  type StoredFormat,
} from '@internal/contract/internal/format-version';
import type { Result } from '@internal/utils/result';
import type { MigrationMetadata } from '../../metadata';
import {
  type MigrationMetadataDocumentV1,
  migrationMetadataV1FromV0,
  parseMigrationMetadataV1,
  printMigrationMetadataV1,
} from './v1';

const MIGRATION_METADATA_FORMAT_VERSIONS = [0, 1] as const;

const MIGRATION_METADATA_FORMAT: StoredFormat<typeof MIGRATION_METADATA_FORMAT_VERSIONS> = {
  kind: 'migration',
  versions: MIGRATION_METADATA_FORMAT_VERSIONS,
  conversions: { 1: migrationMetadataV1FromV0 },
};

const PARSERS: Readonly<
  Record<
    NewestFormatVersion<typeof MIGRATION_METADATA_FORMAT_VERSIONS>,
    (document: unknown) => Result<MigrationMetadata, string>
  >
> = { 1: parseMigrationMetadataV1 };

export type MigrationMetadataDocument = MigrationMetadataDocumentV1;

/**
 * The metadata a `migration.json` holds, or why its content is invalid. Reads the format version before anything else and throws `MIGRATION.FORMAT_VERSION_NEWER` or `MIGRATION.FORMAT_VERSION_MISSING`, naming `path` and the extension `bundledIn` that ships it, for a file this release cannot read.
 */
export function parseMigrationMetadataDocument(
  document: unknown,
  path: string | undefined,
  bundledIn?: string,
): Result<MigrationMetadata, string> {
  const newest = readStoredDocument(document, MIGRATION_METADATA_FORMAT, { path, bundledIn });
  return PARSERS[newest.formatVersion](newest.document);
}

/** The `migration.json` document this release writes for `metadata`. */
export function printMigrationMetadataDocument(
  metadata: MigrationMetadata,
): MigrationMetadataDocument {
  return printMigrationMetadataV1(metadata);
}
