import { describe, expect, it } from 'vitest';
import { EMPTY_CONTRACT_HASH } from '../src/constants';
import type { MigrationEdge } from '../src/graph';
import { computeMigrationHash } from '../src/hash';
import { findPath, findPathWithInvariants, reconstructGraph } from '../src/migration-graph';
import type { OnDiskMigrationPackage } from '../src/package';
import { createTestMetadata, createTestOps } from './fixtures';

let migrationCounter = 0;

interface PkgOpts {
  readonly invariants?: readonly string[];
  readonly createdAt?: string;
}

function pkg(
  from: string,
  to: string,
  dirName: string,
  opts: PkgOpts = {},
): OnDiskMigrationPackage {
  const baseCreatedAt = opts.createdAt ?? '2026-02-25T14:00:00.000Z';
  const uniqueCreatedAt = `${baseCreatedAt}-${migrationCounter++}`;
  const metadata = createTestMetadata({
    from,
    to,
    createdAt: uniqueCreatedAt,
    providedInvariants: opts.invariants ?? [],
  });
  const ops = createTestOps();
  const migrationHash = computeMigrationHash(metadata, ops);
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    metadata: { ...metadata, migrationHash },
    ops,
  };
}

const E = EMPTY_CONTRACT_HASH;

const dirNames = (path: readonly MigrationEdge[] | null): readonly string[] | null =>
  path === null ? null : path.map((e) => e.dirName);

// ---------------------------------------------------------------------------
// F8 — when required is empty, behaviour matches findPath byte-identically.
// ---------------------------------------------------------------------------

describe('findPathWithInvariants — F8 equivalence with findPath when required = ∅', () => {
  const empty: ReadonlySet<string> = new Set();

  it('matches findPath on a linear chain', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
    ]);
    expect(dirNames(findPathWithInvariants(graph, E, 'H3', empty))).toEqual(
      dirNames(findPath(graph, E, 'H3')),
    );
  });

  it('matches findPath on a diamond — same shortest, same tie-break', () => {
    const graph = reconstructGraph([
      pkg(E, 'A', 'm0'),
      pkg('A', 'B', 'm_left'),
      pkg('A', 'C', 'm_right'),
      pkg('B', 'D', 'm_left_close'),
      pkg('C', 'D', 'm_right_close'),
    ]);
    expect(dirNames(findPathWithInvariants(graph, 'A', 'D', empty))).toEqual(
      dirNames(findPath(graph, 'A', 'D')),
    );
  });

  it('matches findPath when no path exists (both null)', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1')]);
    expect(findPathWithInvariants(graph, E, 'H99', empty)).toBeNull();
    expect(findPath(graph, E, 'H99')).toBeNull();
  });

  it('matches findPath when from === to (both empty array)', () => {
    const graph = reconstructGraph([pkg(E, 'H1', 'm1')]);
    expect(findPathWithInvariants(graph, 'H1', 'H1', empty)).toEqual([]);
    expect(findPath(graph, 'H1', 'H1')).toEqual([]);
  });

  it('matches findPath on a graph with a cycle', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H1', 'm3_back'),
      pkg('H1', 'H3', 'm4'),
    ]);
    expect(dirNames(findPathWithInvariants(graph, E, 'H3', empty))).toEqual(
      dirNames(findPath(graph, E, 'H3')),
    );
  });

  it('matches findPath when multiple equal-length paths exist (createdAt tie-break)', () => {
    // Both edges from H1 → H2 have identical structural shape; tie-break is
    // createdAt ascending. findPath picks the earlier one.
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm0'),
      pkg('H1', 'H2', 'm_early', { createdAt: '2026-01-01T00:00:00.000Z' }),
      pkg('H1', 'H2', 'm_late', { createdAt: '2026-12-01T00:00:00.000Z' }),
    ]);
    expect(dirNames(findPathWithInvariants(graph, 'H1', 'H2', empty))).toEqual(
      dirNames(findPath(graph, 'H1', 'H2')),
    );
  });
});

// ---------------------------------------------------------------------------
// Core correctness — single invariant, multiple invariants, no path,
// determinism, state-level dedup.
// ---------------------------------------------------------------------------

describe('findPathWithInvariants — core correctness', () => {
  it('selects the providing route when one exists', () => {
    // A → B → D (no invariant), A → C → D (C→D provides X). Require X.
    const graph = reconstructGraph([
      pkg(E, 'A', 'm0'),
      pkg('A', 'B', 'm_left_open'),
      pkg('B', 'D', 'm_left_close'),
      pkg('A', 'C', 'm_right_open'),
      pkg('C', 'D', 'm_right_close', { invariants: ['X'] }),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'D', new Set(['X']));
    expect(dirNames(path)).toEqual(['m_right_open', 'm_right_close']);
  });

  it('returns null when no path covers the required set', () => {
    // Linear A → B → C, no edge declares X.
    const graph = reconstructGraph([pkg('A', 'B', 'm1'), pkg('B', 'C', 'm2')]);
    expect(findPathWithInvariants(graph, 'A', 'C', new Set(['X']))).toBeNull();
  });

  it('returns null when from === to and required is non-empty', () => {
    // Empty path covers no invariants ⇒ unsatisfiable.
    const graph = reconstructGraph([pkg('A', 'B', 'm1', { invariants: ['X'] })]);
    expect(findPathWithInvariants(graph, 'A', 'A', new Set(['X']))).toBeNull();
  });

  it('returns null when target is structurally unreachable', () => {
    const graph = reconstructGraph([pkg('A', 'B', 'm1')]);
    expect(findPathWithInvariants(graph, 'A', 'Z', new Set(['X']))).toBeNull();
  });

  it('selects the same-length tie-break path among multiple satisfying ones', () => {
    // Two equal-length paths from A → D both provide X. Tie-break is
    // createdAt ascending; the early-createdAt path wins.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm_left', {
        invariants: ['X'],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      pkg('B', 'D', 'm_left_close'),
      pkg('A', 'C', 'm_right', {
        invariants: ['X'],
        createdAt: '2026-12-01T00:00:00.000Z',
      }),
      pkg('C', 'D', 'm_right_close'),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'D', new Set(['X']));
    expect(dirNames(path)).toEqual(['m_left', 'm_left_close']);
  });

  it('finds a path covering two required invariants on different edges', () => {
    // A → B (X) → C (Y) → D. Require {X, Y}.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm1', { invariants: ['X'] }),
      pkg('B', 'C', 'm2', { invariants: ['Y'] }),
      pkg('C', 'D', 'm3'),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'D', new Set(['X', 'Y']));
    expect(dirNames(path)).toEqual(['m1', 'm2', 'm3']);
  });

  it('state-level dedup is required for correctness (counter-example)', () => {
    // The spec's counter-example (Pathfinder algorithm §):
    //   A → D via two edges, one providing X, one providing Y; both reach D.
    //   D → E → F. Edge E → F also provides X.
    //   Required: {X, Y}. Only the Y-edge route covers both ⇒ correct path is
    //   A→D (Y-edge), D→E, E→F (X-edge).
    // Node-only dedup at D would pick the X-arrival first, mark D visited,
    // and never re-explore via the Y-arrival, returning null.
    const graph = reconstructGraph([
      pkg('A', 'D', 'm_AD_x', {
        invariants: ['X'],
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      pkg('A', 'D', 'm_AD_y', {
        invariants: ['Y'],
        createdAt: '2026-12-01T00:00:00.000Z',
      }),
      pkg('D', 'E', 'm_DE'),
      pkg('E', 'F', 'm_EF', { invariants: ['X'] }),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'F', new Set(['X', 'Y']));
    expect(path).not.toBeNull();
    expect(dirNames(path)).toEqual(['m_AD_y', 'm_DE', 'm_EF']);
  });
});

// ---------------------------------------------------------------------------
// Neighbour ordering — D11. With required non-empty, invariant-covering edges
// are explored first; with required empty, today's order is preserved.
// ---------------------------------------------------------------------------

describe('findPathWithInvariants — neighbour ordering (D11)', () => {
  it('prefers invariant-covering edges among equal-length satisfying paths', () => {
    // Two equal-length paths from A → D, only one provides X. The
    // invariant-covering route must be selected even though without the
    // invariant heuristic the createdAt tie-break would prefer the other.
    const graph = reconstructGraph([
      // Non-providing route, earlier createdAt — would win on tie-break alone.
      pkg('A', 'B', 'm_no_x', { createdAt: '2026-01-01T00:00:00.000Z' }),
      pkg('B', 'D', 'm_no_x_close'),
      // Providing route, later createdAt.
      pkg('A', 'C', 'm_x', {
        invariants: ['X'],
        createdAt: '2026-12-01T00:00:00.000Z',
      }),
      pkg('C', 'D', 'm_x_close'),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'D', new Set(['X']));
    expect(dirNames(path)).toEqual(['m_x', 'm_x_close']);
  });

  it('matches today findPath ordering when required is empty (no heuristic in play)', () => {
    // Same graph as above; with required = ∅, the invariant-providing edge
    // shouldn't be preferred — today's tie-break wins (createdAt ascending).
    const graph = reconstructGraph([
      pkg('A', 'B', 'm_no_x', { createdAt: '2026-01-01T00:00:00.000Z' }),
      pkg('B', 'D', 'm_no_x_close'),
      pkg('A', 'C', 'm_x', {
        invariants: ['X'],
        createdAt: '2026-12-01T00:00:00.000Z',
      }),
      pkg('C', 'D', 'm_x_close'),
    ]);
    expect(dirNames(findPathWithInvariants(graph, 'A', 'D', new Set()))).toEqual(
      dirNames(findPath(graph, 'A', 'D')),
    );
  });
});

// ---------------------------------------------------------------------------
// Common shapes panel — spec §"Graph shapes to evaluate" / Common shapes.
// ---------------------------------------------------------------------------

describe('findPathWithInvariants — common shapes', () => {
  it('linear spine with invariants along the way — required matches, path equals spine', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1', { invariants: ['X'] }),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3', { invariants: ['Y'] }),
    ]);
    expect(dirNames(findPathWithInvariants(graph, E, 'H3', new Set(['X', 'Y'])))).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('long free spine + required detour — takes the detour', () => {
    // Long spine with a side detour that provides X. The detour rejoins
    // a few edges later. Require X ⇒ must take the detour.
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
      pkg('H3', 'H4', 'm4'),
      pkg('H4', 'H5', 'm5'),
      // Side detour: H2 → S → H4 with side providing X.
      pkg('H2', 'S', 'm_detour_open', { invariants: ['X'] }),
      pkg('S', 'H4', 'm_detour_close'),
    ]);
    const path = findPathWithInvariants(graph, E, 'H5', new Set(['X']));
    expect(dirNames(path)).toEqual(['m1', 'm2', 'm_detour_open', 'm_detour_close', 'm5']);
  });

  it('two required invariants on different edges — picks the path containing both', () => {
    // Two parallel routes A → D:
    //  - via B: provides only X
    //  - via C: provides X and Y
    // Required {X, Y} ⇒ only the C route satisfies.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm_b_open', { invariants: ['X'] }),
      pkg('B', 'D', 'm_b_close'),
      pkg('A', 'C', 'm_c_open', { invariants: ['X'] }),
      pkg('C', 'D', 'm_c_close', { invariants: ['Y'] }),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'D', new Set(['X', 'Y']));
    expect(dirNames(path)).toEqual(['m_c_open', 'm_c_close']);
  });

  it('required invariant provided by multiple edges on the same path — selection unaffected', () => {
    // X provided twice along the only path. Path is unchanged from the
    // structural shortest; both provider edges retain X on their `invariants`.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm1', { invariants: ['X'] }),
      pkg('B', 'C', 'm2'),
      pkg('C', 'D', 'm3', { invariants: ['X'] }),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'D', new Set(['X']));
    expect(dirNames(path)).toEqual(['m1', 'm2', 'm3']);
    expect(path?.[0]?.invariants).toEqual(['X']);
    expect(path?.[2]?.invariants).toEqual(['X']);
  });
});

// ---------------------------------------------------------------------------
// Failure shapes panel — spec §"Graph shapes to evaluate" / Failure shapes.
// ---------------------------------------------------------------------------

describe('findPathWithInvariants — failure shapes', () => {
  it('invariant exists elsewhere but not on any from→to path → null', () => {
    // X is declared, but only on an edge in a disconnected component.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm1'),
      pkg('B', 'C', 'm2'),
      pkg('Q', 'R', 'm_other', { invariants: ['X'] }),
    ]);
    expect(findPathWithInvariants(graph, 'A', 'C', new Set(['X']))).toBeNull();
  });

  it('partial satisfaction — every path covers X or Y but not both → null', () => {
    // Two routes A → D: one provides only X, the other only Y.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm_b_open', { invariants: ['X'] }),
      pkg('B', 'D', 'm_b_close'),
      pkg('A', 'C', 'm_c_open', { invariants: ['Y'] }),
      pkg('C', 'D', 'm_c_close'),
    ]);
    expect(findPathWithInvariants(graph, 'A', 'D', new Set(['X', 'Y']))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pathological shapes panel — spec §"Graph shapes to evaluate" / Pathological.
// ---------------------------------------------------------------------------

describe('findPathWithInvariants — pathological shapes', () => {
  it('handles a dense graph with many required invariants without looping (k=8)', () => {
    // Diamond cascade: 8 diamonds. Each diamond's top edge provides inv-i;
    // bottom edge provides nothing. Only the all-top path covers all 8
    // invariants. Asserts: returns the all-top path.
    const k = 8;
    const packages: OnDiskMigrationPackage[] = [];
    for (let i = 0; i < k; i++) {
      const open = i === 0 ? E : `S${i}`;
      const close = `S${i + 1}`;
      packages.push(
        pkg(open, close, `m_top_${i}`, { invariants: [`inv-${i}`] }),
        pkg(open, `D${i}`, `m_bot_open_${i}`),
        pkg(`D${i}`, close, `m_bot_close_${i}`),
      );
    }
    const graph = reconstructGraph(packages);
    const required = new Set(Array.from({ length: k }, (_, i) => `inv-${i}`));
    const path = findPathWithInvariants(graph, E, `S${k}`, required);
    expect(path).not.toBeNull();
    expect(path).toHaveLength(k);
    expect(dirNames(path)).toEqual(Array.from({ length: k }, (_, i) => `m_top_${i}`));
  });

  it('cycles on free edges — must not loop forever', () => {
    // A → B → A → B → … cycle, plus B → C exit. Require X (provided on B→C
    // exit). Must terminate and return [m_AB, m_BC].
    const graph = reconstructGraph([
      pkg('A', 'B', 'm_AB'),
      pkg('B', 'A', 'm_BA'),
      pkg('B', 'C', 'm_BC', { invariants: ['X'] }),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'C', new Set(['X']));
    expect(dirNames(path)).toEqual(['m_AB', 'm_BC']);
  });

  it('cycles on invariant-providing edges — must not loop forever', () => {
    // A → B (provides X), B → A (provides X), B → C exit. Require X.
    // The BFS must dedup the (B, {X}) state and not loop.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm_AB', { invariants: ['X'] }),
      pkg('B', 'A', 'm_BA', { invariants: ['X'] }),
      pkg('B', 'C', 'm_BC'),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'C', new Set(['X']));
    expect(dirNames(path)).toEqual(['m_AB', 'm_BC']);
  });

  it('required invariant only provided via a cycle — finds the acyclic satisfying path', () => {
    // Spec edge case: A → B → C exit, with a side cycle B → D → B that
    // provides X. The acyclic satisfying path goes A→B→D→B→C, which uses
    // the cycle once. Length 4.
    const graph = reconstructGraph([
      pkg('A', 'B', 'm_AB'),
      pkg('B', 'D', 'm_BD', { invariants: ['X'] }),
      pkg('D', 'B', 'm_DB'),
      pkg('B', 'C', 'm_BC'),
    ]);
    const path = findPathWithInvariants(graph, 'A', 'C', new Set(['X']));
    expect(path).not.toBeNull();
    expect(dirNames(path)).toEqual(['m_AB', 'm_BD', 'm_DB', 'm_BC']);
  });
});
