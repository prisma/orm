import { describe, expect, it } from 'vitest';
import { DdlNode, isDdlNode } from '../../src/exports/ast';

class TargetContributedDdlNode extends DdlNode {
  readonly kind = 'target-contributed';
}

describe('isDdlNode', () => {
  it('recognizes a DdlNode subclass the family core has never heard of', () => {
    expect(isDdlNode(new TargetContributedDdlNode())).toBe(true);
  });

  it('rejects values that do not answer the brand', () => {
    const candidates = [null, undefined, 'create table', 42, {}, { isDdlNode: true }];

    expect(candidates.map(isDdlNode)).toEqual([false, false, false, false, false, false]);
  });
});

describe('DdlNode', () => {
  it('collects no param refs by default', () => {
    expect(new TargetContributedDdlNode().collectParamRefs()).toEqual([]);
  });
});
