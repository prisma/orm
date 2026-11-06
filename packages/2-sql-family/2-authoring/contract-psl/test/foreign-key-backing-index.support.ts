import type { AuthoringContributions } from '@internal/framework-components/authoring';
import type { ColumnTypeDescriptor } from '@internal/framework-components/codec';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { sql } from '@internal/sql-contract/sql-expression';
import type { ForeignKeyIndex, SqlStorage } from '@internal/sql-contract/types';
import { defineContract, type IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import { type } from 'arktype';
import { expect } from 'vitest';
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
  indexTypes: defineIndexTypes()
    .add('hash', { options: type('object') })
    .add('btree', { options: type('object') }),
} as const;

const authoringContributions = { type: {} } as const satisfies AuthoringContributions;

const int4Column = { codecId: 'pg/int4@1' } as const satisfies ColumnTypeDescriptor;

export const backingIndex = {
  name: 'post_authorId_idx_e47547ed',
  prefix: 'post_authorId_idx',
  columns: ['authorId'],
  unique: false,
};

export const namedIndex = {
  name: 'post_author_e47547ed',
  prefix: 'post_author',
  columns: ['authorId'],
  unique: false,
};

export const partialIndex = {
  name: 'post_author_live_29e42dbc',
  prefix: 'post_author_live',
  columns: ['authorId'],
  where: 'id > 0',
  unique: false,
};

export const hashIndex = {
  name: 'post_author_hash_94e691a2',
  prefix: 'post_author_hash',
  columns: ['authorId'],
  unique: false,
  type: 'hash',
  options: {},
};

export function foreignKeyNaming(index: ForeignKeyIndex | undefined) {
  return {
    source: { namespaceId: 'public', tableName: 'post', columns: ['authorId'] },
    target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
    ...(index === undefined ? {} : { index }),
  };
}

export interface Case {
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
      | 'btree'
      | 'byId'
      | 'partialNamedLikeKey'
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

export function interpretPost(testCase: Case) {
  return interpretSchema(pslSource(testCase));
}

export function interpretSchema(source: string) {
  return interpretSqlContract(source, {
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
}

export function buildFromPsl(testCase: Case) {
  const result = interpretPost(testCase);
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return postTable(result.value.storage);
}

export function buildFromTs({ ts }: Case) {
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
              constraints.index([cols.authorId], { name: 'post_author_live', where: sql`id > 0` }),
            ],
            hash: [
              constraints.index([cols.authorId], {
                name: 'post_author_hash',
                type: 'hash',
                options: {},
              }),
            ],
            btree: [
              constraints.index([cols.authorId], {
                name: 'post_author',
                type: 'btree',
                options: {},
              }),
            ],
            byId: [constraints.index([cols.id], { name: 'post_by_id' })],
            partialNamedLikeKey: [
              constraints.index([cols.authorId], { map: 'post_author_key', where: sql`id > 0` }),
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

export function expectBothBuilds(testCase: Case) {
  const fromPsl = buildFromPsl(testCase);
  expect(buildFromTs(testCase)).toEqual(fromPsl);
  return expect(fromPsl);
}
