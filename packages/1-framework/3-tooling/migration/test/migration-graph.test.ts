import { describe, expect, it } from 'vitest';
import { EMPTY_CONTRACT_HASH } from '../src/constants';
import type { MigrationEdge } from '../src/graph';
import { computeMigrationHash } from '../src/hash';
import {
  detectCycles,
  detectOrphans,
  findPath,
  findPathWithDecision,
  reconstructGraph,
} from '../src/migration-graph';
import type { OnDiskMigrationPackage } from '../src/package';
import { createTestMetadata, createTestOps } from './fixtures';

let migrationCounter = 0;

function pkg(
  from: string,
  to: string,
  dirName: string,
  createdAt = '2026-02-25T14:00:00.000Z',
): OnDiskMigrationPackage {
  // Bake a per-pkg counter into createdAt so distinct packages get distinct
  // hashes — and use the same metadata for both hashing and the returned
  // package, so each fixture is internally consistent (round-trips through
  // readMigrationPackage()).
  const uniqueCreatedAt = `${createdAt}-${migrationCounter++}`;
  const metadata = createTestMetadata({ from, to, createdAt: uniqueCreatedAt });
  const ops = createTestOps();
  const migrationHash = computeMigrationHash(metadata, ops);
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    metadata: { ...metadata, migrationHash },
    ops,
  };
}

function chain(...specs: Array<[string, string, string]>): OnDiskMigrationPackage[] {
  return specs.map(([from, to, dirName]) => pkg(from!, to!, dirName!));
}

interface PkgWithInvariantsOpts {
  readonly invariants?: readonly string[];
  readonly createdAt?: string;
}

function pkgWithInvariants(
  from: string,
  to: string,
  dirName: string,
  opts: PkgWithInvariantsOpts = {},
): OnDiskMigrationPackage {
  const uniqueCreatedAt = opts.createdAt ?? `2026-02-25T14:00:00.000Z-${migrationCounter++}`;
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

function pkgSelfEdge(
  hash: string,
  dirName: string,
  opts: { readonly invariants?: readonly string[] } = {},
): OnDiskMigrationPackage {
  const uniqueCreatedAt = `2026-02-25T14:00:00.000Z-${migrationCounter++}`;
  const ops = [
    {
      id: 'data_migration.self-edge',
      label: 'Self-edge data migration',
      operationClass: 'data' as const,
    },
  ];
  const metadata = createTestMetadata({
    from: hash,
    to: hash,
    createdAt: uniqueCreatedAt,
    providedInvariants: opts.invariants ?? [],
  });
  const migrationHash = computeMigrationHash(metadata, ops);
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    metadata: { ...metadata, migrationHash },
    ops,
  };
}

const E = EMPTY_CONTRACT_HASH;

describe('reconstructGraph', () => {
  it('builds graph from single migration', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    expect(graph.nodes.size).toBe(2);
    expect(graph.nodes.has(E)).toBe(true);
    expect(graph.nodes.has('H1')).toBe(true);
    expect(graph.forwardChain.get(E)).toHaveLength(1);
    expect(graph.reverseChain.get('H1')).toHaveLength(1);
  });

  it('builds graph from empty packages', () => {
    const graph = reconstructGraph([]);
    expect(graph.nodes.size).toBe(0);
    expect(graph.forwardChain.size).toBe(0);
  });

  it('builds graph from linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    expect(graph.nodes.size).toBe(4);
    expect(graph.forwardChain.get(E)).toHaveLength(1);
    expect(graph.forwardChain.get('H1')).toHaveLength(1);
    expect(graph.forwardChain.get('H2')).toHaveLength(1);
  });

  it('indexes migrations by their hash', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(graph.migrationByHash.size).toBe(2);
  });

  it('propagates manifest providedInvariants onto MigrationEdge.invariants', () => {
    const ops = createTestOps();
    const metadata = createTestMetadata(
      { from: E, to: 'H1', providedInvariants: ['phone-backfill', 'email-verified'] },
      ops,
    );
    const migrationHash = computeMigrationHash(metadata, ops);
    const packages: OnDiskMigrationPackage[] = [
      {
        dirName: 'm1',
        dirPath: '/migrations/m1',
        metadata: { ...metadata, migrationHash },
        ops,
      },
    ];
    const graph = reconstructGraph(packages);
    const edge = graph.migrationByHash.get(migrationHash);
    expect(edge?.invariants).toEqual(['phone-backfill', 'email-verified']);
  });

  it('defaults MigrationEdge.invariants to an empty array when manifest declares none', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const [edge] = [...graph.migrationByHash.values()];
    expect(edge?.invariants).toEqual([]);
  });

  it('includes a no-data-ops self-edge in the graph (sameSourceAndTarget is a violation, not a fatal)', () => {
    const graph = reconstructGraph([pkg('H1', 'H1', 'm1')]);
    expect(graph.nodes.size).toBe(1);
    expect(graph.nodes.has('H1')).toBe(true);
    expect(graph.forwardChain.get('H1')).toHaveLength(1);
    expect(graph.reverseChain.get('H1')).toHaveLength(1);
    const [edge] = [...graph.migrationByHash.values()];
    expect(edge?.from).toBe('H1');
    expect(edge?.to).toBe('H1');
  });

  it('accepts a self-edge that declares at least one data op', () => {
    const graph = reconstructGraph([pkgSelfEdge('H1', 'm1', { invariants: ['X'] })]);
    expect(graph.nodes.size).toBe(1);
    expect(graph.nodes.has('H1')).toBe(true);
    expect(graph.forwardChain.get('H1')).toHaveLength(1);
    expect(graph.reverseChain.get('H1')).toHaveLength(1);
    const [edge] = [...graph.migrationByHash.values()];
    expect(edge?.from).toBe('H1');
    expect(edge?.to).toBe('H1');
    expect(edge?.invariants).toEqual(['X']);
  });

  it('does not throw on duplicate migrationHash values (first edge wins in migrationByHash)', () => {
    const first = pkg(E, 'H1', 'm1');
    const secondBase = pkg('H1', 'H2', 'm2');
    const second = {
      ...secondBase,
      metadata: {
        ...secondBase.metadata,
        migrationHash: first.metadata.migrationHash,
      },
    };

    const graph = reconstructGraph([first, second]);
    expect(graph.migrationByHash.get(first.metadata.migrationHash)?.dirName).toBe('m1');
    expect(graph.migrationByHash.size).toBe(1);
  });
});

describe('findPath', () => {
  it('finds path in linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, E, 'H3');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m1', 'm2', 'm3']);
  });

  it('returns null when no path exists', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, E, 'H99');
    expect(path).toBeNull();
  });

  it('returns empty array when from === to', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H1', 'H1');
    expect(path).toEqual([]);
  });

  it('returns empty array even when a self-edge exists (the empty path is structurally shortest)', () => {
    const packages = [pkg(E, 'H1', 'm0'), pkgSelfEdge('H1', 'm_self')];
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H1', 'H1');
    expect(path).toEqual([]);
  });

  it('finds shortest path when multiple paths exist', () => {
    const packages = [
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
      pkg('H1', 'H3', 'm_shortcut'),
    ];
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H1', 'H3');
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(1);
    expect(path![0]!.dirName).toBe('m_shortcut');
  });

  it('finds sub-path in middle of chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2'], ['H2', 'H3', 'm3']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H1', 'H3');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m2', 'm3']);
  });

  it('finds path when fromHash equals non-empty chain root', () => {
    const packages = chain(['H0', 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const path = findPath(graph, 'H0', 'H2');
    expect(path).not.toBeNull();
    expect(path!.map((e) => e.dirName)).toEqual(['m1', 'm2']);
  });

  it('uses deterministic tie-breaking (createdAt ascending)', () => {
    const early = pkg('H1', 'H2', 'm_early', '2026-01-01T00:00:00.000Z');
    const late = pkg('H1', 'H2', 'm_late', '2026-12-01T00:00:00.000Z');
    const graph = reconstructGraph([pkg(E, 'H1', 'm0'), early, late]);
    const path = findPath(graph, 'H1', 'H2');
    expect(path).not.toBeNull();
    expect(path!).toHaveLength(1);
    expect(path![0]!.dirName).toBe('m_early');
  });
});

describe('detectCycles', () => {
  it('reports no cycles in linear chain', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(detectCycles(graph)).toEqual([]);
  });

  it('detects cycle in node graph', () => {
    const packages: OnDiskMigrationPackage[] = [
      pkg('A', 'B', 'm1'),
      pkg('B', 'C', 'm2'),
      pkg('C', 'A', 'm3'),
    ];
    const graph = reconstructGraph(packages);
    const cycles = detectCycles(graph);
    expect(cycles.length).toBeGreaterThan(0);
  });

  it('handles deep linear chain without stack overflow', () => {
    const length = 20_000;
    const nodes = new Set<string>();
    const forwardChain = new Map<string, MigrationEdge[]>();
    const reverseChain = new Map<string, MigrationEdge[]>();
    const migrationByHash = new Map<string, MigrationEdge>();
    let prev: string = E;
    for (let i = 0; i < length; i++) {
      const next = `h:${i}`;
      nodes.add(prev);
      nodes.add(next);
      const entry: MigrationEdge = {
        from: prev,
        to: next,
        migrationHash: `mid:${i}`,
        dirName: `m${i}`,
        createdAt: new Date(i * 1000).toISOString(),
        invariants: [],
      };
      const fwd = forwardChain.get(prev);
      if (fwd) fwd.push(entry);
      else forwardChain.set(prev, [entry]);
      const rev = reverseChain.get(next);
      if (rev) rev.push(entry);
      else reverseChain.set(next, [entry]);
      migrationByHash.set(entry.migrationHash, entry);
      prev = next;
    }
    const graph = { nodes, forwardChain, reverseChain, migrationByHash };
    expect(() => detectCycles(graph)).not.toThrow();
    expect(detectCycles(graph)).toEqual([]);
  });
});

describe('detectOrphans', () => {
  it('reports no orphans when all reachable', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(detectOrphans(graph)).toEqual([]);
  });

  it('detects orphan migration', () => {
    const p1 = chain([E, 'H1', 'm1']);
    const orphan = pkg('D', 'E2', 'm_orphan');
    const graph = reconstructGraph([...p1, orphan]);
    const orphans = detectOrphans(graph);
    expect(orphans).toHaveLength(1);
    expect(orphans[0]!.dirName).toBe('m_orphan');
  });

  it('reports no orphans for empty graph', () => {
    const graph = reconstructGraph([]);
    expect(detectOrphans(graph)).toEqual([]);
  });

  it('reports no orphans when root chain starts from non-empty hash', () => {
    const packages = chain(['H0', 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    expect(detectOrphans(graph)).toEqual([]);
  });
});

describe('findPathWithDecision', () => {
  it('returns no-op decision when from === to', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H1');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath).toEqual([]);
    expect(result.decision.fromHash).toBe('H1');
    expect(result.decision.toHash).toBe('H1');
    expect(result.decision.alternativeCount).toBe(0);
    expect(result.decision.tieBreakReasons).toEqual([]);
  });

  it('returns unreachable when no structural path exists', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    expect(findPathWithDecision(graph, 'H1', 'H99')).toEqual({ kind: 'unreachable' });
  });

  it('includes ref metadata when provided', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H2', { refName: 'production' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.refName).toBe('production');
  });

  it('omits ref metadata when not provided', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H2');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.refName).toBeUndefined();
  });

  it('reports alternative count for converging paths', () => {
    const packages = [
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3'),
      pkg('H1', 'H3', 'm_shortcut'),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H3');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath).toHaveLength(1);
    expect(result.decision.alternativeCount).toBeGreaterThan(0);
  });

  it('omits tieBreakReasons when invariant routing leaves only one locally viable candidate', () => {
    const packages = [
      pkg(E, 'A', 'm0'),
      pkgWithInvariants('A', 'B', 'm_ab'),
      pkgWithInvariants('A', 'C', 'm_ac', { invariants: ['X'] }),
      pkgWithInvariants('B', 'H', 'm_bh'),
      pkgWithInvariants('C', 'H', 'm_ch'),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'A', 'H', { required: new Set(['X']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath.map((e) => e.dirName)).toEqual(['m_ac', 'm_ch']);
    expect(result.decision.tieBreakReasons).toEqual([]);
    expect(result.decision.alternativeCount).toBeGreaterThan(0);
  });

  it('omits tieBreakReason when the chosen edge sorts first but is the sole invariant-viable fork', () => {
    const early = '2026-02-26T09:59:58.001Z-fixture-ac';
    const late = '2026-02-26T09:59:58.003Z-fixture-ab';
    const packages = [
      pkg(E, 'A', 'm0'),
      pkgWithInvariants('A', 'B', 'm_ab', { createdAt: late }),
      pkgWithInvariants('A', 'C', 'm_ac', { invariants: ['X'], createdAt: early }),
      pkgWithInvariants('B', 'H', 'm_bh'),
      pkgWithInvariants('C', 'H', 'm_ch'),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'A', 'H', { required: new Set(['X']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath.map((e) => e.dirName)).toEqual(['m_ac', 'm_ch']);
    expect(result.decision.tieBreakReasons).toEqual([]);
    expect(result.decision.alternativeCount).toBeGreaterThan(0);
  });

  it('omits a tieBreakReason when the chosen edge is not the lexicographic winner (invariants forced the choice)', () => {
    // Diamond: A → B → D and A → C → D, where C → D provides "X".
    // With X required, the chosen edge at A is the one routed toward C
    // (the non-first sorted candidate). The tie-break is *not* what made
    // the decision — the invariant did — so tieBreakReasons must remain
    // empty. alternativeCount still reports the converging-paths count.
    const packages = [
      pkgWithInvariants(E, 'A', 'm0'),
      pkgWithInvariants('A', 'B', 'm_left'),
      pkgWithInvariants('A', 'C', 'm_right'),
      pkgWithInvariants('B', 'D', 'm_left2'),
      pkgWithInvariants('C', 'D', 'm_right2', { invariants: ['X'] }),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'A', 'D', { required: new Set(['X']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath.map((e) => e.dirName)).toEqual(['m_right', 'm_right2']);
    expect(result.decision.tieBreakReasons).toEqual([]);
    expect(result.decision.alternativeCount).toBeGreaterThan(0);
  });

  it('does not count dead-end outgoing edges as alternatives', () => {
    // At H1 there are two outgoing edges: one reaches H3 (shortcut), one
    // leads to a dead-end (H_dead) that never converges back. The dead-end
    // edge must not be counted as an alternative.
    const packages = [
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H3', 'm_shortcut'),
      pkg('H1', 'H_dead', 'm_deadend'),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H3');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.alternativeCount).toBe(0);
  });

  it('output shape matches expected keys', () => {
    const packages = chain([E, 'H1', 'm1'], ['H1', 'H2', 'm2']);
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, E, 'H2', { refName: 'staging' });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Object.keys(result.decision).sort()).toMatchInlineSnapshot(`
      [
        "alternativeCount",
        "fromHash",
        "refName",
        "requiredInvariants",
        "satisfiedInvariants",
        "selectedPath",
        "tieBreakReasons",
        "toHash",
      ]
    `);
  });

  it('output shape without ref matches expected keys', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, E, 'H1');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(Object.keys(result.decision).sort()).toMatchInlineSnapshot(`
      [
        "alternativeCount",
        "fromHash",
        "requiredInvariants",
        "satisfiedInvariants",
        "selectedPath",
        "tieBreakReasons",
        "toHash",
      ]
    `);
  });

  it('requiredInvariants and satisfiedInvariants default to empty arrays when no required set is passed', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, E, 'H1');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.requiredInvariants).toEqual([]);
    expect(result.decision.satisfiedInvariants).toEqual([]);
  });

  it('requiredInvariants reflects the caller-supplied set, sorted', () => {
    const packages = [pkgWithInvariants(E, 'H1', 'm1', { invariants: ['Y', 'X'] })];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, E, 'H1', { required: new Set(['Y', 'X']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.requiredInvariants).toEqual(['X', 'Y']);
  });

  it('satisfiedInvariants equals requiredInvariants on an ok outcome (every required id is covered by selectedPath)', () => {
    const packages = [
      pkgWithInvariants(E, 'A', 'm1', { invariants: ['X'] }),
      pkgWithInvariants('A', 'B', 'm2', { invariants: ['Y'] }),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, E, 'B', { required: new Set(['X', 'Y']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.satisfiedInvariants).toEqual(['X', 'Y']);
    expect(result.decision.requiredInvariants).toEqual(['X', 'Y']);
  });

  it('satisfiedInvariants ignores edge invariants not in the required set (intersection semantics)', () => {
    const packages = [
      pkgWithInvariants(E, 'A', 'm1', { invariants: ['X', 'noise'] }),
      pkgWithInvariants('A', 'B', 'm2'),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, E, 'B', { required: new Set(['X']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.satisfiedInvariants).toEqual(['X']);
  });

  it('routes through edges that cover the required invariant when an alternative does not', () => {
    // Diamond: A → B → D (no invariants) and A → C → D (C→D provides X).
    // With X required, the C→D path must be chosen.
    const packages = [
      pkgWithInvariants(E, 'A', 'm0'),
      pkgWithInvariants('A', 'B', 'm_left'),
      pkgWithInvariants('A', 'C', 'm_right'),
      pkgWithInvariants('B', 'D', 'm_left_close'),
      pkgWithInvariants('C', 'D', 'm_right_close', { invariants: ['X'] }),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'A', 'D', { required: new Set(['X']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath.map((e) => e.dirName)).toEqual([
      'm_right',
      'm_right_close',
    ]);
    expect(result.decision.satisfiedInvariants).toEqual(['X']);
  });

  it('returns unsatisfiable with structuralPath when required cannot be covered on any reachable path', () => {
    // X is declared on an edge that is not on any path from H1 to H3.
    const packages = [
      pkgWithInvariants(E, 'H1', 'm1'),
      pkgWithInvariants('H1', 'H3', 'm_shortcut'),
      pkgWithInvariants('H1', 'H_off', 'm_offpath', { invariants: ['X'] }),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H3', { required: new Set(['X']) });
    expect(result.kind).toBe('unsatisfiable');
    if (result.kind !== 'unsatisfiable') return;
    expect(result.structuralPath.map((e) => e.dirName)).toEqual(['m_shortcut']);
    expect(result.missing).toEqual(['X']);
  });

  it('unsatisfiable.missing accounts for partial coverage on the structural path', () => {
    // Required {X, Y}. Structural path provides X via m1 but no edge on the
    // path to H3 covers Y. missing should be ['Y'], not ['X', 'Y'].
    const packages = [
      pkgWithInvariants(E, 'H1', 'm1', { invariants: ['X'] }),
      pkgWithInvariants('H1', 'H3', 'm_shortcut'),
      pkgWithInvariants('H1', 'H_off', 'm_offpath', { invariants: ['Y'] }),
    ];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, E, 'H3', { required: new Set(['X', 'Y']) });
    expect(result.kind).toBe('unsatisfiable');
    if (result.kind !== 'unsatisfiable') return;
    expect(result.missing).toEqual(['Y']);
  });

  it('returns unreachable when from → to is structurally unreachable, regardless of required', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    expect(findPathWithDecision(graph, 'H1', 'H99', { required: new Set(['X']) })).toEqual({
      kind: 'unreachable',
    });
  });

  it('returns unsatisfiable on a no-op transition (from === to) when no self-edge covers required', () => {
    const packages = chain([E, 'H1', 'm1']);
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H1', { required: new Set(['X']) });
    expect(result.kind).toBe('unsatisfiable');
    if (result.kind !== 'unsatisfiable') return;
    expect(result.structuralPath).toEqual([]);
  });

  it('preserves existing routing outcome when required is empty', () => {
    const packages = [pkgWithInvariants(E, 'H1', 'm1'), pkgWithInvariants('H1', 'H2', 'm2')];
    const graph = reconstructGraph(packages);
    const withEmpty = findPathWithDecision(graph, E, 'H2', { required: new Set() });
    const withoutRequired = findPathWithDecision(graph, E, 'H2');
    expect(withEmpty.kind).toBe('ok');
    expect(withoutRequired.kind).toBe('ok');
    if (withEmpty.kind !== 'ok' || withoutRequired.kind !== 'ok') return;
    expect(withEmpty.decision.selectedPath.map((e) => e.dirName)).toEqual(
      withoutRequired.decision.selectedPath.map((e) => e.dirName),
    );
  });

  it('selects a self-edge that covers the required invariant when from === to', () => {
    const packages = [pkg(E, 'H1', 'm0'), pkgSelfEdge('H1', 'm_self', { invariants: ['X'] })];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H1', { required: new Set(['X']) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath.map((e) => e.dirName)).toEqual(['m_self']);
    expect(result.decision.satisfiedInvariants).toEqual(['X']);
  });

  it('returns ok with empty path when from === to and required is empty even if a self-edge exists', () => {
    const packages = [pkg(E, 'H1', 'm0'), pkgSelfEdge('H1', 'm_self', { invariants: ['X'] })];
    const graph = reconstructGraph(packages);
    const result = findPathWithDecision(graph, 'H1', 'H1');
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.decision.selectedPath).toEqual([]);
  });
});
