import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import type { ForeignKeyIndex, SqlStorage } from '@internal/sql-contract/types';
import { defineContract, type IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import { type } from 'arktype';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes, fixtureTypeLookups } from './fixture-codec-descriptors';
import { createBuiltinLikeControlMutationDefaults, interpretSqlContract } from './fixtures';

const sqlFamilyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
} as const satisfies FamilyPackRef<'sql'>;

const targetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  authoring: { type: {} },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

const hashIndexPack = {
  kind: 'extension',
  id: 'hash-index',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  indexTypes: defineIndexTypes().add('hash', { options: type('object') }),
} as const;

const authoringContributions = { type: {} } as const satisfies AuthoringContributions;

const int4Column = { codecId: 'pg/int4@1' } as const satisfies ColumnTypeDescriptor;

const backingIndex = {
  name: 'post_authorId_idx_e47547ed',
  prefix: 'post_authorId_idx',
  columns: ['authorId'],
  unique: false,
};

const namedIndex = {
  name: 'post_author_e47547ed',
  prefix: 'post_author',
  columns: ['authorId'],
  unique: false,
};

const partialIndex = {
  name: 'post_author_live_29e42dbc',
  prefix: 'post_author_live',
  columns: ['authorId'],
  where: 'id > 0',
  unique: false,
};

const hashIndex = {
  name: 'post_author_hash_94e691a2',
  prefix: 'post_author_hash',
  columns: ['authorId'],
  unique: false,
  type: 'hash',
  options: {},
};

function foreignKeyNaming(index: ForeignKeyIndex | undefined) {
  return {
    source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
    target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
    ...(index === undefined ? {} : { index }),
  };
}

interface Case {
  /** The `@relation` arguments after `fields` and `references`, and the lines of the `Post` model after its relation field. */
  readonly psl: { readonly relation?: string; readonly authorId?: string; readonly model?: string };
  /** What the TypeScript builder writes for the same contract. */
  readonly ts: {
    readonly foreignKey?: { readonly index?: boolean | string };
    readonly authorId?: 'id' | 'namedId' | 'unique' | 'namedUnique';
    readonly indexes?: readonly (
      | 'unnamed'
      | 'named'
      | 'partial'
      | 'hash'
      | 'namedByMap'
      | 'namedTwice'
    )[];
  };
}

function pslSource({ psl }: Case): string {
  const oneToOne = psl.authorId !== undefined;
  const keyedByAuthor = psl.authorId?.includes('@id') === true;
  return `model User {
  id Int @id
  ${oneToOne ? 'post Post?' : 'posts Post[]'}
  @@map("user")
}

model Post {
  id Int${keyedByAuthor ? '' : ' @id'}
  authorId Int${psl.authorId ?? ''}
  author User @relation(fields: [authorId], references: [id]${psl.relation ?? ''})
  ${psl.model ?? ''}
  @@map("post")
}
`;
}

function postTable(storage: unknown) {
  const table = (storage as SqlStorage).namespaces['public']?.entries.table?.['post'];
  return { indexes: table?.indexes, foreignKeys: table?.foreignKeys };
}

function buildFromPsl(testCase: Case) {
  const result = interpretSqlContract(pslSource(testCase), {
    target: targetPack,
    scalarColumnDescriptors: new Map([['Int', { codecId: 'pg/int4@1' }]]),
    composedExtensions: [hashIndexPack.id],
    composedExtensionPackRefs: [hashIndexPack],
    composedExtensionContracts: new Map(),
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    authoringContributions,
    createNamespace: createTestSqlNamespace,
    capabilities: {},
    ...fixtureInterpreterTypes,
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return postTable(result.value.storage);
}

function buildFromTs({ ts }: Case) {
  const contract = defineContract(
    {
      ...fixtureTypeLookups,
      family: sqlFamilyPack,
      target: targetPack,
      extensions: { hashIndex: hashIndexPack },
      createNamespace: createTestSqlNamespace,
    },
    ({ model, field, rel }) => {
      const User = model('User', { fields: { id: field.column(int4Column).id() } }).sql({
        table: 'user',
      });
      const authorIdColumn = field.column(int4Column);
      const authorId =
        ts.authorId === 'id'
          ? authorIdColumn.id()
          : ts.authorId === 'namedId'
            ? authorIdColumn.id({ name: 'post_pkey' })
            : ts.authorId === 'unique'
              ? authorIdColumn.unique()
              : ts.authorId === 'namedUnique'
                ? authorIdColumn.unique({ name: 'post_author_key' })
                : authorIdColumn;
      const Post = model('Post', {
        fields: {
          ...(ts.authorId === 'id' || ts.authorId === 'namedId'
            ? { id: field.column(int4Column) }
            : { id: field.column(int4Column).id() }),
          authorId,
        },
        relations: { author: rel.belongsTo(User, { from: 'authorId', to: 'id' }) },
      }).sql(({ cols, constraints }) => ({
        table: 'post',
        indexes: (ts.indexes ?? []).flatMap((kind): readonly IndexConstraint[] => {
          const declared = {
            unnamed: [constraints.index([cols.authorId])],
            named: [constraints.index([cols.authorId], { name: 'post_author' })],
            namedByMap: [constraints.index([cols.authorId], { map: 'post_author_by_hand' })],
            namedTwice: [
              constraints.index([cols.authorId], { map: 'post_author_by_hand' }),
              constraints.index([cols.authorId], { name: 'post_author' }),
            ],
            partial: [
              constraints.index([cols.authorId], { name: 'post_author_live', where: 'id > 0' }),
            ],
            hash: [
              constraints.index([cols.authorId], {
                name: 'post_author_hash',
                type: 'hash',
                options: {},
              }),
            ],
          };
          return declared[kind];
        }),
        foreignKeys: [constraints.foreignKey(cols.authorId, User.refs.id, ts.foreignKey)],
      }));
      return { models: { User, Post } };
    },
  );
  return postTable(contract.storage);
}

function expectBothBuilds(testCase: Case) {
  const fromPsl = buildFromPsl(testCase);
  expect(buildFromTs(testCase)).toEqual(fromPsl);
  return expect(fromPsl);
}

describe("a relation's backing index", () => {
  it('is derived when the table has no index on the foreign key columns', () => {
    expectBothBuilds({ psl: {}, ts: {} }).toEqual({
      indexes: [backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it('is the identical unnamed index the table declares', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId])' },
      ts: { indexes: ['unnamed'] },
    }).toEqual({
      indexes: [backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it('is the identical named index the table declares', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId], name: "post_author")' },
      ts: { indexes: ['named'] },
    }).toEqual({
      indexes: [namedIndex],
      foreignKeys: [foreignKeyNaming({ name: namedIndex.name })],
    });
  });

  it('is derived beside a partial index on the foreign key columns', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId], where: "id > 0", name: "post_author_live")' },
      ts: { indexes: ['partial'] },
    }).toEqual({
      indexes: [partialIndex, backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it('is derived beside a typed index on the foreign key columns', () => {
    expectBothBuilds({
      psl: { model: '@@index([authorId], type: "hash", options: {}, name: "post_author_hash")' },
      ts: { indexes: ['hash'] },
    }).toEqual({
      indexes: [hashIndex, backingIndex],
      foreignKeys: [foreignKeyNaming({ name: backingIndex.name })],
    });
  });

  it.each([
    ['an unnamed unique constraint', '@unique', 'unique', { unique: true }],
    [
      'a named unique constraint',
      '@unique(map: "post_author_key")',
      'namedUnique',
      { unique: true },
    ],
  ] as const)('is %s on the foreign key columns', (_label, attribute, authorId, index) => {
    const fromPsl = buildFromPsl({ psl: { authorId: ` ${attribute}` }, ts: {} });
    expect(fromPsl).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming(index)] });
    expect(buildFromTs({ psl: {}, ts: { authorId } })).toEqual(fromPsl);
  });

  it.each([
    ['an unnamed primary key', '@id', 'id', { primaryKey: true }],
    ['a named primary key', '@id(map: "post_pkey")', 'namedId', { primaryKey: true }],
  ] as const)('is %s on the foreign key columns', (_label, attribute, authorId, index) => {
    const fromPsl = buildFromPsl({ psl: { authorId: ` ${attribute}` }, ts: {} });
    expect(fromPsl).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming(index)] });
    expect(buildFromTs({ psl: {}, ts: { authorId } })).toEqual(fromPsl);
  });

  it('is absent for index: false', () => {
    expectBothBuilds({
      psl: { relation: ', index: false' },
      ts: { foreignKey: { index: false } },
    }).toEqual({ indexes: [], foreignKeys: [foreignKeyNaming(undefined)] });
  });

  it('is the partial index the relation names', () => {
    expectBothBuilds({
      psl: {
        relation: ', index: "post_author_live"',
        model: '@@index([authorId], where: "id > 0", name: "post_author_live")',
      },
      ts: { foreignKey: { index: 'post_author_live' }, indexes: ['partial'] },
    }).toEqual({
      indexes: [partialIndex],
      foreignKeys: [foreignKeyNaming({ name: partialIndex.name })],
    });
  });

  it('refuses a name the table does not declare', () => {
    const message =
      'The foreign key on table "post" columns (authorId) names "post_author_gone" as its index, but table "post" has no index, unique constraint or primary key with that name.';
    expect(() =>
      buildFromPsl({ psl: { relation: ', index: "post_author_gone"' }, ts: {} }),
    ).toThrow(message);
    expect(() =>
      buildFromTs({ psl: {}, ts: { foreignKey: { index: 'post_author_gone' } } }),
    ).toThrow(message);
  });

  it('keeps two identical named indexes and warns about them', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const fromPsl = buildFromPsl({
        psl: {
          model:
            '@@index([authorId], map: "post_author_by_hand")\n  @@index([authorId], name: "post_author")',
        },
        ts: {},
      });
      expect(buildFromTs({ psl: {}, ts: { indexes: ['namedTwice'] } })).toEqual(fromPsl);
      expect(fromPsl).toEqual({
        indexes: [
          { name: 'post_author_by_hand', columns: ['authorId'], unique: false },
          namedIndex,
        ],
        foreignKeys: [foreignKeyNaming({ name: 'post_author_by_hand' })],
      });
      expect(emitWarning.mock.calls).toEqual([
        [
          'Indexes "post_author_by_hand" and "post_author" on table "post" are identical: they have the same columns, type, options, predicate and uniqueness. The contract keeps both because each is named. Remove one of them.',
          { code: 'PN_INDEX_DUPLICATE' },
        ],
        [
          'Indexes "post_author_by_hand" and "post_author" on table "post" are identical: they have the same columns, type, options, predicate and uniqueness. The contract keeps both because each is named. Remove one of them.',
          { code: 'PN_INDEX_DUPLICATE' },
        ],
      ]);
    } finally {
      emitWarning.mockRestore();
    }
  });
});
