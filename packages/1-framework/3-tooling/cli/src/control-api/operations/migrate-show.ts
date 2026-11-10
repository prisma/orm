/**
 * Read-only preview core for `migrate --show`: computes the migration path through the same planSpacePath seam the real apply uses, stopping before any write boundary.
 */

import type { PrismaNextConfig } from '@internal/config/config-types';
import {
  type AggregateContractSpace,
  type ContractSpaceAggregate,
  contractHashAtMarker,
  spacesInApplyOrder,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import type { Refs } from '@internal/migration-tools/refs';
import { readRefs } from '@internal/migration-tools/refs';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { notOk, ok, type Result } from '@internal/utils/result';
import {
  type CliStructuredError,
  errorPathUnreachable,
  errorRuntime,
} from '../../utils/cli-errors';
import { closeQuietly, resolveMigrationPaths } from '../../utils/command-helpers';
import type { CliInvocation } from '../../utils/printed-command';
import { createControlClient } from '../client';
import type { CreateControlClient } from '../types';
import { errorFromCaught } from './caught-errors';
import { buildReadAggregate } from './contract-space-aggregate-loader';
import { planEverySpace, planSpaces, type SpacePathOutcome } from './migrate';
import {
  liveMarkerUse,
  requireDatabaseForLiveMarkerUse,
  resolveContractRef,
} from './ref-resolution';

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
  readonly db?: string;
  readonly to?: string;
  readonly from?: string;
  /** The command line printed advice repeats. */
  readonly invocation: CliInvocation;
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
  /** Present when the preview read the database: the marker hash, or the empty contract, of each space whose plan uses the marker. */
  readonly databaseMarkerHashBySpace?: ReadonlyMap<string, string>;
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
    config,
    options.cwd,
  );

  const dbConnection = options.db ?? config.db?.connection;
  const driver = config.driver;
  const hasExplicitFrom = options.from !== undefined;
  const { liveOrigin, liveTarget, needsDatabase } = liveMarkerUse({
    from: options.from,
    to: options.to,
  });

  const missingDb = requireDatabaseForLiveMarkerUse({
    from: options.from,
    to: options.to,
    dbConnection,
    hasDriver: driver !== undefined,
    commandName: 'db migrate --show',
  });
  if (missingDb) {
    return notOk(missingDb);
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
  const { aggregate, contractHash, storageNameOf } = loaded.value;
  const appGraph = aggregate.app.graph();

  // Resolve the --to target (defaults to the on-disk contract, same as migrate).
  // Also capture the ref's invariants so planSpacePath feeds resolveRecordedPath the
  // same target invariants that real migrate would use (refInvariants ?? headRef.invariants).
  let targetHash: string = contractHash;
  let refInvariants: readonly string[] | undefined;
  const refContext = { graph: appGraph, refs: allRefs, contractHash };
  if (options.to && !liveTarget) {
    const toResult = resolveContractRef(options.to, refContext);
    if (!toResult.ok) {
      return notOk(toResult.failure);
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
  // - Explicit --from other than @db: parse it offline (no connection).
  // - Omitted or @db: read the live DB marker via readAllMarkers() — the same source migrate uses.
  //
  // Full marker records (storageHash + invariants) are preserved so planSpacePath
  // can feed resolveRecordedPath the complete currentMarker — exactly as executeMigrate
  // does via familyInstance.readAllMarkers(). A stripped { storageHash, invariants: [] }
  // marker would produce a different `required` set and a different (incorrect) path.
  type LiveMarker = { readonly storageHash: string; readonly invariants: readonly string[] };
  const markerBySpace = new Map<string, LiveMarker | null>();
  let databaseMarkers: ReadonlyMap<string, LiveMarker> | undefined;
  const allSpaces: ReadonlyArray<AggregateContractSpace> = [aggregate.app, ...aggregate.extensions];
  const planInputs = () => ({
    aggregate,
    markers: markerBySpace,
    appTarget: { hash: targetHash, invariants: refInvariants, refName: undefined },
    storageNameOf,
  });
  let outcomes: ReadonlyMap<string, SpacePathOutcome> | undefined;

  if (options.from !== undefined && !liveOrigin) {
    const fromResult = resolveContractRef(options.from, refContext);
    if (!fromResult.ok) {
      return notOk(fromResult.failure);
    }
    // The --from contract carries a hash and no invariants, and applies to the app
    // space only. Extension spaces stay out of markerBySpace, so they plan from the
    // empty contract to their own head.
    const fromHash = fromResult.value.hash;
    const offlineMarker: LiveMarker | null =
      fromHash === EMPTY_CONTRACT_HASH ? null : { storageHash: fromHash, invariants: [] };
    markerBySpace.set(aggregate.app.spaceId, offlineMarker);
  }

  if (needsDatabase && driver !== undefined) {
    const client = (options.createClient ?? createControlClient)({
      family: config.family,
      target: config.target,
      adapter: config.adapter,
      driver,
      extensions: config.extensions ?? [],
    });
    try {
      await client.connect(dbConnection);
      const allMarkers = await client.readAllMarkers();
      databaseMarkers = allMarkers;
      const appMarker = allMarkers.get(aggregate.app.spaceId);
      // Store the full marker record (storageHash + invariants) per space.
      // This is the same data executeMigrate uses via familyInstance.readAllMarkers().
      if (liveOrigin) {
        for (const space of allSpaces) {
          const marker = allMarkers.get(space.spaceId);
          markerBySpace.set(space.spaceId, marker ?? null);
        }
      }
      if (liveTarget) {
        targetHash = contractHashAtMarker(appMarker);
      }
      // Whichever end of the preview the database supplies, its markers are checked against their
      // graphs exactly as db migrate checks them.
      const checked = await planEverySpace({
        ...planInputs(),
        markers: allMarkers,
        migrationsDir,
        invocation: options.invocation,
        readLedger: (spaceId) => client.readLedger(spaceId),
      });
      if (!checked.ok) {
        return notOk(checked.failure);
      }
      if (liveOrigin) {
        outcomes = checked.value;
      }
    } catch (error) {
      return notOk(
        errorFromCaught(error, (message) => `Failed to read live DB marker: ${message}`, {
          connection: typeof dbConnection === 'string' ? dbConnection : undefined,
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
  // An offline --from is not a database marker, so a --from outside the graph is a path that does
  // not exist rather than MIGRATION.MARKER_MISMATCH.
  const planned = outcomes ?? planSpaces(planInputs());
  const orderedMigrations: MigrateShowMigration[] = [];
  for (const space of spacesInApplyOrder(aggregate)) {
    const outcome = planned.get(space.spaceId);
    if (outcome === undefined) {
      throw new InternalError(`Unreachable: no planned outcome for space "${space.spaceId}"`);
    }

    if (outcome.kind === 'at-head') {
      // Empty-graph space already at target — nothing to run for this space.
      continue;
    }
    if (outcome.kind === 'never-planned') {
      return notOk(
        errorPathUnreachable({
          summary: `No on-disk migrations for contract space "${outcome.spaceId}"`,
          why: `migrate is replay-only: space "${outcome.spaceId}" has no on-disk migrations but its head ref targets "${outcome.targetHash}".`,
          meta: { spaceId: outcome.spaceId, targetHash: outcome.targetHash, kind: 'neverPlanned' },
        }),
      );
    }
    if (outcome.kind === 'unreachable' || outcome.kind === 'marker-outside-graph') {
      const fromHash =
        outcome.kind === 'marker-outside-graph'
          ? outcome.markerHash
          : (outcome.liveMarker?.storageHash ?? EMPTY_CONTRACT_HASH);
      return notOk(
        errorPathUnreachable({
          summary: `No migration path from ${fromHash.slice(0, 14)} to ${outcome.targetHash.slice(0, 14)} in space "${outcome.spaceId}".`,
          why: `The migration graph has no path from the from-state to the target in space "${outcome.spaceId}".`,
          meta: {
            spaceId: outcome.spaceId,
            fromHash,
            targetHash: outcome.targetHash,
            kind: 'pathUnreachable',
          },
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

  const spacesUsingMarker = liveOrigin ? allSpaces : [aggregate.app];
  const databaseMarkerHashBySpace =
    databaseMarkers === undefined
      ? undefined
      : new Map(
          spacesUsingMarker.map((space) => [
            space.spaceId,
            contractHashAtMarker(databaseMarkers.get(space.spaceId)),
          ]),
        );

  return ok({
    aggregate,
    contractHash,
    migrations: orderedMigrations,
    summary,
    ...ifDefined('databaseMarkerHashBySpace', databaseMarkerHashBySpace),
  });
}
