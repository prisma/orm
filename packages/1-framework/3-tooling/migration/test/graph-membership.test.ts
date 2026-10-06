import { describe, expect, it } from 'vitest';
import { EMPTY_CONTRACT_HASH } from '../src/constants';
import { MigrationToolsError } from '../src/errors';
import { assertHashIsGraphNode, isGraphNode, isInSpaceHistory } from '../src/graph-membership';
import { computeMigrationHash } from '../src/hash';
import { reconstructGraph } from '../src/migration-graph';
import type { OnDiskMigrationPackage } from '../src/package';
import { createTestMetadata, createTestOps } from './fixtures';

let migrationCounter = 0;

function pkg(from: string, to: string, dirName: string): OnDiskMigrationPackage {
  const uniqueCreatedAt = `2026-02-25T14:00:00.000Z-${migrationCounter++}`;
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
  return specs.map(([from, to, dirName]) => pkg(from, to, dirName));
}

const E = EMPTY_CONTRACT_HASH;

describe('isGraphNode', () => {
  it('returns true for EMPTY_CONTRACT_HASH on an empty graph', () => {
    const graph = reconstructGraph([]);
    expect(isGraphNode(E, graph)).toBe(true);
  });

  it('returns true for EMPTY_CONTRACT_HASH on a non-empty graph', () => {
    const graph = reconstructGraph(chain([E, 'aaa', 'm1']));
    expect(isGraphNode(E, graph)).toBe(true);
  });

  it('returns false for an unknown hash on an empty graph', () => {
    const graph = reconstructGraph([]);
    expect(isGraphNode('unknown', graph)).toBe(false);
  });

  it('returns false for an unknown hash when the graph has other nodes', () => {
    const graph = reconstructGraph(chain([E, 'aaa', 'm1'], ['aaa', 'bbb', 'm2']));
    expect(isGraphNode('missing', graph)).toBe(false);
  });

  it('returns true for a hash that is a node in the graph', () => {
    const graph = reconstructGraph(chain([E, 'aaa', 'm1'], ['aaa', 'bbb', 'm2']));
    expect(isGraphNode('bbb', graph)).toBe(true);
  });
});

describe('isInSpaceHistory', () => {
  it('counts a node of the space graph', () => {
    const graph = reconstructGraph(chain([E, 'aaa', 'm1']));
    expect(isInSpaceHistory('aaa', { graph, headHash: 'aaa' })).toBe(true);
  });

  it('counts the head of a space that has no migrations', () => {
    const graph = reconstructGraph([]);
    expect(isInSpaceHistory('aaa', { graph, headHash: 'aaa' })).toBe(true);
  });

  it('does not count another hash in a space that has no migrations', () => {
    const graph = reconstructGraph([]);
    expect(isInSpaceHistory('bbb', { graph, headHash: 'aaa' })).toBe(false);
  });

  it('does not count a head that is not a node when the space has migrations', () => {
    const graph = reconstructGraph(chain([E, 'aaa', 'm1']));
    expect(isInSpaceHistory('bbb', { graph, headHash: 'bbb' })).toBe(false);
  });
});

describe('assertHashIsGraphNode', () => {
  it('is a no-op for a graph-node hash', () => {
    const graph = reconstructGraph(chain([E, 'aaa', 'm1']));
    expect(() => assertHashIsGraphNode('aaa', graph)).not.toThrow();
  });

  it('is a no-op for EMPTY_CONTRACT_HASH on an empty graph', () => {
    const graph = reconstructGraph([]);
    expect(() => assertHashIsGraphNode(E, graph)).not.toThrow();
  });

  it('throws MIGRATION.HASH_NOT_IN_GRAPH for an unknown hash', () => {
    const graph = reconstructGraph(chain(['zzz', 'aaa', 'm1'], ['aaa', 'bbb', 'm2']));

    expect(() => assertHashIsGraphNode('missing', graph)).toThrow(MigrationToolsError);

    try {
      assertHashIsGraphNode('missing', graph);
    } catch (error) {
      expect(MigrationToolsError.is(error)).toBe(true);
      const err = error as MigrationToolsError;
      expect(err.code).toBe('MIGRATION.HASH_NOT_IN_GRAPH');
      expect(err.why).toContain('missing');
      expect(err.fix).toMatch(/migration plan/i);
      expect(err.fix).toMatch(/--from/i);
      expect(err.meta?.['hash']).toBe('missing');
      expect(err.meta?.['reachableHashes']).toEqual(['aaa', 'bbb', 'zzz']);
    }
  });

  it('throws MIGRATION.HASH_NOT_IN_GRAPH for malformed input without interpreting its shape', () => {
    const graph = reconstructGraph([]);

    expect(() => assertHashIsGraphNode('not-a-valid-hash', graph)).toThrow(MigrationToolsError);

    try {
      assertHashIsGraphNode('not-a-valid-hash', graph);
    } catch (error) {
      expect(MigrationToolsError.is(error)).toBe(true);
      const err = error as MigrationToolsError;
      expect(err.code).toBe('MIGRATION.HASH_NOT_IN_GRAPH');
      expect(err.meta?.['hash']).toBe('not-a-valid-hash');
      expect(err.meta?.['reachableHashes']).toEqual([]);
    }
  });
});
