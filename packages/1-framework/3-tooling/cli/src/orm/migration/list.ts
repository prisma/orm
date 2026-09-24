import { ormConfigSection } from '@internal/config-loader';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import { buildReadAggregate } from '../../control-api/operations/contract-space-aggregate-loader';
import {
  migrationSpaceListEntriesFromAggregate,
  runMigrationList,
} from '../../control-api/operations/migration-list';
import { renderMigrationGraphLegend } from '../../utils/formatters/migration-graph-labels';
import { TONE_MIGRATION_GRAPH_PALETTE } from '../../utils/formatters/migration-graph-palette';
import { renderMigrationListWithStyle } from '../../utils/formatters/migration-list-render';
import { createToneMigrationListStyler } from '../../utils/formatters/migration-list-styler';
import type { MigrationListResult } from '../../utils/formatters/migration-list-types';
import { toneDrawing } from '../../utils/formatters/tone-markup';
import type { GlyphMode } from '../../utils/glyph-mode';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';
import { displayPath, migrationsDirFor } from './paths';

function listPresentations(inputs: {
  readonly list: MigrationListResult;
  readonly tree: string;
  readonly migrationsDir: string;
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
          ...(inputs.space === undefined ? [] : [{ label: 'space', value: inputs.space }]),
        ],
      },
      { kind: 'drawing', lines: toneDrawing(inputs.tree) },
      ...(legend === undefined ? [] : [{ kind: 'drawing' as const, lines: toneDrawing(legend) }]),
    ],
    json: () => inputs.list,
  };
}

export const migrationListCommand = defineOrmCommand({
  help: {
    summary: 'List on-disk migrations per contract space',
    description:
      'Enumerates every on-disk migration under migrations/<space>/ for every\n' +
      'contract space found on disk. Offline — does not consult the database.\n' +
      'Human output draws the shared migration graph tree with operation counts,\n' +
      'invariants on each migration row, and refs on destination contract nodes.\n' +
      'Pass --space <id> to narrow to one contract space. --ascii forces ASCII\n' +
      'tree glyphs.',
    examples: [
      'migration list',
      'migration list --space app',
      'migration list --ascii',
      'migration list --legend',
      'migration list --json',
    ],
  },
  args: {
    flags: {
      space: flag.string({ brief: 'Narrow output to a single contract space', placeholder: 'id' }),
      ascii: flag.boolean({ brief: 'Use ASCII kind glyphs (pipe-friendly)' }),
      legend: flag.boolean({ brief: 'Print a key for the tree glyphs and lane colors' }),
    },
  },
  needs: { config: ormConfigSection },
  handler: async (args, ctx) => {
    const migrationsDir = migrationsDirFor(ctx.config);

    const loaded = await buildReadAggregate(ctx.config, { migrationsDir });
    if (!loaded.ok) {
      return notOk(normalizeError(loaded.failure));
    }
    const { aggregate, contractHash: liveContractHash } = loaded.value;

    const spaces = await migrationSpaceListEntriesFromAggregate(aggregate, migrationsDir);
    const listed = runMigrationList({ spaces, ...ifDefined('spaceFilter', args.flags.space) });
    if (!listed.ok) {
      return notOk(normalizeError(listed.failure));
    }

    const glyphMode: GlyphMode = args.flags.ascii ? 'ascii' : 'unicode';
    const styler = createToneMigrationListStyler();
    const tree = renderMigrationListWithStyle(listed.value, styler, glyphMode, {
      colorize: true,
      palette: TONE_MIGRATION_GRAPH_PALETTE,
      liveContractHash,
      graphForSpace: (spaceId) => aggregate.space(spaceId)?.graph(),
      appSpaceId: aggregate.app.spaceId,
    });

    const legend = args.flags.legend
      ? renderMigrationGraphLegend({
          colorize: true,
          glyphMode,
          styler,
          palette: TONE_MIGRATION_GRAPH_PALETTE,
        })
      : undefined;

    return ok(
      ctx.present(
        { data: listed.value },
        listPresentations({
          list: listed.value,
          tree,
          migrationsDir: displayPath(migrationsDir, ctx.cwd),
          space: args.flags.space,
          legend,
        }),
      ),
    );
  },
});
