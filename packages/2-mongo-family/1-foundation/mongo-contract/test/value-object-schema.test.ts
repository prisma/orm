import {
  type DomainContractShape,
  validateContractDomain,
} from '@internal/contract/validate-domain';
import { hydrateNamespaceEntities } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { MongoContractSchema } from '../src/contract-schema';
import { composeMongoEntityKinds } from '../src/entity-kinds';
import { MongoValueObject } from '../src/ir/mongo-value-object';

const NAMESPACE = '__unbound__';
const text = {
  type: { kind: 'scalar', codecId: 'mongo/string@1' },
  nullable: false,
  many: false,
} as const;

function valueObjectType(name: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: NAMESPACE,
    entityKind: 'valueObject',
    entityName: name,
  };
}

const address = { fields: { street: text, city: text } };

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

function contractWith(
  addressField: Record<string, unknown>,
  valueObject: Record<string, unknown> = { Address: address },
) {
  return {
    targetFamily: 'mongo',
    roots: { users: { namespace: NAMESPACE, model: 'User' } },
    domain: {
      namespaces: {
        [NAMESPACE]: {
          models: {
            User: {
              fields: {
                _id: { ...text, type: { kind: 'scalar', codecId: 'mongo/objectId@1' } },
                address: addressField,
              },
              relations: {},
              storage: { collection: 'users', fields: { address: { field: 'address' } } },
            },
          },
        },
      },
    },
    storage: {
      namespaces: {
        [NAMESPACE]: { id: NAMESPACE, entries: { collection: { users: {} }, valueObject } },
      },
    },
  };
}

describe('MongoValueObject', () => {
  it('holds its fields, frozen, and serializes to them', () => {
    const valueObject = new MongoValueObject(address);
    expect({
      json: JSON.parse(JSON.stringify(valueObject)),
      frozen: Object.isFrozen(valueObject),
    }).toEqual({ json: address, frozen: true });
  });

  it('is hydrated from the valueObject slot', () => {
    const hydrated = hydrateNamespaceEntities(
      { valueObject: { Address: address } },
      composeMongoEntityKinds(),
      'fail',
    );
    expect(hydrated['valueObject']?.['Address']).toBeInstanceOf(MongoValueObject);
  });
});

describe('the Mongo contract schema with value objects in storage', () => {
  it('accepts a field that refers to a storage value object, and nested and self references', () => {
    const contract = contractWith(
      { type: valueObjectType('Profile'), nullable: false, many: false },
      {
        Address: address,
        Profile: {
          fields: {
            home: { type: valueObjectType('Address'), nullable: true, many: false },
            parent: { type: valueObjectType('Profile'), nullable: true, many: false },
          },
        },
      },
    );
    expect(MongoContractSchema(contract)).toEqual(contract);
  });

  it('leaves frozen storage unchanged, and the value object fills in an absent many', () => {
    const contract = contractWith(
      { type: valueObjectType('Address'), nullable: false, many: false },
      { Address: { fields: { street: { type: text.type, nullable: false } } } },
    );
    deepFreeze(contract.storage);
    expect({
      parsed: MongoContractSchema(contract),
      valueObject: new MongoValueObject({
        fields: { street: { type: text.type, nullable: false } },
      }).fields,
    }).toEqual({ parsed: contract, valueObject: { street: text } });
  });

  it.each([
    ['without nullable', { type: text.type }],
    ['with dict false', { ...text, dict: false }],
  ])('refuses a value object member %s', (_case, street) => {
    expect(
      MongoContractSchema(
        contractWith(
          { type: valueObjectType('Address'), nullable: false },
          { Address: { fields: { street } } },
        ),
      ),
    ).toBeInstanceOf(type.errors);
  });

  it('refuses a field type that names its value object the old way', () => {
    expect(
      MongoContractSchema(
        contractWith({ type: { kind: 'valueObject', name: 'Address' }, nullable: false }),
      ),
    ).toBeInstanceOf(type.errors);
  });

  it('refuses a member value set that points into the domain plane', () => {
    const contract = contractWith(
      { type: valueObjectType('Address'), nullable: false },
      {
        Address: {
          fields: {
            kind: {
              ...text,
              valueSet: {
                plane: 'domain',
                namespaceId: NAMESPACE,
                entityKind: 'enum',
                entityName: 'Kind',
              },
            },
          },
        },
      },
    );
    expect(MongoContractSchema(contract)).toBeInstanceOf(type.errors);
  });

  it('refuses value objects in the domain plane', () => {
    const contract = contractWith({ type: valueObjectType('Address'), nullable: false });
    const old = {
      ...contract,
      domain: {
        namespaces: {
          [NAMESPACE]: {
            ...contract.domain.namespaces[NAMESPACE],
            valueObjects: { Address: address },
          },
        },
      },
    };
    expect(MongoContractSchema(old)).toBeInstanceOf(type.errors);
  });

  it('lets domain validation refuse a reference to a value object storage does not have', () => {
    const parsed = MongoContractSchema(
      contractWith({ type: valueObjectType('Missing'), nullable: false }),
    );
    expect(() =>
      validateContractDomain(
        blindCast<DomainContractShape, 'MongoContractSchema validated the contract'>(parsed),
      ),
    ).toThrow(
      'Model "__unbound__:User" field "address" refers to value object "Missing" in storage namespace "__unbound__", which storage.namespaces.__unbound__.entries.valueObject does not have',
    );
  });
});
