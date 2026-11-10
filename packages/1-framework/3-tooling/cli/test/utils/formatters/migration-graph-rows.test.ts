import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MigrationEdge, MigrationGraph } from '@internal/migration-tools/graph';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { renderMigrationGraphCommand } from '../../../src/utils/formatters/migration-graph-command-render';
import { buildGrid } from '../../../src/utils/formatters/migration-graph-grid-layout';
import {
  buildMigrationGraphRows,
  type ClassifiedEdge,
  type MigrationGraphRowModel,
} from '../../../src/utils/formatters/migration-graph-rows';
import type { MigrationEdgeKind } from '../../../src/utils/formatters/migration-list-graph-topology';

// ---------------------------------------------------------------------------
// Test graph builder helpers
// ---------------------------------------------------------------------------

let migSeq = 0;

function edge(from: string, to: string, dirName: string): MigrationEdge {
  return {
    from,
    to,
    migrationHash: `mig-${migSeq++}`,
    dirName,
    createdAt: '2026-01-01T00:00:00.000Z',
    invariants: [],
  };
}

function graph(edges: readonly MigrationEdge[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationEdge[]>();
  const reverseChain = new Map<string, MigrationEdge[]>();
  const migrationByHash = new Map<string, MigrationEdge>();

  for (const e of edges) {
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

function nodeOrder(model: MigrationGraphRowModel): readonly (string | null)[] {
  return model.nodes;
}

function edgeKinds(model: MigrationGraphRowModel): Record<string, MigrationEdgeKind> {
  const result: Record<string, MigrationEdgeKind> = {};
  for (const e of model.edges) {
    result[e.dirName] = e.kind;
  }
  return result;
}

function classifiedEdge(model: MigrationGraphRowModel, dirName: string): ClassifiedEdge {
  const found = model.edges.find((e) => e.dirName === dirName);
  if (!found) throw new Error(`no edge with dirName ${dirName}`);
  return found;
}

// ---------------------------------------------------------------------------
// Helper: assert topological order (every node appears before its forward parents)
// ---------------------------------------------------------------------------

function assertTipsBeforeRoots(model: MigrationGraphRowModel): void {
  const position = new Map<string, number>();
  let idx = 0;
  for (const n of model.nodes) {
    if (n !== null) position.set(n, idx);
    idx++;
  }

  for (const e of model.edges) {
    if (e.kind !== 'forward') continue;
    const fromPos = position.get(e.from);
    const toPos = position.get(e.to);
    if (fromPos === undefined || toPos === undefined) continue;
    expect(
      toPos,
      `tip ${e.to} (pos ${toPos}) should appear before root ${e.from} (pos ${fromPos}) for edge ${e.dirName}`,
    ).toBeLessThan(fromPos);
  }
}

// ---------------------------------------------------------------------------
// Empty graph
// ---------------------------------------------------------------------------

describe('buildMigrationGraphRows', () => {
  it('returns empty rows for an empty graph', () => {
    const g = graph([]);
    const model = buildMigrationGraphRows(g);
    expect(model.nodes).toEqual([]);
    expect(model.edges).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Linear topology
  // -------------------------------------------------------------------------

  describe('linear', () => {
    it('orders nodes tips-first, roots-last', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const addPosts = edge('aaa', 'bbb', 'add_posts');
      const g = graph([init, addPosts]);
      const model = buildMigrationGraphRows(g);

      expect(nodeOrder(model)).toEqual(['bbb', 'aaa', EMPTY_CONTRACT_HASH]);
    });

    it('classifies all edges as forward', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const addPosts = edge('aaa', 'bbb', 'add_posts');
      const g = graph([init, addPosts]);
      const model = buildMigrationGraphRows(g);

      expect(edgeKinds(model)).toEqual({
        init: 'forward',
        add_posts: 'forward',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Rollback — adjacent (no arc needed)
  // -------------------------------------------------------------------------

  describe('rollback', () => {
    it('classifies back edges as rollback', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const addPhone = edge('aaa', 'bbb', 'add_phone');
      const rollbackPhone = edge('bbb', 'aaa', 'rollback_phone');
      const addBio = edge('aaa', 'ccc', 'add_bio');
      const rollbackBio = edge('ccc', 'aaa', 'rollback_bio');
      const g = graph([init, addPhone, rollbackPhone, addBio, rollbackBio]);
      const model = buildMigrationGraphRows(g);

      expect(model.edges.find((e) => e.dirName === 'rollback_phone')?.kind).toBe('rollback');
      expect(model.edges.find((e) => e.dirName === 'rollback_bio')?.kind).toBe('rollback');
      expect(model.edges.find((e) => e.dirName === 'init')?.kind).toBe('forward');
      expect(model.edges.find((e) => e.dirName === 'add_phone')?.kind).toBe('forward');
      expect(model.edges.find((e) => e.dirName === 'add_bio')?.kind).toBe('forward');
    });

    it('places rollback source above its target in tips-first order', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const addPosts = edge('aaa', 'bbb', 'add_posts');
      const rollback = edge('bbb', 'aaa', 'rollback_posts');
      const g = graph([init, addPosts, rollback]);
      const model = buildMigrationGraphRows(g);

      const nodes = nodeOrder(model).filter((n) => n !== null) as string[];
      const bbbPos = nodes.indexOf('bbb');
      const aaaPos = nodes.indexOf('aaa');
      expect(bbbPos).toBeLessThan(aaaPos); // bbb (tip/source of rollback) above aaa
    });

    it('satisfies topological order', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const addPosts = edge('aaa', 'bbb', 'add_posts');
      const rollback = edge('bbb', 'aaa', 'rollback_posts');
      const g = graph([init, addPosts, rollback]);
      assertTipsBeforeRoots(buildMigrationGraphRows(g));
    });
  });

  // -------------------------------------------------------------------------
  // Diamond — convergence
  // -------------------------------------------------------------------------

  describe('diamond', () => {
    it('classifies all edges as forward', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
      const alice = edge('root', 'alice', 'alice_add_phone');
      const bob = edge('root', 'bob', 'bob_add_avatar');
      const mergeAlice = edge('alice', 'tip', 'merge_alice');
      const mergeBob = edge('bob', 'tip', 'merge_bob');
      const g = graph([init, alice, bob, mergeAlice, mergeBob]);
      const model = buildMigrationGraphRows(g);

      for (const e of model.edges) {
        expect(e.kind).toBe('forward');
      }
    });

    it('places tip above both branch nodes, both above root', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'root', 'init');
      const alice = edge('root', 'alice', 'alice_add_phone');
      const bob = edge('root', 'bob', 'bob_add_avatar');
      const mergeAlice = edge('alice', 'tip', 'merge_alice');
      const mergeBob = edge('bob', 'tip', 'merge_bob');
      const g = graph([init, alice, bob, mergeAlice, mergeBob]);
      const model = buildMigrationGraphRows(g);

      const nodes = nodeOrder(model).filter((n) => n !== null) as string[];
      const tipPos = nodes.indexOf('tip');
      const alicePos = nodes.indexOf('alice');
      const bobPos = nodes.indexOf('bob');
      const rootPos = nodes.indexOf('root');
      const emptyPos = nodes.indexOf(EMPTY_CONTRACT_HASH);

      expect(tipPos).toBeLessThan(alicePos);
      expect(tipPos).toBeLessThan(bobPos);
      expect(alicePos).toBeLessThan(rootPos);
      expect(bobPos).toBeLessThan(rootPos);
      expect(rootPos).toBeLessThan(emptyPos);
    });
  });

  // -------------------------------------------------------------------------
  // Disjoint forest
  // -------------------------------------------------------------------------

  describe('disjoint forest', () => {
    it('separates components with a null sentinel', () => {
      const appInit = edge(EMPTY_CONTRACT_HASH, 'aaa', 'app_init');
      const appNext = edge('aaa', 'bbb', 'app_next');
      const otherRoot = edge('ccc', 'ddd', 'other_root');
      const g = graph([appInit, appNext, otherRoot]);
      const model = buildMigrationGraphRows(g);

      expect(model.nodes).toContain(null);
    });

    it('keeps EMPTY_CONTRACT_HASH component before other components', () => {
      const appInit = edge(EMPTY_CONTRACT_HASH, 'aaa', 'app_init');
      const appNext = edge('aaa', 'bbb', 'app_next');
      const otherRoot = edge('ccc', 'ddd', 'other_root');
      const g = graph([appInit, appNext, otherRoot]);
      const model = buildMigrationGraphRows(g);

      const nodes = model.nodes;
      const emptyPos = nodes.indexOf(EMPTY_CONTRACT_HASH);
      const cccPos = nodes.indexOf('ccc');
      expect(emptyPos).toBeGreaterThan(-1);
      expect(cccPos).toBeGreaterThan(-1);
      expect(emptyPos).toBeLessThan(cccPos);
    });

    it('maintains topological order within each component', () => {
      const appInit = edge(EMPTY_CONTRACT_HASH, 'aaa', 'app_init');
      const appNext = edge('aaa', 'bbb', 'app_next');
      const otherRoot = edge('ccc', 'ddd', 'other_root');
      const g = graph([appInit, appNext, otherRoot]);
      const model = buildMigrationGraphRows(g);

      const nodes = model.nodes.filter((n) => n !== null) as string[];
      expect(nodes.indexOf('bbb')).toBeLessThan(nodes.indexOf('aaa'));
      expect(nodes.indexOf('aaa')).toBeLessThan(nodes.indexOf(EMPTY_CONTRACT_HASH));
      expect(nodes.indexOf('ddd')).toBeLessThan(nodes.indexOf('ccc'));
    });
  });

  // -------------------------------------------------------------------------
  // Cross-link / nonlinear forward
  // -------------------------------------------------------------------------

  describe('cross-link (nonlinear forward)', () => {
    it('satisfies topological order with a cross edge', () => {
      // A → B → C, A → D → E, plus cross edge B → E
      const aToB = edge('A', 'B', 'A_to_B');
      const bToC = edge('B', 'C', 'B_to_C');
      const aToD = edge('A', 'D', 'A_to_D');
      const dToE = edge('D', 'E', 'D_to_E');
      const bToE = edge('B', 'E', 'B_to_E');
      const g = graph([aToB, bToC, aToD, dToE, bToE]);
      assertTipsBeforeRoots(buildMigrationGraphRows(g));
    });

    it('classifies cross forward edge correctly', () => {
      const aToB = edge('A', 'B', 'A_to_B');
      const bToC = edge('B', 'C', 'B_to_C');
      const aToD = edge('A', 'D', 'A_to_D');
      const dToE = edge('D', 'E', 'D_to_E');
      const bToE = edge('B', 'E', 'B_to_E');
      const g = graph([aToB, bToC, aToD, dToE, bToE]);
      const model = buildMigrationGraphRows(g);

      // bToE is either forward or rollback depending on DFS traversal order
      // In all cases C and E are tips (no outgoing forward edges)
      for (const e of model.edges) {
        expect(['forward', 'rollback']).toContain(e.kind);
      }
      // A_to_B and A_to_D are always forward (tree edges from root)
      expect(model.edges.find((e) => e.dirName === 'A_to_B')?.kind).toBe('forward');
      expect(model.edges.find((e) => e.dirName === 'A_to_D')?.kind).toBe('forward');
    });
  });

  // -------------------------------------------------------------------------
  // Self-edge
  // -------------------------------------------------------------------------

  describe('self-edge', () => {
    it('classifies self-edge as self', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const noop = edge('aaa', 'aaa', 'noop');
      const next = edge('aaa', 'bbb', 'next');
      const g = graph([init, noop, next]);
      const model = buildMigrationGraphRows(g);

      expect(model.edges.find((e) => e.dirName === 'noop')?.kind).toBe('self');
      expect(model.edges.find((e) => e.dirName === 'init')?.kind).toBe('forward');
      expect(model.edges.find((e) => e.dirName === 'next')?.kind).toBe('forward');
    });

    it('places self-edge node at the right topological position', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const noop = edge('aaa', 'aaa', 'noop');
      const next = edge('aaa', 'bbb', 'next');
      const g = graph([init, noop, next]);
      const model = buildMigrationGraphRows(g);

      const nodes = nodeOrder(model).filter((n) => n !== null) as string[];
      expect(nodes.indexOf('bbb')).toBeLessThan(nodes.indexOf('aaa'));
      expect(nodes.indexOf('aaa')).toBeLessThan(nodes.indexOf(EMPTY_CONTRACT_HASH));
    });
  });

  // -------------------------------------------------------------------------
  // Pure cycle
  // -------------------------------------------------------------------------

  describe('pure cycle', () => {
    it('classifies exactly one edge as rollback in a 2-node cycle', () => {
      const fwd = edge('aaa', 'bbb', 'forward');
      const back = edge('bbb', 'aaa', 'rollback');
      const g = graph([fwd, back]);
      const model = buildMigrationGraphRows(g);

      const kinds = model.edges.map((e) => e.kind);
      expect(kinds.filter((k) => k === 'forward')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'rollback')).toHaveLength(1);
    });

    it('places both nodes deterministically', () => {
      const fwd = edge('aaa', 'bbb', 'forward');
      const back = edge('bbb', 'aaa', 'rollback');
      const g = graph([fwd, back]);
      const model = buildMigrationGraphRows(g);

      const nodes = nodeOrder(model).filter((n) => n !== null) as string[];
      expect(nodes).toHaveLength(2);
      expect(new Set(nodes)).toEqual(new Set(['aaa', 'bbb']));
    });
  });

  // -------------------------------------------------------------------------
  // ClassifiedEdge structure
  // -------------------------------------------------------------------------

  describe('classified edge fields', () => {
    it('carries from, to, dirName, migrationHash, and kind', () => {
      const e = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const g = graph([e]);
      const model = buildMigrationGraphRows(g);

      const ce = classifiedEdge(model, 'init');
      expect(ce.from).toBe(EMPTY_CONTRACT_HASH);
      expect(ce.to).toBe('aaa');
      expect(ce.dirName).toBe('init');
      expect(ce.migrationHash).toBe(e.migrationHash);
      expect(ce.kind).toBe('forward');
    });
  });

  // -------------------------------------------------------------------------
  // Lookup maps
  // -------------------------------------------------------------------------

  describe('edgesByFrom / edgesByTo lookup maps', () => {
    it('indexes edges by from and to', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const addPosts = edge('aaa', 'bbb', 'add_posts');
      const g = graph([init, addPosts]);
      const model = buildMigrationGraphRows(g);

      expect(model.edgesByFrom.get(EMPTY_CONTRACT_HASH)).toHaveLength(1);
      expect(model.edgesByFrom.get('aaa')).toHaveLength(1);
      expect(model.edgesByTo.get('aaa')).toHaveLength(1);
      expect(model.edgesByTo.get('bbb')).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Detached contract (floating node component)
  // -------------------------------------------------------------------------

  describe('detached contract hash', () => {
    it('prepends a single-node component when contractHash is not in the graph', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
      const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
      const g = graph([init, addPosts]);
      const without = buildMigrationGraphRows(g);
      const withDetached = buildMigrationGraphRows(g, { contractHash: 'c0ffee0' });

      expect(without.nodes).toEqual(['a94b7b4', 'ef9de27', EMPTY_CONTRACT_HASH]);
      expect(withDetached.nodes).toEqual([
        'c0ffee0',
        null,
        'a94b7b4',
        'ef9de27',
        EMPTY_CONTRACT_HASH,
      ]);
      expect(withDetached.edges).toEqual(without.edges);
    });

    it('leaves the row model unchanged when contractHash is the sole tip of a linear chain', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
      const addPosts = edge('ef9de27', 'a94b7b4', 'add_posts');
      const g = graph([init, addPosts]);
      const baseline = buildMigrationGraphRows(g);
      const withExisting = buildMigrationGraphRows(g, { contractHash: 'a94b7b4' });

      expect(withExisting).toEqual(baseline);
    });

    it('leaves the row model unchanged for EMPTY_CONTRACT_HASH', () => {
      const init = edge(EMPTY_CONTRACT_HASH, 'ef9de27', 'init');
      const g = graph([init]);
      const baseline = buildMigrationGraphRows(g);
      const withEmpty = buildMigrationGraphRows(g, { contractHash: EMPTY_CONTRACT_HASH });

      expect(withEmpty).toEqual(baseline);
    });

    it('renders a lone floating node when the graph is empty and the contract is detached', () => {
      const model = buildMigrationGraphRows(graph([]), { contractHash: 'c0ffee0' });

      expect(model.nodes).toEqual(['c0ffee0']);
      expect(model.edges).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // Trunk choice via contractHash (connected components)
  // -------------------------------------------------------------------------

  describe('contractHash trunk choice', () => {
    function twoLeafSharedRootGraph(): MigrationGraph {
      return graph([
        edge(EMPTY_CONTRACT_HASH, '76c1bd5', 'historical_1'),
        edge('76c1bd5', '5618dca', 'historical_2'),
        edge('5618dca', '6cee614', 'historical_3'),
        edge('6cee614', 'f7a8eb5', 'historical_4'),
        edge(EMPTY_CONTRACT_HASH, '1375f13', 'live_migration'),
      ]);
    }

    it('places the live-contract leaf on the trunk when it has the shorter chain', () => {
      const g = twoLeafSharedRootGraph();
      const without = buildMigrationGraphRows(g);
      const withLive = buildMigrationGraphRows(g, { contractHash: '1375f13' });

      expect(without.nodes[0]).toBe('f7a8eb5');
      expect(withLive.nodes[0]).toBe('1375f13');
    });

    it('keeps the longest-path heuristic for EMPTY_CONTRACT_HASH', () => {
      const g = twoLeafSharedRootGraph();
      const model = buildMigrationGraphRows(g, { contractHash: EMPTY_CONTRACT_HASH });

      expect(model.nodes[0]).toBe('f7a8eb5');
    });

    it('leaves a single-node component unchanged when contractHash is set', () => {
      const g = graph([edge('aaa', 'bbb', 'solo')]);
      const baseline = buildMigrationGraphRows(g);
      const withContract = buildMigrationGraphRows(g, { contractHash: 'bbb' });

      expect(withContract).toEqual(baseline);
    });
  });

  // -------------------------------------------------------------------------
  // Determinism
  // -------------------------------------------------------------------------

  describe('determinism', () => {
    it('produces the same node ordering regardless of edge insertion order', () => {
      const eA = edge(EMPTY_CONTRACT_HASH, 'aaa', 'init');
      const eB = edge('aaa', 'bbb', 'add_users');
      const eC = edge('bbb', 'ccc', 'add_posts');

      const order1 = buildMigrationGraphRows(graph([eA, eB, eC])).nodes;
      const order2 = buildMigrationGraphRows(graph([eC, eB, eA])).nodes;
      const order3 = buildMigrationGraphRows(graph([eB, eC, eA])).nodes;

      expect(order1).toEqual(order2);
      expect(order1).toEqual(order3);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-links + back-edges must not derail the tips-at-top layering
  // -------------------------------------------------------------------------

  describe('layering under cross-links and back-edges', () => {
    // A graph that combines, in one component: a diamond, a cross-link (a
    // forward "shortcut" edge that skips the diamond), a post-diamond linear
    // chain ending in a tip with a self-edge, an adjacent rollback, a
    // node-skipping rollback, and a node-skipping rollback originating from a
    // branch node. The forward shortcut and the back-edges must NOT pull a
    // node below any of its forward descendants: every forward edge's `to`
    // (the newer contract) must still render above its `from`. A DFS post-order
    // violates this — the post-diamond chain sinks below the diamond and the
    // tip lands mid-graph — so this pins the longest-path layering that keeps
    // tips at the top and roots at the bottom regardless of shortcuts/back-edges.
    function comprehensiveGraph(): MigrationGraph {
      return graph([
        edge(EMPTY_CONTRACT_HASH, '1111111', 'init'),
        edge('1111111', '2222222', 'add_users'),
        edge('2222222', '33aaaaa', 'alice_phone'),
        edge('2222222', '33bbbbb', 'bob_avatar'),
        edge('33aaaaa', '4444444', 'merge_alice'),
        edge('33bbbbb', '4444444', 'merge_bob'),
        // cross-link: forward shortcut skipping the diamond
        edge('1111111', '4444444', 'fast_forward'),
        edge('4444444', '5555555', 'add_posts'),
        edge('5555555', '6666666', 'add_comments'),
        // adjacent rollback
        edge('6666666', '5555555', 'rollback_posts'),
        // node-skipping rollback
        edge('6666666', '2222222', 'rollback_users'),
        // node-skipping rollback originating from a branch node
        edge('33aaaaa', '1111111', 'rollback_alice'),
        // tip + self-edge
        edge('6666666', '7777777', 'hotfix'),
        edge('7777777', '7777777', 'reapply_noop'),
        // disjoint cyclic component
        edge('c111111', 'c222222', 'experiment'),
        edge('c222222', 'c111111', 'revert_experiment'),
      ]);
    }

    it('keeps every forward edge tip-above-root despite a cross-link and branch back-edge', () => {
      assertTipsBeforeRoots(buildMigrationGraphRows(comprehensiveGraph()));
    });

    it('keeps the post-diamond tip at the top and the empty root at the bottom of its component', () => {
      const nodes = nodeOrder(buildMigrationGraphRows(comprehensiveGraph())).filter(
        (n): n is string => n !== null,
      );
      const pos = (hash: string): number => nodes.indexOf(hash);

      // The merge node sits above both diamond branches (the cross-link and
      // the branch back-edge must not sink it below them).
      expect(pos('4444444')).toBeLessThan(pos('33aaaaa'));
      expect(pos('4444444')).toBeLessThan(pos('33bbbbb'));
      // The post-diamond chain stays above the diamond.
      expect(pos('7777777')).toBeLessThan(pos('4444444'));
      expect(pos('6666666')).toBeLessThan(pos('4444444'));
      expect(pos('5555555')).toBeLessThan(pos('4444444'));
      // Tip at the very top of the main component; empty baseline at the bottom.
      expect(pos('7777777')).toBe(0);
      expect(pos(EMPTY_CONTRACT_HASH)).toBeGreaterThan(pos('1111111'));
    });

    // The full command render of the same graph through the NEW grid pipeline:
    // rows, gutter, and labels all derive from one grid. Asserted ANSI-stripped
    // so the structure + label correspondence is evaluable at a glance. The
    // gutter uses the corner alphabet only (│ ╭ ╮ ╰ ╯ — never tees ├ ┬ ┴), and
    // each migration label sits on the row that draws its arrow (↑/↓/⟲).
    it('renders the comprehensive graph through the new command pipeline', () => {
      const rows = buildMigrationGraphRows(comprehensiveGraph());
      const grid = buildGrid(rows, {}, { mode: 'flat', onPath: new Set() });
      const rendered = stripAnsi(
        renderMigrationGraphCommand({
          grid,
          rowModel: rows,
          colorize: false,
          glyphMode: 'unicode',
        }),
      );
      // No legacy tee glyphs anywhere — the renderer draws corners only.
      expect(rendered).not.toMatch(/[├┬┴┼]/u);
      // Each migration label appears on at least one line, and every line that
      // carries a migration name also carries that migration's arrow (↑/↓/⟲) —
      // labels and arrows come from the same grid row.
      const lines = rendered.split('\n');
      for (const edge of rows.edges) {
        const labelLines = lines.filter((line) => line.includes(edge.dirName));
        expect(labelLines.length, `migration ${edge.dirName} present`).toBeGreaterThanOrEqual(1);
        for (const line of labelLines) {
          expect(line, `arrow on row for ${edge.dirName}`).toMatch(/[↑↓⟲]/u);
        }
      }
    });
  });
});
