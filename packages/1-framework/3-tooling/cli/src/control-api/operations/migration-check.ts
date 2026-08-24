/**
 * Policy core of `migration check`: per-space explicit graph checks, aggregate-integrity loading, and single-target resolution.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config-loader';
import { createControlStack } from '@internal/framework-components/control';
import type {
  ContractSpaceAggregate,
  IntegrityViolation,
} from '@internal/migration-tools/aggregate';
import { loadContractSpaceAggregate } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  contractSnapshotDir,
  readContractSnapshotJson,
} from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import type { OnDiskMigrationPackage } from '@internal/migration-tools/package';
import {
  parseMigrationRef,
  type RefResolutionError,
} from '@internal/migration-tools/ref-resolution';
import type { Refs } from '@internal/migration-tools/refs';
import {
  isValidSpaceId,
  listContractSpaceDirectories,
  spaceMigrationDirectory,
  spaceRefsDirectory,
} from '@internal/migration-tools/spaces';
import { ifDefined } from '@internal/utils/defined';
import { notOk, ok, type Result } from '@internal/utils/result';
import { join, relative } from 'pathe';
import type { CheckFailure, MigrationCheckResult } from '../../commands/json/schemas';
import { INTEGRITY_FAILED, OK, PRECONDITION } from '../../commands/migration-check/exit-codes';
import {
  type CliStructuredError,
  errorAmbiguousMigrationRef,
  errorInvalidSpaceId,
  errorSpaceNotFound,
  mapRefResolutionError,
} from '../../utils/cli-errors';
import { resolveContractPath } from '../../utils/command-helpers';
import { toDeclaredExtensionsFromRaw } from '../../utils/extension-pack-inputs';
import {
  findPackageByDirPath,
  looksLikePath,
  resolveAppTargetPath,
  resolveTargetPathAcrossSpaces,
} from '../../utils/migration-path-target';
import { chooseAction, runCommandAction } from '../../utils/next-actions';

function migrationPathRelative(cwd: string, dirPath: string): string {
  return relative(cwd, dirPath);
}

function migrationFileRelative(cwd: string, dirPath: string, fileName: string): string {
  return join(migrationPathRelative(cwd, dirPath), fileName);
}

function checkFileExists(
  space: CheckSpace,
  dirPath: string,
  dirName: string,
  fileName: string,
): CheckFailure | null {
  if (!existsSync(join(dirPath, fileName))) {
    return {
      space: space.spaceId,
      code: 'MIGRATION.CHECK_FILE_MISSING',
      where: migrationFileRelative(space.cwd, dirPath, fileName),
      why: `${fileName} is missing from ${dirName}`,
      nextActions: [
        chooseAction('Re-emit the migration package, or restore it from version control'),
      ],
    };
  }
  return null;
}

/**
 * Snapshot-store consistency check for one migration package (D6.5):
 * absent store entry is not an issue (runner independence, ADR 199 — a
 * package dir with only `migration.json` + `ops.json` is legitimate); a
 * present entry whose inner `storage.storageHash` disagrees with
 * `pkg.metadata.to` is `MIGRATION.CHECK_SNAPSHOT_HASH_MISMATCH`; an unparseable store
 * entry (or a malformed `to`) is `MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE`.
 */
async function checkSnapshotConsistency(
  space: CheckSpace,
  pkg: OnDiskMigrationPackage,
  migrationsDir: string,
): Promise<CheckFailure | null> {
  const spaceId = space.spaceId;
  let snapshotDir: string;
  try {
    snapshotDir = contractSnapshotDir(migrationsDir, pkg.metadata.to);
  } catch {
    return {
      space: spaceId,
      code: 'MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE',
      where: migrationPathRelative(space.cwd, pkg.dirPath),
      why: `Migration "${pkg.dirName}" declares to="${pkg.metadata.to}", which is not a well-formed contract snapshot hash.`,
      nextActions: [
        chooseAction(
          'Re-emit the migration package so migration.json declares a valid 64-hex to-hash',
        ),
      ],
    };
  }

  let raw: unknown;
  try {
    raw = await readContractSnapshotJson(migrationsDir, pkg.metadata.to);
  } catch (error) {
    if (MigrationToolsError.is(error) && error.code === 'MIGRATION.CONTRACT_SNAPSHOT_MISSING') {
      return null;
    }
    return {
      space: spaceId,
      code: 'MIGRATION.CHECK_SNAPSHOT_UNPARSEABLE',
      where: migrationPathRelative(space.cwd, pkg.dirPath),
      why: `Migration "${pkg.dirName}" has an unparseable contract snapshot at ${snapshotDir}/contract.json.`,
      nextActions: [
        chooseAction('Restore migrations/snapshots/ from version control'),
        chooseAction(
          'Or re-run the command that produced this migration to regenerate its snapshot',
        ),
      ],
    };
  }
  const record = raw !== null && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const storage = record['storage'] as Record<string, unknown> | undefined;
  const snapshotHash = storage?.['storageHash'];
  if (typeof snapshotHash === 'string' && snapshotHash !== pkg.metadata.to) {
    return {
      space: spaceId,
      code: 'MIGRATION.CHECK_SNAPSHOT_HASH_MISMATCH',
      where: migrationPathRelative(space.cwd, pkg.dirPath),
      why: `Migration "${pkg.dirName}" declares to=${pkg.metadata.to} but its contract snapshot has storageHash=${snapshotHash}`,
      nextActions: [
        chooseAction(
          'Re-emit the migration package so migration.json and its contract snapshot agree',
        ),
      ],
    };
  }
  return null;
}

/**
 * One contract space's on-disk state, resolved for the explicit graph
 * checks `runMigrationCheck` runs per space: the space's migration
 * packages, its user-authored refs, its induced graph, and the absolute
 * `migrations/<space>/` + `migrations/<space>/refs/` directories the
 * file-existence and dangling-ref `where` paths are derived from.
 */
export interface CheckSpace {
  readonly spaceId: string;
  readonly packages: readonly OnDiskMigrationPackage[];
  readonly refs: Refs;
  readonly graph: MigrationGraph;
  readonly migrationsDir: string;
  readonly refsDir: string;
  /** Migrations root the contract-snapshot store lives under — shared by every space. */
  readonly projectMigrationsDir: string;
  /** Directory the command was invoked from; every `where` path is relative to it. */
  readonly cwd: string;
}

/**
 * Project the loaded {@link ContractSpaceAggregate} into the
 * {@link CheckSpace} rows the multi-space check iterates — one per on-disk
 * contract-space directory, in the aggregate's `app`-first ordering. Mirrors
 * `migration list`'s `migrationSpaceListEntriesFromAggregate`: space
 * membership matches the on-disk directories, package / ref / graph data come
 * from `aggregate.space(id)`.
 */
export async function enumerateCheckSpaces(
  aggregate: ContractSpaceAggregate,
  projectMigrationsDir: string,
  cwd: string,
): Promise<readonly CheckSpace[]> {
  const candidateDirs = await listContractSpaceDirectories(projectMigrationsDir);
  const onDiskSpaceIds = new Set(candidateDirs.filter(isValidSpaceId));
  const spaces: CheckSpace[] = [];
  for (const space of aggregate.spaces()) {
    const spaceId = space.spaceId;
    if (!isValidSpaceId(spaceId)) continue;
    if (!onDiskSpaceIds.has(spaceId)) continue;
    const migrationsDir = spaceMigrationDirectory(projectMigrationsDir, spaceId);
    spaces.push({
      spaceId,
      packages: space.packages,
      refs: space.refs,
      graph: space.graph(),
      migrationsDir,
      refsDir: spaceRefsDirectory(migrationsDir),
      projectMigrationsDir,
      cwd,
    });
  }
  return spaces;
}

function checkManifestFilesPresent(space: CheckSpace): readonly CheckFailure[] {
  if (!existsSync(space.migrationsDir)) return [];
  const loadedDirNames = new Set(space.packages.map((p) => p.dirName));
  const failures: CheckFailure[] = [];
  let entries: string[];
  try {
    entries = readdirSync(space.migrationsDir);
  } catch {
    return failures;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || entry.startsWith('_') || entry === 'refs') continue;
    const entryPath = join(space.migrationsDir, entry);
    try {
      if (!statSync(entryPath).isDirectory()) continue;
    } catch {
      continue;
    }
    if (!loadedDirNames.has(entry)) {
      for (const f of ['migration.json', 'ops.json']) {
        const fail = checkFileExists(space, entryPath, entry, f);
        if (fail) failures.push(fail);
      }
    }
  }
  return failures;
}

function checkReachability(space: CheckSpace): readonly CheckFailure[] {
  const allToHashes = new Set(space.packages.map((p) => p.metadata.to));
  const failures: CheckFailure[] = [];
  for (const pkg of space.packages) {
    const isReachable =
      pkg.metadata.from === null ||
      allToHashes.has(pkg.metadata.from) ||
      pkg.metadata.from === EMPTY_CONTRACT_HASH;
    if (!isReachable) {
      failures.push({
        space: space.spaceId,
        code: 'MIGRATION.CHECK_UNREACHABLE_MIGRATION',
        where: migrationPathRelative(space.cwd, pkg.dirPath),
        why: `Migration "${pkg.dirName}" starts from ${pkg.metadata.from} which no other migration produces`,
        nextActions: [
          chooseAction('Delete the unreachable migration'),
          chooseAction('Or re-emit a migration that connects it to the graph'),
        ],
      });
    }
  }
  return failures;
}

function checkDanglingRefs(space: CheckSpace): readonly CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const [name, entry] of Object.entries(space.refs)) {
    if (!space.graph.nodes.has(entry.hash)) {
      failures.push({
        space: space.spaceId,
        code: 'MIGRATION.CHECK_DANGLING_REF',
        where: relative(space.cwd, join(space.refsDir, `${name}.json`)),
        why: `Ref "${name}" points at ${entry.hash} which does not exist in the migration graph`,
        nextActions: [
          runCommandAction(
            'Point the ref at a graph node',
            `{bin} migration ref set ${name} <valid-hash>`,
          ),
          chooseAction('Or delete the ref'),
        ],
      });
    }
  }
  return failures;
}

async function checkSpace(space: CheckSpace): Promise<readonly CheckFailure[]> {
  const snapshotFailures = await Promise.all(
    space.packages.map((pkg) => checkSnapshotConsistency(space, pkg, space.projectMigrationsDir)),
  );
  return [
    ...checkManifestFilesPresent(space),
    ...snapshotFailures.filter((f): f is CheckFailure => f !== null),
    ...checkReachability(space),
    ...checkDanglingRefs(space),
  ];
}

/**
 * Inputs for {@link runMigrationCheck} — the multi-space policy core of
 * the holistic (no-arg) `migration check`. Enumeration is supplied by the
 * caller (the CLI shell builds it from {@link enumerateCheckSpaces}); the
 * core does not touch config, flags, or streams.
 */
export interface RunMigrationCheckInputs {
  readonly spaces: readonly CheckSpace[];
  readonly spaceFilter?: string;
}

/**
 * Policy core of the holistic `migration check`: validates `--space`,
 * narrows the pre-enumerated spaces, and runs the per-space explicit graph
 * checks (file-existence, snapshot consistency, reachability, dangling
 * refs), aggregating every failure into one {@link MigrationCheckResult}.
 *
 * `--space` validation mirrors `migration list`: an invalid id →
 * {@link errorInvalidSpaceId}; an id with no on-disk space →
 * {@link errorSpaceNotFound}. Both map to exit `PRECONDITION` at the shell.
 * Aggregate-integrity violations (which already span every space) are folded
 * in by the caller, not here.
 */
export async function runMigrationCheck(
  inputs: RunMigrationCheckInputs,
): Promise<Result<MigrationCheckResult, CliStructuredError>> {
  const { spaces, spaceFilter } = inputs;

  if (spaceFilter !== undefined && !isValidSpaceId(spaceFilter)) {
    return notOk(errorInvalidSpaceId(spaceFilter));
  }
  if (spaceFilter !== undefined && !spaces.some((s) => s.spaceId === spaceFilter)) {
    return notOk(errorSpaceNotFound(spaceFilter, spaces.map((s) => s.spaceId).sort()));
  }

  const scopedSpaces =
    spaceFilter !== undefined ? spaces.filter((s) => s.spaceId === spaceFilter) : spaces;

  const failures = (await Promise.all(scopedSpaces.map(checkSpace))).flat();
  if (failures.length === 0) {
    return ok({ ok: true, failures: [], summary: 'All checks passed' });
  }
  return ok({ ok: false, failures, summary: `${failures.length} integrity failure(s)` });
}

export async function loadAggregateIntegrityViolations(
  config: PrismaNextConfig,
  migrationsDir: string,
): Promise<readonly IntegrityViolation[]> {
  try {
    const contractJsonContent = await readFile(resolveContractPath(config), 'utf-8');
    const familyInstance = config.family.create(createControlStack(config));
    const declaredExtensions = toDeclaredExtensionsFromRaw(config.extensions ?? []);

    const parsedAppContract: unknown = JSON.parse(contractJsonContent);
    const aggregate = await loadContractSpaceAggregate({
      migrationsDir,
      deserializeContract: (json: unknown) => familyInstance.deserializeContract(json),
      appContract: familyInstance.deserializeContract(parsedAppContract),
    });
    return aggregate.checkIntegrity({ declaredExtensions, checkContracts: true });
  } catch {
    return [];
  }
}

export interface MigrationCheckOutcome {
  readonly result?: MigrationCheckResult;
  readonly error?: CliStructuredError;
  readonly exitCode: number;
  readonly resolvedSpaceId?: string;
}

export interface SingleTargetInputs {
  readonly spaces: readonly CheckSpace[];
  readonly spaceFilter?: string;
  readonly appMigrationsDir: string;
  readonly appMigrationsRelative: string;
  /** Directory the command was invoked from; a path target resolves against it. */
  readonly cwd: string;
}

/**
 * Ranks ref-resolution failure kinds by how informative they are, so a
 * single-target check surfaces the most useful failure across spaces instead of
 * whichever space failed first. `not-found` (the input matched nothing here)
 * says the least; a malformed input, a wrong grammar, or an in-space ambiguity
 * all say more.
 */
function refFailureSpecificity(error: RefResolutionError): number {
  switch (error.kind) {
    case 'wrong-grammar':
      return 3;
    case 'ambiguous':
      return 2;
    case 'invalid-format':
      return 1;
    case 'not-found':
      return 0;
  }
}

/**
 * Single-target (`check <ref/path>`) mode — resolves a migration reference
 * across all contract spaces (or the one space narrowed by `--space <id>`).
 *
 * Resolution:
 *   - filesystem path → find the owning space by checking which space's
 *     `migrationsDir` contains the resolved path; falls back to app-relative
 *     validation when the path is outside every space dir.
 *   - ref → `parseMigrationRef` against each in-scope space; collect every
 *     (space, package) hit; 0 hits = not-found, 1 = check it, >1 = ambiguity
 *     error (qualify with `--space`).
 *
 * `--space <id>` is validated the same way the holistic path does it:
 * invalid id → `errorInvalidSpaceId`; no on-disk space → `errorSpaceNotFound`.
 */
export async function checkSingleTarget(
  target: string,
  inputs: SingleTargetInputs,
): Promise<MigrationCheckOutcome> {
  const { spaces, spaceFilter, appMigrationsDir, appMigrationsRelative, cwd } = inputs;

  if (spaceFilter !== undefined && !isValidSpaceId(spaceFilter)) {
    return { error: errorInvalidSpaceId(spaceFilter), exitCode: PRECONDITION };
  }
  if (spaceFilter !== undefined && !spaces.some((s) => s.spaceId === spaceFilter)) {
    return {
      error: errorSpaceNotFound(spaceFilter, spaces.map((s) => s.spaceId).sort()),
      exitCode: PRECONDITION,
    };
  }

  const scopedSpaces =
    spaceFilter !== undefined ? spaces.filter((s) => s.spaceId === spaceFilter) : spaces;

  let matchedSpace: CheckSpace | undefined;
  let matchedPkg: OnDiskMigrationPackage | undefined;

  if (looksLikePath(target)) {
    const resolvedPath = resolveTargetPathAcrossSpaces(cwd, target, scopedSpaces);
    if (resolvedPath !== null) {
      for (const space of scopedSpaces) {
        const found = findPackageByDirPath(space.packages, resolvedPath);
        if (found) {
          matchedSpace = space;
          matchedPkg = found;
          break;
        }
      }
    } else {
      // Path outside every space dir — fall back to app-relative validation
      const resolved = resolveAppTargetPath(cwd, target, appMigrationsDir, appMigrationsRelative);
      if (!resolved.ok) {
        return { error: resolved.failure, exitCode: PRECONDITION };
      }
      const appSpace = scopedSpaces.find((s) => s.spaceId === 'app');
      if (appSpace) {
        matchedSpace = appSpace;
        matchedPkg = findPackageByDirPath(appSpace.packages, resolved.value);
      }
    }
  } else {
    // Ref resolution: try each in-scope space, collect all hits.
    const hits: Array<{ space: CheckSpace; pkg: OnDiskMigrationPackage }> = [];
    let bestParseFailure: RefResolutionError | undefined;
    for (const space of scopedSpaces) {
      const migResult = parseMigrationRef(target, { graph: space.graph, refs: space.refs });
      if (!migResult.ok) {
        // Keep scanning — a later space may hold a hit that must not be discarded.
        // When no space yields a hit, keep the most informative failure rather than
        // whichever space failed first (the kind is space-dependent).
        if (
          bestParseFailure === undefined ||
          refFailureSpecificity(migResult.failure) > refFailureSpecificity(bestParseFailure)
        ) {
          bestParseFailure = migResult.failure;
        }
        continue;
      }
      const pkg = space.packages.find(
        (p) => p.metadata.migrationHash === migResult.value.migrationHash,
      );
      if (pkg) {
        hits.push({ space, pkg });
      }
    }

    if (hits.length > 1) {
      const spaceIds = hits.map((h) => h.space.spaceId);
      return {
        error: errorAmbiguousMigrationRef(target, spaceIds),
        exitCode: PRECONDITION,
      };
    }

    if (hits.length === 1) {
      matchedSpace = hits[0]!.space;
      matchedPkg = hits[0]!.pkg;
    } else if (bestParseFailure !== undefined) {
      // The ref didn't resolve in any in-scope space — surface the most informative
      // parse failure through the shared ref-resolution envelope (CONTRACT.VERIFY_FAILED) the
      // earlier work established, rather than a bespoke string. (Ref-resolved-but-
      // no-package falls through to the "not found on disk" result below.)
      return { error: mapRefResolutionError(bestParseFailure), exitCode: PRECONDITION };
    }
  }

  if (!matchedPkg || !matchedSpace) {
    return {
      result: {
        ok: false,
        failures: [],
        summary: `Migration package for "${target}" not found on disk`,
      },
      exitCode: PRECONDITION,
    };
  }

  const failures: CheckFailure[] = [...checkManifestFilesPresent(matchedSpace)];

  for (const f of ['migration.json', 'ops.json']) {
    const fail = checkFileExists(matchedSpace, matchedPkg.dirPath, matchedPkg.dirName, f);
    if (fail) failures.push(fail);
  }

  const verification = verifyMigrationHash(matchedPkg);
  if (!verification.ok) {
    failures.push({
      space: matchedSpace.spaceId,
      code: 'MIGRATION.CHECK_HASH_MISMATCH',
      where: migrationFileRelative(matchedSpace.cwd, matchedPkg.dirPath, 'migration.json'),
      why: `Stored hash ${verification.storedHash} does not match recomputed hash ${verification.computedHash}`,
      nextActions: [
        chooseAction('Re-emit the migration package, or restore it from version control'),
      ],
    });
  }

  const snapshotFailure = await checkSnapshotConsistency(
    matchedSpace,
    matchedPkg,
    matchedSpace.projectMigrationsDir,
  );
  if (snapshotFailure) failures.push(snapshotFailure);

  const resolvedSpaceId = matchedSpace.spaceId !== 'app' ? matchedSpace.spaceId : undefined;

  if (failures.length === 0) {
    return {
      result: { ok: true, failures: [], summary: 'All checks passed' },
      exitCode: OK,
      ...ifDefined('resolvedSpaceId', resolvedSpaceId),
    };
  }
  return {
    result: { ok: false, failures, summary: `${failures.length} integrity failure(s)` },
    exitCode: INTEGRITY_FAILED,
    ...ifDefined('resolvedSpaceId', resolvedSpaceId),
  };
}
