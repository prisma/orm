import { describe, expect, it } from 'vitest';
import { applicationDomainOf } from '../src/application-domain-of';
import { createContract } from '../src/contract-factories';

const address = {
  fields: { city: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
} as const;

describe('createContract with value objects', () => {
  it('puts them in the storage plane of the unbound namespace, next to the given entries', () => {
    const contract = createContract({
      storage: { namespaces: { __unbound__: { id: '__unbound__', entries: { table: {} } } } },
      valueObjects: { Address: address },
    });
    expect({
      entries: contract.storage.namespaces['__unbound__']?.entries,
      domain: contract.domain.namespaces['__unbound__'],
    }).toEqual({
      entries: { table: {}, valueObject: { Address: address } },
      domain: { models: {} },
    });
  });

  it('covers them in the storage hash', () => {
    expect(createContract({ valueObjects: { Address: address } }).storage.storageHash).not.toBe(
      createContract({}).storage.storageHash,
    );
  });
});

describe('applicationDomainOf', () => {
  it('holds models only', () => {
    expect(applicationDomainOf({ models: {} })).toEqual({
      namespaces: { __unbound__: { models: {} } },
    });
  });
});
