import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { MigrationMetadata, MigrationPackage } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import { type } from 'arktype';
import { basename, dirname, join, resolve } from 'pathe';
import type { SnapshotContentVerifier } from './contract-snapshot-store';
import { readContractSnapshotJsonTolerant } from './contract-snapshot-store';
import {
  errorDirectoryExists,
  errorInvalidDestName,
  errorInvalidJson,
  errorInvalidManifest,
  errorInvalidSlug,
  errorMigrationHashMismatch,
  errorMissingFile,
  errorProvidedInvariantsMismatch,
  MigrationToolsError,
} from './errors';
import { verifyMigrationHash } from './hash';
import { deriveProvidedInvariants } from './invariants';
import { MigrationOpsSchema } from './op-schema';
import type { MigrationOps, OnDiskMigrationPackage } from './package';

export const MANIFEST_FILE = 'migration.json';
const OPS_FILE = 'ops.json';
const MAX_SLUG_LENGTH = 64;

export interface ReadMigrationPackageOptions {
  readonly migrationsDir: string;
  /**
   * Content check for the package's end-contract snapshot; a snapshot whose
   * content does not reproduce its address is treated as absent by the
   * tolerant read (the strict store reads report it loudly).
   */
  readonly verifySnapshotContent?: SnapshotContentVerifier;
}

function hasErrnoCode(error: unknown, code: string): boolean {
  return error instanceof Error && (error as { code?: string }).code === code;
}

const MigrationMetadataSchema = type({
  '+': 'reject',
  from: 'string > 0 | null',
  to: 'string',
  migrationHash: 'string',
  providedInvariants: 'string[]',
  createdAt: 'string',
});

export async function writeMigrationPackage(
  dir: string,
  metadata: MigrationMetadata,
  ops: MigrationOps,
): Promise<void> {
  await mkdir(dirname(dir), { recursive: true });

  try {
    await mkdir(dir);
  } catch (error) {
    if (hasErrnoCode(error, 'EEXIST')) {
      throw errorDirectoryExists(dir);
    }
    throw error;
  }

  await writeFile(join(dir, MANIFEST_FILE), JSON.stringify(metadata, null, 2), {
    flag: 'wx',
  });
  await writeFile(join(dir, OPS_FILE), JSON.stringify(ops, null, 2), { flag: 'wx' });
}

/**
 * Materialise an in-memory {@link MigrationPackage} to a per-space
 * directory on disk.
 *
 * Writes two files under `<targetDir>/<pkg.dirName>/`:
 *
 * - `migration.json` — the manifest (pretty-printed, matches
 *   {@link writeMigrationPackage}'s output for byte-for-byte parity with
 *   app-space migrations).
 * - `ops.json` — the operation list (pretty-printed).
 *
 * Distinct verb from the lower-level {@link writeMigrationPackage}
 * (which takes constituent `(metadata, ops)`): callers reading
 * `materialise…` know they are persisting a struct-typed package.
 *
 * Overwrite-idempotent: the per-package directory is cleared before
 * each emit, so re-running against the same `targetDir` produces
 * byte-identical contents and never leaves stale files behind. The
 * lower-level {@link writeMigrationPackage} stays strict because the
 * CLI authoring path (`migration plan` / `migration new`) deliberately
 * refuses to clobber an existing authored migration; this helper is
 * the re-emit path that is supposed to converge on a single canonical
 * on-disk shape.
 *
 * The per-space head contract resolves through
 * `<projectMigrationsDir>/snapshots/<hex>/` (written by
 * {@link import('./emit-contract-space-artifacts').emitContractSpaceArtifacts}),
 * not inside the per-package directory. The runner reads only
 * `migration.json` + `ops.json` from each package.
 */
export async function materialiseMigrationPackage(
  targetDir: string,
  pkg: MigrationPackage,
): Promise<void> {
  const dir = join(targetDir, pkg.dirName);
  await rm(dir, { recursive: true, force: true });
  await writeMigrationPackage(dir, pkg.metadata, pkg.ops);
}

/**
 * Idempotent variant of {@link materialiseMigrationPackage}: writes the
 * package only if `<targetDir>/<pkg.dirName>/` does not already exist on
 * disk as a directory; returns `{ written: false }` when the package
 * directory is present (no rewrite, no comparison — by-existence skip).
 *
 * Concretely:
 *   - existing directory → skip silently, return `{ written: false }`.
 *   - missing path → write three files via {@link materialiseMigrationPackage},
 *     return `{ written: true }`.
 *   - path exists but is not a directory (file/symlink) → treated as
 *     missing; {@link materialiseMigrationPackage} will attempt creation
 *     and fail with an appropriate OS error.
 *   - any other I/O error from `stat` → propagated unchanged.
 *
 * Used by the CLI's `runContractSpaceExtensionMigrationsPass` to
 * materialise extension migration packages into a project's
 * `migrations/<spaceId>/` directory, and by extension-package tests
 * that mirror the same idempotent-rematerialise property locally
 * without taking a CLI dependency.
 */
export async function materialiseExtensionMigrationPackageIfMissing(
  targetDir: string,
  pkg: MigrationPackage,
): Promise<{ readonly written: boolean }> {
  const pkgDir = join(targetDir, pkg.dirName);
  if (await directoryExists(pkgDir)) {
    return { written: false };
  }
  await materialiseMigrationPackage(targetDir, pkg);
  return { written: true };
}

async function directoryExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) return false;
    throw error;
  }
}

/**
 * Copy a list of files into `destDir`, optionally renaming each one.
 *
 * The destination directory is created (with `recursive: true`) if it
 * does not already exist. Each source path is copied byte-for-byte into
 * `destDir/<destName>`; missing sources throw `ENOENT`. The helper is
 * intentionally generic: callers own the list of files and the naming
 * convention for the copies.
 */
export async function copyFilesWithRename(
  destDir: string,
  files: readonly { readonly sourcePath: string; readonly destName: string }[],
): Promise<void> {
  await mkdir(destDir, { recursive: true });
  for (const file of files) {
    if (basename(file.destName) !== file.destName) {
      throw errorInvalidDestName(file.destName);
    }
    await copyFile(file.sourcePath, join(destDir, file.destName));
  }
}

export async function writeMigrationMetadata(
  dir: string,
  metadata: MigrationMetadata,
): Promise<void> {
  await writeFile(join(dir, MANIFEST_FILE), `${JSON.stringify(metadata, null, 2)}\n`);
}

export async function writeMigrationOps(dir: string, ops: MigrationOps): Promise<void> {
  await writeFile(join(dir, OPS_FILE), `${JSON.stringify(ops, null, 2)}\n`);
}

export async function readMigrationPackage(
  dir: string,
  options: ReadMigrationPackageOptions,
): Promise<OnDiskMigrationPackage> {
  const absoluteDir = resolve(dir);
  const manifestPath = join(absoluteDir, MANIFEST_FILE);
  const opsPath = join(absoluteDir, OPS_FILE);

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile(MANIFEST_FILE, absoluteDir);
    }
    throw error;
  }

  let opsRaw: string;
  try {
    opsRaw = await readFile(opsPath, 'utf-8');
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      throw errorMissingFile(OPS_FILE, absoluteDir);
    }
    throw error;
  }

  let metadata: MigrationMetadata;
  try {
    metadata = JSON.parse(manifestRaw);
  } catch (e) {
    throw errorInvalidJson(manifestPath, e instanceof Error ? e.message : String(e));
  }

  let ops: MigrationOps;
  try {
    ops = JSON.parse(opsRaw);
  } catch (e) {
    throw errorInvalidJson(opsPath, e instanceof Error ? e.message : String(e));
  }

  validateMetadata(metadata, manifestPath);
  validateOps(ops, opsPath);

  // Re-derive before the hash check so format/duplicate diagnostics
  // fire with their dedicated codes rather than as a generic hash mismatch.
  const derivedInvariants = deriveProvidedInvariants(ops);
  if (!arraysEqual(metadata.providedInvariants, derivedInvariants)) {
    throw errorProvidedInvariantsMismatch(
      manifestPath,
      metadata.providedInvariants,
      derivedInvariants,
    );
  }

  const endContractJson = await readContractSnapshotJsonTolerant(
    options.migrationsDir,
    metadata.to,
    options.verifySnapshotContent,
  );
  const pkg: OnDiskMigrationPackage = {
    dirName: basename(absoluteDir),
    dirPath: absoluteDir,
    metadata,
    ops,
    ...ifDefined('endContractJson', endContractJson),
  };

  const verification = verifyMigrationHash(pkg);
  if (!verification.ok) {
    throw errorMigrationHashMismatch(
      absoluteDir,
      verification.storedHash,
      verification.computedHash,
    );
  }

  return pkg;
}

/**
 * Reads a migration package's manifest and ops without running hash or
 * invariants verification. Returns `null` when the files cannot be read or
 * parsed (i.e. when the package is genuinely unloadable).
 *
 * Used by {@link readMigrationsDir} to retain a package whose hash or
 * invariants diverge from what is stored on disk — the raw content is still
 * useful for display / querying; only integrity is in question.
 */
async function readMigrationPackageRaw(dir: string): Promise<OnDiskMigrationPackage | null> {
  const absoluteDir = resolve(dir);
  const manifestPath = join(absoluteDir, MANIFEST_FILE);
  const opsPath = join(absoluteDir, OPS_FILE);

  let manifestRaw: string;
  try {
    manifestRaw = await readFile(manifestPath, 'utf-8');
  } catch {
    return null;
  }
  let opsRaw: string;
  try {
    opsRaw = await readFile(opsPath, 'utf-8');
  } catch {
    return null;
  }

  let metadata: MigrationMetadata;
  try {
    metadata = JSON.parse(manifestRaw);
  } catch {
    return null;
  }
  let ops: MigrationOps;
  try {
    ops = JSON.parse(opsRaw);
  } catch {
    return null;
  }

  const result = MigrationMetadataSchema(metadata);
  if (result instanceof type.errors) return null;

  const opsResult = MigrationOpsSchema(ops);
  if (opsResult instanceof type.errors) return null;

  // Deliberately no `endContractJson`: this loader only runs for packages
  // that failed hash / invariants verification, and a snapshot from an
  // unverifiable package must never reach the ledger's contract store.
  return {
    dirName: basename(absoluteDir),
    dirPath: absoluteDir,
    metadata,
    ops,
  };
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function validateMetadata(
  metadata: unknown,
  filePath: string,
): asserts metadata is MigrationMetadata {
  const result = MigrationMetadataSchema(metadata);
  if (result instanceof type.errors) {
    throw errorInvalidManifest(filePath, result.summary);
  }
}

function validateOps(ops: unknown, filePath: string): asserts ops is MigrationOps {
  const result = MigrationOpsSchema(ops);
  if (result instanceof type.errors) {
    throw errorInvalidManifest(filePath, result.summary);
  }
}

/**
 * A per-package load-time problem returned by {@link readMigrationsDir}.
 *
 * Three variants, matching the relocated throws from the load path:
 *
 * - `hashMismatch` — stored `migrationHash` differs from the recomputed value.
 *   The package is **retained** in the returned `packages` array.
 * - `providedInvariantsMismatch` — `migration.json` declares different
 *   `providedInvariants` than `ops.json` implies.  The package is **retained**.
 * - `packageUnloadable` — the manifest is missing, unparseable, or schema-
 *   invalid.  The package is **omitted** from `packages`.
 *
 * Callers that need the `spaceId` context (e.g. the aggregate loader) attach
 * it when converting to {@link import('./integrity-violation').IntegrityViolation}.
 */
export type PackageLoadProblem =
  | {
      readonly kind: 'hashMismatch';
      readonly dirName: string;
      readonly stored: string;
      readonly computed: string;
    }
  | { readonly kind: 'providedInvariantsMismatch'; readonly dirName: string }
  | { readonly kind: 'packageUnloadable'; readonly dirName: string; readonly detail: string };

/**
 * Result returned by {@link readMigrationsDir}.
 *
 * - `packages` — every package that could be read; hash-mismatched and
 *   invariants-mismatched packages are included here (the problem is
 *   represented rather than fatal).
 * - `problems` — one entry per package that had a load-time issue.
 *   `packageUnloadable` entries are **not** in `packages`.
 */
export interface ReadMigrationsDirResult {
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly problems: readonly PackageLoadProblem[];
}

function packageLoadProblemDetailFromError(error: unknown): string {
  if (MigrationToolsError.is(error)) return error.why;
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function readMigrationsDir(
  migrationsRoot: string,
  options: ReadMigrationPackageOptions,
): Promise<ReadMigrationsDirResult> {
  let entries: string[];
  try {
    entries = await readdir(migrationsRoot);
  } catch (error) {
    if (hasErrnoCode(error, 'ENOENT')) {
      return { packages: [], problems: [] };
    }
    throw error;
  }

  const packages: OnDiskMigrationPackage[] = [];
  const problems: PackageLoadProblem[] = [];

  for (const entry of entries.sort()) {
    const entryPath = join(migrationsRoot, entry);
    const entryStat = await stat(entryPath);
    if (!entryStat.isDirectory()) continue;

    const manifestPath = join(entryPath, MANIFEST_FILE);
    try {
      await stat(manifestPath);
    } catch {
      continue; // skip non-migration directories
    }

    let pkg: OnDiskMigrationPackage;
    try {
      pkg = await readMigrationPackage(entryPath, options);
    } catch (error) {
      const dirName = entry;
      if (MigrationToolsError.is(error)) {
        if (error.code === 'MIGRATION.HASH_MISMATCH') {
          const meta = error.meta;
          const rawPkg = await readMigrationPackageRaw(entryPath);
          if (rawPkg !== null) packages.push(rawPkg);
          problems.push({
            kind: 'hashMismatch',
            dirName,
            stored: typeof meta?.['storedHash'] === 'string' ? meta['storedHash'] : '',
            computed: typeof meta?.['computedHash'] === 'string' ? meta['computedHash'] : '',
          });
          continue;
        }
        if (error.code === 'MIGRATION.PROVIDED_INVARIANTS_MISMATCH') {
          const rawPkg = await readMigrationPackageRaw(entryPath);
          if (rawPkg !== null) packages.push(rawPkg);
          problems.push({ kind: 'providedInvariantsMismatch', dirName });
          continue;
        }
      }
      // Any other error (missing file, invalid JSON, invalid manifest schema) →
      // package unloadable; omit from packages.
      problems.push({
        kind: 'packageUnloadable',
        dirName,
        detail: packageLoadProblemDetailFromError(error),
      });
      continue;
    }
    packages.push(pkg);
  }

  return { packages, problems };
}

export function formatMigrationDirName(timestamp: Date, slug: string): string {
  const sanitized = slug
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  if (sanitized.length === 0) {
    throw errorInvalidSlug(slug);
  }

  const truncated = sanitized.slice(0, MAX_SLUG_LENGTH);

  const y = timestamp.getUTCFullYear();
  const mo = String(timestamp.getUTCMonth() + 1).padStart(2, '0');
  const d = String(timestamp.getUTCDate()).padStart(2, '0');
  const h = String(timestamp.getUTCHours()).padStart(2, '0');
  const mi = String(timestamp.getUTCMinutes()).padStart(2, '0');

  return `${y}${mo}${d}T${h}${mi}_${truncated}`;
}
