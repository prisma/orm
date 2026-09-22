import { parseNaming } from '@internal/sql-schema-ir/naming';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat as printPslFromSql } from '../fixtures';

describe('printPsl', () => {
  it('escapes inferred relation field names that would start with a digit', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        login: {
          name: 'login',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            '2fa_id': {
              name: '2fa_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['2fa_id'],
              referencedTable: 'account',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Account {
        id     Int     @id
        logins Login[]

        @@map("account")
      }

      model Login {
        id     Int     @id
        _2faId Int     @map("2fa_id")
        _2fa   Account @relation(fields: [_2faId], references: [id], index: false)

        @@map("login")
      }
      "
    `);
  });

  it('disambiguates colliding normalized field names and preserves relation references', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: {
            user_id: {
              name: 'user_id',
              nativeType: 'int4',
              nullable: false,
            },
            userId: {
              name: 'userId',
              nativeType: 'text',
              nullable: false,
            },
          },
          primaryKey: { columns: ['user_id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        login: {
          name: 'login',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            account_id: {
              name: 'account_id',
              nativeType: 'int4',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['account_id'],
              referencedTable: 'account',
              referencedColumns: ['user_id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Account {
        userId2 Int     @id @map("user_id")
        userId  String
        logins  Login[]

        @@map("account")
      }

      model Login {
        id        Int     @id
        accountId Int     @map("account_id")
        account   Account @relation(fields: [accountId], references: [userId2], index: false)

        @@map("login")
      }
      "
    `);
  });

  it('disambiguates more than two colliding normalized field names', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            userId: {
              name: 'userId',
              nativeType: 'text',
              nullable: false,
            },
            user_id: {
              name: 'user_id',
              nativeType: 'int4',
              nullable: false,
            },
            'user-id': {
              name: 'user-id',
              nativeType: 'bool',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Account {
        id      Int     @id
        userId  String
        userId2 Int     @map("user_id")
        userId3 Boolean @map("user-id")

        @@map("account")
      }
      "
    `);
  });

  it('composite unique constraint and index', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        record: {
          name: 'record',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            type: { name: 'type', nativeType: 'text', nullable: false },
            code: { name: 'code', nativeType: 'text', nullable: false },
            category: { name: 'category', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['type', 'code'] }],
          indexes: [
            {
              naming: parseNaming('record_category_idx', undefined),
              columns: ['category', 'type'],
              where: undefined,
              unique: false,
              partial: false,
              type: undefined,
              options: undefined,
              annotations: undefined,
              dependsOn: undefined,
            },
          ],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Record {
        id       Int    @id
        _type    String @map("type")
        code     String
        category String

        @@unique([_type, code])
        @@index([category, _type], map: "record_category_idx")
        @@map("record")
      }
      "
    `);
  });

  it('preserves named non-unique indexes', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        record: {
          name: 'record',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            category: { name: 'category', nativeType: 'text', nullable: false },
            type: { name: 'type', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [
            {
              naming: parseNaming('record_category_type_idx', undefined),
              columns: ['category', 'type'],
              where: undefined,
              unique: false,
              partial: false,
              type: undefined,
              options: undefined,
              annotations: undefined,
              dependsOn: undefined,
            },
          ],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Record {
        id       Int    @id
        category String
        _type    String @map("type")

        @@index([category, _type], map: "record_category_type_idx")
        @@map("record")
      }
      "
    `);
  });

  it('preserves a non-default index access method (e.g. hash)', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        record: {
          name: 'record',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            token: { name: 'token', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [
            {
              naming: parseNaming('record_token_hash_idx', undefined),
              columns: ['token'],
              where: undefined,
              unique: false,
              partial: false,
              type: 'hash',
              options: undefined,
              annotations: undefined,
              dependsOn: undefined,
            },
          ],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Record {
        id    Int    @id
        token String

        @@index([token], map: "record_token_hash_idx", type: "hash")
        @@map("record")
      }
      "
    `);
  });

  it('preserves named primary keys and unique constraints', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        record: {
          name: 'record',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
            category: { name: 'category', nativeType: 'text', nullable: false },
            code: { name: 'code', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'], name: 'record_pkey' },
          foreignKeys: [],
          uniques: [
            { columns: ['email'], name: 'record_email_key' },
            { columns: ['category', 'code'], name: 'record_category_code_key' },
          ],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Record {
        id       Int    @id(map: "record_pkey")
        email    String @unique(map: "record_email_key")
        category String
        code     String

        @@unique([category, code], map: "record_category_code_key")
        @@map("record")
      }
      "
    `);
  });

  it('reserved word table names are escaped', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        type: {
          name: 'type',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            model: { name: 'model', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });
    const result = printPslFromSql(schemaIR);
    expect(result).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model _Type {
        id     Int    @id
        _model String @map("model")

        @@map("type")
      }
      "
    `);
  });

  it('throws when model names collide after normalization', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user_profile: {
          name: 'user_profile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        UserProfile: {
          name: 'UserProfile',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    expect(() => printPslFromSql(schemaIR)).toThrowErrorMatchingInlineSnapshot(`
      [StructuredError: PSL model name collisions detected:
      - model "UserProfile" from tables "user_profile", "UserProfile"]
    `);
    let caught: unknown;
    try {
      printPslFromSql(schemaIR);
    } catch (error) {
      caught = error;
    }
    expect(isStructuredError(caught)).toBe(true);
    expect(caught).toMatchObject({ code: 'CONTRACT.NAME_DUPLICATE' });
  });

  it('renames an adopted enum away from a same-named model, @@map carrying the type name', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        user_role: {
          name: 'user_role',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          nativeEnums: [{ typeName: 'user_role', values: ['admin', 'user'] }],
        },
      },
    });

    const output = printPslFromSql(schemaIR);
    expect(output).toContain('model UserRole {');
    expect(output).toContain('native_enum UserRole2 {');
    expect(output).toContain('@@map("user_role")');
  });

  it('throws on enum type names that normalize to the same PSL name', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {},
      annotations: {
        pg: {
          nativeEnums: [
            { typeName: 'user_role', values: ['a'] },
            { typeName: 'UserRole', values: ['b'] },
          ],
        },
      },
    });

    expect(() => printPslFromSql(schemaIR)).toThrow(/enum name collisions detected/i);
  });
});
