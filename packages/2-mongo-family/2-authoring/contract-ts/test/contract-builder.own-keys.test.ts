import { domainModelsAtDefaultNamespace } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, valueObject } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

function ownKeys(record: object | undefined): unknown {
  return {
    prototypeIsPlain: Object.getPrototypeOf(record) === Object.prototype,
    keys: Object.keys(record ?? {}),
  };
}

describe('Mongo contract names every object has as a property', () => {
  it('builds a model and collection named constructor and a collection named __proto__', () => {
    const Ctor = model('constructor', {
      collection: 'constructor',
      fields: { id: field.scalar(type.ObjectId()).mongo({ field: '_id' }) },
    });
    const Proto = model('Proto', {
      collection: '__proto__',
      fields: { id: field.scalar(type.ObjectId()).mongo({ field: '_id' }) },
    });
    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { constructor: Ctor, Proto },
    });
    const collections =
      contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.collection ?? undefined;
    expect({
      models: Object.keys(domainModelsAtDefaultNamespace(contract.domain)),
      collections: ownKeys(collections),
      roots: ownKeys(contract.roots),
      validatorOfConstructor:
        Object.getOwnPropertyDescriptor(collections ?? {}, 'constructor')?.value?.validator !==
        undefined,
    }).toEqual({
      models: ['constructor', 'Proto'],
      collections: { prototypeIsPlain: true, keys: ['constructor', '__proto__'] },
      roots: { prototypeIsPlain: true, keys: ['constructor', '__proto__'] },
      validatorOfConstructor: true,
    });
  });

  it('builds a value object named constructor', () => {
    const Ctor = valueObject('constructor', { fields: { street: field.scalar(type.String()) } });
    const User = model('User', {
      collection: 'users',
      fields: {
        id: field.scalar(type.ObjectId()).mongo({ field: '_id' }),
        address: field.valueObject(Ctor),
      },
    });
    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User },
      valueObjects: { constructor: Ctor },
    });
    const valueObjects = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.valueObject;
    expect(Object.keys(valueObjects ?? {})).toEqual(['constructor']);
  });

  it('builds an enum named __proto__ as an own key', () => {
    const Proto = enumType('__proto__', { codecId: 'mongo/string@1' }, member('A', 'a'));
    const Account = model('Account', {
      collection: 'accounts',
      fields: { _id: field.scalar(type.ObjectId()), kind: field.namedType(Proto) },
    });
    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      enums: Object.fromEntries([['__proto__', Proto]]),
      models: { Account },
    });
    const namespace = contract.domain.namespaces[UNBOUND_NAMESPACE_ID] as
      | Record<string, object | undefined>
      | undefined;
    const enums = namespace?.['enum'];
    expect({
      prototypeIsPlain: Object.getPrototypeOf(enums) === Object.prototype,
      keys: Object.keys(enums ?? {}),
    }).toEqual({ prototypeIsPlain: true, keys: ['__proto__'] });
  });
});
