import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
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

export interface ReadFormatVersionOptions<TVersion extends number> {
  readonly kind: StoredFileKind;
  /** Every version this release reads, with no gap from the oldest to the newest. */
  readonly knownVersions: readonly TVersion[];
  readonly path?: string | undefined;
  /** The extension whose package ships the file, for a file the application cannot change itself. */
  readonly bundledIn?: string | undefined;
  /** Whether the file is a contract snapshot, which the error advice treats apart. */
  readonly snapshot?: boolean | undefined;
}

type FormatVersionProblem =
  | { readonly reason: 'newer'; readonly formatVersion: number }
  | { readonly reason: 'notObject' }
  | { readonly reason: 'absent' }
  | { readonly reason: 'schemaVersion' }
  | { readonly reason: 'bothFields' }
  | { readonly reason: 'invalid'; readonly formatVersion: unknown };

interface FormatVersionErrorFacts {
  readonly kind: StoredFileKind;
  readonly knownVersions: readonly number[];
  readonly path: string | undefined;
  readonly bundledIn: string | undefined;
  readonly snapshot: boolean;
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
 * The format version of a stored file's parsed JSON, read before anything else in it, as the first step of {@link readStoredDocument}. Throws `*.FORMAT_VERSION_NEWER` for a version higher than any in `knownVersions`, and `*.FORMAT_VERSION_MISSING` for a file with no format version, with the old `schemaVersion` field, or with a value that is not a positive integer.
 *
 * Version 0 is a file a release candidate wrote, which has no `formatVersion`: a contract with `"schemaVersion": "1"`, or a `migration.json` or ref file without either field. It is returned only when `knownVersions` has 0.
 */
export function readFormatVersion<TVersion extends number>(
  document: unknown,
  options: ReadFormatVersionOptions<TVersion>,
): TVersion {
  if (isJsonObject(document)) {
    const written = writtenFormatVersion(document, options.kind);
    const known = options.knownVersions.find((version) => version === written);
    if (known !== undefined) return known;
  }
  throw formatVersionError({
    kind: options.kind,
    knownVersions: options.knownVersions,
    path: options.path,
    bundledIn: options.bundledIn,
    snapshot: options.snapshot === true,
    problem: problemOf(document, options.knownVersions),
  });
}

function writtenFormatVersion(
  document: Readonly<Record<string, unknown>>,
  kind: StoredFileKind,
): number | undefined {
  if ('formatVersion' in document) {
    const formatVersion = document['formatVersion'];
    return !('schemaVersion' in document) && isPositiveInteger(formatVersion)
      ? formatVersion
      : undefined;
  }
  if (kind === 'contract') return document['schemaVersion'] === '1' ? 0 : undefined;
  return 'schemaVersion' in document ? undefined : 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/** A stored file's parsed JSON object. */
export type StoredDocument = Readonly<Record<string, unknown>>;

/** Format versions, oldest first. */
export type FormatVersionList = readonly [number, ...number[]];

export type NewestFormatVersion<TVersions extends FormatVersionList> = TVersions extends readonly [
  ...unknown[],
  infer TNewest extends number,
]
  ? TNewest
  : never;

/** Turns a document of one format version into a document of the next. */
export type StoredConversion = (document: StoredDocument) => StoredDocument;

/** The format versions of one kind of stored file that this release reads, and how a document of each becomes one of the next. */
export interface StoredFormat<TVersions extends FormatVersionList> {
  readonly kind: StoredFileKind;
  readonly versions: TVersions;
  /** For each version after the oldest, the function that turns a document of the version before it into one of this version. */
  readonly conversions: Readonly<
    Record<Exclude<TVersions[number], TVersions[0]>, StoredConversion>
  > &
    Readonly<Partial<Record<TVersions[0], never>>>;
}

export interface StoredDocumentInNewestVersion<TVersions extends FormatVersionList> {
  readonly formatVersion: NewestFormatVersion<TVersions>;
  readonly document: StoredDocument;
}

export interface StoredFileLocation {
  readonly path?: string | undefined;
  /** The extension whose package ships the file. */
  readonly bundledIn?: string | undefined;
}

export interface ContractFileLocation extends StoredFileLocation {
  /** Whether the file is a contract snapshot in the migrations folder, which a command writes only where none exists. */
  readonly snapshot?: boolean | undefined;
}

/**
 * A stored file's parsed JSON in the newest format version of `format`. Reads the version first, as {@link readFormatVersion} does, and then converts the document one version at a time. Nothing is written back to the file.
 */
export function readStoredDocument<TVersions extends FormatVersionList>(
  document: unknown,
  format: StoredFormat<TVersions>,
  location: StoredFileLocation = {},
): StoredDocumentInNewestVersion<TVersions> {
  return convertStoredDocument(document, format, location, false);
}

function convertStoredDocument<TVersions extends FormatVersionList>(
  document: unknown,
  format: StoredFormat<TVersions>,
  location: StoredFileLocation,
  snapshot: boolean,
): StoredDocumentInNewestVersion<TVersions> {
  const written = readFormatVersion(document, {
    kind: format.kind,
    knownVersions: format.versions,
    path: location.path,
    bundledIn: location.bundledIn,
    snapshot,
  });
  const conversions: Readonly<Partial<Record<number, StoredConversion>>> = format.conversions;
  let current = blindCast<StoredDocument, 'readFormatVersion accepts only a JSON object'>(document);
  for (const version of format.versions.slice(format.versions.indexOf(written) + 1)) {
    const convert = conversions[version];
    if (convert === undefined) {
      throw new InternalError(`No conversion to ${format.kind} format version ${version}`);
    }
    current = convert(current);
  }
  return { formatVersion: newestFormatVersion(format.versions), document: current };
}

function newestFormatVersion<TVersions extends FormatVersionList>(
  versions: TVersions,
): NewestFormatVersion<TVersions> {
  return blindCast<
    NewestFormatVersion<TVersions>,
    'a non-empty version list ends with its newest version'
  >(versions[versions.length - 1]);
}

function contractV1FromV0(document: StoredDocument): StoredDocument {
  const { schemaVersion: _, ...contract } = document;
  return { formatVersion: 1, ...contract };
}

/** The contract format versions this release reads, oldest first. Version 0 is what a release candidate wrote, which has no `formatVersion`; it is read until `8.0.0`. */
export const CONTRACT_FORMAT_VERSIONS_READ = [0, 1] as const;

/** How each format version of a contract becomes the next. Version 0 is what a release candidate wrote; it is read until `8.0.0`, and only here. Version 1 changed only the version field, which every family's contract shares. */
export const CONTRACT_FORMAT: StoredFormat<typeof CONTRACT_FORMAT_VERSIONS_READ> = {
  kind: 'contract',
  versions: CONTRACT_FORMAT_VERSIONS_READ,
  conversions: { 1: contractV1FromV0 },
};

export type NewestContractFormatVersion = NewestFormatVersion<typeof CONTRACT_FORMAT_VERSIONS_READ>;

/** The contract format version this release writes, and the version of every document {@link convertContractDocument} returns. A family's serializer writes it as `formatVersion`. */
export const NEWEST_CONTRACT_FORMAT_VERSION: NewestContractFormatVersion = newestFormatVersion(
  CONTRACT_FORMAT_VERSIONS_READ,
);

/**
 * A stored contract's parsed JSON in the newest format version, converted from the version it was written in. Every reader of a stored contract, Prisma's own included, reads it this way, and only then parses the document. Throws the errors {@link isFormatVersionError} tests for, before anything else in the file is read.
 */
export function convertContractDocument(
  document: unknown,
  location: ContractFileLocation = {},
): StoredDocument {
  return convertStoredDocument(document, CONTRACT_FORMAT, location, location.snapshot === true)
    .document;
}

function isJsonObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function problemOf(document: unknown, knownVersions: readonly number[]): FormatVersionProblem {
  if (!isJsonObject(document)) return { reason: 'notObject' };
  const formatVersion = document['formatVersion'];
  if (isPositiveInteger(formatVersion) && formatVersion > Math.max(...knownVersions)) {
    return { reason: 'newer', formatVersion };
  }
  if ('formatVersion' in document) {
    if (!isPositiveInteger(formatVersion)) return { reason: 'invalid', formatVersion };
    if ('schemaVersion' in document) return { reason: 'bothFields' };
    throw new InternalError(
      `Format version ${formatVersion} is neither one this release reads nor newer than them`,
    );
  }
  if ('schemaVersion' in document) return { reason: 'schemaVersion' };
  return { reason: 'absent' };
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

/** Whether `error` is one that {@link convertContractDocument} throws for a format version it does not read. */
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
  const { kind, path, bundledIn, problem } = facts;
  const declarableVersions = facts.knownVersions.filter((version) => version > 0);
  const label = facts.snapshot ? 'contract snapshot' : FILE_LABELS[kind];
  const named = path === undefined ? `The ${label}` : `The ${label} "${path}"`;
  const file = bundledIn === undefined ? named : `${named} of the extension "${bundledIn}"`;
  const meta = {
    fileKind: kind,
    knownFormatVersions: declarableVersions,
    ...ifDefined('path', path),
    ...ifDefined('bundledIn', bundledIn),
  };
  const error =
    problem.reason === 'newer'
      ? structuredError(CODES[kind].newer, `${file} was written by a newer release of Prisma`, {
          why: `It is in format version ${problem.formatVersion}, and this release of Prisma reads format ${versionsText(declarableVersions)} only.`,
          fix:
            bundledIn === undefined
              ? 'Upgrade Prisma to the release that wrote the file, or a later one, and run the command again.'
              : `The extension "${bundledIn}" was built for a newer release of Prisma. Upgrade Prisma, or use a release of the extension built for this one.`,
          nextActions: [
            {
              kind: 'user-choice',
              label:
                bundledIn === undefined
                  ? 'Upgrade Prisma to the release that wrote the file, or a later one'
                  : `Upgrade Prisma, or use a release of the extension "${bundledIn}" built for this one`,
            },
          ],
          meta: { ...meta, formatVersion: problem.formatVersion },
          docsUrl: docsUrlFor(CODES[kind].newer),
          ...ifDefined('where', path === undefined ? undefined : { path }),
        })
      : structuredError(CODES[kind].missing, `${file} ${MISSING_SUMMARIES[problem.reason]}`, {
          why: missingWhy(kind, facts.knownVersions, problem),
          ...missingFix(facts, problem),
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

type MissingProblem = Exclude<FormatVersionProblem, { reason: 'newer' }>;

const MISSING_SUMMARIES: Readonly<Record<MissingProblem['reason'], string>> = {
  absent: 'has no format version',
  schemaVersion: 'has no format version',
  bothFields: 'has both "formatVersion" and "schemaVersion"',
  invalid: 'has a format version that is not valid',
  notObject: 'is not a JSON object',
};

function missingFix(
  { kind, knownVersions, bundledIn, snapshot }: FormatVersionErrorFacts,
  problem: MissingProblem,
): Pick<StructuredError, 'fix' | 'nextActions'> {
  if (bundledIn !== undefined) {
    return {
      fix: `The extension "${bundledIn}" ships this file in its package, so the upgrade instructions cannot change it in your project. Upgrade the extension to a release built for this release of Prisma; if there is none, ask its author to republish it.`,
      nextActions: [
        {
          kind: 'user-choice',
          label: `Upgrade the extension "${bundledIn}", or ask its author to republish it`,
        },
      ],
    };
  }
  if (problem.reason === 'bothFields') return BOTH_FIELDS_ADVICE;
  if (noReleaseWroteThisFile(kind, knownVersions, problem)) {
    return snapshot ? SNAPSHOT_REMAKE_ADVICE : REMAKE_ADVICE[kind];
  }
  return {
    fix: `A pre-release of Prisma 8 wrote this file. Follow the upgrade instructions of each release since the one that wrote it; they add the format version: ${UPGRADE_GUIDES_URL}`,
    nextActions: [
      { kind: 'open-url', label: 'Follow the upgrade instructions', url: UPGRADE_GUIDES_URL },
    ],
  };
}

const RESTORE_FROM_VERSION_CONTROL = {
  kind: 'user-choice',
  label: 'Restore the file from version control',
} as const;

const BOTH_FIELDS_ADVICE: Pick<StructuredError, 'fix' | 'nextActions'> = {
  fix: 'Delete the "schemaVersion" field from the file, or restore the file from version control.',
  nextActions: [
    { kind: 'user-choice', label: 'Delete the "schemaVersion" field from the file' },
    RESTORE_FROM_VERSION_CONTROL,
  ],
};

const SNAPSHOT_REMAKE_ADVICE: Pick<StructuredError, 'fix' | 'nextActions'> = {
  fix: 'No release of Prisma wrote this file. Restore it from version control. A command writes a contract snapshot only where none exists, so emitting the contract again does not change it. If it is the snapshot of the emitted contract, you can instead delete its folder and write it again: `{bin} db migrate --advance-ref db` writes it when a migration ends at that contract, after applying any pending migrations to the configured database, and `{bin} db sign` writes it when none does, after checking that the configured database matches contract.json and recording that in the database; each also moves the db ref to that contract. If it is the head snapshot of an extension, delete its folder and run `{bin} contract emit`, which writes it again from the installed extension and also emits contract.json from the contract source.',
  nextActions: [{ kind: 'user-choice', label: 'Restore the snapshot from version control' }],
};

const REMAKE_ADVICE: Readonly<
  Record<StoredFileKind, Pick<StructuredError, 'fix' | 'nextActions'>>
> = {
  contract: {
    fix: 'No release of Prisma wrote this file. Restore it from version control. If it is the contract.json that `{bin} contract emit` writes, you can emit it again instead; a contract snapshot in the migrations folder cannot be emitted again.',
    nextActions: [
      RESTORE_FROM_VERSION_CONTROL,
      {
        kind: 'run-command',
        label: 'Or, if it is the emitted contract.json, emit the contract again',
        command: '{bin} contract emit',
      },
    ],
  },
  migration: {
    fix: 'No release of Prisma wrote this file. Restore it from version control. If no database has applied the migration, you can instead delete this migration.json and run `node <migration folder>/migration.ts`, which writes migration.json and ops.json again with a new creation time, so the migration gets a new hash.',
    nextActions: [
      RESTORE_FROM_VERSION_CONTROL,
      {
        kind: 'run-command',
        label:
          'Or, if no database has applied the migration, delete this migration.json and run this command, which writes migration.json and ops.json again with a new creation time, so the migration gets a new hash',
        command: 'node <migration folder>/migration.ts',
      },
    ],
  },
  ref: {
    fix: 'No release of Prisma wrote this file. Restore it from version control. Or delete the file and write it again. For the db ref, which records the contract the database is at, run `{bin} db migrate --advance-ref db`, which applies any pending migrations to the configured database and then moves the db ref to the contract the database is at; when no migration ends at contract.json, run `{bin} db sign` instead, which checks that the configured database matches contract.json, records that in the database and moves the db ref to contract.json. For the head ref of an extension, run `{bin} contract emit`, which emits contract.json from the contract source and writes the head ref again from the installed extension. For any other ref, set it again to the contract it named with `{bin} migration ref set <name> <contract>`; whatever uses the ref, such as a deploy that migrates a database to it, uses the contract you name.',
    nextActions: [
      RESTORE_FROM_VERSION_CONTROL,
      {
        kind: 'run-command',
        label:
          'Or, for the db ref, delete the file and run this command, which applies any pending migrations to the configured database, then moves the db ref to the contract the database is at',
        command: '{bin} db migrate --advance-ref db',
      },
      {
        kind: 'run-command',
        label:
          'Or, for the db ref when no migration ends at contract.json, delete the file and run this command, which checks that the configured database matches contract.json and records that in the database, then moves the db ref to contract.json',
        command: '{bin} db sign',
      },
      {
        kind: 'run-command',
        label:
          'Or, for the head ref of an extension, delete the file and run this command, which emits contract.json from the contract source and writes the head ref again from the installed extension',
        command: '{bin} contract emit',
      },
      {
        kind: 'run-command',
        label:
          'Or, for any other ref, delete the file and set the ref again to the contract it named; whatever uses the ref, such as a deploy that migrates a database to it, uses the contract you name',
        command: '{bin} migration ref set <name> <contract>',
      },
    ],
  },
};

function noReleaseWroteThisFile(
  kind: StoredFileKind,
  knownVersions: readonly number[],
  problem: MissingProblem,
): boolean {
  switch (problem.reason) {
    case 'notObject':
    case 'invalid':
    case 'bothFields':
      return true;
    case 'absent':
      return kind === 'contract';
    case 'schemaVersion':
      return kind !== 'contract' || knownVersions.includes(0);
  }
}

function missingWhy(
  kind: StoredFileKind,
  knownVersions: readonly number[],
  problem: MissingProblem,
): string {
  switch (problem.reason) {
    case 'notObject':
      return 'Every file of this kind that Prisma writes is a JSON object with its format version in it.';
    case 'absent':
      return kind === 'contract'
        ? 'It has neither "formatVersion" nor "schemaVersion". Every release of Prisma 8 wrote one of them into a contract.'
        : 'It has no "formatVersion" field. Files that Prisma 8.0.0 and later write have one; files that a pre-release of Prisma 8 wrote do not.';
    case 'schemaVersion':
      if (kind !== 'contract') {
        return 'It has the field "schemaVersion", which no release of Prisma wrote into this kind of file.';
      }
      return noReleaseWroteThisFile(kind, knownVersions, problem)
        ? 'It has the field "schemaVersion", but it is not the contract a release candidate wrote, which has "schemaVersion": "1" and no "formatVersion".'
        : 'It has the field "schemaVersion", which a pre-release of Prisma 8 wrote in place of "formatVersion".';
    case 'bothFields':
      return kind === 'contract'
        ? 'It has "formatVersion", which Prisma writes, and also "schemaVersion", which a pre-release of Prisma 8 wrote in its place. No release of Prisma wrote both into one file, so it cannot be told which format version the file is in.'
        : 'It has "formatVersion", which Prisma writes, and also "schemaVersion", which no release of Prisma wrote into this kind of file, so it cannot be told which format version the file is in.';
    case 'invalid':
      return `Its "formatVersion" is ${JSON.stringify(problem.formatVersion)}, which is not a positive integer.`;
  }
}
