import { describe, expect, it } from 'vitest';
import { defineContract, field, model, rel, valueObject } from '../src/contract-builder';
import { enumType, member } from '../src/enum-type';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

const scaffold = { family: mongoFamilyPack, target: mongoTargetPack } as const;
const id = () => field.scalar(type.ObjectId());
const Plain = model('Plain', { collection: 'plains', fields: { _id: id() } });

function refusalOf(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    const { code, message, meta } = error as { code: unknown; message: unknown; meta: unknown };
    return { code, message, meta };
  }
  return undefined;
}

function refused(subject: string, meta: Record<string, string>) {
  return {
    code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
    message: `${subject} are not a plain object: their prototype has been replaced. A key written as "__proto__" in an object literal does this. Use a plain object, and choose another name for a "__proto__" key.`,
    meta: { ...meta, reason: 'prototype-replaced' },
  };
}

describe('a "__proto__" key written in an object literal the Mongo builder reads', () => {
  const cases: readonly (readonly [string, () => unknown, ReturnType<typeof refused>])[] = [
    [
      'the models of a contract',
      () => defineContract({ ...scaffold, models: { __proto__: Plain } as never }),
      refused('The models of the contract', { kind: 'model' }),
    ],
    [
      'the models a contract factory returns',
      () => defineContract(scaffold, () => ({ models: { __proto__: Plain } as never })),
      refused('The models of the contract', { kind: 'model' }),
    ],
    [
      'the value objects of a contract',
      () =>
        defineContract({
          ...scaffold,
          models: { Plain },
          valueObjects: { __proto__: valueObject('Address', { fields: {} }) } as never,
        }),
      refused('The value objects of the contract', { kind: 'valueObject' }),
    ],
    [
      'the enums of a contract',
      () =>
        defineContract({
          ...scaffold,
          models: { Plain },
          enums: {
            __proto__: enumType('Mood', { codecId: 'mongo/string@1' }, member('A', 'a')),
          } as never,
        }),
      refused('The enums of the contract', { kind: 'enum' }),
    ],
    [
      'the roots of a contract',
      () =>
        defineContract({ ...scaffold, models: { Plain }, roots: { __proto__: Plain } as never }),
      refused('The roots of the contract', { kind: 'root' }),
    ],
    [
      'the extensions of a contract',
      () =>
        defineContract({
          ...scaffold,
          models: { Plain },
          extensions: { __proto__: mongoFamilyPack } as never,
        }),
      refused('The extensions of the contract', { kind: 'extensionPack' }),
    ],
    [
      'the fields of a model',
      () =>
        defineContract({
          ...scaffold,
          models: {
            User: model('User', {
              collection: 'users',
              fields: { _id: id(), __proto__: field.scalar(type.String()) } as never,
            }),
          },
        }),
      refused('The fields of model "User"', { kind: 'field', modelName: 'User' }),
    ],
    [
      'the relations of a model',
      () =>
        defineContract({
          ...scaffold,
          models: {
            Plain,
            User: model('User', {
              collection: 'users',
              fields: { _id: id() },
              relations: { __proto__: rel.hasMany('Plain') } as never,
            }),
          },
        }),
      refused('The relations of model "User"', { kind: 'relation', modelName: 'User' }),
    ],
    [
      'the storage relations of a model',
      () =>
        defineContract({
          ...scaffold,
          models: {
            User: model('User', {
              collection: 'users',
              fields: { _id: id() },
              storageRelations: { __proto__: { field: 'x' } } as never,
            }),
          },
        }),
      refused('The storage relations of model "User"', {
        kind: 'storageRelation',
        modelName: 'User',
      }),
    ],
    [
      'the variants of a model',
      () =>
        defineContract({
          ...scaffold,
          models: {
            Task: model('Task', {
              collection: 'tasks',
              fields: { _id: id(), kind: field.scalar(type.String()) },
              discriminator: { field: 'kind', variants: { __proto__: { value: 'bug' } } as never },
            }),
          },
        }),
      refused('The variants of model "Task"', { kind: 'variant', modelName: 'Task' }),
    ],
    [
      'the fields of a value object',
      () => {
        const Address = valueObject('Address', {
          fields: { __proto__: field.scalar(type.String()) } as never,
        });
        return defineContract({
          ...scaffold,
          models: {
            User: model('User', {
              collection: 'users',
              fields: { _id: id(), home: field.valueObject(Address) },
            }),
          },
          valueObjects: { Address },
        });
      },
      refused('The fields of value object "Address"', {
        kind: 'valueObjectField',
        valueObjectName: 'Address',
      }),
    ],
  ];

  it.each(cases)('refuses %s', (_name, run, expected) => {
    expect(refusalOf(run)).toEqual(expected);
  });

  it('builds a contract whose objects are plain or have no prototype', () => {
    const models = Object.assign(Object.create(null) as Record<string, typeof Plain>, { Plain });
    expect(refusalOf(() => defineContract({ ...scaffold, models }))).toBeUndefined();
  });
});
