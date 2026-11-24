import { readFormatVersion } from '@internal/contract/format-version';
import type { Result } from '@internal/utils/result';
import type { MigrationMetadata } from '../../metadata';
import {
  type MigrationMetadataDocumentV1,
  parseMigrationMetadataV1,
  printMigrationMetadataV1,
} from './v1';

const MIGRATION_METADATA_FORMAT_VERSIONS = [1] as const;

type MigrationMetadataFormatVersion = (typeof MIGRATION_METADATA_FORMAT_VERSIONS)[number];

const PARSERS: Readonly<
  Record<MigrationMetadataFormatVersion, (document: unknown) => Result<MigrationMetadata, string>>
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
  const formatVersion = readFormatVersion(document, {
    kind: 'migration',
    knownVersions: MIGRATION_METADATA_FORMAT_VERSIONS,
    path,
    bundledIn,
  });
  return PARSERS[formatVersion](document);
}

/** The `migration.json` document this release writes for `metadata`. */
export function printMigrationMetadataDocument(
  metadata: MigrationMetadata,
): MigrationMetadataDocument {
  return printMigrationMetadataV1(metadata);
}
