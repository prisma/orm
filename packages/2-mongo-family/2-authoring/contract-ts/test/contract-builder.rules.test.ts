import { describe, expect, it } from 'vitest';
import { defineContract, field, index, model, valueObject } from '../src/contract-builder';
import type { AnyFieldBuilder, AnyModelBuilder, AnyValueObjectBuilder } from '../src/contract-dsl';
import { enumType, member } from '../src/enum-type';
import { mongoFamilyPack, mongoTargetPack } from './mongo-test-packs';

const Role = enumType('Role', { codecId: 'mongo/string@1' }, member('Admin', 'admin'));

function taskModels(
  base: { readonly type?: AnyFieldBuilder } = {},
  bugCollection: string | null = 'tasks',
) {
  const Task = model('Task', {
    collection: 'tasks',
    fields: { _id: field.objectId(), type: base.type ?? field.string() },
    discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
  });
  const Bug = model('Bug', {
    ...(bugCollection === null ? {} : { collection: bugCollection }),
    base: Task,
    fields: { severity: field.string() },
  });
  return { Task, Bug };
}

function build(input: {
  readonly models?: Record<string, AnyModelBuilder>;
  readonly valueObjects?: Record<string, AnyValueObjectBuilder>;
}) {
  return () => defineContract({ family: mongoFamilyPack, target: mongoTargetPack, ...input });
}

function refusalOf(run: () => unknown): { code: unknown; meta: unknown } {
  try {
    run();
  } catch (error) {
    const { code, meta } = error as { code: unknown; meta: unknown };
    return { code, meta };
  }
  throw new Error('expected a refusal');
}

describe('defineContract — variant collections', () => {
  it('stores a variant that omits its collection in its base collection', () => {
    const contract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: taskModels({}, null),
    });

    expect(contract.domain.namespaces.__unbound__.models.Bug.storage.collection).toBe('tasks');
  });

  it('refuses a variant stored in another collection than its base', () => {
    expect(refusalOf(build({ models: taskModels({}, 'bugs') }))).toEqual({
      code: 'CONTRACT.COLLECTION_INVALID',
      meta: {
        modelName: 'Bug',
        collection: 'bugs',
        baseModel: 'Task',
        baseCollection: 'tasks',
        reason: 'variant-collection-differs',
      },
    });
  });
});

describe('defineContract — discriminators', () => {
  it('refuses an optional discriminator', () => {
    expect(refusalOf(build({ models: taskModels({ type: field.string().optional() }) }))).toEqual({
      code: 'CONTRACT.ARGUMENT_INVALID',
      meta: { modelName: 'Task', fieldName: 'type', reason: 'discriminator-optional' },
    });
  });

  it('refuses a discriminator that is not text', () => {
    expect(refusalOf(build({ models: taskModels({ type: field.int32() }) }))).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      meta: { modelName: 'Task', fieldName: 'type', reason: 'discriminator-not-text' },
    });
  });

  it('refuses a discriminator field the model does not declare', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: { _id: field.objectId() },
      discriminator: { field: 'kind', variants: { Bug: { value: 'bug' } } },
    });
    const Bug = model('Bug', { collection: 'tasks', base: Task, fields: {} });

    expect(refusalOf(build({ models: { Task, Bug } }))).toEqual({
      code: 'CONTRACT.FIELD_UNKNOWN',
      meta: { modelName: 'Task', fieldName: 'kind', reason: 'discriminator-field-unknown' },
    });
  });

  it('refuses a discriminator no variant names as its base', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: { _id: field.objectId(), type: field.string() },
      discriminator: { field: 'type', variants: {} },
    });

    expect(refusalOf(build({ models: { Task } }))).toEqual({
      code: 'CONTRACT.ARGUMENT_INVALID',
      meta: { modelName: 'Task', reason: 'discriminator-without-variants' },
    });
  });

  it('refuses a listed variant that no model declares', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: { _id: field.objectId(), type: field.string() },
      discriminator: { field: 'type', variants: { Bug: { value: 'bug' }, Ghost: { value: 'g' } } },
    });
    const Bug = model('Bug', { base: Task, fields: {} });

    expect(refusalOf(build({ models: { Task, Bug } }))).toEqual({
      code: 'CONTRACT.ARGUMENT_INVALID',
      meta: { modelName: 'Task', variant: 'Ghost', reason: 'listed-variant-missing' },
    });
  });

  it('refuses a base that has no discriminator', () => {
    const Task = model('Task', { collection: 'tasks', fields: { _id: field.objectId() } });
    const Bug = model('Bug', { collection: 'tasks', base: Task, fields: {} });

    expect(refusalOf(build({ models: { Task, Bug } }))).toEqual({
      code: 'CONTRACT.ARGUMENT_INVALID',
      meta: { modelName: 'Bug', baseModel: 'Task', reason: 'base-without-discriminator' },
    });
  });

  it('refuses a base the contract does not declare', () => {
    const Bug = model('Bug', { collection: 'tasks', base: 'Task', fields: {} });

    expect(refusalOf(build({ models: { Bug } }))).toEqual({
      code: 'CONTRACT.ARGUMENT_INVALID',
      meta: { modelName: 'Bug', baseModel: 'Task', reason: 'base-unknown' },
    });
  });
});

describe('defineContract — enums', () => {
  it('refuses a value object field typed by an enum the contract does not declare', () => {
    const Address = valueObject('Address', { fields: { role: field.namedType(Role) } });

    expect(refusalOf(build({ valueObjects: { Address } }))).toEqual({
      code: 'CONTRACT.ENUM_UNKNOWN',
      meta: { valueObjectName: 'Address', fieldName: 'role', enumName: 'Role' },
    });
  });
});

describe('defineContract — index shapes', () => {
  function indexed(indexes: Parameters<typeof model>[1]['indexes']) {
    return {
      models: {
        Doc: model('Doc', {
          collection: 'docs',
          fields: { _id: field.objectId(), a: field.string(), b: field.string() },
          indexes,
        }),
      },
    };
  }

  it.each([
    ['a unique wildcard index', [index({ '$**': 1 }, { unique: true })], 'unique-wildcard'],
    ['a wildcard with a hashed key', [index({ '$**': 1, a: 'hashed' })], 'wildcard-with-type'],
    ['a hashed index on several fields', [index({ a: 'hashed', b: 1 })], 'hashed-several-fields'],
    [
      'a TTL wildcard index',
      [index({ 'a.$**': 1 }, { expireAfterSeconds: 60 })],
      'ttl-with-wildcard',
    ],
    ['a second text index', [index({ a: 'text' }), index({ b: 'text' })], 'second-text-index'],
    [
      'a wildcard projection without a wildcard key',
      [index({ a: 1 }, { wildcardProjection: { b: 1 } })],
      'projection-without-wildcard',
    ],
  ] as const)('refuses %s', (_, indexes, reason) => {
    expect(refusalOf(build(indexed(indexes)))).toMatchObject({
      code: 'CONTRACT.INDEX_INVALID',
      meta: { modelName: 'Doc', reason },
    });
  });

  it('refuses a collation without a locale', () => {
    const indexes = [
      { fields: { a: 1 as const }, options: { collation: JSON.parse('{"strength":2}') } },
    ];
    expect(refusalOf(build(indexed(indexes)))).toMatchObject({
      code: 'CONTRACT.INDEX_INVALID',
      meta: { modelName: 'Doc', reason: 'collation-without-locale' },
    });
  });
});

describe('defineContract — namespaces', () => {
  it('builds into the target default namespace', () => {
    const contract = defineContract({
      family: mongoFamilyPack,
      target: { ...mongoTargetPack, defaultNamespaceId: 'main' },
      models: { User: model('User', { collection: 'users', fields: { _id: field.objectId() } }) },
    });

    expect(Object.keys(contract.domain.namespaces)).toEqual(['main']);
  });
});
