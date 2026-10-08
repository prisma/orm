import { asNamespaceId } from '@internal/contract/types';
import type { AuthoringWarning } from '@internal/framework-components/authoring';
import { nameOf } from '@internal/sql-schema-ir/naming';
import { describe, expect, it } from 'vitest';
import {
  type ForeignKeyAuthoringInput,
  materializeForeignKeysAndIndexes,
} from '../src/foreign-key-materialization';
import type { IndexCandidate } from '../src/index-deduplication';
import { lowerAuthoredIndex } from '../src/index-naming';
import type { ForeignKeyIndex } from '../src/ir/foreign-key';

const namespaceId = asNamespaceId('public');

function foreignKey(
  columns: readonly string[],
  intent: Pick<ForeignKeyAuthoringInput, 'constraint' | 'index'>,
): ForeignKeyAuthoringInput {
  return {
    source: { namespaceId, tableName: 'post', columns },
    target: { namespaceId, tableName: 'user', columns: ['id'] },
    ...intent,
  };
}

function reference(columns: readonly string[], index?: ForeignKeyIndex) {
  return {
    source: { namespaceId, tableName: 'post', columns },
    target: { namespaceId, tableName: 'user', columns: ['id'] },
    ...(index === undefined ? {} : { index }),
  };
}

const partialIndex: IndexCandidate = {
  index: lowerAuthoredIndex('post', {
    columns: ['author_id'],
    where: 'archived_at IS NULL',
    unique: undefined,
    map: undefined,
    name: 'post_author_live',
    type: undefined,
    options: undefined,
  }),
  namedByUser: true,
};

function unnamedIndexOn(columns: readonly string[], map?: string): IndexCandidate {
  return {
    index: lowerAuthoredIndex('post', {
      columns,
      where: undefined,
      unique: undefined,
      map,
      name: undefined,
      type: undefined,
      options: undefined,
    }),
    namedByUser: map !== undefined,
  };
}

const derivedAuthorIndex = {
  naming: { kind: 'wire', prefix: 'post_author_id_idx', hash: 'f3862461' },
  columns: ['author_id'],
  where: undefined,
  unique: false,
  type: undefined,
  options: undefined,
};

function materialize(input: {
  readonly foreignKeys: readonly ForeignKeyAuthoringInput[];
  readonly declaredIndexes?: readonly IndexCandidate[];
  readonly uniques?: readonly { readonly columns: readonly string[]; readonly name?: string }[];
  readonly primaryKey?: { readonly columns: readonly string[]; readonly name?: string };
}) {
  const warnings: AuthoringWarning[] = [];
  return materializeForeignKeysAndIndexes({
    tableName: 'post',
    foreignKeys: input.foreignKeys,
    declaredIndexes: input.declaredIndexes ?? [],
    uniques: input.uniques ?? [],
    primaryKey: input.primaryKey,
    warnings,
  });
}

describe('materializeForeignKeysAndIndexes', () => {
  it('derives a backing index and names it on the foreign key', () => {
    expect(
      materialize({ foreignKeys: [foreignKey(['author_id'], { constraint: true, index: true })] }),
    ).toEqual({
      foreignKeys: [reference(['author_id'], { name: 'post_author_id_idx_f3862461' })],
      indexes: [derivedAuthorIndex],
    });
  });

  it('derives one backing index for two foreign keys on the same columns', () => {
    expect(
      materialize({
        foreignKeys: [
          foreignKey(['author_id'], { constraint: true, index: true }),
          foreignKey(['author_id'], { constraint: true, index: true }),
        ],
      }),
    ).toEqual({
      foreignKeys: [
        reference(['author_id'], { name: 'post_author_id_idx_f3862461' }),
        reference(['author_id'], { name: 'post_author_id_idx_f3862461' }),
      ],
      indexes: [derivedAuthorIndex],
    });
  });

  it('derives no backing index and names none for index: false', () => {
    expect(
      materialize({ foreignKeys: [foreignKey(['author_id'], { constraint: true, index: false })] }),
    ).toEqual({ foreignKeys: [reference(['author_id'])], indexes: [] });
  });

  it('derives the backing index of a foreign key without a constraint', () => {
    expect(
      materialize({ foreignKeys: [foreignKey(['author_id'], { constraint: false, index: true })] }),
    ).toEqual({ foreignKeys: [], indexes: [derivedAuthorIndex] });
  });

  it('points a foreign key at the declared index its index argument names', () => {
    expect(
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_live' })],
        declaredIndexes: [partialIndex],
      }),
    ).toEqual({
      foreignKeys: [reference(['author_id'], { name: 'post_author_live_8ae1cbe7' })],
      indexes: [partialIndex.index],
    });
  });

  it.each([
    [
      'unique constraint',
      { uniques: [{ columns: ['author_id'], name: 'post_author_key' }] },
      { unique: true },
    ],
    [
      'primary key',
      { primaryKey: { columns: ['author_id'], name: 'post_author_key' } },
      { primaryKey: true },
    ],
  ] as const)('points a foreign key at the %s its index argument names', (_label, table, index) => {
    expect(
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_key' })],
        ...table,
      }),
    ).toEqual({ foreignKeys: [reference(['author_id'], index)], indexes: [] });
  });

  it.each([
    ['unique constraint', { uniques: [{ columns: ['author_id'] }] }, { unique: true }],
    ['primary key', { primaryKey: { columns: ['author_id'] } }, { primaryKey: true }],
  ] as const)('backs a foreign key by an unnamed %s on its columns', (_label, table, index) => {
    expect(
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: true })],
        ...table,
      }),
    ).toEqual({ foreignKeys: [reference(['author_id'], index)], indexes: [] });
  });

  it.each([
    [
      'unique constraint',
      { uniques: [{ columns: ['author_id', 'id'], name: 'post_author_key' }] },
      { unique: true },
    ],
    [
      'primary key',
      { primaryKey: { columns: ['author_id', 'id'], name: 'post_author_key' } },
      { primaryKey: true },
    ],
  ] as const)(
    'accepts a %s whose first columns are the foreign key columns',
    (_label, table, index) => {
      expect(
        materialize({
          foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_key' })],
          ...table,
        }),
      ).toEqual({ foreignKeys: [reference(['author_id'], index)], indexes: [] });
    },
  );

  it.each([
    [
      'unique constraint',
      { uniques: [{ columns: ['id', 'author_id'], name: 'post_author_key' }] },
      '(id, author_id)',
    ],
    [
      'primary key',
      { primaryKey: { columns: ['id', 'author_id'], name: 'post_author_key' } },
      '(id, author_id)',
    ],
    ['index', { declaredIndexes: [unnamedIndexOn(['title'], 'post_author_key')] }, '(title)'],
  ] as const)(
    'refuses a %s whose first columns are not the foreign key columns',
    (_label, table, columns) => {
      expect(() =>
        materialize({
          foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_key' })],
          ...table,
        }),
      ).toThrow(
        `The foreign key on table "post" columns (author_id) names "post_author_key" as its index, but its columns ${columns} do not start with the foreign key's columns, so it does not serve the foreign key's lookups.`,
      );
    },
  );

  it('refuses an expression index', () => {
    const expression: IndexCandidate = {
      index: lowerAuthoredIndex('post', {
        expression: 'lower(title)',
        where: undefined,
        unique: undefined,
        map: 'post_title_lower',
        name: undefined,
        type: undefined,
        options: undefined,
      }),
      namedByUser: true,
    };
    expect(() =>
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_title_lower' })],
        declaredIndexes: [expression],
      }),
    ).toThrow(
      `The foreign key on table "post" columns (author_id) names "post_title_lower" as its index, but it indexes an expression, not the foreign key's columns, so it does not serve the foreign key's lookups.`,
    );
  });

  it('accepts an index whose first columns are the foreign key columns', () => {
    const composite = unnamedIndexOn(['author_id', 'title'], 'post_author_title');
    expect(
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_title' })],
        declaredIndexes: [composite],
      }),
    ).toEqual({
      foreignKeys: [reference(['author_id'], { name: nameOf(composite.index.naming) })],
      indexes: [composite.index],
    });
  });

  it('refuses the default name of an unnamed index', () => {
    expect(() =>
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_id_idx' })],
        declaredIndexes: [unnamedIndexOn(['author_id'])],
      }),
    ).toThrow(
      'The foreign key on table "post" columns (author_id) names "post_author_id_idx" as its index, but table "post" has no index, unique constraint or primary key with that name.',
    );
  });

  it('accepts the stored name two identical unnamed indexes share, which merge into one', () => {
    const first = unnamedIndexOn(['author_id']);
    expect(
      materialize({
        foreignKeys: [
          foreignKey(['author_id'], { constraint: true, index: 'post_author_id_idx_f3862461' }),
        ],
        declaredIndexes: [first, unnamedIndexOn(['author_id'])],
      }),
    ).toEqual({
      foreignKeys: [reference(['author_id'], { name: 'post_author_id_idx_f3862461' })],
      indexes: [first.index],
    });
  });

  it('refuses a name that an index and a key share', () => {
    expect(() =>
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_key' })],
        declaredIndexes: [unnamedIndexOn(['author_id'], 'post_author_key')],
        uniques: [{ columns: ['author_id'], name: 'post_author_key' }],
      }),
    ).toThrow(
      'The foreign key on table "post" columns (author_id) names "post_author_key" as its index, but table "post" has more than one index, unique constraint or primary key with that name.',
    );
  });

  it('follows a removed backing index through every index that replaced it', () => {
    const unnamed: IndexCandidate = {
      index: lowerAuthoredIndex('post', {
        columns: ['author_id'],
        where: undefined,
        unique: undefined,
        map: undefined,
        name: undefined,
        type: undefined,
        options: undefined,
      }),
      namedByUser: false,
    };

    expect(
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: true })],
        declaredIndexes: [unnamed],
        uniques: [{ columns: ['author_id'] }],
      }),
    ).toEqual({ foreignKeys: [reference(['author_id'], { unique: true })], indexes: [] });
  });

  it('refuses an index argument that names nothing on the table', () => {
    expect(() =>
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_gone' })],
        declaredIndexes: [partialIndex],
      }),
    ).toThrow(
      'The foreign key on table "post" columns (author_id) names "post_author_gone" as its index, but table "post" has no index, unique constraint or primary key with that name.',
    );
  });

  it('refuses an index argument that names two indexes', () => {
    const typed: IndexCandidate = {
      index: lowerAuthoredIndex('post', {
        columns: ['author_id'],
        where: undefined,
        unique: undefined,
        map: undefined,
        name: 'post_author_live',
        type: 'hash',
        options: undefined,
      }),
      namedByUser: true,
    };

    expect(() =>
      materialize({
        foreignKeys: [foreignKey(['author_id'], { constraint: true, index: 'post_author_live' })],
        declaredIndexes: [partialIndex, typed],
      }),
    ).toThrow(
      'The foreign key on table "post" columns (author_id) names "post_author_live" as its index, but table "post" has more than one index, unique constraint or primary key with that name.',
    );
  });
});
