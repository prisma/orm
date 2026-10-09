import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { sql } from '@internal/sql-contract/sql-expression';
import { WIRE_NAME_PREFIX_MAX_BYTES } from '@internal/sql-schema-ir/naming';
import { describe, expect, it, vi } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { type ContractInput, defineContract, field, model, rel } from '../src/contract-builder';
import { columnDescriptor } from './helpers/column-descriptor';
import { testIndexPack } from './helpers/test-index-pack';
import { unboundTables } from './unbound-tables';

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

function defineTestContract<
  const Types extends NonNullable<ContractInput['types']> = Record<never, never>,
  const Models extends NonNullable<ContractInput['models']> = Record<never, never>,
  const Extensions extends NonNullable<ContractInput['extensions']> | undefined = undefined,
>(
  definition: Omit<
    ContractInput<typeof bareFamilyPack, typeof postgresTargetPack, Types, Models, Extensions>,
    'family' | 'target' | 'createNamespace' | 'codecLookup' | 'dataTypeLookup'
  >,
) {
  return defineContract({
    ...testTypeLookups,
    family: bareFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...definition,
  });
}

describe('index naming at TS lowering', () => {
  it('unnamed index lowers wire-named with the default prefix and a content-hash wire name', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email])],
        })),
      },
    });

    expect(unboundTables(contract.storage)['user']!.indexes).toEqual([
      {
        name: 'user_email_idx_46df9cad',
        prefix: 'user_email_idx',
        columns: ['email'],
        unique: false,
      },
    ]);
  });

  it('named index lowers wire-named with the authored name as prefix', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email], { name: 'user_email_lookup' })],
        })),
      },
    });

    expect(unboundTables(contract.storage)['user']!.indexes).toEqual([
      {
        name: 'user_email_lookup_46df9cad',
        prefix: 'user_email_lookup',
        columns: ['email'],
        unique: false,
      },
    ]);
  });

  it('type and options participate in the wire hash', () => {
    const contract = defineContract(
      {
        ...testTypeLookups,
        family: bareFamilyPack,
        target: postgresTargetPack,
        extensions: { testIndexes: testIndexPack },
        createNamespace: createTestSqlNamespace,
      },
      ({ model: helperModel, field: helperField }) => ({
        models: {
          Doc: helperModel('Doc', {
            fields: {
              id: helperField.column(int4Column).id(),
              body: helperField.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'doc',
            indexes: [
              constraints.index([cols.body], { type: 'bm25', options: { key_field: 'id' } }),
            ],
          })),
        },
      }),
    );

    expect(unboundTables(contract.storage)['doc']!.indexes).toEqual([
      {
        name: 'doc_body_idx_a755c485',
        prefix: 'doc_body_idx',
        columns: ['body'],
        unique: false,
        type: 'bm25',
        options: { key_field: 'id' },
      },
    ]);
  });

  it('FK-backing index materializes wire-named with the default FK-index name as prefix', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'user' });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: { index: true } }),
      },
    }).sql({ table: 'post' });

    const contract = defineTestContract({ models: { User, Post } });

    expect(unboundTables(contract.storage)['post']!.indexes).toEqual([
      {
        name: 'post_userId_idx_a489d58a',
        prefix: 'post_userId_idx',
        columns: ['userId'],
        unique: false,
      },
    ]);
  });

  it('truncates a synthesized FK-backing index prefix to the 54-byte cap', () => {
    const Category = model('Category', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'category' });

    const CategoryPost = model('CategoryPost', {
      fields: {
        id: field.column(int4Column).id(),
        categoryId: field.column(int4Column).sql({ column: 'categoryId_AtMap' }),
      },
      relations: {
        category: rel
          .belongsTo(Category, { from: 'categoryId', to: 'id' })
          .sql({ fk: { index: true } }),
      },
    }).sql({ table: 'CategoriesOnPostsManyToMany_AtAtMap' });

    const contract = defineTestContract({ models: { Category, CategoryPost } });

    expect(unboundTables(contract.storage)['CategoriesOnPostsManyToMany_AtAtMap']!.indexes).toEqual(
      [
        {
          name: 'CategoriesOnPostsManyToMany_AtAtMap_categoryId_AtMap_i_4870b374',
          prefix: 'CategoriesOnPostsManyToMany_AtAtMap_categoryId_AtMap_i',
          columns: ['categoryId_AtMap'],
          unique: false,
        },
      ],
    );
  });

  it('truncates a synthesized FK-backing index prefix without splitting multibyte mapped names', () => {
    const mappedTable = 'я'.repeat(28);
    const mappedColumn = 'категорияId';
    const Category = model('Category', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'category' });

    const CategoryPost = model('CategoryPost', {
      fields: {
        id: field.column(int4Column).id(),
        categoryId: field.column(int4Column).sql({ column: mappedColumn }),
      },
      relations: {
        category: rel
          .belongsTo(Category, { from: 'categoryId', to: 'id' })
          .sql({ fk: { index: true } }),
      },
    }).sql({ table: mappedTable });

    const contract = defineTestContract({ models: { Category, CategoryPost } });
    const [index] = unboundTables(contract.storage)[mappedTable]!.indexes;
    const synthesizedPrefix = `${mappedTable}_${mappedColumn}_idx`;

    expect(index).toMatchObject({
      prefix: 'я'.repeat(27),
      columns: [mappedColumn],
      unique: false,
    });
    expect(Buffer.byteLength(index?.prefix ?? '', 'utf8')).toBeLessThanOrEqual(
      WIRE_NAME_PREFIX_MAX_BYTES,
    );
    expect(synthesizedPrefix.startsWith(index?.prefix ?? '')).toBe(true);
  });

  it('rejects an authored index name over the 54-byte prefix cap', () => {
    const longName = 'a'.repeat(55);
    expect(() =>
      defineTestContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'user',
            indexes: [constraints.index([cols.email], { name: longName })],
          })),
        },
      }),
    ).toThrow(new RegExp(`"${longName}" exceeds the 54-byte maximum`));
  });
});

describe('constraints.index — full matrix', () => {
  it('the expression overload lowers a wire-named expression index', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ constraints }) => ({
          table: 'user',
          indexes: [constraints.index({ expression: sql`lower(email)`, name: 'users_email_eq' })],
        })),
      },
    });

    expect(unboundTables(contract.storage)['user']!.indexes).toEqual([
      {
        name: 'users_email_eq_17273133',
        prefix: 'users_email_eq',
        expression: 'lower(email)',
        unique: false,
      },
    ]);
  });

  it('where and unique thread through the fields overload', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [
            constraints.index([cols.email], {
              where: sql`(deleted_at IS NULL)`,
              unique: true,
              name: 'users_email_active',
            }),
          ],
        })),
      },
    });

    const index = unboundTables(contract.storage)['user']!.indexes[0];
    expect(index).toMatchObject({
      prefix: 'users_email_active',
      columns: ['email'],
      where: '(deleted_at IS NULL)',
      unique: true,
    });
  });

  it('the fields overload accepts map for an exact physical name', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email], { map: 'users_email_adopted' })],
        })),
      },
    });

    expect(unboundTables(contract.storage)['user']!.indexes).toEqual([
      { name: 'users_email_adopted', columns: ['email'], unique: false },
    ]);
  });

  it('map with an expression lowers exact and draws the exact-name body warning', () => {
    const emitWarning = vi.spyOn(process, 'emitWarning').mockImplementation(() => {});
    try {
      const contract = defineTestContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql(({ constraints }) => ({
            table: 'user',
            indexes: [
              constraints.index({ expression: sql`lower(email)`, map: 'users_email_adopted' }),
            ],
          })),
        },
      });
      expect(unboundTables(contract.storage)['user']!.indexes).toEqual([
        { name: 'users_email_adopted', expression: 'lower(email)', unique: false },
      ]);
      expect(emitWarning).toHaveBeenCalledTimes(1);
      expect(String(emitWarning.mock.calls[0]?.[0])).toContain(
        'index "users_email_adopted" uses map: with a SQL body.',
      );
    } finally {
      emitWarning.mockRestore();
    }
  });

  it('an expression without name or map is rejected by the shared guard', () => {
    let caught: unknown;
    try {
      defineTestContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql(({ constraints }) => ({
            table: 'user',
            indexes: [constraints.index({ expression: sql`lower(email)` })],
          })),
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('expression index requires an explicit name'),
    });
  });

  it('name combined with map is rejected by the shared guard', () => {
    let caught: unknown;
    try {
      defineTestContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).id(),
              email: field.column(textColumn),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'user',
            indexes: [
              constraints.index([cols.email], { name: 'users_email_idx', map: 'users_email' }),
            ],
          })),
        },
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('map and name are mutually exclusive'),
    });
  });
});
