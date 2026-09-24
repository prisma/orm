import { canonicalizeContractToObject } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import { MongoContractSerializer } from '../src/core/ir/mongo-contract-serializer';
import { mongoContractJson } from './mongo-contract-json-fixture';

const timestampNow = { kind: 'generator', id: 'timestampNow' };

function withExecution(defaults: readonly unknown[]) {
  return {
    ...mongoContractJson({}),
    capabilities: {},
    extensions: {},
    meta: {},
    execution: { executionHash: 'test-execution-hash', mutations: { defaults } },
  };
}

const validDefault = {
  ref: { namespace: '__unbound__', entry: 'items', field: 'updatedAt' },
  onCreate: timestampNow,
  onUpdate: timestampNow,
};

const validationFailed = expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED' });

describe('Mongo contract execution section', () => {
  it('validates a section whose defaults name an entry and a field', () => {
    const contract = new MongoContractSerializer().deserializeContract(
      withExecution([validDefault]),
    );
    expect(contract.execution).toEqual({
      executionHash: 'test-execution-hash',
      mutations: { defaults: [validDefault] },
    });
  });

  it('canonicalizes the section right after storage and before capabilities', () => {
    const contract = new MongoContractSerializer().deserializeContract(
      withExecution([validDefault]),
    );
    const canonical = canonicalizeContractToObject(contract as unknown as Contract, {
      serializeContract: (c) => JSON.parse(JSON.stringify(c)) as JsonObject,
    });
    const keys = Object.keys(canonical);
    expect(keys.indexOf('execution')).toBe(keys.indexOf('storage') + 1);
    expect(keys.indexOf('capabilities')).toBe(keys.indexOf('execution') + 1);
    expect(canonical['execution']).toEqual({
      executionHash: 'test-execution-hash',
      mutations: { defaults: [validDefault] },
    });
  });

  it('rejects a default whose ref names a table and column', () => {
    const tableRef = {
      ref: { namespace: '__unbound__', table: 'items', column: 'updated_at' },
      onCreate: timestampNow,
    };
    expect(() =>
      new MongoContractSerializer().deserializeContract(withExecution([tableRef])),
    ).toThrow(validationFailed);
  });

  it('rejects a default whose ref names a model instead of an entry', () => {
    const modelRef = {
      ref: { namespace: '__unbound__', model: 'Item', field: 'updatedAt' },
      onCreate: timestampNow,
    };
    expect(() =>
      new MongoContractSerializer().deserializeContract(withExecution([modelRef])),
    ).toThrow(validationFailed);
  });

  it('rejects a ref with a table key next to entry and field', () => {
    const extraKey = { ...validDefault, ref: { ...validDefault.ref, table: 'items' } };
    expect(() =>
      new MongoContractSerializer().deserializeContract(withExecution([extraKey])),
    ).toThrow(validationFailed);
  });

  it('rejects a generator id that is not a flat id', () => {
    const badId = { ...validDefault, onCreate: { kind: 'generator', id: 'time.stamp/now' } };
    expect(() => new MongoContractSerializer().deserializeContract(withExecution([badId]))).toThrow(
      validationFailed,
    );
  });

  it('leaves a contract without the section unchanged', () => {
    const contract = new MongoContractSerializer().deserializeContract(mongoContractJson({}));
    expect(contract.execution).toBeUndefined();
  });
});
