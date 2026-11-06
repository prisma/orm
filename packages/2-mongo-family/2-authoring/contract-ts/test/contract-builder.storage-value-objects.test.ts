import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, valueObject } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';
import { mongoFamilyPack, mongoTargetPack } from './mongo-test-packs';

const Role = enumType('Role', { codecId: 'mongo/string@1' }, member('Admin', 'admin'));

function contractWith(street: 'street' | 'line1') {
  const Geo = valueObject('Geo', { fields: { lat: field.double() } });
  const Address = valueObject('Address', {
    fields: {
      [street]: field.string(),
      role: field.namedType(Role),
      geo: field.valueObject(Geo).optional(),
    },
  });
  const User = model('User', {
    collection: 'users',
    fields: { _id: field.objectId(), address: field.valueObject(Address) },
  });
  return defineContract({
    family: mongoFamilyPack,
    target: mongoTargetPack,
    enums: { Role },
    models: { User },
    valueObjects: { Address, Geo },
  });
}

function json(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}

function valueObjectRef(entityName: string) {
  return {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: UNBOUND_NAMESPACE_ID,
    entityKind: 'valueObject',
    entityName,
  };
}

describe('the Mongo builder writes value objects into storage', () => {
  it('writes them under entries.valueObject, and fields refer to them by coordinate', () => {
    const contract = contractWith('street');
    expect({
      valueObjects: json(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries)['valueObject'],
      field: json(contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['User']?.fields)[
        'address'
      ],
      domainKeys: Object.keys(contract.domain.namespaces[UNBOUND_NAMESPACE_ID] ?? {}).sort(),
    }).toEqual({
      valueObjects: {
        Address: {
          fields: {
            street: {
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
              nullable: false,
              many: false,
            },
            role: {
              type: { kind: 'scalar', codecId: 'mongo/string@1' },
              nullable: false,
              many: false,
              valueSet: {
                plane: 'storage',
                entityKind: 'valueSet',
                namespaceId: UNBOUND_NAMESPACE_ID,
                entityName: 'Role',
              },
            },
            geo: { type: valueObjectRef('Geo'), nullable: true, many: false },
          },
        },
        Geo: {
          fields: {
            lat: {
              type: { kind: 'scalar', codecId: 'mongo/double@1' },
              nullable: false,
              many: false,
            },
          },
        },
      },
      field: { type: valueObjectRef('Address'), nullable: false, many: false },
      domainKeys: ['enum', 'models'],
    });
  });

  it('changes the storage hash when a member changes', () => {
    expect(String(contractWith('street').storage.storageHash)).not.toBe(
      String(contractWith('line1').storage.storageHash),
    );
  });
});
