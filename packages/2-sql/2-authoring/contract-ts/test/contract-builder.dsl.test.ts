import type { Contract } from '@internal/contract/types';
import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { type ContractInput, defineContract, field, model, rel } from '../src/contract-builder';
import { modelsMapForAssertions, modelsOf } from './contract-test-helpers';
import { crossRef } from './cross-ref-helpers';

import { columnDescriptor } from './helpers/column-descriptor';
import { unboundTables } from './unbound-tables';

const typecheckOnly = process.env['PN_TYPECHECK_ONLY'] === 'true';

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

const int4Column = columnDescriptor('pg/int4@1');
const textColumn = columnDescriptor('pg/text@1');
const timestamptzTemporalColumn = columnDescriptor('pg/timestamptz-temporal@1');

function defineTestContract<
  const Definition extends Omit<ContractInput, 'target' | 'family' | 'createNamespace'>,
>(definition: Definition) {
  return defineContract({
    family: bareFamilyPack,
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    ...definition,
  });
}

type OwnershipRelationCase = {
  readonly label: 'hasMany' | 'hasOne';
  readonly relationName: 'posts' | 'profile';
  readonly targetModelName: 'Post' | 'Profile';
  readonly targetTable: 'blog_post' | 'user_profile';
  readonly expectedCardinality: '1:N' | '1:1';
};

function buildOwnershipRelationContract(ownershipCase: OwnershipRelationCase) {
  const User = model('User', {
    fields: {
      id: field.column(textColumn).id(),
      ...(ownershipCase.label === 'hasMany' ? { email: field.column(textColumn) } : {}),
    },
  });

  const Target = model(ownershipCase.targetModelName, {
    fields: {
      id: field.column(textColumn).id(),
      userId: field.column(textColumn).column('user_id'),
      ...(ownershipCase.label === 'hasMany' ? { title: field.column(textColumn) } : {}),
    },
  });

  return defineTestContract({
    models: {
      User: User.relations({
        [ownershipCase.relationName]:
          ownershipCase.label === 'hasMany'
            ? rel.hasMany(Target, { by: 'userId' })
            : rel.hasOne(() => Target, { by: 'userId' }),
      }).sql({
        table: 'app_user',
      }),
      [ownershipCase.targetModelName]: Target.relations({
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      }).sql(({ cols, constraints }) => ({
        table: ownershipCase.targetTable,
        foreignKeys: [constraints.foreignKey([cols.userId], [User.refs['id']!])],
      })),
    },
  });
}

describe('contract DSL authoring surface', () => {
  it('lowers inline ids and uniques while keeping sql focused on table/index/fk concerns', () => {
    const types = {
      Role: {
        kind: 'codec-instance',
        codecId: 'app/test-enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    } as const;

    const UserBase = model('User', {
      fields: {
        id: field
          .generated({
            type: textColumn,
            generated: { kind: 'generator', id: 'uuidv4' },
          })
          .id({ name: 'app_user_pkey' }),
        email: field.column(textColumn).unique({ name: 'app_user_email_key' }),
        role: field.namedType(types.Role),
        createdAt: field.column(timestamptzTemporalColumn).column('created_at').defaultSql('now()'),
      },
    }).sql({
      table: 'app_user',
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id({ name: 'blog_post_pkey' }),
        userId: field.column(textColumn).column('user_id'),
        title: field.column(textColumn),
      },
      relations: {
        user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'blog_post',
      indexes: [constraints.index([cols.userId], { name: 'blog_post_user_id_idx' })],
      foreignKeys: [
        constraints.foreignKey([cols.userId], [UserBase.refs['id']!], {
          name: 'blog_post_user_id_fkey',
          onDelete: 'cascade',
        }),
      ],
    }));

    const User = UserBase.relations({
      posts: rel.hasMany(() => Post, { by: 'userId' }),
    });

    const contract = defineTestContract({
      storageHash: 'contract-dsl',
      foreignKeyDefaults: { constraint: true, index: false },
      types,
      models: {
        User,
        Post,
      },
    });
    const storageTables = unboundTables(contract.storage) as Record<
      string,
      {
        readonly primaryKey?: unknown;
        readonly uniques?: unknown;
        readonly indexes?: unknown;
        readonly foreignKeys?: unknown;
        readonly columns: Record<
          string,
          { readonly default?: unknown; readonly typeRef?: unknown }
        >;
      }
    >;

    expect(contract.target).toBe('postgres');
    expect(contract.storage.storageHash).toBe('contract-dsl');
    expect(storageTables['app_user']).toMatchObject({
      primaryKey: { columns: ['id'], name: 'app_user_pkey' },
      uniques: [{ columns: ['email'], name: 'app_user_email_key' }],
    });
    expect(storageTables['blog_post']).toMatchObject({
      primaryKey: { columns: ['id'], name: 'blog_post_pkey' },
      indexes: [
        {
          name: 'blog_post_user_id_idx_6c952402',
          prefix: 'blog_post_user_id_idx',
          columns: ['user_id'],
          unique: false,
        },
      ],
    });

    const appUserColumns = storageTables['app_user']?.columns;
    expect(appUserColumns?.['created_at']?.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
    expect(appUserColumns?.['role']?.typeRef).toBe('Role');
    expect(storageTables['blog_post']?.foreignKeys).toEqual([
      {
        source: { namespaceId: 'public', tableName: 'blog_post', columns: ['user_id'] },
        target: { namespaceId: 'public', tableName: 'app_user', columns: ['id'] },
        name: 'blog_post_user_id_fkey',
        onDelete: 'cascade',
      },
    ]);
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'app_user', column: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
    const modelsByName = modelsOf(contract) as Record<
      string,
      {
        fields: Record<string, unknown>;
        relations: Record<string, unknown>;
        storage: { namespaceId: '__unbound__'; table: string; fields: Record<string, unknown> };
      }
    >;
    expect(modelsByName['User']?.storage.fields['createdAt']).toEqual({ column: 'created_at' });
    expect(modelsByName['Post']?.storage.fields['userId']).toEqual({ column: 'user_id' });
    expect(modelsByName['User']?.relations).toMatchObject({
      posts: {
        to: crossRef('Post', 'public'),
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['userId'],
        },
      },
    });
    expect(modelsByName['Post']?.relations).toMatchObject({
      user: {
        to: crossRef('User', 'public'),
        cardinality: 'N:1',
        on: {
          localFields: ['userId'],
          targetFields: ['id'],
        },
      },
    });
  });

  it('keeps field and belongsTo storage overrides local when possible', () => {
    const User = model('User', {
      fields: {
        id: field
          .column(textColumn)
          .id()
          .sql({ id: { name: 'app_user_pkey' } }),
        email: field
          .column(textColumn)
          .unique()
          .sql({ unique: { name: 'app_user_email_key' } }),
      },
    }).sql({
      table: 'app_user',
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id({ name: 'blog_post_pkey' }),
        authorId: field.column(textColumn).sql({ column: 'author_id' }),
        createdAt: field.column(timestamptzTemporalColumn).sql({ column: 'created_at' }),
      },
      relations: {
        author: rel
          .belongsTo(User, { from: 'authorId', to: 'id' })
          .sql({ fk: { name: 'blog_post_author_id_fkey', onDelete: 'cascade' } }),
      },
    }).sql({
      table: 'blog_post',
    });

    const contract = defineTestContract({
      foreignKeyDefaults: { constraint: true, index: false },
      models: {
        User,
        Post,
      },
    });

    const tables = unboundTables(contract.storage) as Record<
      string,
      {
        primaryKey?: unknown;
        uniques?: unknown;
        foreignKeys?: unknown;
        columns: Record<string, unknown>;
      }
    >;
    const models = modelsMapForAssertions(contract);
    expect(tables['app_user']?.primaryKey).toEqual({
      columns: ['id'],
      name: 'app_user_pkey',
    });
    expect(tables['app_user']?.uniques).toEqual([
      {
        columns: ['email'],
        name: 'app_user_email_key',
      },
    ]);
    expect(tables['blog_post']?.columns['author_id']).toBeDefined();
    expect(tables['blog_post']?.columns['created_at']).toBeDefined();
    expect(tables['blog_post']?.foreignKeys).toEqual([
      {
        source: {
          namespaceId: 'public',
          tableName: 'blog_post',
          columns: ['author_id'],
        },
        target: { namespaceId: 'public', tableName: 'app_user', columns: ['id'] },
        name: 'blog_post_author_id_fkey',
        onDelete: 'cascade',
      },
    ]);
    expect(models['Post']?.storage.fields['authorId']).toEqual({ column: 'author_id' });
    expect(models['Post']?.storage.fields['createdAt']).toEqual({ column: 'created_at' });
  });

  it.each([
    [
      'unique',
      () =>
        field.column(textColumn).sql({
          unique: { name: 'user_email_key' },
        }),
      /field\.sql\(\{ unique \}\) requires an existing inline \.unique/,
    ],
    [
      'id',
      () =>
        field.column(textColumn).sql({
          id: { name: 'user_pkey' },
        }),
      /field\.sql\(\{ id \}\) requires an existing inline \.id/,
    ],
  ] as const)(
    'rejects field-local %s overlays without the semantic declaration',
    (_label, run, error) => {
      expect(run).toThrow(error);
    },
  );

  it('supports token-based many-to-many relations with lazy through refs', () => {
    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(textColumn).column('post_id'),
        tagId: field.column(textColumn).column('tag_id'),
      },
    }).sql({
      table: 'post_tag',
    });

    const PostBase = model('Post', {
      fields: {
        id: field.column(textColumn).id(),
        title: field.column(textColumn),
      },
    }).sql({
      table: 'post',
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(textColumn).id(),
        label: field.column(textColumn),
      },
      relations: {
        posts: rel.manyToMany(PostBase, {
          through: () => PostTag,
          from: 'tagId',
          to: 'postId',
        }),
      },
    }).sql({
      table: 'tag',
    });

    const Post = PostBase.relations({
      tags: rel.manyToMany(() => Tag, {
        through: () => PostTag,
        from: 'postId',
        to: 'tagId',
      }),
    });

    const contract = defineTestContract({
      models: {
        Post,
        Tag,
        PostTag,
      },
    });

    const modelsByName = modelsOf(contract) as Record<
      string,
      { relations: Record<string, unknown> }
    >;
    expect(modelsByName['Post']?.relations).toMatchObject({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
      },
    });
    expect(modelsByName['Tag']?.relations).toMatchObject({
      posts: {
        to: crossRef('Post', 'public'),
        cardinality: 'N:M',
      },
    });
  });

  it('rejects duplicate named storage objects in the refined sql overlay', () => {
    const User = model('User', {
      fields: {
        id: field.column(textColumn).id({ name: 'app_user_pkey_e8a52337' }),
      },
    }).sql(({ cols, constraints }) => ({
      table: 'app_user',
      indexes: [constraints.index([cols.id], { name: 'app_user_pkey' })],
    }));

    expect(() =>
      defineTestContract({
        models: {
          User,
        },
      }),
    ).toThrow(/Contract semantic validation failed:.*app_user_pkey/);
  });

  it('supports compound ids and uniques in .attributes(...)', () => {
    const Membership = model('Membership', {
      fields: {
        orgId: field.column(textColumn).column('org_id'),
        userId: field.column(textColumn).column('user_id'),
        role: field.column(textColumn),
      },
    })
      .attributes(({ fields, constraints }) => ({
        id: constraints.id([fields.orgId, fields.userId], {
          name: 'membership_pkey',
        }),
        uniques: [
          constraints.unique([fields.orgId, fields.role], {
            name: 'membership_org_role_key',
          }),
        ],
      }))
      .sql({
        table: 'membership',
      });

    const contract = defineTestContract({
      models: {
        Membership,
      },
    });

    expect(
      (unboundTables(contract.storage) as Record<string, unknown>)['membership'],
    ).toMatchObject({
      primaryKey: {
        columns: ['org_id', 'user_id'],
        name: 'membership_pkey',
      },
      uniques: [
        {
          columns: ['org_id', 'role'],
          name: 'membership_org_role_key',
        },
      ],
    });
  });

  it('rejects duplicate identity columns from .attributes(...) through storage semantics', () => {
    const User = model('User', {
      fields: {
        id: field.column(textColumn),
      },
    })
      .attributes(({ fields, constraints }) => ({
        id: constraints.id([fields.id, fields.id]),
      }))
      .sql({ table: 'app_user' });

    expect(() =>
      defineTestContract({
        models: {
          User,
        },
      }),
    ).toThrow(/Contract semantic validation failed:.*primary key.*duplicate column "id"/);
  });

  it('rejects duplicate unique and index columns through storage semantics', () => {
    const User = model('User', {
      fields: {
        id: field.column(textColumn),
        email: field.column(textColumn),
      },
    })
      .attributes(({ fields, constraints }) => ({
        uniques: [constraints.unique([fields.email, fields.email])],
      }))
      .sql(({ cols, constraints }) => ({
        table: 'app_user',
        indexes: [constraints.index([cols.email, cols.email])],
      }));

    expect(() =>
      defineTestContract({
        models: {
          User,
        },
      }),
    ).toThrow(
      /Contract semantic validation failed:.*unique constraint.*duplicate column "email".*index.*duplicate column "email"/,
    );
  });

  it.each([
    {
      label: 'hasMany',
      relationName: 'posts',
      targetModelName: 'Post',
      targetTable: 'blog_post',
      expectedCardinality: '1:N',
    },
    {
      label: 'hasOne',
      relationName: 'profile',
      targetModelName: 'Profile',
      targetTable: 'user_profile',
      expectedCardinality: '1:1',
    },
  ] as const)(
    'lowers %s ownership relations through the relation pipeline',
    ({ relationName, targetModelName, targetTable, expectedCardinality, ...ownershipCase }) => {
      const contract = buildOwnershipRelationContract({
        relationName,
        targetModelName,
        targetTable,
        expectedCardinality,
        ...ownershipCase,
      });

      const modelsByName = modelsOf(contract) as Record<
        string,
        { relations: Record<string, unknown> }
      >;
      expect(modelsByName['User']?.relations).toMatchObject({
        [relationName]: {
          to: crossRef(targetModelName, 'public'),
          cardinality: expectedCardinality,
          on: {
            localFields: ['id'],
            targetFields: ['userId'],
          },
        },
      });
      expect(modelsByName[targetModelName]?.relations).toMatchObject({
        user: {
          to: crossRef('User', 'public'),
          cardinality: 'N:1',
          on: {
            localFields: ['userId'],
            targetFields: ['id'],
          },
        },
      });
    },
  );

  it('applies root naming defaults and preserves explicit overrides', () => {
    const BlogPost = model('BlogPost', {
      fields: {
        id: field.column(int4Column).id(),
        createdAt: field.column(timestamptzTemporalColumn),
        authorId: field.column(textColumn).column('author_identifier'),
      },
    }).sql(({ cols, constraints }) => ({
      indexes: [constraints.index([cols.authorId], { name: 'blog_post_author_identifier_idx' })],
    }));

    const contract = defineTestContract({
      naming: { tables: 'snake_case', columns: 'snake_case' },
      models: {
        BlogPost,
      },
    });

    const tables = unboundTables(contract.storage) as Record<
      string,
      { columns: Record<string, unknown> }
    >;
    expect(tables['blog_post']).toBeDefined();
    expect(tables['blog_post']?.columns['created_at']).toBeDefined();
    expect(tables['blog_post']?.columns['author_identifier']).toBeDefined();
    const models = modelsMapForAssertions(contract);
    expect(models['BlogPost']?.storage.fields['createdAt']).toEqual({ column: 'created_at' });
    expect(models['BlogPost']?.storage.fields['authorId']).toEqual({
      column: 'author_identifier',
    });
  });

  it.each([
    {
      name: 'table names',
      run: () => {
        const BlogPost = model('BlogPost', {
          fields: {
            id: field.column(int4Column).id(),
          },
        });

        const blogPost = model('blogPost', {
          fields: {
            id: field.column(int4Column).id(),
          },
        });

        return defineTestContract({
          naming: { tables: 'snake_case' },
          models: {
            BlogPost,
            blogPost,
          },
        });
      },
      error: /Models "BlogPost" and "blogPost" both map to table "blog_post"/,
    },
    {
      name: 'column names',
      run: () => {
        const BlogPost = model('BlogPost', {
          fields: {
            id: field.column(int4Column).id(),
            createdAt: field.column(timestamptzTemporalColumn),
            created_at: field.column(timestamptzTemporalColumn),
          },
        });

        return defineTestContract({
          naming: { columns: 'snake_case' },
          models: {
            BlogPost,
          },
        });
      },
      error: /Model "BlogPost" maps both "createdAt" and "created_at" to column "created_at"/,
    },
  ])('rejects duplicate %s after applying naming defaults', ({ run, error }) => {
    expect(run).toThrow(error);
  });

  it('allows the same table name in different namespaces', () => {
    const PublicThing = model('PublicThing', {
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'thing' });

    const ShadowThing = model('ShadowThing', {
      namespace: 'shadow',
      fields: {
        id: field.column(int4Column).id(),
      },
    }).sql({ table: 'thing' });

    const contract = defineTestContract({
      namespaces: ['shadow'],
      models: { PublicThing, ShadowThing },
    });

    expect(contract.storage.namespaces).toHaveProperty(['public', 'entries', 'table', 'thing']);
    expect(contract.storage.namespaces).toHaveProperty(['shadow', 'entries', 'table', 'thing']);
    expect(contract.domain.namespaces).toHaveProperty(['shadow', 'models', 'ShadowThing']);
  });

  it('resolves an M:N junction to its own namespace when the junction table name collides', () => {
    const PublicRole = model('Role', {
      fields: { id: field.column(textColumn).id() },
    }).sql({ table: 'roles' });
    const PublicUserRole = model('UserRole', {
      fields: {
        userId: field.column(int4Column).column('user_id'),
        roleId: field.column(textColumn).column('role_id'),
      },
    })
      .attributes(({ fields, constraints }) => ({
        id: constraints.id([fields.userId, fields.roleId]),
      }))
      .sql({ table: 'user_roles' });
    const PublicUser = model('User', {
      fields: { id: field.column(int4Column).id() },
    })
      .relations({
        roles: rel.manyToMany(() => PublicRole, {
          through: () => PublicUserRole,
          from: 'userId',
          to: 'roleId',
        }),
      })
      .sql({ table: 'users' });

    const ShadowRole = model('ShadowRole', {
      namespace: 'shadow',
      fields: { id: field.column(textColumn).id() },
    }).sql({ table: 'roles' });
    const ShadowUserRole = model('ShadowUserRole', {
      namespace: 'shadow',
      fields: {
        userId: field.column(int4Column).column('user_id'),
        roleId: field.column(textColumn).column('role_id'),
      },
    })
      .attributes(({ fields, constraints }) => ({
        id: constraints.id([fields.userId, fields.roleId]),
      }))
      .sql({ table: 'user_roles' });
    const ShadowUser = model('ShadowUser', {
      namespace: 'shadow',
      fields: { id: field.column(int4Column).id() },
    })
      .relations({
        roles: rel.manyToMany(() => ShadowRole, {
          through: () => ShadowUserRole,
          from: 'userId',
          to: 'roleId',
        }),
      })
      .sql({ table: 'users' });

    const contract = defineTestContract({
      namespaces: ['shadow'],
      models: {
        User: PublicUser,
        Role: PublicRole,
        UserRole: PublicUserRole,
        ShadowUser,
        ShadowRole,
        ShadowUserRole,
      },
    });

    expect(contract.domain.namespaces).toMatchObject({
      public: {
        models: {
          User: {
            relations: {
              roles: { through: { table: 'user_roles', namespaceId: 'public' } },
            },
          },
        },
      },
      shadow: {
        models: {
          ShadowUser: {
            relations: {
              roles: { through: { table: 'user_roles', namespaceId: 'shadow' } },
            },
          },
        },
      },
    });
  });

  it('rejects duplicate relation names when mixing model relations with .relations()', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      },
    });

    expect(() =>
      Post.relations({
        user: rel.belongsTo(User, { from: 'userId', to: 'id' }),
      }),
    ).toThrow('Model "Post" already defines relation "user".');
  });

  it('rejects belongsTo relations whose field arity does not match the target', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    const Membership = model('Membership', {
      fields: {
        id: field.column(int4Column).id(),
        orgId: field.column(int4Column),
        userId: field.column(int4Column),
      },
      relations: {
        user: rel.belongsTo(User, { from: ['orgId', 'userId'], to: 'id' }),
      },
    });

    expect(() =>
      defineTestContract({
        models: {
          User,
          Membership,
        },
      }),
    ).toThrow('Relation "Membership.user" maps 2 source field(s) to 1 target field(s).');
  });

  it('rejects hasMany relations whose child fields do not match the parent identity arity', () => {
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
        authorId: field.column(int4Column),
      },
    });

    const User = model('User', {
      fields: {
        orgId: field.column(int4Column),
        id: field.column(int4Column),
      },
      relations: {
        posts: rel.hasMany(Post, { by: 'authorId' }),
      },
    }).attributes(({ fields, constraints }) => ({
      id: constraints.id([fields.orgId, fields.id]),
    }));

    expect(() =>
      defineTestContract({
        models: {
          User,
          Post,
        },
      }),
    ).toThrow('Relation "User.posts" maps 2 anchor field(s) to 1 child field(s).');
  });

  it('rejects many-to-many relations whose through mappings do not match anchor arity', () => {
    const PostTag = model('PostTag', {
      fields: {
        postId: field.column(int4Column),
        postTenantId: field.column(int4Column),
        tagId: field.column(int4Column),
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(int4Column).id(),
      },
      relations: {
        tags: rel.manyToMany(() => Tag, {
          through: () => PostTag,
          from: ['postId', 'postTenantId'],
          to: 'tagId',
        }),
      },
    });

    const Tag = model('Tag', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    expect(() =>
      defineTestContract({
        models: {
          Post,
          Tag,
          PostTag,
        },
      }),
    ).toThrow('Relation "Post.tags" has mismatched many-to-many field counts.');
  });

  it('types local refs and named model tokens separately', () => {
    const Post = model('Post', {
      fields: {
        id: field.column(int4Column),
        userId: field.column(int4Column),
        title: field.column(textColumn),
      },
    });

    const User = model('User', {
      fields: {
        id: field.column(int4Column),
        email: field.column(textColumn),
      },
      relations: {
        posts: rel.hasMany(Post, { by: 'userId' }),
      },
    })
      .attributes(({ fields, constraints }) => {
        expectTypeOf(fields.id.fieldName).toEqualTypeOf<'id'>();
        expectTypeOf(fields.email.fieldName).toEqualTypeOf<'email'>();

        // @ts-expect-error relation fields must not appear in attributes field refs
        fields.posts;

        return {
          id: constraints.id(fields.id),
        };
      })
      .sql(({ cols, constraints }) => {
        expectTypeOf(cols.id.fieldName).toEqualTypeOf<'id'>();
        expectTypeOf(cols.email.fieldName).toEqualTypeOf<'email'>();
        expectTypeOf(User.refs['id']!.fieldName).toEqualTypeOf<'id'>();
        expectTypeOf(User.refs['id']!.modelName).toEqualTypeOf<'User'>();
        expectTypeOf(User.ref('email').fieldName).toEqualTypeOf<'email'>();
        expectTypeOf(User.ref('email').modelName).toEqualTypeOf<'User'>();

        // @ts-expect-error relation fields must not appear in sql column refs
        cols.posts;

        // @ts-expect-error relation fields must not appear in model token refs
        User.refs.posts;

        // @ts-expect-error unknown field names must not appear in model token refs
        User.ref('posts');

        return {
          indexes: [constraints.index([cols.email])],
        };
      });

    if (typecheckOnly) {
      rel.belongsTo(User, { from: 'userId', to: 'id' });
      rel.hasMany(Post, { by: 'userId' });

      // @ts-expect-error relation targets must expose real scalar fields
      rel.belongsTo(User, { from: 'userId', to: 'posts' });

      // @ts-expect-error relation targets must expose real scalar fields
      rel.hasMany(Post, { by: 'posts' });
    }

    expect(User).toBeDefined();
  });

  it('requires a named model token before cross-model refs are available', () => {
    const Anonymous = model({
      fields: {
        id: field.column(int4Column),
      },
    });

    if (typecheckOnly) {
      // @ts-expect-error unnamed models must not expose token-based cross-model refs
      Anonymous.ref('id');

      // @ts-expect-error unnamed models must not expose token-based cross-model refs
      Anonymous.refs.id;

      // @ts-expect-error unnamed models must not compile as relation targets
      rel.belongsTo(Anonymous, { from: 'id', to: 'id' });

      // @ts-expect-error unnamed models must not compile through lazy relation targets
      rel.hasMany(() => Anonymous, { by: 'id' });
    }

    expect(Anonymous).toBeDefined();
  });

  it('rejects mismatched model token keys during lowering', () => {
    const User = model('User', {
      fields: {
        id: field.column(int4Column).id(),
      },
    });

    expect(() =>
      defineTestContract({
        models: {
          Account: User,
        },
      }),
    ).toThrow('Model token "User" must be assigned to models.User. Received models.Account.');
  });
});

describe('self-referential and circular relations', () => {
  it('lowers a self-referential tree relation (parent/children on the same model)', () => {
    const CategoryBase = model('Category', {
      fields: {
        id: field.column(int4Column).id(),
        name: field.column(textColumn),
        parentId: field.column(int4Column).optional(),
      },
    });
    const Category = CategoryBase.relations({
      parent: rel.belongsTo(() => CategoryBase, { from: 'parentId', to: 'id' }),
      children: rel.hasMany(() => CategoryBase, { by: 'parentId' }),
    });

    const contract = defineTestContract({
      models: { Category },
    });

    const categoryModel = (
      modelsOf(contract) as Record<string, { relations: Record<string, unknown> }>
    )['Category'];
    expect(categoryModel?.relations).toMatchObject({
      parent: {
        to: crossRef('Category', 'public'),
        cardinality: 'N:1',
        on: {
          localFields: ['parentId'],
          targetFields: ['id'],
        },
      },
      children: {
        to: crossRef('Category', 'public'),
        cardinality: '1:N',
        on: {
          localFields: ['id'],
          targetFields: ['parentId'],
        },
      },
    });
  });

  it('lowers circular relations (A references B, B references A)', () => {
    const EmployeeBase = model('Employee', {
      fields: {
        id: field.column(int4Column).id(),
        name: field.column(textColumn),
        departmentId: field.column(int4Column),
      },
    });

    const Department = model('Department', {
      fields: {
        id: field.column(int4Column).id(),
        name: field.column(textColumn),
        headId: field.column(int4Column),
      },
      relations: {
        head: rel.belongsTo(EmployeeBase, { from: 'headId', to: 'id' }),
      },
    });

    const Employee = EmployeeBase.relations({
      department: rel.belongsTo(() => Department, { from: 'departmentId', to: 'id' }),
    });

    const contract = defineTestContract({
      models: { Employee, Department },
    });

    const modelsByName = modelsOf(contract) as Record<
      string,
      { relations: Record<string, unknown> }
    >;
    expect(modelsByName['Employee']?.relations).toMatchObject({
      department: {
        to: crossRef('Department', 'public'),
        cardinality: 'N:1',
        on: {
          localFields: ['departmentId'],
          targetFields: ['id'],
        },
      },
    });
    expect(modelsByName['Department']?.relations).toMatchObject({
      head: {
        to: crossRef('Employee', 'public'),
        cardinality: 'N:1',
        on: {
          localFields: ['headId'],
          targetFields: ['id'],
        },
      },
    });
  });

  it('M:N relation round-trips through validateContract with through descriptor intact', () => {
    const UserTag = model('UserTag', {
      fields: {
        userId: field.column(textColumn).column('user_id'),
        tagId: field.column(textColumn).column('tag_id'),
      },
    })
      .attributes(({ fields, constraints }) => ({
        id: constraints.id([fields.userId, fields.tagId]),
      }))
      .sql({ table: 'user_tag' });

    const TagBase = model('Tag', {
      fields: {
        id: field.column(textColumn).id(),
        name: field.column(textColumn),
      },
    }).sql({ table: 'tag' });

    const UserBase = model('User', {
      fields: {
        id: field.column(textColumn).id(),
        email: field.column(textColumn),
      },
    });

    const Tag = TagBase.relations({
      users: rel.manyToMany(() => UserBase, {
        through: () => UserTag,
        from: 'tagId',
        to: 'userId',
      }),
    });

    const User = UserBase.relations({
      tags: rel.manyToMany(() => Tag, {
        through: () => UserTag,
        from: 'userId',
        to: 'tagId',
      }),
    }).sql({ table: 'app_user' });

    const contract = defineTestContract({
      models: { User, Tag, UserTag },
    });

    expect(() => validateSqlContractFully<Contract<SqlStorage>>(contract)).not.toThrow();

    const contractModels = modelsOf(contract) as Record<
      string,
      { relations: Record<string, unknown> }
    >;
    expect(contractModels['User']?.relations).toMatchObject({
      tags: {
        to: crossRef('Tag', 'public'),
        cardinality: 'N:M',
        through: {
          table: 'user_tag',
          parentColumns: ['user_id'],
          childColumns: ['tag_id'],
          targetColumns: ['id'],
        },
      },
    });
    expect(contractModels['Tag']?.relations).toMatchObject({
      users: {
        to: crossRef('User', 'public'),
        cardinality: 'N:M',
        through: {
          table: 'user_tag',
          parentColumns: ['tag_id'],
          childColumns: ['user_id'],
          targetColumns: ['id'],
        },
      },
    });
  });
});
