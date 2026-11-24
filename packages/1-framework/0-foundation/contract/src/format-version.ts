import { ifDefined } from '@internal/utils/defined';
import {
  docsUrlFor,
  isStructuredError,
  type StructuredError,
  structuredError,
} from '@internal/utils/structured-error';
import { UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import { isPlainRecord } from './is-plain-record';

/** The kinds of file Prisma writes into a repository and reads back, each of which says which version of its format it is in. */
export type StoredFileKind = 'contract' | 'migration' | 'ref';

/** The format versions of `contract.json` (and of each contract snapshot) that this release reads. Each family has a unit of code for every one. */
export const CONTRACT_FORMAT_VERSIONS = [1] as const;

export type ContractFormatVersion = (typeof CONTRACT_FORMAT_VERSIONS)[number];

export interface ReadFormatVersionOptions<TVersion extends number> {
  readonly kind: StoredFileKind;
  readonly knownVersions: readonly TVersion[];
  readonly path?: string | undefined;
}

type FormatVersionProblem =
  | { readonly reason: 'newer'; readonly formatVersion: number }
  | { readonly reason: 'absent' }
  | { readonly reason: 'schemaVersion' }
  | { readonly reason: 'invalid'; readonly formatVersion: unknown };

interface FormatVersionErrorFacts {
  readonly kind: StoredFileKind;
  readonly knownVersions: readonly number[];
  readonly path: string | undefined;
  readonly problem: FormatVersionProblem;
}

const FILE_LABELS: Readonly<Record<StoredFileKind, string>> = {
  contract: 'contract file',
  migration: 'migration file (migration.json)',
  ref: 'ref file',
};

const CODES = {
  contract: {
    newer: 'CONTRACT.FORMAT_VERSION_NEWER',
    missing: 'CONTRACT.FORMAT_VERSION_MISSING',
  },
  migration: {
    newer: 'MIGRATION.FORMAT_VERSION_NEWER',
    missing: 'MIGRATION.FORMAT_VERSION_MISSING',
  },
  ref: {
    newer: 'MIGRATION.FORMAT_VERSION_NEWER',
    missing: 'MIGRATION.FORMAT_VERSION_MISSING',
  },
} as const satisfies Readonly<
  Record<
    StoredFileKind,
    { readonly newer: `${string}.${string}`; readonly missing: `${string}.${string}` }
  >
>;

const FORMAT_VERSION_ERROR_CODES: ReadonlySet<string> = new Set(
  Object.values(CODES).flatMap((codes) => [codes.newer, codes.missing]),
);

const FACTS = Symbol('formatVersionErrorFacts');

/**
 * The format version of a stored file's parsed JSON, read before anything else in it. Throws `*.FORMAT_VERSION_NEWER` for a version higher than any in `knownVersions`, and `*.FORMAT_VERSION_MISSING` for a file with no format version, with the old `schemaVersion` field, or with a value that is not a positive integer. Nothing else in the file is looked at.
 */
export function readFormatVersion<TVersion extends number>(
  document: unknown,
  options: ReadFormatVersionOptions<TVersion>,
): TVersion {
  if (isJsonObject(document) && !('schemaVersion' in document)) {
    const known = options.knownVersions.find((version) => version === document['formatVersion']);
    if (known !== undefined) return known;
  }
  throw formatVersionError({
    kind: options.kind,
    knownVersions: options.knownVersions,
    path: options.path,
    problem: problemOf(document, options.knownVersions),
  });
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function problemOf(document: unknown, knownVersions: readonly number[]): FormatVersionProblem {
  if (!isJsonObject(document)) return { reason: 'absent' };
  const formatVersion = document['formatVersion'];
  if (
    typeof formatVersion === 'number' &&
    Number.isInteger(formatVersion) &&
    formatVersion > Math.max(...knownVersions)
  ) {
    return { reason: 'newer', formatVersion };
  }
  if ('schemaVersion' in document) return { reason: 'schemaVersion' };
  if (!('formatVersion' in document)) return { reason: 'absent' };
  return { reason: 'invalid', formatVersion };
}

/** Whether `value` carries a format version field, new or old. */
export function carriesFormatVersion(value: unknown): boolean {
  return isJsonObject(value) && ('formatVersion' in value || 'schemaVersion' in value);
}

/**
 * Whether `value` is a contract that Prisma built in memory, by the contract builder or by deserializing a file, rather than a stored contract document. Prisma builds `storage` as an object of an IR class; parsed JSON gives a plain object. A stored document must be read through its format version; only a contract built in memory may be printed again instead.
 */
export function isContractBuiltInMemory(value: unknown): boolean {
  if (!isJsonObject(value) || carriesFormatVersion(value)) return false;
  const storage = value['storage'];
  return typeof storage === 'object' && storage !== null && !isPlainRecord(storage);
}

/** Whether `error` is one that {@link readFormatVersion} throws. */
export function isFormatVersionError(error: unknown): error is StructuredError {
  return isStructuredError(error) && FORMAT_VERSION_ERROR_CODES.has(error.code);
}

/** `error`, naming the file at `path` when the reader that raised it did not know the path. */
export function formatVersionErrorAt(error: StructuredError, path: string): StructuredError {
  const facts: unknown = Reflect.get(error, FACTS);
  if (!isFormatVersionFacts(facts) || facts.path !== undefined) return error;
  return formatVersionError({ ...facts, path });
}

function isFormatVersionFacts(value: unknown): value is FormatVersionErrorFacts {
  return typeof value === 'object' && value !== null && 'problem' in value;
}

function formatVersionError(facts: FormatVersionErrorFacts): StructuredError {
  const { kind, knownVersions, path, problem } = facts;
  const file =
    path === undefined ? `The ${FILE_LABELS[kind]}` : `The ${FILE_LABELS[kind]} "${path}"`;
  const meta = {
    fileKind: kind,
    knownFormatVersions: [...knownVersions],
    ...ifDefined('path', path),
  };
  const error =
    problem.reason === 'newer'
      ? structuredError(CODES[kind].newer, `${file} was written by a newer release of Prisma`, {
          why: `It is in format version ${problem.formatVersion}, and this release of Prisma reads format ${versionsText(knownVersions)} only.`,
          fix: 'Upgrade Prisma to the release that wrote the file, or a later one, and run the command again.',
          nextActions: [
            {
              kind: 'user-choice',
              label: 'Upgrade Prisma to the release that wrote the file, or a later one',
            },
          ],
          meta: { ...meta, formatVersion: problem.formatVersion },
          docsUrl: docsUrlFor(CODES[kind].newer),
          ...ifDefined('where', path === undefined ? undefined : { path }),
        })
      : structuredError(CODES[kind].missing, `${file} has no format version`, {
          why: missingWhy(problem),
          fix: `A pre-release of Prisma 8 wrote this file. Follow the upgrade instructions of each release since the one that wrote it; they add the format version: ${UPGRADE_GUIDES_URL}`,
          nextActions: [
            {
              kind: 'open-url',
              label: 'Follow the upgrade instructions',
              url: UPGRADE_GUIDES_URL,
            },
          ],
          meta,
          docsUrl: docsUrlFor(CODES[kind].missing),
          ...ifDefined('where', path === undefined ? undefined : { path }),
        });
  Object.defineProperty(error, FACTS, { value: facts });
  return error;
}

function versionsText(versions: readonly number[]): string {
  return versions.length === 1 ? `version ${versions[0]}` : `versions ${versions.join(', ')}`;
}

function missingWhy(problem: Exclude<FormatVersionProblem, { reason: 'newer' }>): string {
  switch (problem.reason) {
    case 'absent':
      return 'It has no "formatVersion" field. Files that Prisma 8.0.0 and later write have one; files that a pre-release of Prisma 8 wrote do not.';
    case 'schemaVersion':
      return 'It has the field "schemaVersion", which a pre-release of Prisma 8 wrote in place of "formatVersion".';
    case 'invalid':
      return `Its "formatVersion" is ${JSON.stringify(problem.formatVersion)}, which is not a positive integer.`;
  }
}
