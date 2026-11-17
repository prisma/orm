import { IRNodeBase } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoValueSet } from '../../src/ir/mongo-value-set';

describe('MongoValueSet', () => {
  it('constructs with ordered values', () => {
    const vs = new MongoValueSet({ kind: 'valueSet', values: ['user', 'admin'] });
    expect(vs.kind).toBe('valueSet');
    expect(vs.values).toEqual(['user', 'admin']);
  });

  it('keeps non-string encoded values (ints, booleans)', () => {
    const vs = new MongoValueSet({ kind: 'valueSet', values: [0, 1, 2] });
    expect(vs.values).toEqual([0, 1, 2]);
  });

  it('extends IRNodeBase and freezes', () => {
    const vs = new MongoValueSet({ kind: 'valueSet', values: ['x', 'y'] });
    expect(vs).toBeInstanceOf(IRNodeBase);
    expect(vs).toBeInstanceOf(MongoValueSet);
    expect(Object.isFrozen(vs)).toBe(true);
  });

  it('round-trips through canonical JSON', () => {
    const vs = new MongoValueSet({ kind: 'valueSet', values: ['admin', 'author', 'reader'] });
    expect(JSON.parse(JSON.stringify(vs))).toEqual({
      kind: 'valueSet',
      values: ['admin', 'author', 'reader'],
    });
  });
});
