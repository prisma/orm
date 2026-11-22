import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import {
  hasMigrationPath,
  migrationsToTarget,
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

describe('migrationsToTarget', () => {
  const marker = (storageHash: string, invariants: readonly string[] = []) => ({
    storageHash,
    invariants,
  });
  const withInvariant = buildGraph([
    entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'),
    { ...entry(HASH_A, HASH_B, 'm2'), invariants: ['backfill-email'] },
  ]);

  it('is on-disk when a migration path leads from the marker to the target', () => {
    expect(migrationsToTarget(graph, marker(HASH_A), { hash: HASH_B, invariants: [] })).toBe(
      'on-disk',
    );
  });

  it('starts a database with no marker at the empty contract', () => {
    expect(migrationsToTarget(graph, undefined, { hash: HASH_B, invariants: [] })).toBe('on-disk');
  });

  it('needs none when the database is already at the target, where db migrate does nothing', () => {
    expect(migrationsToTarget(graph, marker(HASH_B), { hash: HASH_B, invariants: [] })).toBe(
      'none-needed',
    );
  });

  it('is on-disk when the database is at the target and a migration that keeps the contract provides an invariant it lacks', () => {
    const seeds = buildGraph([
      entry(EMPTY_CONTRACT_HASH, HASH_B, 'm1'),
      { ...entry(HASH_B, HASH_B, 'm2'), invariants: ['seeded'] },
    ]);
    expect(
      migrationsToTarget(seeds, marker(HASH_B), { hash: HASH_B, invariants: ['seeded'] }),
    ).toBe('on-disk');
  });

  it('reports the invariants missing when the database is at the target and no migration provides one it lacks', () => {
    expect(
      migrationsToTarget(graph, marker(HASH_B), { hash: HASH_B, invariants: ['seeded'] }),
    ).toBe('invariants-missing');
  });

  it('is missing when no path from elsewhere provides an invariant the target requires', () => {
    expect(
      migrationsToTarget(graph, marker(HASH_A), {
        hash: HASH_B,
        invariants: ['backfill-email'],
      }),
    ).toBe('missing');
  });

  it('counts an invariant a migration on the path provides, or the marker already records', () => {
    const target = { hash: HASH_B, invariants: ['backfill-email', 'seeded'] };
    expect(migrationsToTarget(withInvariant, marker(HASH_A, ['seeded']), target)).toBe('on-disk');
    expect(migrationsToTarget(withInvariant, marker(HASH_A), target)).toBe('missing');
  });
});
