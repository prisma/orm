import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { defineContract, field, model, rel } from '../src/contract-builder';

import { columnDescriptor } from './helpers/column-descriptor';
import { unboundTables } from './unbound-tables';

type PortableSqlCodecTypes = {
  readonly 'sql/char@1': { output: string };
  readonly 'sql/text@1': { output: string };
  readonly 'test/timestamp@1': { output: string };
};

type PortableTargetPack<TTarget extends string> = TargetPackRef<'sql', TTarget> & {
  readonly __codecTypes?: PortableSqlCodecTypes;
};

const bareFamilyPack: FamilyPackRef<'sql'> = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
};

const postgresTargetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
} as const satisfies PortableTargetPack<'postgres'>;

const sqliteTargetPack = {
  kind: 'target',
  id: 'sqlite',
  familyId: 'sql',
  targetId: 'sqlite',
  version: '0.0.1',
  defaultNamespaceId: '__unbound__',
} as const satisfies PortableTargetPack<'sqlite'>;

const uuidColumn = columnDescriptor('sql/char@1', 'character', { length: 36 });
const textColumn = columnDescriptor('sql/text@1');
const portableTimestampColumn = columnDescriptor('test/timestamp@1');

function buildPortableContract<TTarget extends string>(target: PortableTargetPack<TTarget>) {
  const UserBase = model('User', {
    fields: {
      id: field.column(uuidColumn).id({ name: 'app_user_pkey' }),
      email: field.column(textColumn).unique({ name: 'app_user_email_key' }),
      createdAt: field.column(portableTimestampColumn).defaultSql('CURRENT_TIMESTAMP'),
    },
  }).sql({
    table: 'app_user',
  });

  const Post = model('Post', {
    fields: {
      id: field.column(uuidColumn).id({ name: 'blog_post_pkey' }),
      authorId: field.column(uuidColumn),
      title: field.column(textColumn),
    },
    relations: {
      author: rel.belongsTo(UserBase, { from: 'authorId', to: 'id' }),
    },
  }).sql(({ cols, constraints }) => ({
    table: 'blog_post',
    foreignKeys: [
      constraints.foreignKey([cols.authorId], [UserBase.refs['id']!], {
        name: 'blog_post_author_id_fkey',
        onDelete: 'cascade',
      }),
    ],
  }));

  const User = UserBase.relations({
    posts: rel.hasMany(() => Post, { by: 'authorId' }),
  });

  return defineContract({
    family: bareFamilyPack,
    target,
    createNamespace: createTestSqlNamespace,
    naming: { tables: 'snake_case', columns: 'snake_case' },
    storageHash: 'portable-contract-dsl',
    models: {
      User,
      Post,
    },
  });
}

describe('contract DSL portability coverage', () => {
  it('keeps portable contracts identical across postgres and sqlite target swaps', () => {
    const postgresContract = buildPortableContract(postgresTargetPack);
    const sqliteContract = buildPortableContract(sqliteTargetPack);
    const postgresStorageTables = unboundTables(postgresContract.storage) as Record<
      string,
      { readonly columns: Record<string, unknown> }
    >;

    expect(postgresContract.target).toBe('postgres');
    expect(sqliteContract.target).toBe('sqlite');
    expect(postgresStorageTables['app_user']?.columns['created_at']).toMatchObject({
      codecId: 'test/timestamp@1',
      nativeType: 'timestamp',
      default: {
        kind: 'function',
        expression: 'CURRENT_TIMESTAMP',
      },
    });
    expect(postgresStorageTables['blog_post']?.columns['author_id']).toMatchObject({
      codecId: 'sql/char@1',
      nativeType: 'character',
      typeParams: { length: 36 },
    });

    const stripNamespaceIds = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(stripNamespaceIds);
      }
      if (value !== null && typeof value === 'object') {
        const record = value as Record<string, unknown>;
        if ('namespaceId' in record) {
          const { namespaceId: _namespaceId, ...withoutNamespaceId } = record;
          return stripNamespaceIds(withoutNamespaceId);
        }
        if ('namespace' in record) {
          const { namespace: _namespace, ...withoutNamespace } = record;
          return stripNamespaceIds(withoutNamespace);
        }
        return Object.fromEntries(
          Object.entries(record).map(([key, entry]) => [key, stripNamespaceIds(entry)]),
        );
      }
      return value;
    };

    const stripTargetProfileAndStorageHashes = (c: Record<string, unknown>) => {
      const { target: _t, profileHash: _p, storage, domain, roots, ...rest } = c;
      const {
        storageHash: _sh,
        namespaces: _ns,
        ...storageRest
      } = storage as Record<string, unknown>;
      const domainNamespaces = (domain as { namespaces: Record<string, { models: unknown }> })
        .namespaces;
      const models = Object.fromEntries(
        Object.entries(
          Object.assign(
            {},
            ...Object.values(domainNamespaces).map(
              (slice) => slice.models as Record<string, unknown>,
            ),
          ),
        ).map(([modelName, model]) => {
          const typedModel = model as {
            relations?: Record<string, { to: { model: string; namespace?: string } }>;
          };
          if (typedModel.relations === undefined) {
            return [modelName, model];
          }
          return [
            modelName,
            {
              ...typedModel,
              relations: Object.fromEntries(
                Object.entries(typedModel.relations).map(([relationName, relation]) => [
                  relationName,
                  {
                    ...relation,
                    to: { model: relation.to.model },
                  },
                ]),
              ),
            },
          ];
        }),
      );
      return stripNamespaceIds({
        ...rest,
        roots,
        domain: { namespaces: { default: { models } } },
        storage: {
          ...storageRest,
          tables: unboundTables(c['storage'] as Parameters<typeof unboundTables>[0]),
        },
      }) as Record<string, unknown>;
    };

    expect(
      stripTargetProfileAndStorageHashes(sqliteContract as unknown as Record<string, unknown>),
    ).toEqual(
      stripTargetProfileAndStorageHashes(postgresContract as unknown as Record<string, unknown>),
    );
  });
});
