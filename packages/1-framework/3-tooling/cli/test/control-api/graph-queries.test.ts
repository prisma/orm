import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import {
  databasePlanFrom,
  hasMigrationPath,
  planOriginArgument,
  UNKNOWN_PLAN_ORIGIN,
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

describe('planOriginArgument', () => {
  const HASH_C = `${'c'.repeat(64)}`;

  it('plans from the contract the database is at', () => {
    expect(planOriginArgument(graph, HASH_A)).toBe(HASH_A);
  });

  it('plans an empty database from where its history ends', () => {
    expect(planOriginArgument(graph, EMPTY_CONTRACT_HASH)).toBe(HASH_B);
  });

  it('leaves --from out when the space has no migrations', () => {
    expect(planOriginArgument(buildGraph([]), EMPTY_CONTRACT_HASH)).toBeUndefined();
  });

  it('asks for the contract when an empty database reaches two ends of the history', () => {
    const forked = buildGraph([
      entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'),
      entry(HASH_A, HASH_B, 'm2'),
      entry(HASH_A, HASH_C, 'm3'),
    ]);
    expect(planOriginArgument(forked, EMPTY_CONTRACT_HASH)).toBe(UNKNOWN_PLAN_ORIGIN);
  });

  it('asks for the contract when the history an empty database reaches has no end', () => {
    const cycle = buildGraph([
      entry(EMPTY_CONTRACT_HASH, HASH_A, 'm1'),
      entry(HASH_A, HASH_B, 'm2'),
      entry(HASH_B, HASH_A, 'm3'),
    ]);
    expect(planOriginArgument(cycle, EMPTY_CONTRACT_HASH)).toBe(UNKNOWN_PLAN_ORIGIN);
  });

  it('plans from the empty database when no migration starts from it', () => {
    const baselined = buildGraph([entry(HASH_A, HASH_B, 'm1')]);
    expect(planOriginArgument(baselined, EMPTY_CONTRACT_HASH)).toBe('@empty');
  });
});

describe('databasePlanFrom', () => {
  const OFF_GRAPH = `${'d'.repeat(64)}`;
  const ref = (hash: string) => ({ hash, invariants: [] });

  it('plans from the contract the database is at when a migration records it', () => {
    expect(databasePlanFrom({ graph, refs: {}, markerHash: HASH_A })).toBe(HASH_A);
  });

  it('plans a database with no marker from where the history ends', () => {
    expect(databasePlanFrom({ graph, refs: {}, markerHash: undefined })).toBe(HASH_B);
  });

  it('plans a database with no marker from the empty contract when there are no migrations', () => {
    expect(databasePlanFrom({ graph: buildGraph([]), refs: {}, markerHash: undefined })).toBe(
      '@empty',
    );
  });

  it('plans from the ref that names the database contract while there are no migrations', () => {
    expect(
      databasePlanFrom({
        graph: buildGraph([]),
        refs: { db: ref(OFF_GRAPH), staging: ref(OFF_GRAPH) },
        markerHash: OFF_GRAPH,
      }),
    ).toBe('db');
  });

  it('cannot plan when nothing records the contract the database is at', () => {
    expect([
      databasePlanFrom({ graph: buildGraph([]), refs: {}, markerHash: OFF_GRAPH }),
      databasePlanFrom({ graph, refs: { db: ref(OFF_GRAPH) }, markerHash: OFF_GRAPH }),
    ]).toEqual([undefined, undefined]);
  });
});
