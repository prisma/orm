import { describe, expect, it } from 'vitest';
import type { MigrationEdge, MigrationGraph } from '../src/graph';
import { bfs } from '../src/graph-ops';
import { findPathWithInvariants } from '../src/migration-graph';

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function graphOf(edges: readonly MigrationEdge[]): MigrationGraph {
  const nodes = new Set<string>();
  const forwardChain = new Map<string, MigrationEdge[]>();
  const reverseChain = new Map<string, MigrationEdge[]>();
  const migrationByHash = new Map<string, MigrationEdge>();
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
    forwardChain.set(edge.from, [...(forwardChain.get(edge.from) ?? []), edge]);
    reverseChain.set(edge.to, [...(reverseChain.get(edge.to) ?? []), edge]);
    migrationByHash.set(edge.migrationHash, edge);
  }
  return { nodes, forwardChain, reverseChain, migrationByHash };
}

function unprunedSearch(
  graph: MigrationGraph,
  fromHash: string,
  toHash: string,
  required: ReadonlySet<string>,
): readonly MigrationEdge[] | null {
  interface State {
    readonly node: string;
    readonly covered: ReadonlySet<string>;
  }
  const key = (s: State) => JSON.stringify([s.node, [...s.covered].sort()]);
  const tieBreak = (a: MigrationEdge, b: MigrationEdge) =>
    a.createdAt.localeCompare(b.createdAt) ||
    a.to.localeCompare(b.to) ||
    a.migrationHash.localeCompare(b.migrationHash);
  const neighbours = (s: State) =>
    (graph.forwardChain.get(s.node) ?? [])
      .map((edge) => {
        const gained = edge.invariants.filter((inv) => required.has(inv) && !s.covered.has(inv));
        return { edge, useful: gained.length > 0, covered: new Set([...s.covered, ...gained]) };
      })
      .sort((a, b) => Number(b.useful) - Number(a.useful) || tieBreak(a.edge, b.edge))
      .map(({ edge, covered }) => ({ next: { node: edge.to, covered }, edge }));

  const parents = new Map<string, { parentKey: string; edge: MigrationEdge }>();
  for (const step of bfs<State, MigrationEdge>(
    [{ node: fromHash, covered: new Set() }],
    neighbours,
    key,
  )) {
    const stepKey = key(step.state);
    if (step.parent !== null && step.incomingEdge !== null) {
      parents.set(stepKey, { parentKey: key(step.parent), edge: step.incomingEdge });
    }
    if (step.state.node === toHash && step.state.covered.size === required.size) {
      const path: MigrationEdge[] = [];
      for (let p = parents.get(stepKey); p; p = parents.get(p.parentKey)) path.push(p.edge);
      return path.reverse();
    }
  }
  return null;
}

describe('findPathWithInvariants — agrees with an unpruned search', () => {
  it('returns the same path on random small graphs with cycles, runs of same-hash migrations and shared providers', () => {
    const invariantPool = ['a', 'b', 'c', 'd'];
    let satisfiable = 0;
    let severalSameHashOnPath = 0;
    for (let seed = 1; seed <= 3000; seed++) {
      const random = seededRandom(seed);
      const pick = <T>(xs: readonly T[]): T | undefined => xs[Math.floor(random() * xs.length)];
      const nodeNames = Array.from({ length: 2 + Math.floor(random() * 5) }, (_, i) => `N${i}`);
      const node = () => pick(nodeNames) ?? 'N0';
      const edges: MigrationEdge[] = [];
      const addEdge = (from: string, to: string) =>
        edges.push({
          from,
          to,
          migrationHash: `h${edges.length}`,
          dirName: `m${edges.length}`,
          createdAt: `2026-01-01T00:00:0${Math.floor(random() * 3)}Z`,
          invariants: invariantPool.filter(() => random() < 0.2),
        });
      for (let i = 0; i + 1 < nodeNames.length; i++) {
        if (random() < 0.6) addEdge(`N${i}`, `N${i + 1}`);
      }
      for (let i = Math.floor(random() * 10); i > 0; i--) {
        const from = node();
        addEdge(from, random() < 0.25 ? from : node());
      }
      for (let i = 1 + Math.floor(random() * 2); i > 0; i--) {
        const contract = node();
        for (let j = 2 + Math.floor(random() * 4); j > 0; j--) addEdge(contract, contract);
      }
      const graph = graphOf(edges);
      const required = new Set(invariantPool.filter(() => random() < 0.4));
      if (required.size === 0) required.add('a');
      const fromHash = random() < 0.6 ? 'N0' : node();
      const toHash = random() < 0.6 ? (nodeNames.at(-1) ?? 'N0') : node();

      const expected = unprunedSearch(graph, fromHash, toHash, required);
      if (expected !== null) satisfiable++;
      if (
        expected?.some(
          (e, i) =>
            e.from === e.to &&
            expected[i + 1]?.from === expected[i + 1]?.to &&
            expected[i + 1]?.from === e.to,
        )
      ) {
        severalSameHashOnPath++;
      }
      expect({ seed, path: findPathWithInvariants(graph, fromHash, toHash, required) }).toEqual({
        seed,
        path: expected,
      });
    }
    expect({ satisfiable, severalSameHashOnPath }).toEqual({
      satisfiable: expect.any(Number),
      severalSameHashOnPath: expect.any(Number),
    });
    console.log({ satisfiable, severalSameHashOnPath });
  });
});
