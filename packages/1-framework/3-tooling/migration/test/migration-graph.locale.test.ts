import { describe, expect, it } from 'vitest';
import { EMPTY_CONTRACT_HASH } from '../src/constants';
import { findPath, reconstructGraph } from '../src/migration-graph';
import { collateAsDanishInEachTest, pkgWithHash } from './danish-collation';

const E = EMPTY_CONTRACT_HASH;

describe('findPath tie-break on a machine whose locale reorders hex strings', () => {
  collateAsDanishInEachTest();

  it('picks the migration whose hash sorts first by character code', () => {
    const graph = reconstructGraph([
      pkgWithHash(E, 'H1', 'm0', 'sha256:00'),
      pkgWithHash('H1', 'H2', 'm_b', 'sha256:b0'),
      pkgWithHash('H1', 'H2', 'm_aa', 'sha256:aa'),
    ]);
    expect(findPath(graph, E, 'H2')?.map((e) => e.dirName)).toEqual(['m0', 'm_aa']);
  });

  it('picks the route whose intermediate contract sorts first by character code', () => {
    const graph = reconstructGraph([
      pkgWithHash('H1', 'sha256:b0', 'to_b0', 'sha256:01'),
      pkgWithHash('H1', 'sha256:aa', 'to_aa', 'sha256:f1'),
      pkgWithHash('sha256:b0', 'H2', 'from_b0', 'sha256:02'),
      pkgWithHash('sha256:aa', 'H2', 'from_aa', 'sha256:f2'),
    ]);
    expect(findPath(graph, 'H1', 'H2')?.map((e) => e.dirName)).toEqual(['to_aa', 'from_aa']);
  });
});
