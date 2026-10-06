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

  it('where() returns a mutator narrowed to where, updateAll and deleteAll', () => {
    const narrowed = createRelationMutator().where({ id: 1 });

    expect(Object.keys(narrowed).sort()).toEqual(['deleteAll', 'updateAll', 'where']);
  });

  it('updateAll() and deleteAll() carry the filters of every preceding where() in call order', () => {
    const mutator = createRelationMutator();
    const callback = () => ({ toWhereExpr: () => undefined }) as never;

    expect(mutator.updateAll({ id: 2 })).toEqual({
      kind: 'updateAll',
      filters: [],
      data: { id: 2 },
    });
    expect(mutator.deleteAll()).toEqual({ kind: 'deleteAll', filters: [] });
    expect(mutator.where({ id: 1 }).updateAll({ id: 2 })).toEqual({
      kind: 'updateAll',
      filters: [{ id: 1 }],
      data: { id: 2 },
    });
    expect(mutator.where({ id: 1 }).where(callback).deleteAll()).toEqual({
      kind: 'deleteAll',
      filters: [{ id: 1 }, callback],
    });
  });

  it('where() does not change the mutator it is called on', () => {
    const base = createRelationMutator().where({ id: 1 });
    base.where({ id: 2 });

    expect(base.deleteAll()).toEqual({ kind: 'deleteAll', filters: [{ id: 1 }] });
  });

  it('descriptor and callback guards validate mutation values', () => {
    expect(isRelationMutationDescriptor({ kind: 'updateAll', filters: [], data: {} })).toBe(true);
    expect(isRelationMutationDescriptor({ kind: 'deleteAll', filters: [] })).toBe(true);
    expect(isRelationMutationDescriptor(createRelationMutator().where({ id: 1 }))).toBe(false);
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
