import { assembleDataTypeSupport } from '@internal/framework-components/authoring';
import { extractCodecLookup } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { buildMongoContractFromDefinition } from '../src/build-contract';
import { field } from '../src/contract-builder';
import type { FieldNode, IndexNode, ModelNode } from '../src/contract-definition';
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

function indexesOf(models: readonly ModelNode[]): unknown {
  const built = buildMongoContractFromDefinition(
    { target: mongoTargetPack, models, writesCollectionValidators: false, warnings: undefined },
    codecLookup,
    dataTypes,
  );
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

describe('the builder merges identical and redundant indexes in a collection', () => {
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
      { kind: 'mongo-index', keys: a, unique: true },
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
    ).toEqual([{ kind: 'mongo-index', keys: ab, unique: true }]);
  });

  it("drops a later model's plain index that an earlier model's unique index makes redundant", () => {
    expect(
      indexesOf([
        inUsers('User', [{ fields: { a: 1 }, options: { unique: true } }]),
        inUsers('Admin', [{ fields: { a: 1 } }, { fields: { b: 1 } }]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', keys: a, unique: true },
      { kind: 'mongo-index', keys: [{ field: 'b', direction: 1 }] },
    ]);
  });

  it('keeps two indexes on the same field in opposite directions', () => {
    expect(indexesOf([inUsers('User', [{ fields: { a: 1 } }, { fields: { a: -1 } }])])).toEqual([
      { kind: 'mongo-index', keys: a },
      { kind: 'mongo-index', keys: [{ field: 'a', direction: -1 }] },
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
      { kind: 'mongo-index', keys: ab },
      { kind: 'mongo-index', keys: [{ field: 'a:1,b', direction: 1 }] },
    ]);
  });

  it('keeps two indexes on the same fields in another order', () => {
    expect(
      indexesOf([inUsers('User', [{ fields: { a: 1, b: 1 } }, { fields: { b: 1, a: 1 } }])]),
    ).toEqual([
      { kind: 'mongo-index', keys: ab },
      {
        kind: 'mongo-index',
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
      { kind: 'mongo-index', keys: [{ field: 'b', direction: 1 }] },
      { kind: 'mongo-index', keys: [{ field: 'c', direction: 1 }] },
      { kind: 'mongo-index', keys: a, unique: true },
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
      { kind: 'mongo-index', keys: a, sparse: true },
      { kind: 'mongo-index', keys: [{ field: 'b', direction: 1 }] },
    ]);
  });

  it('keeps the first of two identical indexes on two models in one collection', () => {
    expect(
      indexesOf([
        inUsers('User', [{ fields: { a: 1 }, options: { unique: true } }]),
        inUsers('Admin', [{ fields: { b: 1 } }, { fields: { a: 1 }, options: { unique: true } }]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', keys: a, unique: true },
      { kind: 'mongo-index', keys: [{ field: 'b', direction: 1 }] },
    ]);
  });

  it('keeps one text index for identical text indexes on two models in one collection', () => {
    expect(
      indexesOf([
        inUsers('User', [{ fields: { a: 'text' } }]),
        inUsers('Admin', [{ fields: { a: 'text' } }]),
      ]),
    ).toEqual([{ kind: 'mongo-index', keys: [{ field: 'a', direction: 'text' }] }]);
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
    ).toEqual([{ kind: 'mongo-index', keys: a, ...options }]);
  });

  it.each<[string, IndexNode['options']]>([
    ['collation', { collation: { locale: 'fr' } }],
    ['partial filter', { partialFilterExpression: { b: 'x' } }],
    ['sparse', { sparse: true }],
    ['TTL', { expireAfterSeconds: 60 }],
  ])('keeps two indexes on the same keys whose %s differs', (_, options) => {
    expect(
      indexesOf([
        inUsers('User', [
          { fields: { a: 1 }, ...(options ? { options } : {}) },
          { fields: { a: 1 } },
        ]),
      ]),
    ).toEqual([
      { kind: 'mongo-index', keys: a, ...options },
      { kind: 'mongo-index', keys: a },
    ]);
  });

  it('keeps the indexes two variants write on the same field, scoped to each variant', () => {
    const variant = (modelName: string, value: string): ModelNode => ({
      modelName,
      collection: 'users',
      fields: [scalar('c')],
      indexes: [{ fields: { c: 1 } }],
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
        keys: [{ field: 'c', direction: 1 }],
        partialFilterExpression: { type: 'bug' },
      },
      {
        kind: 'mongo-index',
        keys: [{ field: 'c', direction: 1 }],
        partialFilterExpression: { type: 'feature' },
      },
    ]);
  });
});
