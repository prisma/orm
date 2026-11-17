/**
 * Geometry scaling — colsPerLane is an option that rescales the grid with no
 * renderer code change. Tests here verify:
 *
 *  1. Passing colsPerLane=3 produces a proportionally wider grid than colsPerLane=2.
 *  2. The no-tee corner alphabet (no ├ ┬ ┴ ┼) holds at colsPerLane=3.
 *  3. The default (colsPerLane unspecified) equals colsPerLane=2 output exactly.
 *
 * Uses the fork-2 topology (2 forward lanes, no back-lanes) so totalCols = numLanes * colsPerLane.
 */

import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@internal/migration-tools/graph';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { buildGrid } from '../../../src/utils/formatters/migration-graph-grid-layout';
import { renderGrid } from '../../../src/utils/formatters/migration-graph-occlusion-render';
import { buildMigrationGraphRows } from '../../../src/utils/formatters/migration-graph-rows';

// ---------------------------------------------------------------------------
// Minimal fork-2 fixture: ∅ → root → trunk, root → alt  (2 forward lanes)
// ---------------------------------------------------------------------------

const EMPTY = EMPTY_CONTRACT_HASH;

function makeEdge(from: string, to: string, dirName: string, i: number): MigrationEdge {
  return {
    from,
    to,
    migrationHash: `geo${String(i).padStart(3, '0')}-${dirName.slice(0, 20)}`,
    dirName,
    createdAt: '2026-06-06T00:00:00.000Z',
    invariants: [],
  };
}

const edgeInit = makeEdge(EMPTY, 'geo_root', '20260606T0000_init', 0);
const edgeTrunk = makeEdge('geo_root', 'geo_trunk', '20260606T0001_trunk', 1);
const edgeAlt = makeEdge('geo_root', 'geo_alt', '20260606T0002_alt', 2);

const FORK_EDGES: readonly MigrationEdge[] = [edgeInit, edgeTrunk, edgeAlt];

function buildForkGraph(): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationEdge[]>();
  const reverseChain = new Map<string, MigrationEdge[]>();
  const migrationByHash = new Map<string, MigrationEdge>();
  for (const e of FORK_EDGES) {
    nodes.add(e.from);
    nodes.add(e.to);
    migrationByHash.set(e.migrationHash, e);
    const fwd = forwardChain.get(e.from);
    if (fwd) fwd.push(e);
    else forwardChain.set(e.from, [e]);
    const rev = reverseChain.get(e.to);
    if (rev) rev.push(e);
    else reverseChain.set(e.to, [e]);
  }
  return { nodes, forwardChain, reverseChain, migrationByHash };
}

const FLAT_HIGHLIGHT = { mode: 'flat' as const, onPath: new Set<string>() };

function buildForkGrid(colsPerLane?: number) {
  const rowModel = buildMigrationGraphRows(buildForkGraph(), {});
  return buildGrid(rowModel, colsPerLane !== undefined ? { colsPerLane } : {}, FLAT_HIGHLIGHT);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('migration-graph geometry', () => {
  it('grid width scales with colsPerLane — fork-2 has 2 forward lanes', () => {
    const grid2 = buildForkGrid(2);
    const grid3 = buildForkGrid(3);

    const numLanes = 2;
    expect(grid2[0]!.length, 'colsPerLane=2: width = numLanes * 2').toBe(numLanes * 2);
    expect(grid3[0]!.length, 'colsPerLane=3: width = numLanes * 3').toBe(numLanes * 3);
  });

  it('no tee glyphs at colsPerLane=3', () => {
    const grid3 = buildForkGrid(3);
    const rendered = renderGrid(grid3, { colorize: false, colsPerLane: 3 });
    expect(stripAnsi(rendered)).not.toMatch(/[├┬┴┼]/u);
  });

  it('default output (colsPerLane unspecified) is identical to colsPerLane=2', () => {
    const gridDefault = buildForkGrid(undefined);
    const grid2 = buildForkGrid(2);

    const renderedDefault = renderGrid(gridDefault, { colorize: false });
    const rendered2 = renderGrid(grid2, { colorize: false });

    expect(renderedDefault).toBe(rendered2);
  });
});
