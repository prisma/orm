import { describe, expect, it } from 'vitest';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
} from '../src/relation-mutator';

describe('relation-mutator', () => {
  it('createRelationMutator() normalizes create/connect/disconnect payloads', () => {
    const mutator = createRelationMutator();

    expect(mutator.create({ id: 1 })).toEqual({
      kind: 'create',
      data: [{ id: 1 }],
    });
    expect(mutator.create([{ id: 1 }, { id: 2 }])).toEqual({
      kind: 'create',
      data: [{ id: 1 }, { id: 2 }],
    });

    expect(mutator.connect({ id: 1 })).toEqual({
      kind: 'connect',
      criteria: [{ id: 1 }],
    });
    expect(mutator.connect([{ id: 1 }, { id: 2 }])).toEqual({
      kind: 'connect',
      criteria: [{ id: 1 }, { id: 2 }],
    });

    expect(mutator.disconnect()).toEqual({ kind: 'disconnect' });
    expect(mutator.disconnect([{ id: 1 }])).toEqual({
      kind: 'disconnect',
      criteria: [{ id: 1 }],
    });
  });

  it('descriptor and callback guards validate mutation values', () => {
    expect(isRelationMutationDescriptor(null)).toBe(false);
    expect(isRelationMutationDescriptor({ kind: 'unknown' })).toBe(false);
    expect(isRelationMutationDescriptor({ kind: 'create', data: [] })).toBe(true);
    expect(isRelationMutationDescriptor({ kind: 'connect', criteria: [] })).toBe(true);
    expect(isRelationMutationDescriptor({ kind: 'disconnect' })).toBe(true);
    expect(isRelationMutationDescriptor([{ kind: 'disconnect' }])).toBe(false);
    expect(
      isRelationMutationDescriptor(Object.assign([{ kind: 'disconnect' }], { kind: 'disconnect' })),
    ).toBe(false);

    expect(isRelationMutationCallback(() => ({ kind: 'disconnect' }))).toBe(true);
    expect(isRelationMutationCallback(() => [{ kind: 'disconnect' }])).toBe(true);
    expect(isRelationMutationCallback({})).toBe(false);
  });
});
