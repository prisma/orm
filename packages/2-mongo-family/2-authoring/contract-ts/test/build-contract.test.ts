import {
  assembleDataTypeSupport,
  TIMESTAMP_NOW_GENERATOR_ID,
} from '@internal/framework-components/authoring';
import { extractCodecLookup } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { MongoContract } from '@internal/mongo-contract';
import { mongoDataType } from '@internal/mongo-contract/data-type';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { buildMongoContractFromDefinition } from '../src/build-contract';
import type { RestatedFieldDifference } from '../src/build-refusals';
import { defineContract, field, index, model } from '../src/contract-builder';
import type { ContractDefinition, FieldNode, ModelNode } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';
import {
  identityCodec,
  identityCodecDescriptor,
  mongoFamilyPack,
  mongoTargetPack,
} from './mongo-test-packs';

const codecLookup = extractCodecLookup([mongoFamilyPack, mongoTargetPack]);
const { support: dataTypes } = assembleDataTypeSupport(
  [mongoFamilyPack, mongoTargetPack],
  (codecId) => codecLookup.descriptorFor(codecId)?.dataType,
);
const objectIdType = field.objectId().__type;
const stringType = field.string().__type;
const int32Type = field.int32().__type;
const vectorType = field.vector().__type;
const now = { kind: 'generator', id: TIMESTAMP_NOW_GENERATOR_ID } as const;

function scalar(fieldName: string, overrides: Partial<FieldNode> = {}): FieldNode {
  return { fieldName, type: stringType, nullable: false, many: false, ...overrides };
}

const id = scalar('_id', { type: objectIdType });

function withoutDiscriminator({ discriminator: _, ...model }: ModelNode): ModelNode {
  return model;
}

const task: ModelNode = {
  modelName: 'Task',
  collection: 'tasks',
  indexes: [{ fields: { title: 1 } }],
  fields: [id, scalar('type'), scalar('title', { storedName: 't' })],
  discriminator: { field: 'type', listedVariants: ['Bug'] },
};

const bug: ModelNode = {
  modelName: 'Bug',
  collection: 'tasks',
  indexes: [{ fields: { severity: 1 } }],
  fields: [scalar('severity')],
  base: { model: 'Task', value: { kind: 'string', text: 'bug' } },
};

function definitionOf(overrides: Partial<ContractDefinition>): ContractDefinition {
  return {
    target: mongoTargetPack,
    models: [task, bug],
    writesCollectionValidators: true,
    warnings: undefined,
    ...overrides,
  };
}

function build(overrides: Partial<ContractDefinition>) {
  return buildMongoContractFromDefinition(definitionOf(overrides), codecLookup, dataTypes);
}

function contractOf(overrides: Partial<ContractDefinition>): MongoContract {
  const built = build(overrides);
  if (!built.ok) throw new Error(`refused: ${JSON.stringify(built.failure)}`);
  return built.value.contract;
}

function refusalsOf(overrides: Partial<ContractDefinition>) {
  const built = build(overrides);
  return built.ok ? [] : built.failure.refusals.map(({ kind, key }) => ({ kind, key }));
}

function hasValidator(contract: MongoContract, collection: string): boolean {
  const collections = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries['collection'];
  return 'validator' in (collections?.[collection] ?? {});
}

function user(fields: readonly FieldNode[], overrides: Partial<ModelNode> = {}): ModelNode {
  return { modelName: 'User', collection: 'users', fields: [id, ...fields], ...overrides };
}

const modelField = (model: string, fieldName: string) => ({
  kind: 'field',
  owner: { kind: 'model', name: model },
  field: fieldName,
});
const valueObjectField = (valueObject: string, fieldName: string) => ({
  kind: 'field',
  owner: { kind: 'valueObject', name: valueObject },
  field: fieldName,
});

describe('buildMongoContractFromDefinition', () => {
  it('builds the contract defineContract builds from the same models', () => {
    const Task = model('Task', {
      collection: 'tasks',
      fields: {
        _id: field.objectId(),
        type: field.string(),
        title: field.string().mongo({ field: 't' }),
      },
      indexes: [index({ title: 1 })],
      discriminator: { field: 'type', variants: { Bug: { value: 'bug' } } },
    });
    const Bug = model('Bug', {
      collection: 'tasks',
      base: Task,
      fields: { severity: field.string() },
      indexes: [index({ severity: 1 })],
    });

    expect(contractOf({})).toEqual(
      defineContract({ family: mongoFamilyPack, target: mongoTargetPack, models: { Task, Bug } }),
    );
  });

  it('gives collections no validator when the definition says so', () => {
    expect({
      with: hasValidator(contractOf({}), 'tasks'),
      without: hasValidator(contractOf({ writesCollectionValidators: false }), 'tasks'),
    }).toEqual({ with: true, without: false });
  });

  it('returns the warnings the definition carries', () => {
    const sourceWarning = {
      code: 'TEST_WARNING',
      message: 'a warning from the source',
      item: 'source',
      summary: 'warnings from the source',
    };
    const built = build({
      warnings: [sourceWarning],
      models: [user([])],
    });

    expect(built.ok && built.value.warnings).toEqual([{ kind: 'source', warning: sourceWarning }]);
  });

  it('builds an optional field that generates a value', () => {
    const contract = contractOf({
      models: [user([scalar('at', { nullable: true, executionDefaults: { onCreate: now } })])],
    });

    expect(contract.execution?.mutations.defaults).toEqual([
      { ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'users', field: 'at' }, onCreate: now },
    ]);
  });

  it('keys the generators a source already resolved by collection and stored field', () => {
    const contract = contractOf({
      models: [user([scalar('at', { storedName: 'a', generatedValues: { onUpdate: now } })])],
    });

    expect(contract.execution?.mutations.defaults).toEqual([
      { ref: { namespace: UNBOUND_NAMESPACE_ID, entry: 'users', field: 'a' }, onUpdate: now },
    ]);
  });

  it('refuses a document id MongoDB cannot store whether or not collections get validators', () => {
    const documentIdModel: ModelNode = {
      modelName: 'Doc',
      collection: 'docs',
      fields: [scalar('_id', { type: vectorType })],
    };

    expect({
      withValidators: refusalsOf({ models: [documentIdModel] }),
      withoutValidators: refusalsOf({
        models: [documentIdModel],
        writesCollectionValidators: false,
      }),
    }).toEqual({
      withValidators: [{ kind: 'validator', key: modelField('Doc', '_id') }],
      withoutValidators: [{ kind: 'validator', key: modelField('Doc', '_id') }],
    });
  });

  it('builds a variant that restates a base field under the same name', () => {
    expect(
      refusalsOf({ models: [task, { ...bug, fields: [...bug.fields, scalar('type')] }] }),
    ).toEqual([]);
  });

  it.each<[string, Partial<FieldNode>, readonly RestatedFieldDifference[]]>([
    ['stored name', { storedName: 'title' }, ['storedName']],
    ['type', { storedName: 't', type: objectIdType }, ['type']],
    ['nullability', { storedName: 't', nullable: true }, ['nullable']],
    ['list shape', { storedName: 't', many: { elementNullable: false } }, ['many']],
    ['stored name and type', { type: objectIdType }, ['storedName', 'type']],
  ])(
    'refuses a variant that restates a base field with a different %s',
    (_label, overrides, differences) => {
      const built = build({
        models: [task, { ...bug, fields: [...bug.fields, scalar('title', overrides)] }],
      });
      expect(built.ok ? [] : built.failure.refusals).toEqual([
        {
          kind: 'restatedBaseFieldDiffers',
          key: modelField('Bug', 'title'),
          baseModel: 'Task',
          differences,
        },
      ]);
    },
  );

  it('builds a variant that restates a base field exactly', () => {
    const tags = () => scalar('tags', { many: { elementNullable: false } });
    expect(
      refusalsOf({
        models: [
          { ...task, fields: [...task.fields, tags()] },
          { ...bug, fields: [...bug.fields, scalar('title', { storedName: 't' }), tags()] },
        ],
      }),
    ).toEqual([]);
  });

  it('stores a variant that names no collection in its base collection', () => {
    const { collection: _, ...bugWithoutCollection } = bug;
    const contract = contractOf({ models: [task, bugWithoutCollection] });

    expect(contract.domain.namespaces[UNBOUND_NAMESPACE_ID]?.models['Bug']?.storage).toEqual({
      collection: 'tasks',
      fields: { severity: { field: 'severity' } },
    });
  });
});

describe('buildMongoContractFromDefinition refusals', () => {
  const Role = enumType('Role', { codecId: 'mongo/string@1' }, member('Admin', 'admin'));
  const Missing = enumType('Missing', { codecId: 'test/missing@1' }, member('A', 'a'));

  it.each([
    [
      'a duplicate model',
      { models: [user([]), user([])] },
      [{ kind: 'duplicateModel', key: { kind: 'model', model: 'User' } }],
    ],
    [
      'a duplicate value object',
      {
        models: [],
        valueObjects: [
          { name: 'A', fields: [] },
          { name: 'A', fields: [] },
        ],
      },
      [{ kind: 'duplicateValueObject', key: { kind: 'valueObject', valueObject: 'A' } }],
    ],
    [
      'an unsupported stored name',
      { models: [user([scalar('a', { storedName: '__proto__' })])] },
      [{ kind: 'storedNameUnsupported', key: modelField('User', 'a') }],
    ],
    [
      'two fields stored under one name',
      { models: [user([scalar('a'), scalar('b', { storedName: 'a' })])] },
      [{ kind: 'storedNameDuplicate', key: modelField('User', 'b') }],
    ],
    [
      'a variant field stored under a name its base uses',
      { models: [task, { ...bug, fields: [scalar('sev', { storedName: 'type' })], indexes: [] }] },
      [{ kind: 'storedNameSharedWithBase', key: modelField('Bug', 'sev') }],
    ],
    [
      'a stored name on a value object field',
      { models: [], valueObjects: [{ name: 'A', fields: [scalar('x', { storedName: 'y' })] }] },
      [{ kind: 'valueObjectFieldStoredName', key: valueObjectField('A', 'x') }],
    ],
    [
      'a relation on an unknown local field',
      {
        models: [
          user([], {
            relations: [
              {
                relationName: 'org',
                toModel: 'User',
                cardinality: 'N:1',
                on: { localFields: ['orgId'], targetFields: ['_id'] },
                nullable: undefined,
              },
            ],
          }),
        ],
      },
      [
        {
          kind: 'relationLocalFieldUnknown',
          key: { kind: 'relation', model: 'User', relation: 'org' },
        },
      ],
    ],
    [
      'a required to-one relation on an optional field',
      {
        models: [
          user([scalar('orgId', { nullable: true })], {
            relations: [
              {
                relationName: 'org',
                toModel: 'User',
                cardinality: 'N:1',
                on: { localFields: ['orgId'], targetFields: ['_id'] },
                nullable: false,
              },
            ],
          }),
        ],
      },
      [{ kind: 'relationNullability', key: { kind: 'relation', model: 'User', relation: 'org' } }],
    ],
    [
      'indexes on a model without a collection',
      { models: [{ modelName: 'Part', fields: [], indexes: [{ fields: { a: 1 } }] }] },
      [
        {
          kind: 'collectionSettingWithoutCollection',
          key: { kind: 'collectionSettings', model: 'Part' },
        },
      ],
    ],
    [
      'control policies on one collection from two models',
      {
        models: [
          user([], { controlPolicy: 'managed' }),
          { modelName: 'Admin', collection: 'users', fields: [], controlPolicy: 'managed' },
        ],
      },
      [{ kind: 'collectionSettingTwice', key: { kind: 'collectionSettings', model: 'Admin' } }],
    ],
    [
      'a variant in another collection',
      { models: [task, { ...bug, collection: 'bugs' }] },
      [{ kind: 'variantCollectionDiffers', key: { kind: 'collectionSettings', model: 'Bug' } }],
    ],
    [
      'an index on an unknown field',
      {
        models: [user([scalar('a')], { indexes: [{ fields: { a: 1 } }, { fields: { nope: 1 } }] })],
      },
      [{ kind: 'indexFieldUnknown', key: { kind: 'index', model: 'User', position: 1 } }],
    ],
    [
      'a unique wildcard index',
      { models: [user([], { indexes: [{ fields: { '$**': 1 }, options: { unique: true } }] })] },
      [{ kind: 'indexShape', key: { kind: 'index', model: 'User', position: 0 } }],
    ],
    [
      'a variant index whose filter contradicts its discriminator value',
      {
        models: [
          task,
          {
            ...bug,
            indexes: [
              { fields: { severity: 1 }, options: { partialFilterExpression: { type: 'x' } } },
            ],
          },
        ],
      },
      [{ kind: 'indexScopeConflict', key: { kind: 'index', model: 'Bug', position: 0 } }],
    ],
    [
      'a generated value on a value object field',
      {
        models: [],
        valueObjects: [
          { name: 'A', fields: [scalar('at', { executionDefaults: { onCreate: now } })] },
        ],
      },
      [{ kind: 'generatedOnValueObject', key: valueObjectField('A', 'at') }],
    ],
    [
      'a generator no pack declares',
      {
        models: [
          user([scalar('at', { generatorCalls: { onCreate: { name: 'nope', args: {} } } })]),
        ],
      },
      [{ kind: 'generatorUnknown', key: modelField('User', 'at') }],
    ],
    [
      'a phase set twice',
      {
        models: [
          user([
            scalar('at', {
              executionDefaults: { onCreate: now },
              generatorCalls: { onCreate: { name: 'now', args: {} } },
            }),
          ]),
        ],
      },
      [{ kind: 'generatorPhaseSetTwice', key: modelField('User', 'at') }],
    ],
    [
      'a phase set by both the field type and a resolved generator',
      {
        models: [
          user([
            scalar('at', {
              executionDefaults: { onCreate: now },
              generatedValues: { onCreate: now },
            }),
          ]),
        ],
      },
      [{ kind: 'generatorPhaseSetTwice', key: modelField('User', 'at') }],
    ],
    [
      'a generated list field',
      {
        models: [
          user([
            scalar('at', {
              many: { elementNullable: false },
              executionDefaults: { onCreate: now },
            }),
          ]),
        ],
      },
      [{ kind: 'generatedList', key: modelField('User', 'at') }],
    ],
    [
      'a generated value on a variant',
      {
        models: [
          task,
          {
            ...bug,
            fields: [scalar('severity'), scalar('at', { executionDefaults: { onCreate: now } })],
          },
        ],
      },
      [{ kind: 'generatedOnVariant', key: modelField('Bug', 'at') }],
    ],
    [
      'a generated value on a model without a collection',
      {
        models: [
          { modelName: 'Part', fields: [scalar('at', { executionDefaults: { onCreate: now } })] },
        ],
      },
      [{ kind: 'generatedWithoutCollection', key: modelField('Part', 'at') }],
    ],
    [
      'two models generating different values for one stored field',
      {
        models: [
          user([scalar('at', { executionDefaults: { onCreate: now } })]),
          {
            modelName: 'Admin',
            collection: 'users',
            fields: [scalar('at', { executionDefaults: { onUpdate: now } })],
          },
        ],
      },
      [{ kind: 'generatedConflict', key: modelField('Admin', 'at') }],
    ],
    [
      'an enum declared under another key',
      { models: [], enums: { Other: Role } },
      [{ kind: 'enumKeyMismatch', key: { kind: 'enum', enumName: 'Other' } }],
    ],
    [
      'an enum whose codec no pack provides',
      { models: [], enums: { Missing } },
      [{ kind: 'enumMemberProblem', key: { kind: 'enum', enumName: 'Missing' } }],
    ],
    [
      'a value object field typed by an undeclared enum',
      { models: [], valueObjects: [{ name: 'A', fields: [scalar('role', { enumName: 'Role' })] }] },
      [{ kind: 'enumUnknown', key: valueObjectField('A', 'role') }],
    ],
    [
      'two variants with one discriminator value',
      {
        models: [
          { ...task, discriminator: { field: 'type' } },
          bug,
          { ...bug, modelName: 'OtherBug', indexes: [] },
        ],
      },
      [{ kind: 'discriminatorValueDuplicate', key: { kind: 'base', variant: 'OtherBug' } }],
    ],
    [
      'a discriminator on an unknown field',
      { models: [{ ...task, discriminator: { field: 'kind' } }, bug] },
      [{ kind: 'discriminatorFieldUnknown', key: { kind: 'discriminator', model: 'Task' } }],
    ],
    [
      'a discriminator that is not text',
      {
        models: [
          { ...task, fields: [id, scalar('type', { type: int32Type }), scalar('title')] },
          bug,
        ],
      },
      [{ kind: 'discriminatorField', key: { kind: 'discriminator', model: 'Task' } }],
    ],
    [
      'a discriminator value the field cannot hold',
      {
        models: [
          task,
          { ...bug, base: { model: 'Task', value: { kind: 'boolean', value: true } } },
        ],
      },
      [{ kind: 'discriminatorValue', key: { kind: 'base', variant: 'Bug' } }],
    ],
    [
      'a model with both a discriminator and a base',
      { models: [task, { ...bug, discriminator: { field: 'severity' } }] },
      [{ kind: 'discriminatorAndBase', key: { kind: 'discriminator', model: 'Bug' } }],
    ],
    [
      'a listed variant that no model declares',
      {
        models: [
          { ...task, discriminator: { field: 'type', listedVariants: ['Bug', 'Ghost'] } },
          bug,
        ],
      },
      [{ kind: 'listedVariantMissing', key: { kind: 'discriminator', model: 'Task' } }],
    ],
    [
      'a base that has no discriminator',
      { models: [{ ...withoutDiscriminator(task) }, bug] },
      [{ kind: 'baseWithoutDiscriminator', key: { kind: 'base', variant: 'Bug' } }],
    ],
    [
      'a base the definition does not declare',
      { models: [bug] },
      [{ kind: 'baseUnknown', key: { kind: 'base', variant: 'Bug' } }],
    ],
    [
      'a variant without a discriminator value',
      { models: [task, { ...bug, base: { model: 'Task', value: undefined } }] },
      [{ kind: 'variantWithoutValue', key: { kind: 'base', variant: 'Bug' } }],
    ],
    [
      'a document id the validator cannot describe',
      {
        models: [
          user([]),
          { modelName: 'Doc', collection: 'docs', fields: [scalar('_id', { type: vectorType })] },
        ],
      },
      [{ kind: 'validator', key: modelField('Doc', '_id') }],
    ],
  ] satisfies readonly [string, Partial<ContractDefinition>, readonly unknown[]][])(
    'refuses %s',
    (_, overrides, expected) => {
      expect(refusalsOf(overrides)).toEqual(expected);
    },
  );
});

describe('buildMongoContractFromDefinition refusals with their whole data', () => {
  const sized = mongoDataType('test/sized', {
    read: (json) => json,
    bsonTypes: ['string'],
    params: type({ 'length?': 'number.integer >= 1' }),
  });
  const choosy = mongoDataType('test/choosy', { read: (json) => json, bsonTypes: ['string'] });
  const target = {
    ...mongoTargetPack,
    dataTypes: [...mongoTargetPack.dataTypes, sized, choosy],
    types: {
      codecTypes: {
        codecDescriptors: [
          ...mongoTargetPack.types.codecTypes.codecDescriptors,
          identityCodecDescriptor('test/sized@1', sized),
          {
            ...identityCodecDescriptor('test/choosy@1', choosy),
            factory: () => () => ({
              ...identityCodec('test/choosy@1', choosy),
              toDataTypeValue: (value: unknown) => {
                if (value === 'bad') throw new Error('bad is not allowed');
                return choosy.valueFrom(String(value), {});
              },
            }),
          },
        ],
      },
    },
  } as const;
  const stackCodecs = extractCodecLookup([mongoFamilyPack, target]);
  const { support: stackDataTypes } = assembleDataTypeSupport(
    [mongoFamilyPack, target],
    (codecId) => stackCodecs.descriptorFor(codecId)?.dataType,
  );
  const refusalsWith = (overrides: Partial<ContractDefinition>) => {
    const built = buildMongoContractFromDefinition(
      definitionOf({ target, ...overrides }),
      stackCodecs,
      stackDataTypes,
    );
    return built.ok ? [] : built.failure.refusals;
  };

  it("refuses type parameters the field's data type does not accept", () => {
    expect(
      refusalsWith({
        models: [
          user([
            scalar('code', {
              type: { kind: 'scalar', codecId: 'test/sized@1', typeParams: { length: 0 } },
            }),
          ]),
        ],
      }),
    ).toEqual([
      {
        kind: 'typeParamsInvalid',
        key: modelField('User', 'code'),
        problem: {
          dataType: 'test/sized',
          message: expect.stringContaining('test/sized: length must be'),
          parameters: ['length'],
        },
      },
    ]);
  });

  it('refuses one enum member its codec refuses', () => {
    const Grade = enumType(
      'Grade',
      { codecId: 'test/choosy@1' },
      member('Good', 'good'),
      member('Bad', 'bad'),
    );

    expect(refusalsWith({ models: [], enums: { Grade } })).toEqual([
      {
        kind: 'enumMemberProblem',
        key: { kind: 'enumMember', enumName: 'Grade', member: 'Bad' },
        enumName: 'Grade',
        codecId: 'test/choosy@1',
        problem: {
          kind: 'codec-refused-member',
          member: 'Bad',
          reason: 'bad is not allowed',
          cause: expect.any(Error),
        },
      },
    ]);
  });
});
