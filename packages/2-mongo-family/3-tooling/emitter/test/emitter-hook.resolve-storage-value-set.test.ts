import { type Contract, type ContractModelBase, coreHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { mongoEmission } from '../src/index';
import { createMongoContract } from './fixtures/create-mongo-contract';

const roleField = {
  nullable: false,
  many: false,
  type: { kind: 'scalar', codecId: 'mongo/string@1' },
  valueSet: {
    plane: 'storage',
    entityKind: 'valueSet',
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityName: 'Role',
  },
} as const;

const domainRoleField = {
  ...roleField,
  valueSet: {
    plane: 'domain',
    entityKind: 'enum',
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityName: 'Role',
  },
} as const;

const userModel: ContractModelBase = {
  fields: {
    _id: { nullable: false, many: false, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
    role: roleField,
    domainRole: domainRoleField,
  },
  relations: {},
  storage: { collection: 'users' },
} as unknown as ContractModelBase;

function contractWithValueSet(values: readonly string[]): Contract {
  const base = createMongoContract({ models: { User: userModel } });
  const storage = {
    storageHash: coreHash('test'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'mongo-namespace' as const,
        entries: {
          collection: {},
          valueSet: { Role: { kind: 'valueSet', values } },
        },
      },
    },
  };
  return { ...base, storage: storage as Contract['storage'] };
}

describe('mongoEmission.resolveStorageValueSet', () => {
  it('sources encodedValues from the storage value set and codecId from the field', () => {
    const contract = contractWithValueSet(['admin', 'author', 'reader']);
    const resolved = mongoEmission.resolveStorageValueSet?.('User', 'role', userModel, contract);
    expect(resolved).toEqual({
      encodedValues: ['admin', 'author', 'reader'],
      codecId: 'mongo/string@1',
    });
  });

  it('reads the storage value set the reference names', () => {
    const contract = contractWithValueSet(['storage-a', 'storage-b']);
    const resolved = mongoEmission.resolveStorageValueSet?.('User', 'role', userModel, contract);
    expect(resolved?.encodedValues).toEqual(['storage-a', 'storage-b']);
  });

  it('leaves a reference to a domain enum to the framework', () => {
    const contract = contractWithValueSet(['admin']);
    const resolved = mongoEmission.resolveStorageValueSet?.(
      'User',
      'domainRole',
      userModel,
      contract,
    );
    expect(resolved).toBeUndefined();
  });

  it('returns undefined for a field with no value-set ref', () => {
    const contract = contractWithValueSet(['admin']);
    const resolved = mongoEmission.resolveStorageValueSet?.('User', '_id', userModel, contract);
    expect(resolved).toBeUndefined();
  });

  it('returns undefined when the storage value set is absent for the referenced entry', () => {
    const base = createMongoContract({ models: { User: userModel } });
    const resolved = mongoEmission.resolveStorageValueSet?.('User', 'role', userModel, base);
    expect(resolved).toBeUndefined();
  });
});
