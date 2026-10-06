import { buildNamespacedEnums, type NamespacedEnums } from '@internal/contract/enum-accessor';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { defineContract, enumType, field, member, model } from '../src/exports/contract-builder';
import mongoStatic from '../src/static/mongo-static';

type AnyMongoContract = MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>;

const Role = enumType(
  'Role',
  { codecId: 'mongo/string@1' },
  member('User', 'user'),
  member('Admin', 'admin'),
);

const Account = model('Account', {
  collection: 'accounts',
  fields: {
    _id: field.objectId(),
    role: field.namedType(Role),
  },
});

const contract = defineContract({
  enums: { Role },
  models: { Account },
});

type TestContract = typeof contract;

const contractJson = new MongoContractSerializer().serializeContract(contract);

describe('mongoStatic({ contractJson })', () => {
  it('returns context, contract, enums, and query', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(result.context).toBeDefined();
    expect(result.contract).toBeDefined();
    expect(result.enums).toBeDefined();
    expect(result.query).toBeDefined();
  });

  it('context carries the deserialized contract', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(result.context.contract).toBe(result.contract);
  });

  it('context carries the codec registry (standard codecs present)', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(result.context.codecs.has('mongo/string@1')).toBe(true);
    expect(result.context.codecs.has('mongo/objectId@1')).toBe(true);
  });

  it('context is frozen', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(Object.isFrozen(result.context)).toBe(true);
  });

  it('enums exposes the Role accessor without the namespace key', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(result.enums.Role).toBeDefined();
    expect(result.enums.Role.values).toEqual(['user', 'admin']);
  });

  it('enums.Role.members.User is "user"', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(result.enums.Role.members.User).toBe('user');
  });

  it('enums.Role.ordinalOf returns declaration-order indices', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(result.enums.Role.ordinalOf('user')).toBe(0);
    expect(result.enums.Role.ordinalOf('admin')).toBe(1);
  });

  it('enums matches what buildNamespacedEnums produces for the unbound namespace', () => {
    const allNamespaced = buildNamespacedEnums(
      contract.domain,
    ) as NamespacedEnums<AnyMongoContract>;
    const expectedEnums = allNamespaced[UNBOUND_NAMESPACE_ID];

    const result = mongoStatic<TestContract>({ contractJson });

    expect(result.enums.Role.values).toEqual(expectedEnums?.['Role']?.values);
    expect(result.enums.Role.names).toEqual(expectedEnums?.['Role']?.names);
  });

  it('query.from is a function (builder is present)', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(typeof result.query.from).toBe('function');
  });

  it('contract matches the deserialized contractJson', () => {
    const result = mongoStatic<TestContract>({ contractJson });
    expect(result.contract.target).toBe(contract.target);
    expect(result.contract.domain).toEqual(contract.domain);
  });
});
