import type {
  MigrateShowMigration,
  MigrateShowPlanSuccess,
} from '../../control-api/operations/migrate-show';
import { listRefsByContractHash } from '../../control-api/operations/migration-list';
import type { GlyphMode } from '../glyph-mode';
import {
  // biome-ignore lint/plugin/no-family-vocabulary: a terminal text column, the character offset a label starts at
  computeLabelColumn,
  computeMaxDirNameWidth,
  renderMigrationGraphCommand,
} from './migration-graph-command-render';
import { buildGrid } from './migration-graph-grid-layout';
import { formatOnPathMigrationRow, type MigrationEdgeAnnotation } from './migration-graph-labels';
import type { MigrationGraphPalette } from './migration-graph-palette';
import { buildMigrationGraphRows } from './migration-graph-rows';
import {
  highlightFromEdgeAnnotations,
  indentMigrationGraphTreeBlock,
} from './migration-graph-space-render';
import type { MigrationListStylerWithMarkers } from './migration-list-styler';

const LABEL_GAP = 2;
// biome-ignore lint/plugin/no-family-vocabulary: a terminal text column, the narrowest offset the hash column may start at
const MIN_HASH_DATA_COLUMN = 25;
const LIST_INDENT = 2;

/** How the drawing is painted: as ANSI bytes, as tone marks, or not at all. */
interface PaintOptions {
  readonly colorize: boolean;
  readonly glyphMode: GlyphMode;
  readonly styler?: MigrationListStylerWithMarkers;
  readonly palette?: MigrationGraphPalette;
}

function paintOverrides(options: PaintOptions): {
  readonly styler?: MigrationListStylerWithMarkers;
  readonly palette?: MigrationGraphPalette;
} {
  return {
    ...(options.styler === undefined ? {} : { styler: options.styler }),
    ...(options.palette === undefined ? {} : { palette: options.palette }),
  };
}

/**
 * What `migrate --show` draws: the whole topology with the chosen route lifted
 * out of it, plus the widths the ordered run-list has to share so every `→` in
 * the output lands in the same column.
 */
export interface MigrateShowRendering {
  readonly graphOutput: string;
  readonly runListDirNameWidth: number;
  /** Set only when more than one space is drawn; undefined means a flat tree. */
  readonly runListLeftPad: number | undefined;
}

/**
 * Every space, with the migrations on the chosen path lifted to focus mode and
 * everything else dimmed. Widths are computed across all spaces first so the
 * sections and the run-list below them share their columns.
 */
export function renderMigrateShowGraph(
  plan: MigrateShowPlanSuccess,
  options: PaintOptions,
): MigrateShowRendering {
  const { aggregate, contractHash } = plan;
  const allSpaces = [aggregate.app, ...aggregate.extensions];
  const onPathHashes = new Set(plan.migrations.map((migration) => migration.migrationHash));

  const spaceLayouts = allSpaces.map((space) => {
    const isApp = space.spaceId === aggregate.app.spaceId;
    const spaceGraph = space.graph();
    const rowModel = buildMigrationGraphRows(spaceGraph, isApp ? { contractHash } : {});
    const edgeAnnotations = new Map<string, MigrationEdgeAnnotation>();
    for (const edge of spaceGraph.migrationByHash.values()) {
      edgeAnnotations.set(edge.migrationHash, {
        pathHighlight: onPathHashes.has(edge.migrationHash) ? 'on-path' : 'off-path',
      });
    }
    const grid = buildGrid(rowModel, {}, highlightFromEdgeAnnotations(edgeAnnotations));
    return { space, isApp, rowModel, grid, edgeAnnotations };
  });

  const multiSpace = spaceLayouts.length > 1;
  // biome-ignore lint/plugin/no-family-vocabulary: a terminal text column, the character offset labels align to across spaces
  const globalLabelColumn = multiSpace
    ? // biome-ignore lint/plugin/no-family-vocabulary: a terminal text column, the character offset a label starts at
      Math.max(...spaceLayouts.map(({ grid }) => computeLabelColumn(grid, options.glyphMode)))
    : undefined;
  const widestRunListName =
    plan.migrations.length > 0
      ? Math.max(...plan.migrations.map((migration) => migration.dirName.length))
      : 0;
  const globalMaxDirNameWidth = multiSpace
    ? Math.max(
        Math.max(...spaceLayouts.map(({ rowModel }) => computeMaxDirNameWidth(rowModel))),
        widestRunListName,
      )
    : undefined;

  const sections: string[] = [];
  for (const { space, isApp, rowModel, grid, edgeAnnotations } of spaceLayouts) {
    const liveMarkerHash = plan.renderMarkerHashBySpace.get(space.spaceId);
    const tree = renderMigrationGraphCommand({
      grid,
      rowModel,
      contractHash,
      isAppSpace: isApp,
      ...(plan.databaseMarkersRead && liveMarkerHash !== undefined
        ? { dbHash: liveMarkerHash }
        : {}),
      refsByHash: listRefsByContractHash(space),
      edgeAnnotationsByHash: edgeAnnotations,
      colorize: options.colorize,
      glyphMode: options.glyphMode,
      ...paintOverrides(options),
      // biome-ignore lint/plugin/no-family-vocabulary: a terminal text column, the character offset labels align to across spaces
      ...(globalLabelColumn === undefined ? {} : { globalLabelColumn }),
      ...(globalMaxDirNameWidth === undefined ? {} : { globalMaxDirNameWidth }),
    });
    if (tree.length === 0) {
      continue;
    }
    sections.push(
      multiSpace ? `${space.spaceId}:\n${indentMigrationGraphTreeBlock(tree, '  ')}` : tree,
    );
  }

  return {
    graphOutput: sections.join('\n\n'),
    runListDirNameWidth: globalMaxDirNameWidth ?? widestRunListName,
    // biome-ignore lint/plugin/no-family-vocabulary: a terminal text column, the character offset labels align to across spaces
    runListLeftPad: globalLabelColumn,
  };
}

/**
 * The ordered "will run" rows, aligned with the graph above them.
 *
 * The `→` arrow has to land in the same absolute column in a list row as in a
 * graph edge row. A graph edge row is `[gutter][name][hashes]`; a list row is
 * `[indent][name][indent][hashes]`, so the list's name column absorbs the
 * gutter width and the indent — twice over when a flat tree has no space
 * headings indenting it.
 */
export function migrateShowRunListRows(
  migrations: readonly MigrateShowMigration[],
  rendering: Pick<MigrateShowRendering, 'runListDirNameWidth' | 'runListLeftPad'>,
  options: PaintOptions,
): readonly string[] {
  const gutter = rendering.runListLeftPad ?? 0;
  const multiSpace = rendering.runListLeftPad !== undefined;
  const edgeDirNameWidth = Math.max(
    rendering.runListDirNameWidth + LABEL_GAP,
    // biome-ignore lint/plugin/no-family-vocabulary: a terminal text column, the narrowest offset the hash column may start at
    MIN_HASH_DATA_COLUMN - gutter,
  );
  const listDirNameWidth = gutter + edgeDirNameWidth - (multiSpace ? LIST_INDENT : LIST_INDENT * 2);
  return migrations.map(
    (migration) =>
      `  ${formatOnPathMigrationRow(
        migration.dirName,
        migration.from,
        migration.to,
        listDirNameWidth,
        options.colorize,
        options.glyphMode,
        paintOverrides(options),
      )}`,
  );
}
