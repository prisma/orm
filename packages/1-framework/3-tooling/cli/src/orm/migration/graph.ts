import { ormConfigSection } from '@internal/config-loader';
import { ifDefined } from '@internal/utils/defined';
import type { Block, Presentations } from '@prisma/cli-engine';
import { flag } from '@prisma/cli-engine';
import { notOk, ok } from '@prisma/cli-engine/protocol';
import type {
  MigrationGraphJsonResult,
  MigrationSpaceGraphEntry,
} from '../../commands/json/schemas';
import { buildReadAggregate } from '../../control-api/operations/contract-space-aggregate-loader';
import { buildMigrationSpaceGraphEntries } from '../../control-api/operations/migration-graph';
import {
  migrationSpaceListEntriesFromAggregate,
  runMigrationList,
} from '../../control-api/operations/migration-list';
import { errorLegendHumanOnly } from '../../utils/cli-errors';
import { renderMigrationGraphLegend } from '../../utils/formatters/migration-graph-labels';
import { TONE_MIGRATION_GRAPH_PALETTE } from '../../utils/formatters/migration-graph-palette';
import {
  buildMigrationGraphTreeSections,
  renderMigrationGraphDot,
  renderMigrationGraphSections,
} from '../../utils/formatters/migration-graph-sections';
import { createToneMigrationListStyler } from '../../utils/formatters/migration-list-styler';
import { toneDrawing } from '../../utils/formatters/tone-markup';
import type { GlyphMode } from '../../utils/glyph-mode';
import { defineOrmCommand } from '../define-command';
import { normalizeError } from '../normalize-error';
import { displayPath, migrationsDirFor } from './paths';

/**
 * The `--dot` document. DOT is not a `--format` value — the engine owns that
 * flag — so the DOT text is the stdout payload in human mode and rides the json
 * result as a `dot` field alongside the graph document.
 */
interface MigrationGraphDotResult extends MigrationGraphJsonResult {
  readonly dot: string;
}

/**
 * The tree is a drawing for a reader; the DOT document is a graph description
 * for another program, so it is also the stdout payload. It appears in both
 * surfaces because the engine treats the payload as a mirror of the human
 * output: on one shared screen it suppresses the stdout copy, so the human
 * block is what keeps `--dot` visible there, while split sinks receive both.
 */
function graphPresentations(inputs: {
  readonly document: MigrationGraphJsonResult | MigrationGraphDotResult;
  readonly tree: string | undefined;
  readonly dot: string | undefined;
  readonly migrationsDir: string;
  readonly space: string | undefined;
  readonly legend: string | undefined;
}): Presentations {
  const { tree, dot, legend } = inputs;
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
      ...(tree === undefined ? [] : [{ kind: 'drawing' as const, lines: toneDrawing(tree) }]),
      ...(dot === undefined ? [] : [{ kind: 'drawing' as const, lines: dot.split('\n') }]),
      ...(legend === undefined ? [] : [{ kind: 'drawing' as const, lines: toneDrawing(legend) }]),
    ],
    ...(dot === undefined ? {} : { stdout: () => dot.split('\n') }),
    json: () => inputs.document,
  };
}

function graphSummary(spaces: readonly MigrationSpaceGraphEntry[]): string {
  const contracts = spaces.reduce((count, space) => count + space.contracts.length, 0);
  const migrations = spaces.reduce((count, space) => count + space.migrations.length, 0);
  return `${spaces.length} space(s), ${contracts} contract(s), ${migrations} migration(s)`;
}

export const migrationGraphCommand = defineOrmCommand({
  help: {
    summary: 'Show the migration graph topology',
    description:
      'Renders the migration graph topology. Offline — does not consult the\n' +
      'database. --ascii swaps box-drawing for pipe-friendly ASCII glyphs.\n' +
      '--dot emits Graphviz DOT for the app graph instead of the tree, and\n' +
      'ignores --space; in json mode the result carries the DOT text alongside\n' +
      'the graph document.',
    examples: [
      'migration graph',
      'migration graph --json',
      'migration graph --dot',
      'migration graph --ascii',
      'migration graph --legend',
      'migration graph --space app',
    ],
  },
  args: {
    flags: {
      space: flag.string({ brief: 'Narrow output to a single contract space', placeholder: 'id' }),
      dot: flag.boolean({ brief: 'Emit Graphviz DOT for the app graph' }),
      ascii: flag.boolean({ brief: 'Use ASCII glyphs (pipe-friendly)' }),
      legend: flag.boolean({ brief: 'Print a key for the tree glyphs and lane colors' }),
    },
  },
  needs: { config: ormConfigSection },
  handler: async (args, ctx) => {
    if (args.flags.legend && args.flags.dot) {
      return notOk(normalizeError(errorLegendHumanOnly('--dot')));
    }

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
    const scopedSpaces = listed.value.spaces;

    const glyphMode: GlyphMode = args.flags.ascii ? 'ascii' : 'unicode';
    const graphSpaces: MigrationSpaceGraphEntry[] = [
      ...buildMigrationSpaceGraphEntries({ aggregate, scopedSpaces }),
    ];
    const summary = graphSummary(graphSpaces);
    const graphDocument: MigrationGraphJsonResult = { ok: true, spaces: graphSpaces, summary };

    const dot = args.flags.dot ? renderMigrationGraphDot(aggregate.app.graph()) : undefined;
    const document = dot === undefined ? graphDocument : { ...graphDocument, dot };
    const styler = createToneMigrationListStyler();
    const tree =
      dot === undefined
        ? renderMigrationGraphSections(
            buildMigrationGraphTreeSections({
              aggregate,
              scopedSpaces,
              liveContractHash,
              glyphMode,
              colorize: true,
              styler,
              palette: TONE_MIGRATION_GRAPH_PALETTE,
            }),
            styler.summary(summary),
          )
        : undefined;

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
        { data: document },
        graphPresentations({
          document,
          tree,
          dot,
          migrationsDir: displayPath(migrationsDir, ctx.cwd),
          space: args.flags.space,
          legend,
        }),
      ),
    );
  },
});
