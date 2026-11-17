import { describe, expect, it } from 'vitest';
import { field, index, model, rel, valueObject } from '../src/contract-builder';
import { buildContractDefinition } from '../src/contract-lowering';
import { enumType, member } from '../src/enum-type';
import { mongoFamilyPack, mongoTargetPack, type } from './mongo-test-packs';

const objectIdType = field.scalar(type.ObjectId()).__type;
const stringType = field.scalar(type.String()).__type;

describe('buildContractDefinition', () => {
  it('lowers models to plain data, keeping indexes in the order they are written', () => {
    const Role = enumType('Role', { codecId: 'mongo/string@1' }, member('Admin', 'admin'));
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.scalar(type.ObjectId()),
        type: field.scalar(type.String()),
        title: field.scalar(type.String()).optional().mongo({ field: 't' }),
        tags: field.scalar(type.String()).many(),
        role: field.namedType(Role),
      },
      indexes: [index({ title: 1 }), index({ type: 1 }, { unique: true })],
      controlPolicy: 'managed',
      discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
    });
    const Bug = model('Bug', { collection: 'tasks', base: Task, fields: {} });

    const definition = buildContractDefinition({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug },
      enums: { Role },
      roots: { allTasks: Task },
    });

    expect(definition).toEqual({
      target: mongoTargetPack,
      models: [
        {
          modelName: 'Task',
          collection: 'tasks',
          controlPolicy: 'managed',
          indexes: [{ fields: { title: 1 } }, { fields: { type: 1 }, options: { unique: true } }],
          fields: [
            { fieldName: '_id', type: objectIdType, nullable: false, many: false },
            { fieldName: 'type', type: stringType, nullable: false, many: false },
            {
              fieldName: 'title',
              storedName: 't',
              type: stringType,
              nullable: true,
              many: false,
            },
            {
              fieldName: 'tags',
              type: stringType,
              nullable: false,
              many: { elementNullable: false },
            },
            {
              fieldName: 'role',
              type: stringType,
              nullable: false,
              many: false,
              enumName: 'Role',
            },
          ],
          relations: [],
          discriminator: { field: 'type', listedVariants: ['Bug'] },
        },
        {
          modelName: 'Bug',
          collection: 'tasks',
          fields: [],
          relations: [],
          base: { model: 'Task', value: { kind: 'string', text: 'bug' } },
        },
      ],
      valueObjects: [],
      enums: { Role },
      roots: { allTasks: 'Task' },
      writesCollectionValidators: true,
      warnings: undefined,
    });
  });

  it('lowers embed and reference relations, and value objects', () => {
    const Address = valueObject('Address', { fields: { city: field.scalar(type.String()) } });
    const User = model('User', {
      collection: 'users',
      fields: { _id: field.scalar(type.ObjectId()), home: field.valueObject(Address).optional() },
    });
    const Post = model('Post', {
      collection: 'posts',
      fields: { _id: field.scalar(type.ObjectId()), authorId: field.scalar(type.ObjectId()) },
      relations: {
        author: rel.belongsTo(User, { from: 'authorId', to: User.ref('_id') }),
        comments: rel.hasMany('Comment'),
      },
    });

    const definition = buildContractDefinition({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { User, Post },
      valueObjects: { Address },
    });

    expect({
      relations: definition.models[1]?.relations,
      valueObjects: definition.valueObjects,
    }).toEqual({
      relations: [
        {
          relationName: 'author',
          toModel: 'User',
          cardinality: 'N:1',
          on: { localFields: ['authorId'], targetFields: ['_id'] },
          nullable: undefined,
        },
        { relationName: 'comments', toModel: 'Comment', cardinality: '1:N', nullable: undefined },
      ],
      valueObjects: [
        {
          name: 'Address',
          fields: [{ fieldName: 'city', type: stringType, nullable: false, many: false }],
        },
      ],
    });
  });

  it('gives a variant the base no value names an undefined value', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: { _id: field.scalar(type.ObjectId()), type: field.scalar(type.String()) },
      discriminator: { field: 'type', variants: {} },
    });
    const Bug = model('Bug', { collection: 'tasks', base: Task, fields: {} });

    const definition = buildContractDefinition({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      models: { Task, Bug },
    });

    expect(definition.models[1]?.base).toEqual({ model: 'Task', value: undefined });
  });

  it('refuses a family pack that is not MongoDB', () => {
    expect(() =>
      buildContractDefinition({
        family: { ...mongoFamilyPack, familyId: 'sql' },
        target: mongoTargetPack,
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.PACK_FAMILY_MISMATCH' }));
  });
});
