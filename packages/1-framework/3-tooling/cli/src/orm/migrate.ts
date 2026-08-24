import type { Contract } from '@internal/contract/types';
import { createControlStack } from '@internal/framework-components/control';
import type { MigrationGraph } from '@internal/migration-tools/graph';
import type { RefEntry, Refs } from '@internal/migration-tools/refs';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { CliStructuredError, Result } from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { createControlClient } from '../control-api/client';
import { mapCaughtMigrationError } from '../control-api/operations/caught-errors';
import { mapContractAtError } from '../control-api/operations/contract-at-errors';
import {
  loadContractSpaceAggregateForCli,
  refuseContractSpaceIntegrity,
} from '../control-api/operations/contract-space-aggregate-loader';
import { refuseMarkerOutsideGraph } from '../control-api/operations/graph-queries';
import { refuseUnknownInvariants } from '../control-api/operations/invariants';
import {
  executeMigrateShowPlan,
  type MigrateShowMigration,
} from '../control-api/operations/migrate-show';
import { advanceRefSafely, readContractIR } from '../control-api/operations/ref-advancement';
import { resolveContractRef } from '../control-api/operations/ref-resolution';
import type {
  CreateControlClient,
  MigratePathDecision,
  PerSpaceExecutionEntry,
} from '../control-api/types';
import { errorContractValidationFailed, errorUnexpected } from '../utils/cli-errors';
import { closeQuietly, maskConnectionUrl } from '../utils/command-helpers';
import { toDeclaredExtensionsFromRaw } from '../utils/extension-pack-inputs';
import {
  migrateShowRunListRows,
  renderMigrateShowGraph,
} from '../utils/formatters/migrate-show-render';
import { TONE_MIGRATION_GRAPH_PALETTE } from '../utils/formatters/migration-graph-palette';
import { createToneMigrationListStyler } from '../utils/formatters/migration-list-styler';
import { toneDrawing } from '../utils/formatters/tone-markup';
import { mapMigrateFailure } from '../utils/migrate-failure';
import { runCommandAction } from '../utils/next-actions';
import { ormConfigSection } from './config-section';
import { perSpaceBlocks } from './db/migration-blocks';
import { prepareMigrationRun } from './db/prepare';
import { defineOrmCommand } from './define-command';
import { dbFlag } from './flags';
import { displayPath, migrationsDirFor } from './migration/paths';
import { normalizeError } from './normalize-error';
import { controlProgressReporter } from './progress';

/** What `migrate --show` reports. Read-only; no writes performed. */
interface MigrateShowDocument {
  readonly ok: true;
  readonly migrations: readonly MigrateShowMigration[];
  readonly summary: string;
}

interface MigrateDocument {
  readonly ok: boolean;
  readonly migrationsApplied: number;
  readonly migrationsTotal: number;
  readonly markerHash: string;
  readonly applied: readonly {
    readonly spaceId: string;
    readonly dirName: string;
    readonly migrationHash: string;
    readonly from: string;
    readonly to: string;
    readonly operationsExecuted: number;
  }[];
  readonly summary: string;
  readonly perSpace: readonly PerSpaceExecutionEntry[];
  readonly pathDecision?: MigratePathDecision;
  readonly timings: { readonly total: number };
  readonly advancedRef?: { readonly name: string; readonly hash: string } | null;
}

const STATUS_ACTION = runCommandAction(
  'Check every space against the database',
  '{bin} migration status',
);

/**
 * The route the migration will take. The graph is a drawing — the engine cannot
 * derive a lane gutter — and the ordered list under it is drawn with the same
 * widths so every arrow lands in one column.
 */
function showPresentations(inputs: {
  readonly document: MigrateShowDocument;
  readonly graph: string;
  readonly runList: readonly string[];
  readonly migrationsDir: string;
  readonly database: string | undefined;
  readonly from: string | undefined;
  readonly to: string | undefined;
}): Presentations {
  const { document, graph, runList } = inputs;
  const count = document.migrations.length;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'migrations', value: inputs.migrationsDir },
          ...(inputs.database === undefined ? [] : [{ label: 'database', value: inputs.database }]),
          ...(inputs.from === undefined ? [] : [{ label: 'from', value: inputs.from }]),
          ...(inputs.to === undefined ? [] : [{ label: 'to', value: inputs.to }]),
        ],
      },
      ...(graph.length === 0 ? [] : [{ kind: 'drawing' as const, lines: toneDrawing(graph) }]),
      ...(count === 0
        ? [{ kind: 'summary' as const, status: 'info' as const, text: document.summary }]
        : [
            {
              kind: 'summary' as const,
              status: 'info' as const,
              text: `The following ${count} migration${count === 1 ? '' : 's'} will run:`,
            },
            { kind: 'drawing' as const, lines: toneDrawing(runList.join('\n')) },
          ]),
    ],
    json: () => document,
  };
}

function applyPresentations(inputs: {
  readonly document: MigrateDocument;
  readonly migrationsDir: string;
  readonly database: string | undefined;
  readonly to: string | undefined;
}): Presentations {
  const { document } = inputs;
  const advanced = document.advancedRef;
  return {
    stdout: () => [],
    human: (): readonly Block[] => [
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'migrations', value: inputs.migrationsDir },
          ...(inputs.database === undefined ? [] : [{ label: 'database', value: inputs.database }]),
          ...(inputs.to === undefined ? [] : [{ label: 'to', value: inputs.to }]),
        ],
      },
      { kind: 'summary', status: 'ok', text: document.summary },
      ...(document.perSpace.length === 0 ? [] : perSpaceBlocks(document.perSpace, 'apply')),
      ...(advanced === null || advanced === undefined
        ? []
        : [
            {
              kind: 'summary' as const,
              status: 'ok' as const,
              text: [
                { text: `Advanced ref "${advanced.name}" → ` },
                { text: advanced.hash, tone: 'identifier' as const },
              ],
            },
          ]),
    ],
    json: () => document,
    next: () => [STATUS_ACTION],
  };
}

interface RequestedTarget {
  readonly entry: RefEntry | undefined;
  readonly refName: string | undefined;
}

/**
 * `--to` as a contract the app graph knows. A ref target keeps the invariants
 * the ref declares; a bare hash carries none. Omitting `--to` targets the
 * emitted contract, which needs no resolution at all.
 */
function resolveRequestedTarget(
  to: string | undefined,
  refs: Refs,
  graph: MigrationGraph,
): Result<RequestedTarget, CliStructuredError> {
  if (to === undefined) {
    return ok({ entry: undefined, refName: undefined });
  }
  const resolved = resolveContractRef(to, { graph, refs });
  if (!resolved.ok) {
    return notOk(normalizeError(resolved.failure));
  }
  if (resolved.value.provenance.kind !== 'ref') {
    return ok({ entry: { hash: resolved.value.hash, invariants: [] }, refName: undefined });
  }
  const refName = resolved.value.provenance.refName;
  return ok({ entry: refs[refName], refName });
}

export function createMigrateCommand(createClient: CreateControlClient) {
  return defineOrmCommand({
    help: {
      summary: 'Apply planned migrations to advance the database',
      description:
        'Walks every contract space (app + extensions) and applies pending on-disk\n' +
        'migrations in canonical order (extensions alphabetically, then app). It\n' +
        'replays the on-disk migration graph and never invents an edge. Use --to to\n' +
        'target a specific contract (hash, ref name, or migration directory) and\n' +
        '--show for a read-only preview of the route it would take.',
      examples: [
        'db migrate',
        'db migrate --db $DATABASE_URL',
        'db migrate --to production',
        'db migrate --show',
        'db migrate --show --from @contract --to production',
      ],
    },
    args: {
      flags: {
        db: dbFlag,
        to: flag.string({
          brief:
            'Target contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path)',
          placeholder: 'contract',
        }),
        advanceRef: flag.string({
          brief: 'Advance the named ref to the post-apply marker after success',
          placeholder: 'name',
        }),
        show: flag.boolean({ brief: 'Preview the migration route without applying (read-only)' }),
        from: flag.string({
          brief: 'From-state for the --show preview (@contract, @db, hash, ref name, or dir)',
          placeholder: 'contract',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      // `migrate` walks every contract space, so the header names the root they
      // all live under rather than the app subspace.
      const migrationsRelative = displayPath(migrationsDirFor(ctx.config, ctx.cwd), ctx.cwd);

      if (args.flags.show) {
        const planned = await executeMigrateShowPlan({
          config: ctx.config,
          cwd: ctx.cwd,
          createClient,
          ...ifDefined('db', args.flags.db),
          ...ifDefined('to', args.flags.to),
          ...ifDefined('from', args.flags.from),
        });
        if (!planned.ok) {
          return notOk(normalizeError(planned.failure));
        }
        const plan = planned.value;
        const paint = {
          colorize: true,
          glyphMode: 'unicode' as const,
          styler: createToneMigrationListStyler(),
          palette: TONE_MIGRATION_GRAPH_PALETTE,
        };
        const rendering = renderMigrateShowGraph(plan, paint);
        const document: MigrateShowDocument = {
          ok: true,
          migrations: plan.migrations,
          summary: plan.summary,
        };
        const dbConnection = args.flags.db ?? ctx.config.db?.connection;
        return ok(
          ctx.present(
            { data: document },
            showPresentations({
              document,
              graph: rendering.graphOutput,
              runList: migrateShowRunListRows(plan.migrations, rendering, paint),
              migrationsDir: migrationsRelative,
              database:
                args.flags.from === undefined && typeof dbConnection === 'string'
                  ? maskConnectionUrl(dbConnection)
                  : undefined,
              from: args.flags.from,
              to: args.flags.to,
            }),
          ),
        );
      }

      const startedAt = Date.now();
      const prepared = await prepareMigrationRun({
        config: ctx.config,
        cwd: ctx.cwd,
        db: args.flags.db,
        commandName: 'db migrate',
        createClient,
      });
      if (!prepared.ok) {
        return notOk(prepared.failure);
      }
      const { client, contractJson, contractPath, dbConnection, migrationsDir, refsDir } =
        prepared.value;

      const familyInstance = ctx.config.family.create(createControlStack(ctx.config));
      let appContract: Contract;
      try {
        appContract = familyInstance.deserializeContract(contractJson);
      } catch (error) {
        return notOk(
          normalizeError(
            errorContractValidationFailed(
              `Contract at ${contractPath} failed to deserialize: ${error instanceof Error ? error.message : String(error)}`,
              { where: { path: contractPath } },
            ),
          ),
        );
      }

      const loaded = await loadContractSpaceAggregateForCli({
        targetId: ctx.config.target.targetId,
        migrationsDir,
        appContract,
        extensions: ctx.config.extensions ?? [],
        deserializeContract: (json) => familyInstance.deserializeContract(json),
      });
      if (!loaded.ok) {
        return notOk(normalizeError(loaded.failure));
      }
      const aggregate = loaded.value;
      const integrityFailure = refuseContractSpaceIntegrity(
        aggregate,
        {
          declaredExtensions: toDeclaredExtensionsFromRaw(
            castAs<ReadonlyArray<unknown>>(ctx.config.extensions ?? []),
          ),
          checkContracts: true,
        },
        migrationsDir,
      );
      if (integrityFailure) {
        return notOk(normalizeError(integrityFailure));
      }

      const target = resolveRequestedTarget(
        args.flags.to,
        aggregate.app.refs,
        aggregate.app.graph(),
      );
      if (!target.ok) {
        return notOk(target.failure);
      }

      let document: MigrateDocument;
      try {
        await client.connect(dbConnection);
        const appGraph = aggregate.app.graph();
        const appMarker = (await client.readAllMarkers()).get('app') ?? null;

        if (appMarker !== null) {
          const markerRefusal = refuseMarkerOutsideGraph({
            markerHash: appMarker.storageHash,
            graph: appGraph,
          });
          if (markerRefusal) {
            return notOk(normalizeError(markerRefusal));
          }
        }

        const refEntry = target.value.entry;
        if (refEntry !== undefined && refEntry.invariants.length > 0) {
          const invariantRefusal = refuseUnknownInvariants({
            graph: appGraph,
            markerInvariants: appMarker?.invariants ?? [],
            refInvariants: refEntry.invariants,
            ...ifDefined('refName', args.flags.to),
          });
          if (invariantRefusal) {
            return notOk(normalizeError(invariantRefusal));
          }
        }

        // With `--to` on a graph node that has a bundle, the apply contract is
        // THAT bundle's destination rather than the emitted contract.json.
        let applyContract: Contract = appContract;
        let snapshotContractJson: Record<string, unknown> = contractJson;
        let snapshotContractDts: string | undefined;
        if (args.flags.to !== undefined && refEntry !== undefined) {
          const matching = aggregate.app.packages.find((p) => p.metadata.to === refEntry.hash);
          if (matching !== undefined) {
            try {
              const at = await aggregate.app.contractAt(
                refEntry.hash,
                target.value.refName === undefined ? undefined : { refName: target.value.refName },
              );
              applyContract = at.contract;
              snapshotContractJson = blindCast<
                Record<string, unknown>,
                'contractAt reads the stored contract.json, whose top level is a JSON object by construction'
              >(at.contractJson);
              snapshotContractDts = at.contractDts;
            } catch (error) {
              const mapped = mapContractAtError(error, { artifactRole: 'to' });
              if (!mapped.ok) {
                return notOk(normalizeError(mapped.failure));
              }
              throw error;
            }
          }
        }

        const applied = await client.migrate({
          contract: applyContract,
          migrationsDir,
          onProgress: controlProgressReporter(ctx.report),
          ...ifDefined('refHash', refEntry?.hash),
          ...(refEntry?.invariants === undefined ? {} : { refInvariants: refEntry.invariants }),
          ...(refEntry === undefined ? {} : ifDefined('refName', args.flags.to)),
        });
        if (!applied.ok) {
          return notOk(normalizeError(mapMigrateFailure(applied.failure)));
        }
        const { value } = applied;

        let advancedRef: { name: string; hash: string } | null = null;
        if (args.flags.advanceRef !== undefined) {
          const contractIR =
            snapshotContractDts === undefined
              ? await readContractIR(snapshotContractJson, contractPath)
              : { contract: snapshotContractJson, contractDts: snapshotContractDts };
          const advanced = await advanceRefSafely({
            refsDir,
            migrationsDir,
            name: args.flags.advanceRef,
            hash: value.markerHash,
            contractIR,
          });
          if (!advanced.ok) {
            return notOk(normalizeError(advanced.failure));
          }
          advancedRef = { name: advanced.value.name, hash: advanced.value.hash };
        }

        document = {
          ok: true,
          migrationsApplied: value.migrationsApplied,
          migrationsTotal: value.applied.length,
          markerHash: value.markerHash,
          applied: value.applied,
          summary: value.summary,
          perSpace: value.perSpace,
          ...ifDefined('pathDecision', value.pathDecision),
          timings: { total: Date.now() - startedAt },
          advancedRef,
        };
      } catch (error) {
        const mapped = mapCaughtMigrationError(error);
        return notOk(
          normalizeError(
            mapped ??
              errorUnexpected(error instanceof Error ? error.message : String(error), {
                why: `Unexpected error during migrate: ${error instanceof Error ? error.message : String(error)}`,
              }),
          ),
        );
      } finally {
        await closeQuietly(client);
      }

      ctx.report({
        kind: 'message',
        severity: 'verbose',
        text: `Total time: ${document.timings.total}ms`,
      });

      return ok(
        ctx.present(
          { data: document },
          applyPresentations({
            document,
            migrationsDir: migrationsRelative,
            database: prepared.value.database,
            to: args.flags.to,
          }),
        ),
      );
    },
  });
}

export const migrateCommand = createMigrateCommand(createControlClient);
