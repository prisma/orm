import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { ContractExecutionSectionSchema } from '../src/execution-section-schema';

const timestampNow = { kind: 'generator', id: 'timestampNow' };

function section(defaults: readonly unknown[]) {
  return { executionHash: 'hash', mutations: { defaults } };
}

const validDefault = {
  ref: { namespace: 'public', entry: 'post', field: 'updatedAt' },
  onCreate: timestampNow,
  onUpdate: { kind: 'generator', id: 'timestampNow', params: { precision: 3 } },
};

describe('ContractExecutionSectionSchema', () => {
  it('accepts defaults whose ref names an entry and a field', () => {
    expect(ContractExecutionSectionSchema(section([validDefault]))).toEqual(
      section([validDefault]),
    );
  });

  it('rejects a ref that names a table and a column', () => {
    const tableRef = {
      ref: { namespace: 'public', table: 'post', column: 'updatedAt' },
      onCreate: timestampNow,
    };
    expect(ContractExecutionSectionSchema(section([tableRef]))).toBeInstanceOf(type.errors);
  });

  it('rejects an extra key on a ref', () => {
    const extra = { ...validDefault, ref: { ...validDefault.ref, model: 'Post' } };
    expect(ContractExecutionSectionSchema(section([extra]))).toBeInstanceOf(type.errors);
  });

  it('rejects an extra key on a default', () => {
    expect(
      ContractExecutionSectionSchema(section([{ ...validDefault, onDelete: timestampNow }])),
    ).toBeInstanceOf(type.errors);
  });

  it('rejects a generator id that is not flat', () => {
    const badId = { ...validDefault, onCreate: { kind: 'generator', id: 'time.stamp/now' } };
    expect(ContractExecutionSectionSchema(section([badId]))).toBeInstanceOf(type.errors);
  });

  it('rejects a value kind other than generator', () => {
    const literal = { ...validDefault, onCreate: { kind: 'literal', id: 'timestampNow' } };
    expect(ContractExecutionSectionSchema(section([literal]))).toBeInstanceOf(type.errors);
  });

  it('rejects a section without an execution hash', () => {
    expect(ContractExecutionSectionSchema({ mutations: { defaults: [] } })).toBeInstanceOf(
      type.errors,
    );
  });
});
