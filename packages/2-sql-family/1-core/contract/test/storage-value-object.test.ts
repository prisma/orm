import type { ContractModel } from '@internal/contract/types';
import { hydrateNamespaceEntities, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds } from '../src/entity-kinds';
import { col, model, table } from '../src/factories';
import { StorageValueObject } from '../src/ir/storage-value-object';
import type { SqlStorage } from '../src/types';
import { createSqlStorageSchema, validateSqlContractFully } from '../src/validators';

const text = { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } as const;

function valueObjectType(name: string, namespaceId: string = UNBOUND_NAMESPACE_ID) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId,
    entityKind: 'valueObject',
    entityName: name,
  } as const;
}

const address = { fields: { street: text, city: text } };

function storageWith(valueObject: Record<string, unknown>) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'test-sql-namespace',
        entries: {
          table: {
            user: table({
              id: col('pg/int4', 'pg/int4@1'),
              address: col('pg/jsonb', 'pg/jsonb@1'),
            }),
          },
          valueObject,
        },
      },
    },
  };
}

function contractWith(
  addressType: unknown,
  valueObject: Record<string, unknown> = { Address: address },
) {
  return createContract<SqlStorage>({
    storage: blindCast<SqlStorage, 'test storage literal with a valueObject slot'>(
      storageWith(valueObject),
    ),
    models: {
      User: blindCast<ContractModel, 'test model literal with a value object field'>({
        ...model('user', { id: { column: 'id' }, address: { column: 'address' } }),
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
          address: { nullable: false, type: addressType },
        },
      }),
    },
  });
}

const addressWithMany = {
  fields: { street: { ...text, many: false }, city: { ...text, many: false } },
};

describe('StorageValueObject', () => {
  it('holds the fields it is given, with many false where a field leaves it out, frozen', () => {
    const valueObject = new StorageValueObject(address);
    expect({
      fields: valueObject.fields,
      frozen: Object.isFrozen(valueObject),
      fieldFrozen: Object.isFrozen(valueObject.fields['street']),
    }).toEqual({ fields: addressWithMany.fields, frozen: true, fieldFrozen: true });
  });

  it('keeps the many a field gives', () => {
    const tags = { ...text, many: { elementNullable: true } };
    expect(new StorageValueObject({ fields: { tags } }).fields).toEqual({ tags });
  });

  it('serializes to its fields only', () => {
    expect(JSON.parse(JSON.stringify(new StorageValueObject(address)))).toEqual(addressWithMany);
  });

  it('is hydrated from the valueObject slot', () => {
    const hydrated = hydrateNamespaceEntities(
      { valueObject: { Address: address } },
      composeSqlEntityKinds(),
      'fail',
    );
    expect(hydrated['valueObject']?.['Address']).toBeInstanceOf(StorageValueObject);
  });
});

describe('the storage valueObject slot schema', () => {
  const schema = createSqlStorageSchema(composeSqlEntityKinds());

  function validate(valueObject: Record<string, unknown>) {
    return schema({ storageHash: 'test', ...storageWith(valueObject) });
  }

  it('accepts scalar, list, nested and self-referencing members', () => {
    expect(
      validate({
        Address: address,
        Profile: {
          fields: {
            home: { nullable: true, type: valueObjectType('Address') },
            tags: { ...text, many: { elementNullable: false } },
            parent: { nullable: true, type: valueObjectType('Profile') },
          },
        },
      }),
    ).not.toBeInstanceOf(type.errors);
  });

  it.each([
    [
      'a union',
      {
        nullable: false,
        type: { kind: 'union', members: [text.type, valueObjectType('Address')] },
      },
    ],
    ['a dictionary', { ...text, dict: true }],
  ])('refuses a member that is %s', (_case, member) => {
    expect(validate({ Address: address, Shape: { fields: { either: member } } })).toBeInstanceOf(
      type.errors,
    );
  });

  it('refuses a member key it does not know', () => {
    expect(validate({ Address: { fields: { city: { ...text, column: 'city' } } } })).toBeInstanceOf(
      type.errors,
    );
  });

  it('refuses a member value set that points into the domain plane', () => {
    expect(
      validate({
        Address: {
          fields: {
            kind: {
              ...text,
              valueSet: {
                plane: 'domain',
                namespaceId: UNBOUND_NAMESPACE_ID,
                entityKind: 'enum',
                entityName: 'Kind',
              },
            },
          },
        },
      }),
    ).toBeInstanceOf(type.errors);
  });

  it('refuses a member reference that is not a storage value object coordinate', () => {
    expect(
      validate({
        Wrapper: {
          fields: { inner: { nullable: false, type: { kind: 'valueObject', name: 'Address' } } },
        },
      }),
    ).toBeInstanceOf(type.errors);
  });
});

describe('validateSqlContractFully with a value object in storage', () => {
  it('accepts a field that refers to the value object by its storage coordinate', () => {
    expect(() => validateSqlContractFully(contractWith(valueObjectType('Address')))).not.toThrow();
  });

  it('refuses a field that refers to a value object storage does not have', () => {
    expect(() => validateSqlContractFully(contractWith(valueObjectType('Missing')))).toThrow(
      'Model "__unbound__:User" field "address" refers to value object "Missing" in storage namespace "__unbound__", which storage.namespaces.__unbound__.entries.valueObject does not have',
    );
  });

  it('accepts a nested value object and one that refers to itself', () => {
    const contract = contractWith(valueObjectType('Profile'), {
      Address: address,
      Profile: {
        fields: {
          home: { nullable: true, type: valueObjectType('Address') },
          parent: { nullable: true, type: valueObjectType('Profile') },
        },
      },
    });
    expect(() => validateSqlContractFully(contract)).not.toThrow();
  });

  it('refuses a domain field whose type is a union inside a union, as the framework field type schema does', () => {
    expect(() =>
      validateSqlContractFully(
        contractWith({
          kind: 'union',
          members: [text.type, { kind: 'union', members: [text.type] }],
        }),
      ),
    ).toThrow(/Contract structural validation failed/);
  });

  it('refuses a field type that names its value object the old way', () => {
    expect(() =>
      validateSqlContractFully(contractWith({ kind: 'valueObject', name: 'Address' })),
    ).toThrow(/Contract structural validation failed/);
  });

  it.each([
    [
      'a union',
      {
        nullable: false,
        type: { kind: 'union', members: [text.type, valueObjectType('Address')] },
      },
      'union',
    ],
    ['a dictionary', { ...text, dict: true }, 'dictionary'],
  ])('refuses a member that is %s, naming the member', (_case, member, kind) => {
    const contract = contractWith(valueObjectType('Shape'), {
      Address: address,
      Shape: { fields: { either: member } },
    });
    expect(() => validateSqlContractFully(contract)).toThrow(
      expect.objectContaining({
        message: `Contract structural validation failed: value object "__unbound__:Shape" member "either" is a ${kind}; SQL value objects hold no unions or dictionaries, since their check cannot enforce them`,
      }),
    );
  });

  it('refuses value objects in the domain plane, and says to re-emit', () => {
    const contract = contractWith(valueObjectType('Address'));
    const old = {
      ...contract,
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            ...contract.domain.namespaces[UNBOUND_NAMESPACE_ID],
            valueObjects: { Address: address },
          },
        },
      },
    };
    expect(() => validateSqlContractFully(old)).toThrow(
      'Contract structural validation failed: domain.namespaces.__unbound__.valueObjects: contracts no longer store value objects in the domain plane; they are storage entities under storage.namespaces.<namespace>.entries.valueObject, so re-emit the contract from its source, or rewrite a stored contract such as a migration snapshot with value-objects-in-storage.ts, which ships in the value-objects-in-storage scripts of the Prisma 8 upgrade guide',
    );
  });
});
