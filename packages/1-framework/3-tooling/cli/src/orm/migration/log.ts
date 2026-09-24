import { ormConfigSection } from '@internal/config-loader';
import type { LedgerEntryRecord } from '@internal/contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations, Text } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type { MigrationLogResult } from '../../commands/json/schemas';
import { createControlClient } from '../../control-api/client';
import { mapCaughtMigrationError } from '../../control-api/operations/caught-errors';
import {
  errorTargetMigrationNotSupported,
  errorUnexpected,
  requireLiveDatabase,
} from '../../utils/cli-errors';
import {
  closeQuietly,
  maskConnectionUrl,
  targetSupportsMigrations,
} from '../../utils/command-helpers';
import { createToneMigrationListStyler } from '../../utils/formatters/migration-list-styler';
import {
  formatLedgerAppliedAt,
  MIGRATION_LOG_EMPTY_MESSAGE,
  serializeLedgerEntriesForJson,
  sortLedgerEntries,
  styleHashTransition,
} from '../../utils/formatters/migration-log-table';
import { toneSpans } from '../../utils/formatters/tone-markup';
import type { GlyphMode } from '../../utils/glyph-mode';
import { defineOrmCommand } from '../define-command';
import { dbFlag } from '../flags';
import { normalizeError } from '../normalize-error';

const HEADING_APPLIED_AT = 'Applied at';
const HEADING_SPACE = 'Space';
const HEADING_MIGRATION = 'Migration';
const HEADING_CHANGE = 'Change';
const HEADING_OPS = 'Ops';

interface LedgerGrid {
  readonly headings: readonly Text[];
  readonly rows: ReadonlyArray<readonly Text[]>;
}

/**
 * The ledger laid out for the engine to size. The Space heading appears only
 * when more than one contract space has run, as it does in the commander shell.
 */
function ledgerGrid(
  entries: readonly LedgerEntryRecord[],
  options: { readonly utc: boolean; readonly glyphMode: GlyphMode },
): LedgerGrid {
  const styler = createToneMigrationListStyler();
  const sorted = sortLedgerEntries(entries);
  const showSpace = new Set(sorted.map((entry) => entry.space)).size > 1;
  const headings: Text[] = [HEADING_APPLIED_AT];
  if (showSpace) {
    headings.push(HEADING_SPACE);
  }
  headings.push(HEADING_MIGRATION, HEADING_CHANGE, HEADING_OPS);

  const rows = sorted.map((entry) => {
    const cells: Text[] = [formatLedgerAppliedAt(entry.appliedAt, options.utc ? 'utc' : 'local')];
    if (showSpace) {
      cells.push(entry.space);
    }
    cells.push(
      toneSpans(styler.dirName(entry.migrationName)),
      toneSpans(styleHashTransition(entry.from, entry.to, styler, options.glyphMode)),
      `${entry.operationCount} ops`,
    );
    return cells;
  });

  return { headings, rows };
}

function logPresentations(inputs: {
  readonly document: MigrationLogResult;
  readonly grid: LedgerGrid | undefined;
  readonly database: string | undefined;
}): Presentations {
  const grid = inputs.grid;
  return {
    stdout: () => [],
    next: () => [],
    human: (): readonly Block[] => [
      ...(inputs.database === undefined
        ? []
        : [
            {
              kind: 'fields' as const,
              rail: true,
              rows: [{ label: 'database', value: inputs.database }],
            },
          ]),
      ...(grid === undefined
        ? [{ kind: 'summary' as const, status: 'info' as const, text: MIGRATION_LOG_EMPTY_MESSAGE }]
        : // biome-ignore lint/plugin/no-family-vocabulary: the engine's table block, terminal output
          [{ kind: 'table' as const, columns: grid.headings, rows: grid.rows }]),
    ],
    json: () => inputs.document,
  };
}

export const migrationLogCommand = defineOrmCommand({
  help: {
    summary: 'Show executed migration history',
    description:
      'Reads the database ledger and displays every applied migration edge in\n' +
      'chronological order, including rollbacks and re-applies, merged across\n' +
      'all contract spaces. Requires a database connection.',
    examples: [
      'migration log',
      'migration log --db $DATABASE_URL',
      'migration log --utc',
      'migration log --json',
    ],
  },
  args: {
    flags: {
      db: dbFlag,
      utc: flag.boolean({ brief: 'Render human timestamps in UTC instead of local time' }),
      ascii: flag.boolean({ brief: 'Use ASCII glyphs (pipe-friendly)' }),
    },
  },
  needs: { config: ormConfigSection },
  handler: async (args, ctx) => {
    const dbConnection = args.flags.db ?? ctx.config.db?.connection;
    const missingDb = requireLiveDatabase({
      dbConnection,
      hasDriver: ctx.config.driver !== undefined,
      why: 'migration log needs a database connection and driver to read the ledger (set db.connection in prisma.config.ts, or pass --db <url>)',
      commandName: 'migration log',
    });
    if (missingDb !== null) {
      return notOk(normalizeError(missingDb));
    }
    if (!targetSupportsMigrations(ctx.config.target)) {
      return notOk(
        normalizeError(
          errorTargetMigrationNotSupported({
            why: 'migration log reads the ledger a migration runner writes, and the configured target provides no runner.',
          }),
        ),
      );
    }

    const client = createControlClient({
      family: ctx.config.family,
      target: ctx.config.target,
      adapter: ctx.config.adapter,
      ...ifDefined('driver', ctx.config.driver),
      extensions: ctx.config.extensions ?? [],
    });

    let entries: readonly LedgerEntryRecord[];
    try {
      await client.connect(dbConnection);
      entries = await client.readLedger();
    } catch (error) {
      const mapped = mapCaughtMigrationError(error);
      return notOk(
        normalizeError(
          mapped ??
            errorUnexpected(error instanceof Error ? error.message : String(error), {
              why: `Failed to read migration log: ${error instanceof Error ? error.message : String(error)}`,
            }),
        ),
      );
    } finally {
      await closeQuietly(client);
    }

    const records = serializeLedgerEntriesForJson(entries);
    const document: MigrationLogResult = {
      ok: true,
      records,
      summary: `${records.length} migration(s) applied`,
    };
    const glyphMode: GlyphMode = args.flags.ascii ? 'ascii' : 'unicode';

    return ok(
      ctx.present(
        { data: document },
        logPresentations({
          document,
          grid:
            entries.length === 0
              ? undefined
              : ledgerGrid(entries, { utc: args.flags.utc, glyphMode }),
          database: typeof dbConnection === 'string' ? maskConnectionUrl(dbConnection) : undefined,
        }),
      ),
    );
  },
});
