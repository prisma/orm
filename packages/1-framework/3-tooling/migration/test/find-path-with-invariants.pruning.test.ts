import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { EMPTY_CONTRACT_HASH } from '../src/constants';
import type { MigrationEdge } from '../src/graph';
import { computeMigrationHash } from '../src/hash';
import { findPathWithInvariants, reconstructGraph } from '../src/migration-graph';
import type { OnDiskMigrationPackage } from '../src/package';
import { createTestMetadata, createTestOps } from './fixtures';

let migrationCounter = 0;

function pkg(
  from: string,
  to: string,
  dirName: string,
  invariants: readonly string[] = [],
): OnDiskMigrationPackage {
  const metadata = createTestMetadata({
    from,
    to,
    createdAt: `2026-02-25T14:00:00.000Z-${String(migrationCounter++).padStart(4, '0')}`,
    providedInvariants: invariants,
  });
  const ops = createTestOps();
  return {
    dirName,
    dirPath: `/migrations/${dirName}`,
    metadata: { ...metadata, migrationHash: computeMigrationHash(metadata, ops) },
    ops,
  };
}

const E = EMPTY_CONTRACT_HASH;

const dirNames = (path: readonly MigrationEdge[] | null): readonly string[] | null =>
  path === null ? null : path.map((e) => e.dirName);

describe('findPathWithInvariants — states that can no longer cover a required invariant', () => {
  it(
    'plans a fresh database through 40 same-hash migrations that each provide an invariant',
    () => {
      const k = 40;
      const packages: OnDiskMigrationPackage[] = [];
      for (let i = 0; i < k; i++) {
        packages.push(
          pkg(i === 0 ? E : `H${i}`, `H${i + 1}`, `m_step_${i}`),
          pkg(`H${i + 1}`, `H${i + 1}`, `m_self_${i}`, [`inv-${i}`]),
        );
      }
      const graph = reconstructGraph(packages);
      const required = new Set(Array.from({ length: k }, (_, i) => `inv-${i}`));
      expect(dirNames(findPathWithInvariants(graph, E, `H${k}`, required))).toEqual(
        Array.from({ length: k }, (_, i) => [`m_step_${i}`, `m_self_${i}`]).flat(),
      );
    },
    timeouts.vitestPackageDefault,
  );

  it(
    'plans a fresh database through 40 data-only migrations on one contract that each provide an invariant',
    () => {
      const k = 40;
      const selfLoops = Array.from({ length: k }, (_, i) =>
        pkg('H', 'H', `m_self_${i}`, [`inv-${i}`]),
      );
      const graph = reconstructGraph([pkg(E, 'H', 'm_init'), ...selfLoops]);
      const required = new Set(Array.from({ length: k }, (_, i) => `inv-${i}`));
      expect(dirNames(findPathWithInvariants(graph, E, 'H', required))).toEqual([
        'm_init',
        ...selfLoops.map((p) => p.dirName),
      ]);
    },
    timeouts.vitestPackageDefault,
  );

  it('skips a same-hash provider when a later migration on the route provides the invariant', () => {
    const graph = reconstructGraph([
      pkg(E, 'H1', 'm1'),
      pkg('H1', 'H1', 'm_self', ['X']),
      pkg('H1', 'H2', 'm2'),
      pkg('H2', 'H3', 'm3', ['X']),
    ]);
    expect(dirNames(findPathWithInvariants(graph, E, 'H3', new Set(['X'])))).toEqual([
      'm1',
      'm2',
      'm3',
    ]);
  });

  it('ignores a provider on a branch that cannot reach the target', () => {
    const graph = reconstructGraph([
      pkg(E, 'A', 'm0'),
      pkg('A', 'DEAD', 'm_dead_end', ['X']),
      pkg('A', 'B', 'm1'),
      pkg('B', 'C', 'm2', ['X']),
    ]);
    expect(dirNames(findPathWithInvariants(graph, E, 'C', new Set(['X'])))).toEqual([
      'm0',
      'm1',
      'm2',
    ]);
  });

  it('returns null when the only provider is on a branch that cannot reach the target', () => {
    const graph = reconstructGraph([
      pkg(E, 'A', 'm0'),
      pkg('A', 'DEAD', 'm_dead_end', ['X']),
      pkg('A', 'B', 'm1'),
    ]);
    expect(findPathWithInvariants(graph, E, 'B', new Set(['X']))).toBeNull();
  });

  it('keeps a state whose missing invariant is provided on a cycle back to an earlier node', () => {
    const graph = reconstructGraph([
      pkg(E, 'A', 'm0'),
      pkg('A', 'B', 'm1'),
      pkg('B', 'A', 'm_back', ['X']),
      pkg('B', 'C', 'm2'),
    ]);
    expect(dirNames(findPathWithInvariants(graph, E, 'C', new Set(['X'])))).toEqual([
      'm0',
      'm1',
      'm_back',
      'm1',
      'm2',
    ]);
  });
});
