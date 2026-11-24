import { readFormatVersion } from '@internal/contract/format-version';
import type { Result } from '@internal/utils/result';
import { parseRefV1, printRefV1, type RefDocumentV1, type RefFileContent } from './v1';

const REF_FORMAT_VERSIONS = [1] as const;

type RefFormatVersion = (typeof REF_FORMAT_VERSIONS)[number];

const PARSERS: Readonly<
  Record<RefFormatVersion, (document: unknown) => Result<RefFileContent, string>>
> = { 1: parseRefV1 };

export type RefDocument = RefDocumentV1;

/**
 * The content of a ref file, or why it is invalid. Reads the format version before anything else and throws `MIGRATION.FORMAT_VERSION_NEWER` or `MIGRATION.FORMAT_VERSION_MISSING`, naming `path`, for a file this release cannot read.
 */
export function parseRefDocument(
  document: unknown,
  path: string | undefined,
): Result<RefFileContent, string> {
  const formatVersion = readFormatVersion(document, {
    kind: 'ref',
    knownVersions: REF_FORMAT_VERSIONS,
    path,
  });
  return PARSERS[formatVersion](document);
}

/** The ref file this release writes for `content`. */
export function printRefDocument(content: RefFileContent): RefDocument {
  return printRefV1(content);
}
