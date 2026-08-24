/**
 * Read-only preview core for `migrate --show`: computes the migration path through the same planSpacePath seam the real apply uses, stopping before any write boundary.
 */

import type { PrismaNextConfig } from '@internal/config/config-types';
import {
  type AggregateContractSpace,
  type ContractSpaceAggregate,
  requireHeadRef,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { parseContractRef } from '@internal/migration-tools/ref-resolution';
import type { Refs } from '@internal/migration-tools/refs';
import { readRefs } from '@internal/migration-tools/refs';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  CliStructuredError,
  errorDatabaseConnectionRequired,
  errorPathUnreachable,
  errorRuntime,
  errorUnexpected,
  mapRefResolutionError,
  requireLiveDatabase,
} from '../../utils/cli-errors';
import { closeQuietly, resolveMigrationPaths } from '../../utils/command-helpers';
import { createControlClient } from '../client';
import type { CreateControlClient } from '../types';
import { buildReadAggregate } from './contract-space-aggregate-loader';
import { planSpacePath } from './migrate';

/**
 * One migration that will run in a `migrate --show` preview, in execution order.
 */
export interface MigrateShowMigration {
  readonly spaceId: string;
  readonly dirName: string;
  readonly migrationHash: string;
  readonly from: string;
  readonly to: string;
}

export interface ExecuteMigrateShowPlanOptions {
  readonly config: PrismaNextConfig;
  /** Directory the command was invoked from. */
  readonly cwd: string;
  /** `--config` as the user wrote it, used only to locate the migrations directory and for display. */
  readonly configPath?: string;
  readonly db?: string;
  readonly to?: string;
  readonly from?: string;
  /** Client factory used when the plan needs the live DB marker; defaults to the real client. */
  readonly createClient?: CreateControlClient;
  /**
   * Invoked once, after refs/aggregate/--to resolution succeeds and before any DB connection —
   * exactly where the CLI renders its styled header today.
   */
  readonly onPreflightComplete?: (ctx: {
    readonly configPath: string;
    readonly migrationsRelative: string;
    readonly dbConnection: unknown | undefined;
    readonly hasExplicitFrom: boolean;
  }) => void;
}

export interface MigrateShowPlanSuccess {
  readonly aggregate: ContractSpaceAggregate;
  readonly contractHash: string;
  readonly migrations: readonly MigrateShowMigration[];
  readonly summary: string;
  /** Per-space render hash: live/override marker storageHash, pre-defaulted to the empty sentinel. */
  readonly renderMarkerHashBySpace: ReadonlyMap<string, string>;
  /** True when the live DB marker was read — gates the ★ db marker in the tree. */
  readonly usedLiveMarker: boolean;
}

/**
 * Computes the path through the SAME seam as `executeMigrate`:
 * - `readAllMarkers()` for the from-state (when no `--from` is given), preserving
 *   the full marker including `invariants` (not just `storageHash`).
 * - `planSpacePath()` (shared with `executeMigrate`) for per-space path selection,
 *   which feeds `resolveRecordedPath()` with the same target hash, target invariants,
 *   and current marker as the real apply path uses.
 *
 * Returns BEFORE any write boundary (`runMigration` / marker / DDL). No
 * DB state is mutated.
 */
export async function executeMigrateShowPlan(
  options: ExecuteMigrateShowPlanOptions,
): Promise<Result<MigrateShowPlanSuccess, CliStructuredError>> {
  const config = options.config;
  const { configPath, migrationsDir, migrationsRelative, refsDir } = resolveMigrationPaths(
    options.configPath,
    config,
    options.cwd,
  );

  const dbConnection = options.db ?? config.db?.connection;
  const hasDriver = !!config.driver;
  const hasExplicitFrom = options.from !== undefined;

  // When --from is omitted we read the live DB marker (same as migrate's default).
  // When --from is given, we're in offline hypothetical mode — no connection needed.
  if (!hasExplicitFrom) {
    const missingDb = requireLiveDatabase({
      dbConnection,
      hasDriver,
      why: 'migrate --show needs a database connection to read the live marker (or pass --from <contract> for an offline preview)',
      retryCommand: '{bin} db migrate --show --from <contract>',
    });
    if (missingDb) {
      return notOk(missingDb);
    }
  }

  let allRefs: Refs = {};
  try {
    allRefs = await readRefs(refsDir);
  } catch (error) {
    if (MigrationToolsError.is(error)) {
      return notOk(error);
    }
    throw error;
  }

  const loaded = await buildReadAggregate(config, { migrationsDir });
  if (!loaded.ok) {
    return notOk(loaded.failure);
  }
  const { aggregate, contractHash } = loaded.value;
  const appGraph = aggregate.app.graph();

  // Resolve the --to target (defaults to the on-disk contract, same as migrate).
  // Also capture the ref's invariants so planSpacePath feeds resolveRecordedPath the
  // same target invariants that real migrate would use (refInvariants ?? headRef.invariants).
  let targetHash: string = contractHash;
  let refInvariants: readonly string[] | undefined;
  if (options.to) {
    const toResult = parseContractRef(options.to, {
      graph: appGraph,
      refs: allRefs,
      contractHash,
    });
    if (!toResult.ok) {
      return notOk(mapRefResolutionError(toResult.failure));
    }
    if (toResult.value.provenance.kind === 'reserved-db') {
      return notOk(
        errorDatabaseConnectionRequired({
          why: '@db is not valid as a --to target; it names the live database state, not a target contract.',
          commandName: 'migrate --show',
        }),
      );
    }
    targetHash = toResult.value.hash;
    if (toResult.value.provenance.kind === 'ref') {
      const refEntry = allRefs[toResult.value.provenance.refName];
      if (refEntry) refInvariants = refEntry.invariants;
    }
  }

  options.onPreflightComplete?.({
    configPath,
    migrationsRelative,
    dbConnection,
    hasExplicitFrom,
  });

  // Resolve the from-state.
  // - Explicit --from: parse it offline (no connection).
  // - Omitted: read the live DB marker via readAllMarkers() — the same source migrate uses.
  //
  // Full marker records (storageHash + invariants) are preserved so planSpacePath
  // can feed resolveRecordedPath the complete currentMarker — exactly as executeMigrate
  // does via familyInstance.readAllMarkers(). A stripped { storageHash, invariants: [] }
  // marker would produce a different `required` set and a different (incorrect) path.
  type LiveMarker = { readonly storageHash: string; readonly invariants: readonly string[] };
  const markerBySpace = new Map<string, LiveMarker | null>();
  const allSpaces: ReadonlyArray<AggregateContractSpace> = [aggregate.app, ...aggregate.extensions];

  if (hasExplicitFrom) {
    // @db with explicit --from requires a connection
    if (options.from === '@db') {
      const missingDb = requireLiveDatabase({
        dbConnection,
        hasDriver,
        why: '@db resolves to the live database marker and requires a --db connection',
        retryCommand: '{bin} db migrate --show --from @db --db $DATABASE_URL',
      });
      if (missingDb) {
        return notOk(missingDb);
      }
      // Fall through to the connection path below
    } else {
      const fromResult = parseContractRef(options.from, {
        graph: appGraph,
        refs: allRefs,
        contractHash,
      });
      if (!fromResult.ok) {
        return notOk(mapRefResolutionError(fromResult.failure));
      }
      if (fromResult.value.provenance.kind === 'reserved-db') {
        // Unreachable given the @db branch above, but guard for safety
        const missingDb = requireLiveDatabase({
          dbConnection,
          hasDriver,
          why: '@db resolves to the live database marker and requires a --db connection',
        });
        if (missingDb) {
          return notOk(missingDb);
        }
      } else {
        // Offline hypothetical: the --from ref only carries a hash (no live invariants).
        // Apply the from-hash marker to the APP space only. Extension spaces are left
        // absent from markerBySpace (treated as null / greenfield by planSpacePath),
        // so they plan from their own marker → own head — exactly as executeMigrate does.
        const fromHash = fromResult.value.hash;
        const offlineMarker: LiveMarker | null =
          fromHash === EMPTY_CONTRACT_HASH ? null : { storageHash: fromHash, invariants: [] };
        markerBySpace.set(aggregate.app.spaceId, offlineMarker);
      }
    }
  }

  // If we need the live DB marker (no --from, or --from @db), connect and read.
  const needsLiveMarker = !hasExplicitFrom || options.from === '@db';
  if (needsLiveMarker) {
    if (!dbConnection || !hasDriver) {
      return notOk(
        errorDatabaseConnectionRequired({
          why: 'A database connection is required to read the live marker for migrate --show',
          commandName: 'migrate --show',
        }),
      );
    }
    const client = (options.createClient ?? createControlClient)({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver: config.driver!,
      extensions: config.extensions ?? [],
    });
    try {
      await client.connect(dbConnection);
      const allMarkers = await client.readAllMarkers();
      // Store the full marker record (storageHash + invariants) per space.
      // This is the same data executeMigrate uses via familyInstance.readAllMarkers().
      for (const space of allSpaces) {
        const marker = allMarkers.get(space.spaceId);
        markerBySpace.set(space.spaceId, marker ?? null);
      }
    } catch (error) {
      if (CliStructuredError.is(error)) {
        return notOk(error);
      }
      return notOk(
        errorUnexpected(error instanceof Error ? error.message : String(error), {
          why: `Failed to read live DB marker: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
    } finally {
      await closeQuietly(client);
    }
  }

  // Walk the path via planSpacePath — the same helper executeMigrate uses.
  // planSpacePath feeds resolveRecordedPath identical inputs (targetHash, targetInvariants,
  // currentMarker with full invariants), so the preview path is always the path migrate runs.
  //
  // Canonical schedule order: extensions alphabetically first, then app — mirroring the
  // runner's `applyOrder` in operations/migrate.ts so the "Will run, in order:" list
  // reflects the actual execution sequence (extensions install first, app last).
  const canonicalOrderSpaces: ReadonlyArray<AggregateContractSpace> = [
    ...aggregate.extensions,
    aggregate.app,
  ];
  const orderedMigrations: MigrateShowMigration[] = [];
  for (const space of canonicalOrderSpaces) {
    const isAppSpace = space.spaceId === aggregate.app.spaceId;
    const headRef = requireHeadRef(space);
    const spaceTargetHash = isAppSpace ? targetHash : headRef.hash;
    const spaceRefInvariants = isAppSpace ? refInvariants : undefined;
    const liveMarker = markerBySpace.get(space.spaceId) ?? null;

    const outcome = planSpacePath({
      space,
      aggregate,
      targetHash: spaceTargetHash,
      refInvariants: spaceRefInvariants,
      liveMarker,
    });

    if (outcome.kind === 'at-head') {
      // Empty-graph space already at target — nothing to run for this space.
      continue;
    }
    if (outcome.kind === 'never-planned') {
      return notOk(
        errorPathUnreachable({
          code: 'MIGRATION_PATH_NOT_FOUND',
          summary: `No on-disk migrations for contract space "${outcome.spaceId}"`,
          why: `migrate is replay-only: space "${outcome.spaceId}" has no on-disk migrations but its head ref targets "${outcome.targetHash}".`,
          meta: { spaceId: outcome.spaceId, target: outcome.targetHash, kind: 'neverPlanned' },
        }),
      );
    }
    if (outcome.kind === 'unreachable') {
      const fromHash = outcome.liveMarker?.storageHash ?? EMPTY_CONTRACT_HASH;
      return notOk(
        errorPathUnreachable({
          code: 'MIGRATION_PATH_NOT_FOUND',
          summary: `No migration path from ${fromHash.slice(0, 14)} to ${outcome.targetHash.slice(0, 14)} in space "${outcome.spaceId}".`,
          why: `The migration graph has no path from the from-state to the target in space "${outcome.spaceId}".`,
          meta: { spaceId: outcome.spaceId, from: fromHash, to: outcome.targetHash },
        }),
      );
    }
    if (outcome.kind === 'unsatisfiable') {
      return notOk(
        errorRuntime(
          'MIGRATION.NO_INVARIANT_PATH',
          `Missing required invariants for space "${outcome.spaceId}"`,
          {
            why: `The path requires invariants not available on disk: ${outcome.missing.join(', ')}`,
            fix: 'Add a migration on the path that runs `dataTransform({ invariantId: "<id>", … })` for each missing invariant, or retarget the ref to a hash whose path already provides them.',
            meta: { spaceId: outcome.spaceId, missing: [...outcome.missing] },
          },
        ),
      );
    }

    for (const edge of outcome.plan.migrationEdges) {
      orderedMigrations.push({
        spaceId: space.spaceId,
        dirName: edge.dirName,
        migrationHash: edge.migrationHash,
        from: edge.from,
        to: edge.to,
      });
    }
  }

  const count = orderedMigrations.length;
  const summary =
    count === 0
      ? 'Already up to date — nothing to run'
      : `${count} migration${count === 1 ? '' : 's'} will run`;

  const renderMarkerHashBySpace = new Map(
    allSpaces.map((s) => [
      s.spaceId,
      markerBySpace.get(s.spaceId)?.storageHash ?? EMPTY_CONTRACT_HASH,
    ]),
  );

  return ok({
    aggregate,
    contractHash,
    migrations: orderedMigrations,
    summary,
    renderMarkerHashBySpace,
    usedLiveMarker: needsLiveMarker,
  });
}
