import type { LedgerEntryRecord } from '@internal/contract/types';
import type {
  AggregateContractSpace,
  ContractMarkerRecordLike,
} from '@internal/migration-tools/aggregate';
import type { RefEntry, Refs } from '@internal/migration-tools/refs';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations, Text } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import type { Diagnostic, Result } from '@prisma/cli-engine/protocol';
import { CliStructuredError, notOk, ok } from '@prisma/cli-engine/protocol';
import type {
  MigrationStatusResult,
  MigrationStatusSpace,
  StatusDiagnosticJson,
} from '../../commands/json/schemas';
import { createControlClient } from '../../control-api/client';
import {
  buildReadAggregate,
  loadContractRawSafely,
  refusePackageCorruptionOnAggregate,
} from '../../control-api/operations/contract-space-aggregate-loader';
import { hasMigrationPath } from '../../control-api/operations/graph-queries';
import {
  refuseMissingInvariantPath,
  refuseUnknownInvariants,
} from '../../control-api/operations/invariants';
import {
  listRefsByContractHash,
  migrationSpaceListEntriesFromAggregate,
  runMigrationList,
} from '../../control-api/operations/migration-list';
import {
  appliedHashesFromLedger,
  deriveStatusEdgeAnnotations,
  originHashForStatus,
  statusForMigrationHash,
} from '../../control-api/operations/migration-status-overlay';
import { resolveContractRef } from '../../control-api/operations/ref-resolution';
import { readMigrationRefs } from '../../control-api/operations/refs';
import { errorUnexpected, requireLiveDatabase } from '../../utils/cli-errors';
import { closeQuietly, maskConnectionUrl, readContractEnvelope } from '../../utils/command-helpers';
import { renderMigrationGraphLegend } from '../../utils/formatters/migration-graph-labels';
import { TONE_MIGRATION_GRAPH_PALETTE } from '../../utils/formatters/migration-graph-palette';
import {
  indentMigrationGraphTreeBlock,
  type RenderMigrationGraphSpaceTreeInput,
  renderMigrationGraphSpaceTrees,
} from '../../utils/formatters/migration-graph-space-render';
import { createToneMigrationListStyler } from '../../utils/formatters/migration-list-styler';
import type { MigrationListEntry } from '../../utils/formatters/migration-list-types';
import { toneDrawing } from '../../utils/formatters/tone-markup';
import type { GlyphMode } from '../../utils/glyph-mode';
import { ormConfigSection } from '../config-section';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { normalizeError } from '../normalize-error';
import { appRefsDirFor, contractPathFor, displayPath, migrationsDirFor } from './paths';
import {
  contractUnreadableFinding,
  markerNotInHistoryFinding,
  missingInvariantsFinding,
  type StatusFinding,
} from './status-findings';

const SHORT_HASH_LENGTH = 12;

function shortDisplayHash(hash: string): string {
  return hash.slice(0, SHORT_HASH_LENGTH);
}

interface DatabaseState {
  readonly markersBySpace: ReadonlyMap<string, ContractMarkerRecordLike>;
  readonly ledgersBySpace: ReadonlyMap<string, readonly LedgerEntryRecord[]>;
}

const NO_DATABASE_STATE: DatabaseState = {
  markersBySpace: new Map(),
  ledgersBySpace: new Map(),
};

type ControlClient = ReturnType<typeof createControlClient>;

/** Whatever the configured driver takes: a connection string for some drivers, a settings record for others. */
type ConnectionInput = Parameters<ControlClient['connect']>[0];

async function readDatabaseState(inputs: {
  readonly client: ControlClient;
  readonly connection: ConnectionInput;
  readonly spaceIds: readonly string[];
}): Promise<Result<DatabaseState, CliStructuredError>> {
  const { client } = inputs;
  try {
    await client.connect(inputs.connection);
    const markersBySpace = new Map(await client.readAllMarkers());
    const ledgersBySpace = new Map<string, readonly LedgerEntryRecord[]>();
    for (const spaceId of inputs.spaceIds) {
      ledgersBySpace.set(spaceId, await client.readLedger(spaceId));
    }
    return ok({ markersBySpace, ledgersBySpace });
  } catch (error) {
    return notOk(
      normalizeError(
        CliStructuredError.is(error)
          ? error
          : errorUnexpected(error instanceof Error ? error.message : String(error), {
              why: `Failed to read database state: ${error instanceof Error ? error.message : String(error)}`,
            }),
      ),
    );
  } finally {
    await closeQuietly(client);
  }
}

export function buildNoPathSummary(args: {
  readonly markerHash: string | undefined;
  readonly targetHash: string;
  readonly explicitTarget: boolean;
  readonly refName: string | undefined;
}): string {
  const markerPart =
    args.markerHash !== undefined
      ? `the database state (${shortDisplayHash(args.markerHash)})`
      : 'the database state';
  const targetShort = shortDisplayHash(args.targetHash);
  if (!args.explicitTarget) {
    return `No migration path from ${markerPart} to the application's contract (${targetShort}). Run \`{bin} migration plan --name <name>\` to author one.`;
  }
  const targetLabel =
    args.refName !== undefined
      ? `the target (${targetShort} via \`${args.refName}\`)`
      : `the target (${targetShort})`;
  return `No migration path from ${markerPart} to ${targetLabel}. Run \`{bin} migration plan --name <name>\` to author one, or pass \`--to <contract>\` to pick a reachable target.`;
}

export function buildStatusHeadline(args: {
  readonly pendingCount: number;
  readonly targetHash: string;
  readonly markerDiverged: boolean;
  readonly markerHash: string | undefined;
}): string {
  if (args.markerDiverged && args.markerHash !== undefined) {
    return `Database marker ${shortDisplayHash(args.markerHash)} is not in the on-disk migration graph`;
  }
  if (args.pendingCount === 0) {
    return 'Up to date';
  }
  return `${args.pendingCount} pending — run \`{bin} db migrate --to ${shortDisplayHash(args.targetHash)}\``;
}

interface SpaceSection {
  readonly space: string;
  readonly tree: string;
  readonly showHeading: boolean;
}

/**
 * One space's section: its heading, where more than one space is in scope, on
 * top of its tree. Heading and tree are one drawing so the heading stays a
 * bare label — a `summary` would put a status glyph in front of it.
 */
function sectionBlock(section: SpaceSection): Block {
  const heading: readonly Text[] = section.showHeading
    ? [[{ text: `${section.space}:`, tone: 'heading' }]]
    : [];
  const body: readonly Text[] =
    section.tree.length === 0
      ? [[{ text: '(no migrations)', tone: 'muted' }]]
      : toneDrawing(section.tree);
  return { kind: 'drawing', lines: [...heading, ...body] };
}

function statusPresentations(inputs: {
  readonly document: MigrationStatusResult;
  readonly sections: readonly SpaceSection[];
  readonly headline: Block;
  readonly migrationsDir: string;
  readonly database: string | undefined;
  readonly ref: string | undefined;
  readonly from: string | undefined;
  readonly space: string | undefined;
  readonly legend: string | undefined;
}): Presentations {
  const legend = inputs.legend;
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
          ...(inputs.ref === undefined ? [] : [{ label: 'ref', value: inputs.ref }]),
          ...(inputs.from === undefined ? [] : [{ label: 'from', value: inputs.from }]),
          ...(inputs.space === undefined ? [] : [{ label: 'space', value: inputs.space }]),
        ],
      },
      ...(legend === undefined ? [] : [{ kind: 'drawing' as const, lines: toneDrawing(legend) }]),
      ...inputs.sections.map(sectionBlock),
      inputs.headline,
    ],
    json: () => inputs.document,
  };
}

export const migrationStatusCommand = defineOrmCommand({
  help: {
    summary: 'Show migration path and pending status',
    description:
      'Shows which migrations are pending between the database marker and the\n' +
      'target contract. Requires a database connection. Pass --from for an\n' +
      'offline path preview without a database. Use `migration graph` for\n' +
      'topology, `migration log` for history, and `migration list` for on-disk\n' +
      'enumeration.',
    examples: [
      'migration status',
      'migration status --db $DATABASE_URL',
      'migration status --to production',
      'migration status --from abc123 --to production',
      'migration status --ascii',
      'migration status --legend',
    ],
  },
  args: {
    flags: {
      db: dbFlag,
      space: flag.string({ brief: 'Narrow output to a single contract space', placeholder: 'id' }),
      to: flag.string({
        brief:
          'Target contract reference (hash, prefix, ref name, migration dir name, <dir>^, or ./path)',
        placeholder: 'contract',
      }),
      from: flag.string({
        brief:
          'Origin contract reference; same grammar as --to. Supplying it switches to offline path computation',
        placeholder: 'contract',
      }),
      legend: flag.boolean({ brief: 'Print a key for the tree glyphs and lane colors' }),
      ascii: flag.boolean({ brief: 'Use ASCII glyphs (pipe-friendly)' }),
    },
  },
  needs: { config: ormConfigSection },
  handler: async (args, ctx) => {
    const migrationsDir = migrationsDirFor(ctx.config, ctx.cwd);
    const dbConnection = args.flags.db ?? ctx.config.db?.connection;
    const hasDriver = ctx.config.driver !== undefined;
    const usingFromOverride = args.flags.from !== undefined;

    if (!usingFromOverride) {
      const missingDb = requireLiveDatabase({
        dbConnection,
        hasDriver,
        why: 'migration status needs a database connection to read the marker and ledger (or pass --from for an offline path preview)',
        retryCommand: '{bin} migration status --from <contract>',
      });
      if (missingDb !== null) {
        return notOk(normalizeError(missingDb));
      }
    }

    const refsResult = await readMigrationRefs(appRefsDirFor(ctx.config, ctx.cwd));
    if (!refsResult.ok) {
      return notOk(normalizeError(refsResult.failure));
    }
    const refs: Refs = refsResult.value;

    const findings: StatusFinding[] = [];

    const loaded = await buildReadAggregate(ctx.config, { migrationsDir });
    if (!loaded.ok) {
      return notOk(normalizeError(loaded.failure));
    }
    const { aggregate, contractHash } = loaded.value;

    const contractConfig = {
      contract: ifDefined('output', contractPathFor(ctx.config, ctx.cwd)),
    };
    try {
      await readContractEnvelope(contractConfig);
    } catch (error) {
      findings.push(
        contractUnreadableFinding(error instanceof Error ? error.message : 'unknown error'),
      );
    }

    if ((await loadContractRawSafely(contractConfig)) !== null) {
      const corruption = refusePackageCorruptionOnAggregate(aggregate, migrationsDir);
      if (corruption) {
        return notOk(normalizeError(corruption));
      }
    }

    const appGraph = aggregate.app.graph();

    let activeRefHash: string | undefined;
    let activeRefName: string | undefined;
    let activeRefEntry: RefEntry | undefined;
    if (args.flags.to !== undefined) {
      const resolved = resolveContractRef(args.flags.to, { graph: appGraph, refs });
      if (!resolved.ok) {
        return notOk(normalizeError(resolved.failure));
      }
      activeRefHash = resolved.value.hash;
      if (resolved.value.provenance.kind === 'ref') {
        activeRefName = resolved.value.provenance.refName;
        activeRefEntry = refs[activeRefName];
      }
    }

    let fromOverrideHash: string | undefined;
    if (args.flags.from !== undefined) {
      const resolved = resolveContractRef(args.flags.from, { graph: appGraph, refs });
      if (!resolved.ok) {
        return notOk(normalizeError(resolved.failure));
      }
      fromOverrideHash = resolved.value.hash;
    }

    const listSpaces = await migrationSpaceListEntriesFromAggregate(aggregate, migrationsDir);
    const listed = runMigrationList({
      spaces: listSpaces,
      ...ifDefined('spaceFilter', args.flags.space),
    });
    if (!listed.ok) {
      return notOk(normalizeError(listed.failure));
    }
    const scopedSpaces = listed.value.spaces;

    const connects = dbConnection !== undefined && hasDriver && !usingFromOverride;
    let database: DatabaseState = NO_DATABASE_STATE;
    if (connects) {
      const read = await readDatabaseState({
        client: createControlClient({
          family: ctx.config.family,
          target: ctx.config.target,
          adapter: ctx.config.adapter,
          ...ifDefined('driver', ctx.config.driver),
          extensions: ctx.config.extensions ?? [],
        }),
        connection: dbConnection,
        spaceIds: scopedSpaces.map((entry) => entry.space),
      });
      if (!read.ok) {
        return notOk(read.failure);
      }
      database = read.value;
    }

    const appMarker = database.markersBySpace.get(aggregate.app.spaceId);
    if (activeRefEntry !== undefined && activeRefEntry.invariants.length > 0 && connects) {
      const unknown = refuseUnknownInvariants({
        graph: appGraph,
        markerInvariants: appMarker?.invariants ?? [],
        refInvariants: activeRefEntry.invariants,
        ...ifDefined('refName', activeRefName),
      });
      if (unknown) {
        return notOk(normalizeError(unknown));
      }
    }

    const glyphMode: GlyphMode = args.flags.ascii ? 'ascii' : 'unicode';
    const styler = createToneMigrationListStyler();
    const showSpaceHeadings = scopedSpaces.length > 1;

    const statusSpaces: MigrationStatusSpace[] = [];
    const renderInputs: Array<RenderMigrationGraphSpaceTreeInput & { readonly spaceId: string }> =
      [];
    const emptySpaces: string[] = [];
    let divergedMarker: { readonly space: string; readonly markerHash: string } | undefined;
    let noPath:
      | { readonly markerHash: string | undefined; readonly targetHash: string }
      | undefined;
    let headlineTargetHash = activeRefHash ?? contractHash;
    let totalPending = 0;

    for (const entry of scopedSpaces) {
      const space: AggregateContractSpace | undefined = aggregate.space(entry.space);
      if (space === undefined) {
        continue;
      }
      const graph = space.graph();
      const spaceContractHash = space.contract().storage.storageHash;
      const targetHash = activeRefHash ?? spaceContractHash;
      if (entry.space === aggregate.app.spaceId) {
        headlineTargetHash = targetHash;
      }

      const markerHash = usingFromOverride
        ? fromOverrideHash
        : database.markersBySpace.get(entry.space)?.storageHash;
      const originHash = originHashForStatus(markerHash);
      const markerInGraph =
        markerHash === undefined || graph.nodes.has(markerHash) || markerHash === spaceContractHash;

      if (
        connects &&
        markerInGraph &&
        originHash !== targetHash &&
        noPath === undefined &&
        !hasMigrationPath(graph, originHash, targetHash)
      ) {
        noPath = { markerHash, targetHash };
      }
      if (connects && markerHash !== undefined && !markerInGraph) {
        divergedMarker ??= { space: entry.space, markerHash };
        findings.push(markerNotInHistoryFinding(entry.space));
      }

      const ledger = database.ledgersBySpace.get(entry.space) ?? [];
      const annotations = deriveStatusEdgeAnnotations({
        graph,
        targetHash,
        originHash,
        appliedMigrationHashes: connects ? appliedHashesFromLedger(ledger) : new Set<string>(),
        showAppliedOverlay: connects,
      });
      const migrations = entry.migrations.map((migration: MigrationListEntry) => ({
        ...migration,
        status: statusForMigrationHash(migration.hash, annotations),
      }));
      totalPending += migrations.filter((migration) => migration.status === 'pending').length;

      statusSpaces.push({
        space: entry.space,
        currentContract: markerHash ?? null,
        targetContract: targetHash,
        migrations,
      });

      if (graph.nodes.size === 0) {
        emptySpaces.push(entry.space);
        continue;
      }
      renderInputs.push({
        spaceId: entry.space,
        graph,
        migrations: entry.migrations,
        liveContractHash: contractHash,
        refsByHash: listRefsByContractHash(space),
        statusOverlayByHash: annotations,
        colorize: true,
        glyphMode,
        styler,
        palette: TONE_MIGRATION_GRAPH_PALETTE,
        isAppSpace: entry.space === aggregate.app.spaceId,
        ...(connects && markerHash !== undefined ? { dbHash: markerHash } : {}),
      });
    }

    const requiredInvariants = [...(activeRefEntry?.invariants ?? [])].sort();
    if (connects && requiredInvariants.length > 0) {
      const held = new Set(appMarker?.invariants ?? []);
      const missing = requiredInvariants.filter((id) => !held.has(id));
      if (missing.length > 0) {
        findings.push(missingInvariantsFinding({ missing, refName: activeRefName }));
        if (activeRefHash !== undefined) {
          const unreachable = refuseMissingInvariantPath({
            graph: appGraph,
            originHash: originHashForStatus(appMarker?.storageHash),
            targetHash: activeRefHash,
            missing,
            ...ifDefined('refName', activeRefName),
          });
          if (unreachable) {
            return notOk(normalizeError(unreachable));
          }
        }
      }
    }

    const rendered = renderMigrationGraphSpaceTrees(renderInputs);
    const treesBySpace = new Map(
      renderInputs.map((input, index) => [input.spaceId, rendered[index] ?? '']),
    );
    const sections: readonly SpaceSection[] = scopedSpaces.map((entry) => {
      const tree = treesBySpace.get(entry.space) ?? '';
      return {
        space: entry.space,
        tree:
          showSpaceHeadings && tree.length > 0 ? indentMigrationGraphTreeBlock(tree, '  ') : tree,
        showHeading: showSpaceHeadings,
      };
    });

    const everySpaceEmpty = scopedSpaces.every((entry) => entry.migrations.length === 0);
    const summary = everySpaceEmpty
      ? 'No migrations found'
      : noPath !== undefined
        ? buildNoPathSummary({
            markerHash: noPath.markerHash,
            targetHash: noPath.targetHash,
            explicitTarget: args.flags.to !== undefined,
            refName: activeRefName,
          })
        : buildStatusHeadline({
            pendingCount: totalPending,
            targetHash: headlineTargetHash,
            markerDiverged: divergedMarker !== undefined,
            markerHash: divergedMarker?.markerHash,
          });

    const diagnostics: readonly Diagnostic[] = findings.map((finding) => finding.diagnostic);
    const documentDiagnostics: StatusDiagnosticJson[] = findings.map((finding) => finding.document);
    const document: MigrationStatusResult = {
      ok: true,
      spaces: statusSpaces,
      summary,
      diagnostics: documentDiagnostics,
    };
    const alarming = divergedMarker !== undefined || totalPending > 0 || noPath !== undefined;

    return ok(
      ctx.present(
        { data: document, diagnostics },
        statusPresentations({
          document,
          sections,
          headline: { kind: 'summary', status: alarming ? 'warn' : 'ok', text: summary },
          migrationsDir: displayPath(migrationsDir, ctx.cwd),
          database:
            connects && typeof dbConnection === 'string'
              ? maskConnectionUrl(dbConnection)
              : undefined,
          ref: activeRefName,
          from: args.flags.from,
          space: args.flags.space,
          legend: args.flags.legend
            ? renderMigrationGraphLegend({
                colorize: true,
                glyphMode,
                styler,
                palette: TONE_MIGRATION_GRAPH_PALETTE,
              })
            : undefined,
        }),
      ),
    );
  },
});
