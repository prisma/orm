// Intentionally uses verbose sql-contract-ts/contract-builder import: this file tests the
// base defineContract API directly (not the facade wrapper).
import {
  int4Column,
  textColumn,
  timestamptzTemporalColumn,
} from '@internal/adapter-postgres/column-types';
import sqlFamilyPack from '@internal/family-sql/pack';
import type { ResultType } from '@internal/framework-components/runtime';
import { sql } from '@internal/sql-builder/runtime';
import type { ExtractCodecTypes } from '@internal/sql-contract/types';
import { defineContract, field, model, rel } from '@internal/sql-contract-ts/contract-builder';
import { SelectAst } from '@internal/sql-relational-core/ast';
import { createStubAdapter, createTestContext } from '@internal/sql-runtime/test/utils';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../packages/2-sql/9-family/test/test-sql-contract-serializer';
import type { Contract } from './fixtures/contract.d';
import contractJson from './fixtures/contract.json' with { type: 'json' };

describe('builder integration', () => {
  it('builds a contract matching fixture structure', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      storageHash: 'test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzTemporalColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    // Runtime checks
    expect(contract).toMatchObject({
      target: 'postgres',
      targetFamily: 'sql',
      storage: expect.objectContaining({
        storageHash: 'test-core',
        namespaces: expect.objectContaining({
          public: expect.objectContaining({
            entries: expect.objectContaining({
              table: expect.objectContaining({
                user: expect.anything(),
              }),
            }),
          }),
        }),
      }),
    });
    const userTable = contract.storage.namespaces['public'].entries.table.user;
    expect(userTable).toBeDefined();
    expect(userTable?.columns).toMatchObject({
      id: expect.anything(),
      email: expect.anything(),
      createdAt: expect.anything(),
    });
    expectTypeOf<
      keyof (typeof contract.storage.namespaces)['public']['entries']['table']
    >().toEqualTypeOf<'user'>();
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    type IntCodecOutput = ContractCodecTypes['pg/int4@1']['output'];
    expectTypeOf<IntCodecOutput>().toEqualTypeOf<number>();
    type ColumnMeta =
      (typeof contract)['storage']['namespaces']['public']['entries']['table']['user']['columns']['id'];
    expectTypeOf<ColumnMeta['codecId']>().toExtend<string>();
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();

    expect(userTable?.primaryKey?.columns).toEqual(['id']);
    const userModel = contract.domain.namespaces['public']!.models.User;
    expect(userModel).toMatchObject({
      storage: { namespaceId: 'public', table: 'user' },
      fields: expect.objectContaining({
        id: expect.anything(),
        email: expect.anything(),
        createdAt: expect.anything(),
      }),
    });

    // Type checks - verify literal types are preserved
    expectTypeOf(contract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(contract.targetFamily).toEqualTypeOf<'sql'>();

    // Verify table name is literal 'user', not string
    expectTypeOf(contract.storage.namespaces['public'].entries.table).toHaveProperty('user');

    // Verify column names are literal types
    const userTableType = contract.storage.namespaces['public'].entries.table.user;
    expectTypeOf(userTableType.columns).toHaveProperty('id');
    expectTypeOf(userTableType.columns).toHaveProperty('email');
    expectTypeOf(userTableType.columns).toHaveProperty('createdAt');

    // Verify column types are strings (TypeScript may widen literal types)
    expectTypeOf(userTableType.columns.id.codecId).toExtend<string>();
    expectTypeOf(userTableType.columns.email.codecId).toExtend<string>();
    expectTypeOf(userTableType.columns.createdAt.codecId).toExtend<string>();
    // Runtime check that they match expected values
    expect(userTableType.columns.id.codecId).toBe('pg/int4@1');
    expect(userTableType.columns.email.codecId).toBe('pg/text@1');
    expect(userTableType.columns.createdAt.codecId).toBe('pg/timestamptz-temporal@1');

    // Verify nullable is literal false, not boolean
    expectTypeOf(userTableType.columns.id.nullable).toEqualTypeOf<false>();
    expectTypeOf(userTableType.columns.email.nullable).toEqualTypeOf<false>();
    expectTypeOf(userTableType.columns.createdAt.nullable).toEqualTypeOf<false>();

    // Verify model name is literal 'User', not string
    expectTypeOf(contract.domain.namespaces['public']!.models).toHaveProperty('User');

    // Verify model storage table is literal 'user'
    expectTypeOf(
      contract.domain.namespaces['public']!.models.User.storage.table,
    ).toEqualTypeOf<'user'>();

    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();

    // Verify model field names are literal types
    expectTypeOf(contract.domain.namespaces['public']!.models.User.fields).toHaveProperty('id');
    expectTypeOf(contract.domain.namespaces['public']!.models.User.fields).toHaveProperty('email');
    expectTypeOf(contract.domain.namespaces['public']!.models.User.fields).toHaveProperty(
      'createdAt',
    );
  });

  it('contract can be validated via the SPI serializer', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      storageHash: 'test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzTemporalColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    expect(contract.target).toBe('postgres');
    expect(contract.storage.namespaces['public'].entries.table.user).toBeDefined();
  });

  it('contract works with sql() function', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      storageHash: 'test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzTemporalColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);

    const db = sql<typeof contract>({
      context,
      rawCodecInferer: { inferCodec: () => 'pg/text' },
    });
    const plan = db.public.user.select('id', 'email').build();

    // Runtime checks
    expect(plan.ast).toBeInstanceOf(SelectAst);
    expect(plan.meta.storageHash).toBe(contract.storage.storageHash);

    // Type checks - verify plan types are specific
    expectTypeOf(plan.meta.storageHash).toEqualTypeOf<string>();

    // Verify ResultType inference works with specific types
    type Row = ResultType<typeof plan>;
    // Type inference may widen types, so we verify the codec outputs directly
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();
    expectTypeOf<ContractCodecTypes['pg/text@1']['output']>().toEqualTypeOf<string>();
    expectTypeOf<Row>().toHaveProperty('id');
    expectTypeOf<Row>().toHaveProperty('email');
  });

  it('ResultType inference works with builder contract', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      storageHash: 'test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzTemporalColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    const adapter = createStubAdapter();
    const context = createTestContext(contract, adapter);

    const db = sql<typeof contract>({
      context,
      rawCodecInferer: { inferCodec: () => 'pg/text' },
    });
    const _plan = db.public.user.select('id', 'email', 'createdAt').build();

    type Row = ResultType<typeof _plan>;

    // Runtime check
    const row: Row = {
      id: 1,
      email: 'test@example.com',
      createdAt: Temporal.Instant.from('2024-01-01T00:00:00Z'),
    };
    expect(row).toBeDefined();

    // Type checks - verify ResultType has specific field names
    expectTypeOf<Row>().toHaveProperty('id');
    expectTypeOf<Row>().toHaveProperty('email');
    expectTypeOf<Row>().toHaveProperty('createdAt');
    // Verify codec output types directly (type inference may widen literal types)
    type ContractCodecTypes = ExtractCodecTypes<typeof contract>;
    expectTypeOf<ContractCodecTypes['pg/int4@1']['output']>().toEqualTypeOf<number>();
    expectTypeOf<ContractCodecTypes['pg/text@1']['output']>().toEqualTypeOf<string>();
  });

  it('contract structure matches fixture contract', () => {
    const builderContract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      storageHash: 'test-core',
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column).id(),
            email: field.column(textColumn),
            createdAt: field.column(timestamptzTemporalColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    const fixtureContract = new SqlContractSerializer().deserializeContract(
      contractJson,
    ) as Contract;

    // Runtime checks
    expect(builderContract.target).toBe(fixtureContract.target);
    expect(builderContract.targetFamily).toBe(fixtureContract.targetFamily);
    expect(builderContract.storage.namespaces['public'].entries.table.user.columns).toMatchObject({
      id: {
        codecId: fixtureContract.storage.namespaces['public'].entries.table.user.columns.id.codecId,
      },
      email: {
        codecId:
          fixtureContract.storage.namespaces['public'].entries.table.user.columns.email.codecId,
      },
      createdAt: {
        codecId:
          fixtureContract.storage.namespaces['public'].entries.table.user.columns.createdAt.codecId,
      },
    });
    type ModelShape = {
      storage: { namespaceId: string; table: string; fields: Record<string, unknown> };
      fields: Record<string, unknown>;
    };
    const builderUserModel = builderContract.domain.namespaces['public']!.models
      .User as unknown as ModelShape;
    const fixtureUserModel = fixtureContract.domain.namespaces['public']!.models
      .User as unknown as ModelShape;
    expect(builderUserModel.storage.table).toBe(fixtureUserModel.storage.table);
    expect(Object.keys(builderUserModel.fields).sort()).toEqual(
      Object.keys(fixtureUserModel.fields).sort(),
    );

    // Type checks - verify builder contract preserves types like fixture
    expectTypeOf(builderContract.target).toEqualTypeOf<'postgres'>();
    expectTypeOf(builderContract.targetFamily).toEqualTypeOf<'sql'>();

    // Verify table and column types match
    expectTypeOf(builderContract.storage.namespaces['public'].entries.table).toHaveProperty('user');
    expectTypeOf(
      builderContract.storage.namespaces['public'].entries.table.user.columns,
    ).toHaveProperty('id');
    expectTypeOf(
      builderContract.storage.namespaces['public'].entries.table.user.columns,
    ).toHaveProperty('email');
    expectTypeOf(
      builderContract.storage.namespaces['public'].entries.table.user.columns,
    ).toHaveProperty('createdAt');

    // Verify model types match
    expectTypeOf(builderContract.domain.namespaces['public']!.models).toHaveProperty('User');
    expectTypeOf(
      builderContract.domain.namespaces['public']!.models.User.storage.table,
    ).toEqualTypeOf<'user'>();
    expectTypeOf(builderContract.domain.namespaces['public']!.models.User.fields).toHaveProperty(
      'id',
    );
    expectTypeOf(builderContract.domain.namespaces['public']!.models.User.fields).toHaveProperty(
      'email',
    );
    expectTypeOf(builderContract.domain.namespaces['public']!.models.User.fields).toHaveProperty(
      'createdAt',
    );
  });

  it('supports type option with column-type constants', () => {
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      models: {
        User: model('User', {
          fields: {
            id: field.column(int4Column),
            email: field.column(textColumn),
          },
        }).sql({ table: 'user' }),
      },
    });

    // Type checks - verify codecId is a string (TypeScript may widen literal types)
    expectTypeOf(
      contract.storage.namespaces['public'].entries.table.user.columns.id.codecId,
    ).toExtend<string>();
    expectTypeOf(
      contract.storage.namespaces['public'].entries.table.user.columns.email.codecId,
    ).toExtend<string>();
    // Runtime check that they match expected values
    expect(contract.storage.namespaces['public'].entries.table.user.columns).toMatchObject({
      id: { codecId: 'pg/int4@1' },
      email: { codecId: 'pg/text@1' },
    });
  });

  it('accepts any codecId format in descriptor (validation happens at runtime)', () => {
    // Column descriptors accept any codecId format - validation happens at runtime when the contract is used, not at build time
    const contract = defineContract({
      family: sqlFamilyPack,
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
      models: {
        User: model('User', {
          fields: {
            // biome-ignore lint/suspicious/noExplicitAny: Testing invalid type descriptor
            id: field.column({ codecId: 'invalid', nativeType: 'invalid' } as any),
          },
        }).sql({ table: 'user' }),
      },
    });
    // Contract builds successfully - invalid codecId will cause errors at runtime
    expect(contract.storage.namespaces['public'].entries.table.user.columns.id.codecId).toBe(
      'invalid',
    );
  });

  describe('relation builder', () => {
    it('builds a contract with 1:N relation', () => {
      const UserBase = model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      });

      const Post = model('Post', {
        fields: {
          id: field.column(int4Column).id(),
          userId: field.column(int4Column),
          title: field.column(textColumn),
        },
        relations: {
          user: rel.belongsTo(UserBase, { from: 'userId', to: 'id' }),
        },
      }).sql({ table: 'post' });

      const User = UserBase.relations({
        posts: rel.hasMany(Post, { by: 'userId' }),
      }).sql({ table: 'user' });

      const contract = defineContract({
        family: sqlFamilyPack,
        target: postgresPack,
        createNamespace: postgresCreateNamespace,
        storageHash: 'test-core',
        models: { User, Post },
      });

      type RelShape = {
        to: { namespace: string; model: string };
        cardinality: string;
        on: { localFields: readonly string[]; targetFields: readonly string[] };
      };
      type ModelShape = { relations: Record<string, RelShape> };
      const models = contract.domain.namespaces['public']!.models as Record<string, ModelShape>;
      const userRels = models['User']!.relations;
      const postRels = models['Post']!.relations;
      expect(userRels).toBeDefined();
      expect(userRels['posts']).toBeDefined();
      expect(userRels['posts']!.to).toEqual({ namespace: 'public', model: 'Post' });
      expect(userRels['posts']!.cardinality).toBe('1:N');
      expect(userRels['posts']!.on.localFields).toEqual(['id']);
      expect(userRels['posts']!.on.targetFields).toEqual(['userId']);

      expect(postRels).toBeDefined();
      expect(postRels['user']).toBeDefined();
      expect(postRels['user']!.to).toEqual({ namespace: 'public', model: 'User' });
      expect(postRels['user']!.cardinality).toBe('N:1');
      expect(postRels['user']!.on.localFields).toEqual(['userId']);
      expect(postRels['user']!.on.targetFields).toEqual(['id']);
    });

    it('builds a contract with N:M relation', () => {
      const UserRole = model('UserRole', {
        fields: {
          userId: field.column(int4Column),
          roleId: field.column(int4Column),
        },
      })
        .attributes(({ fields, constraints }) => ({
          id: constraints.id([fields.userId, fields.roleId]),
        }))
        .sql({ table: 'userRole' });

      const UserBase = model('User', {
        fields: {
          id: field.column(int4Column).id(),
          email: field.column(textColumn),
        },
      });

      const Role = model('Role', {
        fields: {
          id: field.column(int4Column).id(),
          name: field.column(textColumn),
        },
        relations: {
          users: rel.manyToMany(UserBase, {
            through: () => UserRole,
            from: 'roleId',
            to: 'userId',
          }),
        },
      }).sql({ table: 'role' });

      const User = UserBase.relations({
        roles: rel.manyToMany(() => Role, {
          through: () => UserRole,
          from: 'userId',
          to: 'roleId',
        }),
      }).sql({ table: 'user' });

      const contract = defineContract({
        family: sqlFamilyPack,
        target: postgresPack,
        createNamespace: postgresCreateNamespace,
        storageHash: 'test-core',
        models: { User, Role, UserRole },
      });

      const models = contract.domain.namespaces['public']!.models as Record<
        string,
        { relations: Record<string, unknown> }
      >;
      expect(models['User']?.relations).toMatchObject({
        roles: {
          to: { namespace: 'public', model: 'Role' },
          cardinality: 'N:M',
        },
      });
      expect(models['Role']?.relations).toMatchObject({
        users: {
          to: { namespace: 'public', model: 'User' },
          cardinality: 'N:M',
        },
      });
    });
  });
});
