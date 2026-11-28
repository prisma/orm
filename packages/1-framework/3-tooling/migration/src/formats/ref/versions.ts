import {
  type NewestFormatVersion,
  readStoredDocument,
  type StoredFormat,
} from '@internal/contract/internal/format-version';
import type { Result } from '@internal/utils/result';
import { parseRefV1, printRefV1, type RefDocumentV1, type RefFileContent, refV1FromV0 } from './v1';

const REF_FORMAT_VERSIONS = [0, 1] as const;

const REF_FORMAT: StoredFormat<typeof REF_FORMAT_VERSIONS> = {
  kind: 'ref',
  versions: REF_FORMAT_VERSIONS,
  conversions: { 1: refV1FromV0 },
};

const PARSERS: Readonly<
  Record<
    NewestFormatVersion<typeof REF_FORMAT_VERSIONS>,
    (document: unknown) => Result<RefFileContent, string>
  >
> = { 1: parseRefV1 };

export type RefDocument = RefDocumentV1;

/**
 * The content of a ref file, or why it is invalid. Reads the format version before anything else and throws `MIGRATION.FORMAT_VERSION_NEWER` or `MIGRATION.FORMAT_VERSION_MISSING`, naming `path` and the extension `bundledIn` that ships it, for a file this release cannot read.
 */
export function parseRefDocument(
  document: unknown,
  path: string | undefined,
  bundledIn?: string,
): Result<RefFileContent, string> {
  const newest = readStoredDocument(document, REF_FORMAT, { path, bundledIn });
  return PARSERS[newest.formatVersion](newest.document);
}

/** The ref file this release writes for `content`. */
export function printRefDocument(content: RefFileContent): RefDocument {
  return printRefV1(content);
}
