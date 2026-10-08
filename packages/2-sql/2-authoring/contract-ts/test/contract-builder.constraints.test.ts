import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
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

function buildUserModel() {
  return model('User', {
    fields: {
      id: field.column(int4Column).id(),
      email: field.column(textColumn),
    },
  }).sql({ table: 'user' });
}

function buildPostModel(
  User: ReturnType<typeof buildUserModel>,
  fkOptions?: {
    readonly name?: string;
    readonly onDelete?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly onUpdate?: 'noAction' | 'restrict' | 'cascade' | 'setNull' | 'setDefault';
    readonly constraint?: boolean;
    readonly index?: boolean;
  },
) {
  return model('Post', {
    fields: {
      id: field.column(int4Column).id(),
      userId: field.column(int4Column),
    },
    relations: {
      user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: fkOptions ?? {} }),
    },
  }).sql({ table: 'post' });
}

describe('contract definition constraint support', () => {
  it('emits unique constraints in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.uniques).toHaveLength(1);
    expect(unboundTables(contract.storage)['user']!.uniques[0]).toEqual({ columns: ['email'] });
  });

  it('emits unique constraints with names in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique({ name: 'user_email_unique' }),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.uniques).toHaveLength(1);
    expect(unboundTables(contract.storage)['user']!.uniques[0]).toEqual({
      columns: ['email'],
      name: 'user_email_unique',
    });
  });

  it('emits indexes in the contract', () => {
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

    expect(unboundTables(contract.storage)['user']!.indexes).toHaveLength(1);
    expect(unboundTables(contract.storage)['user']!.indexes[0]).toEqual({
      name: 'user_email_idx_46df9cad',
      prefix: 'user_email_idx',
      columns: ['email'],
      unique: false,
    });
  });

  it('emits indexes with names in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email], { name: 'user_email_idx' })],
        })),
      },
    });

    expect(unboundTables(contract.storage)['user']!.indexes).toHaveLength(1);
    expect(unboundTables(contract.storage)['user']!.indexes[0]).toEqual({
      name: 'user_email_idx_46df9cad',
      prefix: 'user_email_idx',
      columns: ['email'],
      unique: false,
    });
  });

  it('emits foreign keys in the contract naming their backing index', () => {
    const User = buildUserModel();
    const Post = buildPostModel(User);
    const contract = defineTestContract({
      models: { User, Post },
    });

    expect(unboundTables(contract.storage)['post']!.foreignKeys).toEqual([
      {
        source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
        target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
        index: 'post_userId_idx_a489d58a',
      },
    ]);
  });

  it('emits foreign keys with names in the contract', () => {
    const User = buildUserModel();
    const Post = buildPostModel(User, { name: 'post_userId_fkey' });
    const contract = defineTestContract({
      models: { User, Post },
    });

    expect(unboundTables(contract.storage)['post']!.foreignKeys).toEqual([
      {
        source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
        target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
        name: 'post_userId_fkey',
        index: 'post_userId_idx_a489d58a',
      },
    ]);
  });

  it('emits primary key without name when not provided', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.primaryKey).toEqual({
      columns: ['id'],
    });
    expect(unboundTables(contract.storage)['user']!.primaryKey).not.toHaveProperty('name');
  });

  it('emits primary key name in the contract', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id({ name: 'user_pkey' }),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(unboundTables(contract.storage)['user']!.primaryKey).toEqual({
      columns: ['id'],
      name: 'user_pkey',
    });
  });

  it('rejects duplicate named storage objects during build', () => {
    expect(() =>
      defineTestContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).id({ name: 'user_pkey_e8a52337' }),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'user',
            indexes: [constraints.index([cols.id], { name: 'user_pkey' })],
          })),
        },
      }),
    ).toThrow(/Contract semantic validation failed:.*user_pkey/);

    expect(() =>
      defineTestContract({
        models: {
          User: model('User', {
            fields: {
              id: field.column(int4Column).id({ name: 'user_pkey_e8a52337' }),
            },
          }).sql(({ cols, constraints }) => ({
            table: 'user',
            indexes: [constraints.index([cols.id], { name: 'user_pkey' })],
          })),
        },
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED' }));
  });

  it('throws a contextual error when an extension pack declares a malformed indexTypes value', () => {
    const malformedIndexPack = {
      kind: 'extension',
      id: 'malformed-pack',
      familyId: 'sql',
      targetId: 'postgres',
      version: '0.0.1',
      indexTypes: 'oops',
    } as const;

    expect(() =>
      defineContract({
        ...testTypeLookups,
        family: bareFamilyPack,
        target: postgresTargetPack,
        // The pack is intentionally malformed for this test; the runtime
        // shape check is what we want to exercise.
        extensions: { malformed: malformedIndexPack as unknown as typeof testIndexPack },
        createNamespace: createTestSqlNamespace,
        models: {
          Doc: model('Doc', {
            fields: {
              id: field.column(int4Column).id(),
            },
          }).sql({ table: 'doc' }),
        },
      }),
    ).toThrow(/malformed-pack/);
  });

  it('throws at authoring time when an index uses an unregistered type', () => {
    expect(() =>
      defineContract(
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
                constraints.index([cols.body], {
                  // @ts-expect-error - exercise the authoring-time runtime validator on an unregistered type literal.
                  type: 'made-up',
                  options: {},
                }),
              ],
            })),
          },
        }),
      ),
    ).toThrow(/unregistered index type "made-up"/);
  });

  it('leaves out unnamed indexes on the columns of a unique constraint', () => {
    const contract = defineTestContract({
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn).unique(),
            username: field.column(textColumn).unique(),
          },
        }).sql(({ cols, constraints }) => ({
          table: 'user',
          indexes: [constraints.index([cols.email]), constraints.index([cols.username])],
        })),
      },
    });

    expect(unboundTables(contract.storage)['user']!.uniques).toEqual([
      { columns: ['email'] },
      { columns: ['username'] },
    ]);
    expect(unboundTables(contract.storage)['user']!.indexes).toEqual([]);
  });

  describe('FK1: constraint/index materialize into discrete entities', () => {
    it('a default FK (constraint=true, index=true) emits a foreign key naming its derived backing index', () => {
      const User = buildUserModel();
      const Post = buildPostModel(User);
      const contract = defineTestContract({
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.foreignKeys).toEqual([
        {
          source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
          index: 'post_userId_idx_a489d58a',
        },
      ]);
      expect(post.indexes).toEqual([
        {
          name: 'post_userId_idx_a489d58a',
          prefix: 'post_userId_idx',
          columns: ['userId'],
          unique: false,
        },
      ]);
    });

    it('index=false emits the FK constraint entry and no backing index', () => {
      const User = buildUserModel();
      const Post = buildPostModel(User, { index: false });
      const contract = defineTestContract({
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.foreignKeys).toEqual([
        {
          source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
        },
      ]);
      expect(post.indexes).toEqual([]);
    });

    it('constraint=false emits no foreignKeys entry but keeps the backing index (index defaults true)', () => {
      const User = buildUserModel();
      const Post = buildPostModel(User, { constraint: false });
      const contract = defineTestContract({
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.foreignKeys).toEqual([]);
      expect(post.indexes).toEqual([
        {
          name: 'post_userId_idx_a489d58a',
          prefix: 'post_userId_idx',
          columns: ['userId'],
          unique: false,
        },
      ]);
    });

    it('constraint=false and index=false emits neither a foreignKeys entry nor an index', () => {
      const User = buildUserModel();
      const Post = buildPostModel(User, { constraint: false, index: false });
      const contract = defineTestContract({
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.foreignKeys).toEqual([]);
      expect(post.indexes).toEqual([]);
    });

    it('derives no backing index when an unnamed unique constraint has the FK columns', () => {
      const User = buildUserModel();
      const Post = model('Post', {
        fields: {
          id: field.column(int4Column).id(),
          userId: field.column(int4Column).unique(),
        },
        relations: {
          user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
        },
      }).sql({ table: 'post' });
      const contract = defineTestContract({
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.uniques).toEqual([{ columns: ['userId'] }]);
      expect(post.foreignKeys).toEqual([
        {
          source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
        },
      ]);
      expect(post.indexes).toEqual([]);
    });

    it('foreignKeyDefaults materializes the same way as a per-FK override', () => {
      const User = buildUserModel();
      const Post = buildPostModel(User);
      const contract = defineTestContract({
        foreignKeyDefaults: { constraint: false, index: true },
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.foreignKeys).toEqual([]);
      expect(post.indexes).toEqual([
        {
          name: 'post_userId_idx_a489d58a',
          prefix: 'post_userId_idx',
          columns: ['userId'],
          unique: false,
        },
      ]);
    });

    it('per-FK override takes precedence over foreignKeyDefaults', () => {
      const User = buildUserModel();
      const Post = buildPostModel(User, { constraint: true, index: false });
      const contract = defineTestContract({
        foreignKeyDefaults: { constraint: false, index: false },
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.foreignKeys).toEqual([
        {
          source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
        },
      ]);
      expect(post.indexes).toEqual([]);
    });

    it('points the FK at an identical unnamed @@index instead of deriving a second one', () => {
      const User = buildUserModel();
      const Post = model('Post', {
        fields: {
          id: field.column(int4Column).id(),
          userId: field.column(int4Column),
        },
        relations: {
          user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
        },
      }).sql(({ cols, constraints }) => ({
        table: 'post',
        indexes: [constraints.index([cols.userId])],
      }));
      const contract = defineTestContract({
        models: { User, Post },
      });

      const post = unboundTables(contract.storage)['post']!;
      expect(post.indexes).toEqual([
        {
          name: 'post_userId_idx_a489d58a',
          prefix: 'post_userId_idx',
          columns: ['userId'],
          unique: false,
        },
      ]);
      expect(post.foreignKeys).toEqual([
        {
          source: { namespaceId: 'public', tableName: 'post', columns: ['userId'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
          index: 'post_userId_idx_a489d58a',
        },
      ]);
    });

    it('derives no backing index when an unnamed primary key has the FK columns', () => {
      const User = buildUserModel();
      const Profile = model('Profile', {
        fields: {
          userId: field.column(int4Column).id(),
        },
        relations: {
          user: rel.belongsTo(User, { from: 'userId', to: 'id' }).sql({ fk: {} }),
        },
      }).sql({ table: 'profile' });
      const contract = defineTestContract({
        models: { User, Profile },
      });

      const profile = unboundTables(contract.storage)['profile']!;
      expect(profile.primaryKey).toEqual({ columns: ['userId'] });
      expect(profile.foreignKeys).toEqual([
        {
          source: { namespaceId: 'public', tableName: 'profile', columns: ['userId'] },
          target: { namespaceId: 'public', tableName: 'user', columns: ['id'] },
        },
      ]);
      expect(profile.indexes).toEqual([]);
    });

    it('synthesizes the backing index once when two FKs share the same source columns', () => {
      const TargetA = model('TargetA', {
        fields: { id: field.column(int4Column).id() },
      }).sql({ table: 'target_a' });
      const TargetB = model('TargetB', {
        fields: { id: field.column(int4Column).id() },
      }).sql({ table: 'target_b' });
      const Link = model('Link', {
        fields: {
          id: field.column(int4Column).id(),
          sourceId: field.column(int4Column),
        },
        relations: {
          a: rel.belongsTo(TargetA, { from: 'sourceId', to: 'id' }).sql({ fk: {} }),
          b: rel.belongsTo(TargetB, { from: 'sourceId', to: 'id' }).sql({ fk: {} }),
        },
      }).sql({ table: 'link' });
      const contract = defineTestContract({
        models: { TargetA, TargetB, Link },
      });

      const link = unboundTables(contract.storage)['link']!;
      expect(link.foreignKeys).toEqual([
        {
          source: { namespaceId: 'public', tableName: 'link', columns: ['sourceId'] },
          target: { namespaceId: 'public', tableName: 'target_a', columns: ['id'] },
          index: 'link_sourceId_idx_d92a2571',
        },
        {
          source: { namespaceId: 'public', tableName: 'link', columns: ['sourceId'] },
          target: { namespaceId: 'public', tableName: 'target_b', columns: ['id'] },
          index: 'link_sourceId_idx_d92a2571',
        },
      ]);
      expect(link.indexes).toEqual([
        {
          name: 'link_sourceId_idx_d92a2571',
          prefix: 'link_sourceId_idx',
          columns: ['sourceId'],
          unique: false,
        },
      ]);
    });
  });

  it('supports compound ids and uniques through attributes', () => {
    const contract = defineTestContract({
      models: {
        Membership: model('Membership', {
          fields: {
            orgId: field.column(textColumn),
            userId: field.column(textColumn),
            role: field.column(textColumn),
          },
        })
          .attributes(({ fields, constraints }) => ({
            id: constraints.id([fields.orgId, fields.userId], { name: 'membership_pkey' }),
            uniques: [
              constraints.unique([fields.orgId, fields.role], {
                name: 'membership_org_role_key',
              }),
            ],
          }))
          .sql({ table: 'membership' }),
      },
    });

    expect(unboundTables(contract.storage)['membership']!.primaryKey).toEqual({
      columns: ['orgId', 'userId'],
      name: 'membership_pkey',
    });
    expect(unboundTables(contract.storage)['membership']!.uniques).toEqual([
      {
        columns: ['orgId', 'role'],
        name: 'membership_org_role_key',
      },
    ]);
  });
});
