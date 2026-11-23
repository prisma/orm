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
    expect(migrationsToTarget({ graph }, marker(HASH_A), { hash: HASH_B, invariants: [] })).toEqual(
      { kind: 'on-disk' },
    );
  });

  it('starts a database with no marker at the empty contract, and says it has none', () => {
    expect(
      [undefined, null].map((none) =>
        migrationsToTarget({ graph }, none, { hash: HASH_B, invariants: [] }),
      ),
    ).toEqual([
      { kind: 'on-disk', unmarked: true },
      { kind: 'on-disk', unmarked: true },
    ]);
  });

  it('needs none when the database is already at the target, where db migrate does nothing', () => {
    expect(migrationsToTarget({ graph }, marker(HASH_B), { hash: HASH_B, invariants: [] })).toEqual(
      { kind: 'none-needed' },
    );
  });

  it('is on-disk when the database is at the target and a migration that keeps the contract provides an invariant it lacks', () => {
    const seeds = buildGraph([
      entry(EMPTY_CONTRACT_HASH, HASH_B, 'm1'),
      { ...entry(HASH_B, HASH_B, 'm2'), invariants: ['seeded'] },
    ]);
    expect(
      migrationsToTarget({ graph: seeds }, marker(HASH_B), {
        hash: HASH_B,
        invariants: ['seeded'],
      }),
    ).toEqual({ kind: 'on-disk' });
  });

  it('names the invariants no migration provides when the database is at the target', () => {
    expect(
      migrationsToTarget({ graph }, marker(HASH_B), {
        hash: HASH_B,
        invariants: ['seeded', 'indexed'],
      }),
    ).toMatchObject({
      kind: 'at-target-missing-invariants',
      missingInvariants: ['indexed', 'seeded'],
    });
  });

  it('names the --from of migration new when a migration ends at the target, and says to emit the target first unless it is the emitted contract', () => {
    const target = { hash: HASH_B, invariants: ['seeded'] };
    expect(
      [HASH_B, HASH_A, undefined].map((emittedHash) =>
        migrationsToTarget(
          { graph, ...(emittedHash === undefined ? {} : { emittedHash }) },
          marker(HASH_B),
          target,
        ),
      ),
    ).toEqual([
      {
        kind: 'at-target-missing-invariants',
        missingInvariants: ['seeded'],
        newMigration: { from: HASH_B, emitFirst: false },
      },
      {
        kind: 'at-target-missing-invariants',
        missingInvariants: ['seeded'],
        newMigration: { from: HASH_B, emitFirst: true },
      },
      {
        kind: 'at-target-missing-invariants',
        missingInvariants: ['seeded'],
        newMigration: { from: HASH_B, emitFirst: true },
      },
    ]);
  });

  it('is not on disk when no path from elsewhere provides an invariant the target requires', () => {
    expect(
      migrationsToTarget({ graph }, marker(HASH_A), {
        hash: HASH_B,
        invariants: ['backfill-email'],
      }),
    ).toEqual({ kind: 'plan-needed', missingInvariants: ['backfill-email'] });
  });

  it('counts an invariant a migration on the path provides, or the marker already records', () => {
    const target = { hash: HASH_B, invariants: ['backfill-email', 'seeded'] };
    expect(
      migrationsToTarget({ graph: withInvariant }, marker(HASH_A, ['seeded']), target),
    ).toEqual({ kind: 'on-disk' });
    expect(migrationsToTarget({ graph: withInvariant }, marker(HASH_A), target)).toEqual({
      kind: 'plan-needed',
      missingInvariants: ['backfill-email', 'seeded'],
    });
  });
});
