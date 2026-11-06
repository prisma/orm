import { assembleDataTypeSupport } from '@internal/framework-components/authoring';
import { extractCodecLookup } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoContractFromDefinition } from '../src/build-contract';
import { field } from '../src/contract-builder';
import type {
  ContractDefinition,
  FieldNode,
  IndexNode,
  ModelNode,
} from '../src/contract-definition';
import {
  mergeRedundantIndexes,
  refusalAtWrittenPositions,
  writtenIndexPosition,
} from '../src/merge-redundant-indexes';
import { nameIndexes } from '../src/name-indexes';
import { mongoFamilyPack, mongoTargetPack } from './mongo-test-packs';

const codecLookup = extractCodecLookup([mongoFamilyPack, mongoTargetPack]);
const { support: dataTypes } = assembleDataTypeSupport(
  [mongoFamilyPack, mongoTargetPack],
  (codecId) => codecLookup.descriptorFor(codecId)?.dataType,
);
const stringType = field.string().__type;

function scalar(fieldName: string): FieldNode {
  return { fieldName, type: stringType, nullable: false, many: false };
}

const fields = [
  { ...scalar('_id'), type: field.objectId().__type },
  scalar('type'),
  scalar('a'),
  scalar('b'),
  scalar('c'),
];

function inUsers(modelName: string, indexes: readonly IndexNode[]): ModelNode {
  return { modelName, collection: 'users', fields, indexes };
}

function definitionOf(models: readonly ModelNode[]): ContractDefinition {
  return {
    target: mongoTargetPack,
    models,
    writesCollectionValidators: false,
    warnings: undefined,
  };
}

function merged(models: readonly ModelNode[]): ContractDefinition {
  return mergeRedundantIndexes(nameIndexes(definitionOf(models)), codecLookup, dataTypes)
    .definition;
}

function buildMerged(models: readonly ModelNode[]) {
  return buildMongoContractFromDefinition(merged(models), codecLookup, dataTypes);
}

function indexesOf(models: readonly ModelNode[]): unknown {
  const built = buildMerged(models);
  if (!built.ok) throw new Error(`refused: ${JSON.stringify(built.failure.refusals)}`);
  const collections =
    built.value.contract.storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries['collection'];
  return JSON.parse(JSON.stringify(collections?.['users']))['indexes'];
}

const a = [{ field: 'a', direction: 1 }];
const ab = [
  { field: 'a', direction: 1 },
  { field: 'b', direction: 1 },
];

describe('mergeRedundantIndexes', () => {
  it.each<[string, readonly IndexNode[]]>([
    [
      'the unique index first',
      [{ fields: { a: 1 }, options: { unique: true } }, { fields: { a: 1 } }],
    ],
    [
      'the unique index second',
      [{ fields: { a: 1 } }, { fields: { a: 1 }, options: { unique: true } }],
    ],
  ])('keeps one unique index for a unique and a plain index on one field, %s', (_, indexes) => {
    expect(indexesOf([inUsers('User', indexes)])).toEqual([
      { kind: 'mongo-index', name: 'a_1', keys: a, unique: true },
    ]);
  });

  it('keeps one unique index for a unique and a plain index on the same compound keys', () => {
    expect(
      indexesOf([
        inUsers('User', [
          { fields: { a: 1, b: 1 }, options: { unique: true } },
          { fields: { a: 1, b: 1 } },
        ]),
      ]),
    ).toEqual([{ kind: 'mongo-index', name: 'a_1_b_1', keys: ab, unique: true }]);
  });

  it("drops a later model's plain index that an earlier model's unique index makes redundant", () => {
    expect(
      indexesOf([
        inUsers('User', [{ fields: { a: 1 }, options: { unique: true } }]),
        inUsers('Admin', [{ fields: { a: 1 } }, { fields: { b: 1 } }]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1', keys: a, unique: true },
      { kind: 'mongo-index', name: 'b_1', keys: [{ field: 'b', direction: 1 }] },
    ]);
  });

  it('keeps two indexes on the same field in opposite directions', () => {
    expect(indexesOf([inUsers('User', [{ fields: { a: 1 } }, { fields: { a: -1 } }])])).toEqual([
      { kind: 'mongo-index', name: 'a_1', keys: a },
      { kind: 'mongo-index', name: 'a_-1', keys: [{ field: 'a', direction: -1 }] },
    ]);
  });

  it('keeps an index on a field whose stored name spells another index', () => {
    const odd = { ...scalar('odd'), storedName: 'a:1,b' };
    expect(
      indexesOf([
        {
          ...inUsers('User', [{ fields: { a: 1, b: 1 } }, { fields: { odd: 1 } }]),
          fields: [...fields, odd],
        },
      ]),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1_b_1', keys: ab },
      { kind: 'mongo-index', name: 'a:1,b_1', keys: [{ field: 'a:1,b', direction: 1 }] },
    ]);
  });

  it('keeps two indexes on the same fields in another order', () => {
    expect(
      indexesOf([inUsers('User', [{ fields: { a: 1, b: 1 } }, { fields: { b: 1, a: 1 } }])]),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1_b_1', keys: ab },
      {
        kind: 'mongo-index',
        name: 'b_1_a_1',
        keys: [
          { field: 'b', direction: 1 },
          { field: 'a', direction: 1 },
        ],
      },
    ]);
  });

  it("keeps a later model's unique index at its own position and removes an earlier model's plain one", () => {
    expect(
      indexesOf([
        inUsers('User', [{ fields: { a: 1 } }, { fields: { b: 1 } }]),
        inUsers('Admin', [{ fields: { c: 1 } }, { fields: { a: 1 }, options: { unique: true } }]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', name: 'b_1', keys: [{ field: 'b', direction: 1 }] },
      { kind: 'mongo-index', name: 'c_1', keys: [{ field: 'c', direction: 1 }] },
      { kind: 'mongo-index', name: 'a_1', keys: a, unique: true },
    ]);
  });

  it('keeps the first of two identical indexes on one model', () => {
    expect(
      indexesOf([
        inUsers('User', [
          { fields: { a: 1 }, options: { sparse: true } },
          { fields: { b: 1 } },
          { fields: { a: 1 }, options: { sparse: true } },
        ]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1', keys: a, sparse: true },
      { kind: 'mongo-index', name: 'b_1', keys: [{ field: 'b', direction: 1 }] },
    ]);
  });

  it('keeps the first of two identical indexes on two models in one collection', () => {
    expect(
      indexesOf([
        inUsers('User', [{ fields: { a: 1 }, options: { unique: true } }]),
        inUsers('Admin', [{ fields: { b: 1 } }, { fields: { a: 1 }, options: { unique: true } }]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1', keys: a, unique: true },
      { kind: 'mongo-index', name: 'b_1', keys: [{ field: 'b', direction: 1 }] },
    ]);
  });

  it('keeps one text index for identical text indexes on two models in one collection', () => {
    expect(
      indexesOf([
        inUsers('User', [{ fields: { a: 'text' } }]),
        inUsers('Admin', [{ fields: { a: 'text' } }]),
      ]),
    ).toEqual([{ kind: 'mongo-index', name: 'a_text', keys: [{ field: 'a', direction: 'text' }] }]);
  });

  it.each<[string, IndexNode['options']]>([
    ['unique', { unique: false }],
    ['sparse', { sparse: false }],
  ])('counts %s set to false as unset', (_, options) => {
    expect(
      indexesOf([
        inUsers('User', [
          { fields: { a: 1 }, ...(options ? { options } : {}) },
          { fields: { a: 1 } },
        ]),
      ]),
    ).toEqual([{ kind: 'mongo-index', name: 'a_1', keys: a, ...options }]);
  });

  it.each<[string, IndexNode['options']]>([
    ['collation', { collation: { locale: 'fr' } }],
    ['partial filter', { partialFilterExpression: { b: 'x' } }],
    ['sparse', { sparse: true }],
    ['TTL', { expireAfterSeconds: 60 }],
  ])('keeps two named indexes on the same keys whose %s differs', (_, options) => {
    expect(
      indexesOf([
        inUsers('User', [
          { fields: { a: 1 }, ...(options ? { options } : {}) },
          { fields: { a: 1 }, options: { name: 'a_plain' } },
        ]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', name: 'a_1', keys: a, ...options },
      { kind: 'mongo-index', name: 'a_plain', keys: a },
    ]);
  });

  it('leaves two unnamed indexes on the same keys whose options differ for the builder to refuse by their one name', () => {
    const built = buildMerged([
      inUsers('User', [{ fields: { a: 1 }, options: { sparse: true } }, { fields: { a: 1 } }]),
    ]);
    expect(built.ok ? [] : built.failure.refusals).toEqual([
      {
        kind: 'indexNameDuplicate',
        key: { kind: 'index', model: 'User', position: 1 },
        collection: 'users',
        name: 'a_1',
        firstModel: 'User',
        firstPosition: 0,
      },
    ]);
  });

  it('keeps two identical indexes with different names for the builder to refuse', () => {
    const named: IndexNode = { fields: { a: 1 }, options: { name: 'by_a' } };
    expect(merged([inUsers('User', [{ fields: { a: 1 } }, named])]).models[0]?.indexes).toEqual([
      { fields: { a: 1 }, options: { name: 'a_1' } },
      named,
    ]);
  });

  it('merges a unique and a plain index that a name gives the same name', () => {
    expect(
      indexesOf([
        inUsers('User', [
          { fields: { a: 1 }, options: { unique: true, name: 'by_a' } },
          { fields: { a: 1 }, options: { name: 'by_a' } },
        ]),
      ]),
    ).toEqual([{ kind: 'mongo-index', name: 'by_a', keys: a, unique: true }]);
  });

  it('keeps the named indexes two variants write on the same field, scoped to each variant', () => {
    const variant = (modelName: string, value: string): ModelNode => ({
      modelName,
      collection: 'users',
      fields: [scalar('c')],
      indexes: [{ fields: { c: 1 }, options: { name: `${value}_c` } }],
      base: { model: 'User', value: { kind: 'string', text: value } },
    });

    expect(
      indexesOf([
        {
          ...inUsers('User', []),
          fields: fields.slice(0, 2),
          discriminator: { field: 'type', listedVariants: ['Bug', 'Feature'] },
        },
        variant('Bug', 'bug'),
        variant('Feature', 'feature'),
      ]),
    ).toEqual([
      {
        kind: 'mongo-index',
        name: 'bug_c',
        keys: [{ field: 'c', direction: 1 }],
        partialFilterExpression: { type: 'bug' },
      },
      {
        kind: 'mongo-index',
        name: 'feature_c',
        keys: [{ field: 'c', direction: 1 }],
        partialFilterExpression: { type: 'feature' },
      },
    ]);
  });

  it("keeps one of two identical indexes a variant writes, scoped to the variant's value", () => {
    expect(
      indexesOf([
        {
          ...inUsers('User', []),
          fields: fields.slice(0, 2),
          discriminator: { field: 'type' },
        },
        {
          modelName: 'Bug',
          fields: [scalar('c')],
          indexes: [{ fields: { c: 1 } }, { fields: { c: 1 } }],
          base: { model: 'User', value: { kind: 'string', text: 'bug' } },
        },
      ]),
    ).toEqual([
      {
        kind: 'mongo-index',
        name: 'c_1',
        keys: [{ field: 'c', direction: 1 }],
        partialFilterExpression: { type: 'bug' },
      },
    ]);
  });

  it('removes the merged indexes from the models that wrote them and reports their positions', () => {
    const plain: IndexNode = { fields: { a: 1 }, options: { name: 'a_1' } };
    const other: IndexNode = { fields: { b: 1 }, options: { name: 'b_1' } };
    const unique: IndexNode = { fields: { a: 1 }, options: { unique: true, name: 'a_1' } };
    const result = mergeRedundantIndexes(
      definitionOf([inUsers('User', [plain, other]), inUsers('Admin', [unique, other])]),
      codecLookup,
      dataTypes,
    );

    expect({
      indexes: result.definition.models.map((model) => model.indexes),
      removedIndexes: result.removedIndexes,
    }).toEqual({
      indexes: [[other], [unique]],
      removedIndexes: [
        { model: 'User', position: 0 },
        { model: 'Admin', position: 1 },
      ],
    });
  });

  it('returns the definition it is given when no index merges', () => {
    const definition = nameIndexes(
      definitionOf([inUsers('User', [{ fields: { a: 1 } }, { fields: { b: 1 } }])]),
    );
    expect(mergeRedundantIndexes(definition, codecLookup, dataTypes)).toEqual({
      definition,
      removedIndexes: [],
    });
  });

  it.each<[string, IndexNode]>([
    ['on an unknown field', { fields: { nope: 1 }, options: { name: 'nope_1' } }],
    [
      'with a shape MongoDB refuses',
      { fields: { '$**': 1 }, options: { unique: true, name: '$**_1' } },
    ],
  ])('leaves two identical indexes %s for the builder to refuse', (_, index) => {
    expect(merged([inUsers('User', [index, index])]).models[0]?.indexes).toEqual([index, index]);
  });

  it('leaves two identical variant indexes whose filter contradicts the discriminator value for the builder to refuse', () => {
    const conflicting: IndexNode = {
      fields: { c: 1 },
      options: { partialFilterExpression: { type: 'x' }, name: 'c_1' },
    };
    const models = merged([
      {
        ...inUsers('User', []),
        fields: fields.slice(0, 2),
        discriminator: { field: 'type' },
      },
      {
        modelName: 'Bug',
        fields: [scalar('c')],
        indexes: [conflicting, conflicting],
        base: { model: 'User', value: { kind: 'string', text: 'bug' } },
      },
    ]).models;
    expect(models[1]?.indexes).toEqual([conflicting, conflicting]);
  });

  it('skips a model stored in no collection', () => {
    const embedded: ModelNode = { modelName: 'Address', fields, indexes: [{ fields: { a: 1 } }] };
    expect(merged([embedded, embedded]).models.map((model) => model.indexes)).toEqual([
      [{ fields: { a: 1 }, options: { name: 'a_1' } }],
      [{ fields: { a: 1 }, options: { name: 'a_1' } }],
    ]);
  });
});

describe('refusalAtWrittenPositions', () => {
  const removed = [
    { model: 'User', position: 1 },
    { model: 'User', position: 3 },
  ];

  it('counts positions as the model wrote its indexes, before the merge removed some', () => {
    expect([0, 1, 2].map((position) => writtenIndexPosition(removed, 'User', position))).toEqual([
      0, 2, 4,
    ]);
    expect(writtenIndexPosition(removed, 'Admin', 1)).toBe(1);
  });

  it('maps the index and the first index of a refusal, and leaves other refusals alone', () => {
    const key = { kind: 'index', model: 'User', position: 1 } as const;
    expect({
      shape: refusalAtWrittenPositions(
        { kind: 'indexShape', key, rule: 'unique-wildcard', signature: '{}' },
        removed,
      ).key,
      duplicate: refusalAtWrittenPositions(
        {
          kind: 'indexNameDuplicate',
          key,
          collection: 'users',
          name: 'n',
          firstModel: 'User',
          firstPosition: 0,
        },
        removed,
      ),
      model: refusalAtWrittenPositions(
        { kind: 'duplicateModel', key: { kind: 'model', model: 'User' } },
        removed,
      ),
    }).toEqual({
      shape: { ...key, position: 2 },
      duplicate: {
        kind: 'indexNameDuplicate',
        key: { ...key, position: 2 },
        collection: 'users',
        name: 'n',
        firstModel: 'User',
        firstPosition: 0,
      },
      model: { kind: 'duplicateModel', key: { kind: 'model', model: 'User' } },
    });
  });
});
