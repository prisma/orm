import { ormConfigSection } from '@internal/config-loader';
import type { Contract } from '@internal/contract/types';
import {
  createControlStack,
  type DatabasePolicyDifference,
} from '@internal/framework-components/control';
import { contractHashAtMarker } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  contractSnapshotDir,
  hasContractSnapshot,
} from '@internal/migration-tools/contract-snapshot-store';
import { errorInvalidRefName } from '@internal/migration-tools/errors';
import { isLiveMarkerRef } from '@internal/migration-tools/ref-resolution';
import { advanceRef, type RefEntry, validateRefName } from '@internal/migration-tools/refs';
import { blindCast, castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type {
  CliStructuredError,
  Diagnostic,
  NextAction,
  Result,
} from '@prisma/cli-engine/protocol';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { createControlClient } from '../control-api/client';
import { errorFromCaught } from '../control-api/operations/caught-errors';
import { mapContractAtError } from '../control-api/operations/contract-at-errors';
import {
  loadContractSpaceAggregateForCli,
  refuseContractSpaceIntegrity,
} from '../control-api/operations/contract-space-aggregate-loader';
import { databasePoliciesInForce } from '../control-api/operations/database-policies';
import { refuseUnknownInvariants } from '../control-api/operations/invariants';
import { planEverySpace } from '../control-api/operations/migrate';
import {
  executeMigrateShowPlan,
  type MigrateShowMigration,
} from '../control-api/operations/migrate-show';
import {
  preflightRefAdvancement,
  type RefPointerWriter,
  type RefSnapshot,
  type RefWriteFailure,
  writeAdvancedRef,
} from '../control-api/operations/ref-advancement';
import {
  type RefResolutionContext,
  resolveContractRef,
  retryCommandFor,
} from '../control-api/operations/ref-resolution';
import { shellQuoted } from '../control-api/statements/statement-flag';
import type {
  CreateControlClient,
  MigratePathDecision,
  MigrateTarget,
  PerSpaceExecutionEntry,
} from '../control-api/types';
import {
  errorAdvanceRefArgConflict,
  errorContractValidationFailed,
  errorRefTargetEmpty,
} from '../utils/cli-errors';
import { closeQuietly, maskConnectionUrl } from '../utils/command-helpers';
import { ALL_CONTRACT_REF_FORMS } from '../utils/contract-ref-forms';
import { contractValidationMeta } from '../utils/contract-validation-meta';
import { toDeclaredExtensionsFromRaw } from '../utils/extension-pack-inputs';
import {
  migrateShowRunListRows,
  renderMigrateShowGraph,
} from '../utils/formatters/migrate-show-render';
import { TONE_MIGRATION_GRAPH_PALETTE } from '../utils/formatters/migration-graph-palette';
import { createToneMigrationListStyler } from '../utils/formatters/migration-list-styler';
import { toneDrawing } from '../utils/formatters/tone-markup';
import { chooseAction, runCommandAction } from '../utils/next-actions';
import { errorPermitPolicyChangeNeedsRef } from '../utils/policy-errors';
import {
  type CliInvocation,
  cliCommand,
  cliInvocation,
  rerunFlags,
} from '../utils/printed-command';
import { snapshotVerifierFor } from '../utils/snapshot-content-verification';
import { dataLine } from './data-lines';
import { perSpaceBlocks } from './db/migration-blocks';
import { prepareMigrationRun } from './db/prepare';
import { defineOrmCommand } from './define-command';
import { dbFlag, permitPolicyChangeFlag } from './flags';
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
  readonly databasePoliciesUpdated?: readonly DatabasePolicyDifference[];
}

function statusAction(invocation: CliInvocation): NextAction {
  return runCommandAction(
    'Check every space against the database',
    cliCommand(invocation, 'migration status'),
  );
}

type RefAdvancementDecision =
  | { readonly kind: 'advance'; readonly name: string }
  | { readonly kind: 'refuse-empty-target'; readonly name: string }
  | { readonly kind: 'refuse-invalid-name'; readonly name: string }
  | { readonly kind: 'none'; readonly reason: 'flag' | 'ci' | 'empty-target' };

const DEFAULT_ADVANCE_REF = 'db';

/**
 * The rule of ADR 327: `db` from the config outside CI, the named ref in every case, nothing under
 * `--db` or `--no-advance-ref`. A named ref that could never be written, because its name is
 * invalid or the target is the empty contract, is refused; `db` is left where it is.
 */
function refAdvancementDecision(
  flags: {
    readonly advanceRef: string | undefined;
    readonly noAdvanceRef: boolean | undefined;
    readonly db: string | undefined;
  },
  inCI: boolean,
  targetHash: string,
): RefAdvancementDecision {
  const toEmpty = targetHash === EMPTY_CONTRACT_HASH;
  if (flags.noAdvanceRef === true || (flags.advanceRef === undefined && flags.db !== undefined)) {
    return { kind: 'none', reason: 'flag' };
  }
  if (flags.advanceRef !== undefined) {
    if (!validateRefName(flags.advanceRef)) {
      return { kind: 'refuse-invalid-name', name: flags.advanceRef };
    }
    return toEmpty
      ? { kind: 'refuse-empty-target', name: flags.advanceRef }
      : { kind: 'advance', name: flags.advanceRef };
  }
  if (toEmpty) {
    return { kind: 'none', reason: 'empty-target' };
  }
  return inCI ? { kind: 'none', reason: 'ci' } : { kind: 'advance', name: DEFAULT_ADVANCE_REF };
}

/**
 * The command that writes the ref later. `migration ref set` needs the snapshot in the store, so
 * without it the advice is the same `db migrate` again, which writes both.
 */
function refNotWrittenDiagnostic(
  ref: { readonly name: string; readonly hash: string },
  failure: RefWriteFailure,
  invocation: CliInvocation,
  rerunWithRef: readonly string[],
): Diagnostic {
  const nextAction = failure.snapshotStored
    ? runCommandAction(
        `Point ref "${ref.name}" at the contract the database is at`,
        cliCommand(invocation, 'migration ref set', [shellQuoted(ref.name), ref.hash]),
      )
    : runCommandAction(
        `Write ref "${ref.name}" and its snapshot once the directory is writable`,
        cliCommand(invocation, 'db migrate', rerunWithRef),
      );
  return {
    code: 'MIGRATION.REF_NOT_WRITTEN',
    severity: 'warn',
    summary: `Migrations applied, but ref "${ref.name}" was not written`,
    why: `The database is at contract ${ref.hash}, and ref "${ref.name}" could not be moved there: ${failure.reason}`,
    nextActions: [nextAction],
    meta: {
      name: ref.name,
      hash: ref.hash,
      reason: failure.reason,
      ...ifDefined('causeCode', failure.causeCode),
    },
  };
}

function refNotAdvancedInCIDiagnostic(
  invocation: CliInvocation,
  rerunWithRef: readonly string[],
): Diagnostic {
  return {
    code: 'MIGRATION.REF_NOT_ADVANCED_IN_CI',
    severity: 'info',
    summary: `Ref "${DEFAULT_ADVANCE_REF}" was not advanced: the CLI detected CI`,
    why: 'db migrate advances the db ref only outside CI. Unless the CI variable is false, which turns detection off whatever else is set, the CLI detects CI when CI is set or when a variable that CI services set is present, such as BUILD_NUMBER, BUILD_ID or GITHUB_ACTIONS. In a pipeline this is expected, and --no-advance-ref silences this notice. If this is your development machine, a variable in your shell or in a .env file that prisma.config.ts loads turned advancement off.',
    nextActions: [
      chooseAction(
        'If this is your development machine and not CI: unset the variable that made the CLI detect CI, or set CI=false, so later runs advance the db ref',
      ),
      runCommandAction(
        `If this is your development machine and not CI: advance ref "${DEFAULT_ADVANCE_REF}" now`,
        cliCommand(invocation, 'db migrate', rerunWithRef),
      ),
      chooseAction('In a pipeline: pass --no-advance-ref to silence this notice'),
    ],
  };
}

function refNotAdvancedToEmptyDiagnostic(invocation: CliInvocation, refHash: string): Diagnostic {
  return {
    code: 'MIGRATION.REF_NOT_ADVANCED_TO_EMPTY',
    severity: 'warn',
    summary: `Ref "${DEFAULT_ADVANCE_REF}" still names ${refHash}, but the database is now at the empty contract`,
    why: `The empty contract is where the planner starts, not a contract a ref can name, so db migrate neither moved ref "${DEFAULT_ADVANCE_REF}" nor deleted it. The next migration plan starts from the contract the ref names.`,
    nextActions: [
      runCommandAction(
        `If this is your development database: remove ref "${DEFAULT_ADVANCE_REF}", so the next migration plan asks where to start`,
        cliCommand(invocation, 'migration ref delete', [DEFAULT_ADVANCE_REF]),
      ),
    ],
  };
}

function fromField(from: string): string | undefined {
  return from === EMPTY_CONTRACT_HASH ? undefined : from;
}

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
    stdout: () =>
      document.migrations.map((migration) =>
        dataLine([migration.spaceId, migration.dirName, fromField(migration.from), migration.to]),
      ),
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
  readonly invocation: CliInvocation;
}): Presentations {
  const { document } = inputs;
  const advanced = document.advancedRef;
  return {
    stdout: () =>
      document.applied.map((migration) =>
        dataLine([
          migration.spaceId,
          migration.dirName,
          fromField(migration.from),
          migration.to,
          migration.operationsExecuted,
        ]),
      ),
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
    next: () => [statusAction(inputs.invocation)],
  };
}

interface RequestedTarget {
  readonly entry: RefEntry | undefined;
  readonly refName: string | undefined;
}

const EMITTED_CONTRACT_TARGET: RequestedTarget = { entry: undefined, refName: undefined };

function migrateTargetOf({ entry, refName }: RequestedTarget): MigrateTarget | undefined {
  if (entry === undefined) return undefined;
  return refName === undefined
    ? { kind: 'hash', hash: entry.hash }
    : { kind: 'ref', ref: { name: refName, ...entry } };
}

/**
 * `--to` as a contract the app graph knows. A ref target keeps the invariants
 * the ref declares; a bare hash or `@empty` carries none. An omitted `--to`
 * and `@contract` both target the emitted contract. `@db` is not resolved
 * here: it needs the live marker, which is read only once the connection is
 * open.
 */
function resolveRequestedTarget(
  to: string | undefined,
  context: RefResolutionContext,
): Result<RequestedTarget, CliStructuredError> {
  if (to === undefined) {
    return ok(EMITTED_CONTRACT_TARGET);
  }
  const resolved = resolveContractRef(to, context);
  if (!resolved.ok) {
    return notOk(normalizeError(resolved.failure));
  }
  if (resolved.value.provenance.kind === 'reserved-contract') {
    return ok(EMITTED_CONTRACT_TARGET);
  }
  if (resolved.value.provenance.kind !== 'ref') {
    return ok({ entry: { hash: resolved.value.hash, invariants: [] }, refName: undefined });
  }
  const refName = resolved.value.provenance.refName;
  return ok({ entry: context.refs[refName], refName });
}

function liveMarkerTarget(appMarker: { readonly storageHash: string } | null): RequestedTarget {
  return { entry: { hash: contractHashAtMarker(appMarker), invariants: [] }, refName: undefined };
}

export function createMigrateCommand(
  createClient: CreateControlClient,
  writeRefPointer: RefPointerWriter = advanceRef,
) {
  return defineOrmCommand({
    help: {
      summary: 'Apply planned migrations to advance the database',
      description:
        'Walks every contract space (app + extensions) and applies pending on-disk\n' +
        'migrations in canonical order (extensions alphabetically, then app). It\n' +
        'replays the on-disk migration graph and never invents an edge. Use --to to\n' +
        'target a specific contract and --show for a read-only preview of the route\n' +
        'it would take.\n' +
        "After a successful apply it advances the db ref to the database's new\n" +
        'contract, so the next migration plan starts there. It does so only when\n' +
        'the connection comes from prisma.config.ts and the CLI does not detect CI:\n' +
        'never with --db, and never in CI. Unless CI=false, which wins over\n' +
        'everything else, the CLI detects CI when CI is set or when a variable that\n' +
        'CI services set is present, such as BUILD_NUMBER or GITHUB_ACTIONS; it then\n' +
        'says so.\n' +
        '--advance-ref <name> advances that ref instead, in every case;\n' +
        '--no-advance-ref advances none. A ref that cannot be written is a warning:\n' +
        'the migrations have already applied.',
      examples: [
        'db migrate',
        'db migrate --db $DATABASE_URL',
        'db migrate --no-advance-ref',
        'db migrate --to production',
        'db migrate --show',
        'db migrate --show --from @contract --to production',
      ],
    },
    args: {
      flags: {
        db: dbFlag,
        to: flag.string({
          brief: `Target contract reference (${ALL_CONTRACT_REF_FORMS})`,
          placeholder: 'contract',
        }),
        advanceRef: flag.string({
          brief: 'Advance the named ref, instead of db, to the post-apply marker after success',
          placeholder: 'name',
        }),
        noAdvanceRef: flag.boolean({
          brief: 'Apply without advancing any ref (no ref file or snapshot is written)',
        }),
        show: flag.boolean({ brief: 'Preview the migration route without applying (read-only)' }),
        permitPolicyChange: permitPolicyChangeFlag,
        from: flag.string({
          brief: `From-state for the --show preview (${ALL_CONTRACT_REF_FORMS})`,
          placeholder: 'contract',
        }),
      },
    },
    needs: { config: ormConfigSection },
    handler: async (args, ctx) => {
      if (args.flags.noAdvanceRef && args.flags.advanceRef !== undefined) {
        return notOk(
          normalizeError(errorAdvanceRefArgConflict({ advanceRef: args.flags.advanceRef })),
        );
      }

      // `migrate` walks every contract space, so the header names the root they
      // all live under rather than the app subspace.
      const migrationsRelative = displayPath(migrationsDirFor(ctx.config), ctx.cwd);

      if (args.flags.show) {
        const planned = await executeMigrateShowPlan({
          config: ctx.config,
          cwd: ctx.cwd,
          invocation: { ...cliInvocation(ctx, args.flags.db), rerunArgs: rerunFlags(args.flags) },
          createClient,
          ...ifDefined('db', args.flags.db),
          ...ifDefined('to', args.flags.to),
          ...ifDefined('from', args.flags.from),
          ...(args.flags.permitPolicyChange === true ? { permitPolicyChange: true } : {}),
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
                plan.databaseMarkerHashBySpace !== undefined && typeof dbConnection === 'string'
                  ? maskConnectionUrl(dbConnection)
                  : undefined,
              from: args.flags.from,
              to: args.flags.to,
            }),
          ),
        );
      }

      const liveTarget = isLiveMarkerRef(args.flags.to);
      const startedAt = Date.now();
      const prepared = await prepareMigrationRun({
        config: ctx.config,
        cwd: ctx.cwd,
        db: args.flags.db,
        commandName: 'db migrate',
        createClient,
        retryCommand: retryCommandFor({
          commandName: 'db migrate',
          rerunArgs: rerunFlags(args.flags),
          canRunOffline: false,
        }),
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
              { where: { path: contractPath }, meta: contractValidationMeta(error) },
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
        ...ifDefined('verifySnapshotContent', snapshotVerifierFor(ctx.config)),
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

      const offlineTarget = liveTarget
        ? undefined
        : resolveRequestedTarget(args.flags.to, {
            graph: aggregate.app.graph(),
            refs: aggregate.app.refs,
            contractHash: aggregate.app.contract().storage.storageHash,
          });
      if (offlineTarget !== undefined && !offlineTarget.ok) {
        return notOk(offlineTarget.failure);
      }
      if (args.flags.permitPolicyChange === true && offlineTarget?.value.refName === undefined) {
        return notOk(
          normalizeError(
            errorPermitPolicyChangeNeedsRef({ command: 'db migrate', to: args.flags.to }),
          ),
        );
      }

      let document: MigrateDocument;
      const diagnostics: Diagnostic[] = [];
      try {
        await client.connect(dbConnection);
        const appGraph = aggregate.app.graph();
        const markers = await client.readAllMarkers();
        const appMarker = markers.get(aggregate.app.spaceId) ?? null;

        const target: RequestedTarget =
          offlineTarget === undefined ? liveMarkerTarget(appMarker) : offlineTarget.value;

        const refEntry = target.entry;
        const permitPolicyChange = args.flags.permitPolicyChange === true;
        const inForce = databasePoliciesInForce(
          markers,
          aggregate.app.spaceId,
          familyInstance.markerLocation,
        );
        const planned = await planEverySpace({
          aggregate,
          markers,
          appTarget: {
            hash: refEntry?.hash ?? appContract.storage.storageHash,
            invariants: refEntry?.invariants,
            refName: target.refName,
          },
          storageNameOf: (operation) => familyInstance.storageNameOf(operation),
          accessChangesOf: (operations) => familyInstance.accessChangesOf(operations),
          migrationsDir,
          invocation: cliInvocation(ctx, args.flags.db),
          readLedger: (spaceId) => client.readLedger(spaceId),
          change: inForce.change,
        });
        if (!planned.ok) {
          return notOk(normalizeError(planned.failure));
        }
        if (refEntry !== undefined && refEntry.invariants.length > 0) {
          const invariantRefusal = refuseUnknownInvariants({
            graph: appGraph,
            markerInvariants: appMarker?.invariants ?? [],
            refInvariants: refEntry.invariants,
            ...ifDefined('refName', target.refName),
          });
          if (invariantRefusal) {
            return notOk(normalizeError(invariantRefusal));
          }
        }

        // With `--to` on a graph node that has a bundle, the apply contract is
        // THAT bundle's destination rather than the emitted contract.json.
        let applyContract: Contract = appContract;
        let snapshotContractJson: Record<string, unknown> = contractJson;
        let snapshotContractPath = contractPath;
        if (args.flags.to !== undefined && refEntry !== undefined) {
          const matching = aggregate.app.packages.find((p) => p.metadata.to === refEntry.hash);
          if (matching !== undefined) {
            try {
              const at = await aggregate.app.contractAt(
                refEntry.hash,
                target.refName === undefined ? undefined : { refName: target.refName },
              );
              applyContract = at.contract;
              snapshotContractJson = blindCast<
                Record<string, unknown>,
                'contractAt reads the stored contract.json, whose top level is a JSON object by construction'
              >(at.contractJson);
              snapshotContractPath = join(
                contractSnapshotDir(migrationsDir, refEntry.hash),
                'contract.json',
              );
            } catch (error) {
              const mapped = mapContractAtError(error, { artifactRole: 'to' });
              if (!mapped.ok) {
                return notOk(normalizeError(mapped.failure));
              }
              throw error;
            }
          }
        }

        // The last thing before the apply: a snapshot the store does not hold yet is rendered
        // now, so a contract that cannot be snapshotted refuses the run before any migration
        // executes.
        const targetHash = refEntry?.hash ?? appContract.storage.storageHash;
        const decision = refAdvancementDecision(args.flags, ctx.isCI, targetHash);
        const rerunWith = (refFlags: { advanceRef?: string; noAdvanceRef?: boolean }) =>
          rerunFlags({
            ...args.flags,
            advanceRef: undefined,
            noAdvanceRef: undefined,
            ...refFlags,
          });
        if (decision.kind === 'refuse-invalid-name') {
          return notOk(normalizeError(errorInvalidRefName(decision.name)));
        }
        if (decision.kind === 'refuse-empty-target') {
          return notOk(
            normalizeError(
              errorRefTargetEmpty({
                name: decision.name,
                rerunWithoutRef: cliCommand(
                  cliInvocation(ctx, args.flags.db),
                  'db migrate',
                  rerunWith({ noAdvanceRef: true }),
                ),
              }),
            ),
          );
        }
        let advancement: { readonly name: string; readonly snapshot: RefSnapshot } | null = null;
        if (decision.kind === 'advance') {
          if (await hasContractSnapshot(migrationsDir, targetHash)) {
            advancement = { name: decision.name, snapshot: { kind: 'stored' } };
          } else {
            const preflight = await preflightRefAdvancement({
              name: decision.name,
              contractJson: snapshotContractJson,
              contractJsonPath: snapshotContractPath,
              config: ctx.config,
              client,
            });
            if (!preflight.ok) {
              return notOk(normalizeError(preflight.failure));
            }
            advancement = {
              name: decision.name,
              snapshot: { kind: 'render', contractIR: preflight.value },
            };
          }
        }

        const applied = await client.migrate({
          contract: applyContract,
          migrationsDir,
          invocation: {
            ...cliInvocation(ctx, args.flags.db),
            rerunArgs: rerunFlags(args.flags),
          },
          onProgress: controlProgressReporter(ctx.report),
          ...ifDefined('target', migrateTargetOf(target)),
          ...(permitPolicyChange ? { permitPolicyChange } : {}),
        });
        if (!applied.ok) {
          return notOk(normalizeError(applied.failure));
        }
        const { value } = applied;

        let advancedRef: { name: string; hash: string } | null = null;
        const invocation = cliInvocation(ctx, args.flags.db);
        if (advancement !== null) {
          const ref = { name: advancement.name, hash: value.markerHash };
          const written = await writeAdvancedRef(
            {
              refsDir,
              migrationsDir,
              ...ref,
              snapshot: advancement.snapshot,
            },
            writeRefPointer,
          );
          if (written.ok) {
            advancedRef = ref;
          } else {
            diagnostics.push(
              refNotWrittenDiagnostic(
                ref,
                written.failure,
                invocation,
                rerunWith({ advanceRef: ref.name }),
              ),
            );
          }
        }
        if (decision.kind === 'none' && decision.reason === 'ci') {
          diagnostics.push(
            refNotAdvancedInCIDiagnostic(
              invocation,
              rerunWith({ advanceRef: DEFAULT_ADVANCE_REF }),
            ),
          );
        }
        const staleDbRef = aggregate.app.refs[DEFAULT_ADVANCE_REF];
        if (
          decision.kind === 'none' &&
          decision.reason === 'empty-target' &&
          staleDbRef !== undefined
        ) {
          diagnostics.push(refNotAdvancedToEmptyDiagnostic(invocation, staleDbRef.hash));
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
          ...ifDefined('databasePoliciesUpdated', value.databasePoliciesUpdated),
        };
      } catch (error) {
        return notOk(
          normalizeError(
            errorFromCaught(error, (message) => `Unexpected error during migrate: ${message}`, {
              connection: typeof dbConnection === 'string' ? dbConnection : undefined,
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
          { data: document, ...(diagnostics.length === 0 ? {} : { diagnostics }) },
          applyPresentations({
            document,
            migrationsDir: migrationsRelative,
            database: prepared.value.database,
            to: args.flags.to,
            invocation: cliInvocation(ctx, args.flags.db),
          }),
        ),
      );
    },
  });
}

export const migrateCommand = createMigrateCommand(createControlClient);
