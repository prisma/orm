import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import {
  hasMigrationPath,
  migrationsLeadToTarget,
} from '../../src/control-api/operations/graph-queries';
import { buildGraph, entry } from '../utils/graph-helpers';

const HASH_A = `${'a'.repeat(64)}`;
const HASH_B = `${'b'.repeat(64)}`;

const graph = buildGraph([entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'), entry(HASH_A, HASH_B, 'm2')]);

describe('hasMigrationPath', () => {
  it('reports true when the graph contains a forward path', () => {
    expect(hasMigrationPath(graph, HASH_A, HASH_B)).toBe(true);
  });

  it('reports false when no path exists', () => {
    expect(hasMigrationPath(graph, HASH_B, HASH_A)).toBe(false);
  });
});

describe('migrationsLeadToTarget', () => {
  const marker = (storageHash: string, invariants: readonly string[] = []) => ({
    storageHash,
    invariants,
  });
  const withInvariant = buildGraph([
    entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'),
    { ...entry(HASH_A, HASH_B, 'm2'), invariants: ['backfill-email'] },
  ]);

  it('is true when a migration path leads from the marker to the target', () => {
    expect(migrationsLeadToTarget(graph, marker(HASH_A), { hash: HASH_B, invariants: [] })).toBe(
      true,
    );
  });

  it('starts a database with no marker at the empty contract', () => {
    expect(migrationsLeadToTarget(graph, undefined, { hash: HASH_B, invariants: [] })).toBe(true);
  });

  it('is false when the database is already at the target, where db migrate does nothing', () => {
    expect(migrationsLeadToTarget(graph, marker(HASH_B), { hash: HASH_B, invariants: [] })).toBe(
      false,
    );
  });

  it('is true when the database is at the target and a migration that keeps the contract provides an invariant it lacks', () => {
    const seeds = buildGraph([
      entry(EMPTY_CONTRACT_HASH, HASH_B, 'm1'),
      { ...entry(HASH_B, HASH_B, 'm2'), invariants: ['seeded'] },
    ]);
    expect(
      migrationsLeadToTarget(seeds, marker(HASH_B), { hash: HASH_B, invariants: ['seeded'] }),
    ).toBe(true);
  });

  it('is false when no path provides an invariant the target requires', () => {
    expect(
      migrationsLeadToTarget(graph, marker(HASH_A), {
        hash: HASH_B,
        invariants: ['backfill-email'],
      }),
    ).toBe(false);
  });

  it('counts an invariant a migration on the path provides, or the marker already records', () => {
    const target = { hash: HASH_B, invariants: ['backfill-email', 'seeded'] };
    expect(migrationsLeadToTarget(withInvariant, marker(HASH_A, ['seeded']), target)).toBe(true);
    expect(migrationsLeadToTarget(withInvariant, marker(HASH_A), target)).toBe(false);
  });
});
