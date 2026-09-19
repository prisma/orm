import { flatPslModels } from '@internal/framework-components/psl-ast';
import { printPsl } from '@internal/psl-printer';
import {
  computeIndexContentHash,
  formatWireName,
  parseNaming,
} from '@internal/sql-schema-ir/naming';
import type { SqlIndexIRInput, SqlSchemaIRInput } from '@internal/sql-schema-ir/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { inferPslAstFromFlat as sqlSchemaIrToPslAst } from './fixtures';

function ir(partial: Partial<SqlSchemaIRInput> & Pick<SqlSchemaIRInput, 'tables'>): SqlSchemaIR {
  return new SqlSchemaIR({
    ...partial,
  });
}

describe('inferPostgresPslContract', () => {
  it('produces a model for a single table with PK and unique', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    expect(ast.kind).toBe('document');
    expect(flatPslModels(ast)).toHaveLength(1);
    const model = flatPslModels(ast)[0];
    expect(model?.name).toBe('User');
    const idField = model?.fields.find((f) => f.name === 'id');
    expect(idField?.attributes.some((a) => a.name === 'id')).toBe(true);
    const emailField = model?.fields.find((f) => f.name === 'email');
    expect(emailField?.attributes.some((a) => a.name === 'unique')).toBe(true);
  });

  it('infers relation fields from foreign keys', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const userModel = flatPslModels(ast).find((m) => m.name === 'User');
    const postModel = flatPslModels(ast).find((m) => m.name === 'Post');
    const postsField = userModel?.fields.find((f) => f.name === 'posts');
    expect(postsField?.list).toBe(true);
    const userField = postModel?.fields.find((f) => f.name === 'user');
    expect(userField?.attributes.some((a) => a.name === 'relation')).toBe(true);
  });

  it('adopts native Postgres enum types instead of throwing (adoption specifics live in infer-psl-contract.enum-adoption.test.ts)', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            role: { name: 'role', nativeType: 'role_t', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
      annotations: {
        pg: {
          nativeEnums: [{ typeName: 'role_t', values: ['admin', 'user'] }],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const model = flatPslModels(ast).find((m) => m.name === 'User');
    const roleField = model?.fields.find((f) => f.name === 'role');
    expect(roleField?.typeConstructor).toMatchObject({ path: ['pg', 'enum'] });
  });

  it('produces a @default(now()) attribute for raw now() defaults', () => {
    const schemaIR = ir({
      tables: {
        event: {
          name: 'event',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            ts: {
              name: 'ts',
              nativeType: 'timestamptz',
              nullable: false,
              default: 'now()',
            },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const tsField = flatPslModels(ast)[0]?.fields.find((f) => f.name === 'ts');
    const defaultAttr = tsField?.attributes.find((a) => a.name === 'default');
    expect(defaultAttr).toBeDefined();
    const arg = defaultAttr?.args[0];
    expect(arg && arg.kind === 'positional' ? arg.value : '').toContain('now()');
  });

  it('produces a @default(autoincrement()) attribute for an identity column (GENERATED ... AS IDENTITY)', () => {
    // Both `GENERATED ALWAYS AS IDENTITY` and `GENERATED BY DEFAULT AS
    // IDENTITY` report no `column_default` at all — the postgres control
    // adapter stamps `resolvedDefault` straight to `autoincrement()` with no
    // raw expression (PSL has no syntax to distinguish the two variants),
    // and infer must print the same `@default(autoincrement())` either way.
    const schemaIR = ir({
      tables: {
        session: {
          name: 'session',
          columns: {
            id: {
              name: 'id',
              nativeType: 'int4',
              nullable: false,
              resolvedDefault: { kind: 'function', expression: 'autoincrement()' },
            },
            note: { name: 'note', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const model = flatPslModels(ast)[0];
    const idField = model?.fields.find((f) => f.name === 'id');
    const defaultAttr = idField?.attributes.find((a) => a.name === 'default');
    expect(defaultAttr).toBeDefined();
    const arg = defaultAttr?.args[0];
    expect(arg && arg.kind === 'positional' ? arg.value : '').toBe('autoincrement()');

    // A plain column with neither a raw default nor a resolvedDefault gets
    // no @default attribute at all.
    const noteField = model?.fields.find((f) => f.name === 'note');
    expect(noteField?.attributes.some((a) => a.name === 'default')).toBe(false);
  });

  it('attaches a "no primary key" warning comment for tables without a primary key', () => {
    const schemaIR = ir({
      tables: {
        audit_log: {
          name: 'audit_log',
          columns: {
            event: { name: 'event', nativeType: 'text', nullable: false },
          },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    });

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const auditLog = flatPslModels(ast).find((m) => m.name === 'AuditLog');
    expect(auditLog?.comment).toBe('// WARNING: This table has no primary key in the database');
  });

  it('omits the no-primary-key comment for tables with a primary key', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
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

    const ast = sqlSchemaIrToPslAst(schemaIR);
    const user = flatPslModels(ast).find((m) => m.name === 'User');
    expect(user?.comment).toBeUndefined();
  });

  it('renders a representative two-table schema with FK relation deterministically', () => {
    const schemaIR = ir({
      tables: {
        user: {
          name: 'user',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            email: { name: 'email', nativeType: 'text', nullable: false },
            name: { name: 'name', nativeType: 'text', nullable: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [{ columns: ['email'] }],
          indexes: [],
        },
        post: {
          name: 'post',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            title: { name: 'title', nativeType: 'text', nullable: false },
            user_id: { name: 'user_id', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              columns: ['user_id'],
              referencedTable: 'user',
              referencedColumns: ['id'],
            },
          ],
          uniques: [],
          indexes: [
            {
              naming: { kind: 'exact', name: 'post_user_id_idx' },
              columns: ['user_id'],
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

    const out = printPsl(sqlSchemaIrToPslAst(schemaIR));
    expect(out).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model User {
        id    Int     @id
        email String  @unique
        name  String?
        posts Post[]

        @@map("user")
      }

      model Post {
        id     Int    @id
        title  String
        userId Int    @map("user_id")
        user   User   @relation(fields: [userId], references: [id])

        @@index([userId], map: "post_user_id_idx")
        @@map("post")
      }
      "
    `);
  });

  describe('index emission — wire re-detection and the full matrix', () => {
    interface IndexFixture {
      readonly name: string;
      readonly prefix?: string;
      readonly columns?: readonly string[];
      readonly expression?: string;
      readonly where?: string;
      readonly unique: boolean;
      readonly type?: string;
      readonly options?: Record<string, unknown>;
    }

    function pslWithIndex(index: IndexFixture): string {
      const schemaIR = ir({
        tables: {
          user: {
            name: 'user',
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              email: { name: 'email', nativeType: 'text', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [
              {
                naming: parseNaming(index.name, index.prefix),
                columns: index.columns,
                expression: index.expression,
                where: index.where,
                unique: index.unique,
                partial: index.where !== undefined,
                type: index.type,
                options: index.options,
                annotations: undefined,
                dependsOn: undefined,
              } as SqlIndexIRInput,
            ],
          },
        },
      });
      return printPsl(sqlSchemaIrToPslAst(schemaIR));
    }

    it('a default-named wire-named index re-detects: the wire hash recomputes, name: emits', () => {
      const psl = pslWithIndex({
        name: 'user_email_idx_46df9cad',
        prefix: 'user_email_idx',
        columns: ['email'],
        unique: false,
      });
      expect(psl).toContain('@@index([email], name: "user_email_idx")');
    });

    it('a custom-prefix wire name re-detects wire-named with that prefix', () => {
      const psl = pslWithIndex({
        name: 'custom_idx_46df9cad',
        prefix: 'custom_idx',
        columns: ['email'],
        unique: false,
      });
      expect(psl).toContain('@@index([email], name: "custom_idx")');
    });

    it('a non-wire name adopts exactly with map:', () => {
      const psl = pslWithIndex({ name: 'handwritten_idx', columns: ['email'], unique: false });
      expect(psl).toContain('@@index([email], map: "handwritten_idx")');
    });

    it('a wire-shaped name whose hash does not recompute adopts exactly with map:', () => {
      const psl = pslWithIndex({
        name: 'user_email_idx_00000000',
        prefix: 'user_email_idx',
        columns: ['email'],
        unique: false,
      });
      expect(psl).toContain('@@index([email], map: "user_email_idx_00000000")');
    });

    it("the btree edge: an index authored type: 'btree' re-detects as exact (benign)", () => {
      // The authored 'btree' hashed into the suffix, but introspection
      // normalizes the default method away, so the recompute mismatches and
      // the index adopts exactly — a clean round-trip, just map: not name:.
      const authoredName = formatWireName(
        'user_email_btree',
        computeIndexContentHash({ columns: ['email'], unique: false, type: 'btree' }),
      );
      const psl = pslWithIndex({
        name: authoredName,
        prefix: 'user_email_btree',
        columns: ['email'],
        unique: false,
      });
      expect(psl).toContain(`@@index([email], map: "${authoredName}")`);
    });

    it('a wire-named index with an explicit non-default type and options re-detects stable', () => {
      // A wire-named index carrying options always hashed an explicit type
      // (options without a type is unrepresentable), so the recompute from
      // the introspected parts agrees and name: re-emits.
      const hash = computeIndexContentHash({
        columns: ['email'],
        unique: false,
        type: 'hash',
        options: { fillfactor: '70' },
      });
      const psl = pslWithIndex({
        name: formatWireName('user_email_hashed', hash),
        prefix: 'user_email_hashed',
        columns: ['email'],
        unique: false,
        type: 'hash',
        options: { fillfactor: '70' },
      });
      expect(psl).toContain(
        '@@index([email], name: "user_email_hashed", type: "hash", options: { fillfactor: "70" })',
      );
    });

    it('an expression index emits expression: with no positional list', () => {
      const psl = pslWithIndex({
        name: 'users_email_lower',
        expression: 'lower(email)',
        unique: false,
      });
      expect(psl).toContain('@@index(expression: "lower(email)", map: "users_email_lower")');
    });

    it('an expression index whose reprint re-hashes to the live suffix re-detects wire-named', () => {
      const psl = pslWithIndex({
        name: 'users_lower_17273133',
        prefix: 'users_lower',
        expression: 'lower(email)',
        unique: false,
      });
      expect(psl).toContain('@@index(expression: "lower(email)", name: "users_lower")');
    });

    it('a partial index emits its where: predicate verbatim', () => {
      const psl = pslWithIndex({
        name: 'users_email_active',
        columns: ['email'],
        where: '(email IS NOT NULL)',
        unique: false,
      });
      expect(psl).toContain(
        '@@index([email], map: "users_email_active", where: "(email IS NOT NULL)")',
      );
    });

    it('a unique non-constraint index emits unique: true instead of being dropped', () => {
      const psl = pslWithIndex({
        name: 'users_email_ci_key',
        expression: 'lower(email)',
        unique: true,
      });
      expect(psl).toContain(
        '@@index(expression: "lower(email)", map: "users_email_ci_key", unique: true)',
      );
    });

    it("a default-method index with reloptions emits an explicit type: 'btree' with options:", () => {
      // Introspection normalizes btree away, but PSL requires options: to be
      // paired with type: — the explicit spelling round-trips clean because
      // the expected node's constructor normalizes btree back to undefined.
      const psl = pslWithIndex({
        name: 'users_email_ff_idx',
        columns: ['email'],
        unique: false,
        options: { fillfactor: '70' },
      });
      expect(psl).toContain(
        '@@index([email], map: "users_email_ff_idx", type: "btree", options: { fillfactor: "70" })',
      );
    });

    it('type: and options: emit as introspected when both are present', () => {
      const psl = pslWithIndex({
        name: 'users_email_hash',
        columns: ['email'],
        unique: false,
        type: 'hash',
        options: { fillfactor: '70' },
      });
      expect(psl).toContain(
        '@@index([email], map: "users_email_hash", type: "hash", options: { fillfactor: "70" })',
      );
    });
  });

  it('throws on same-named tables in different schemas (single-namespace stopgap)', () => {
    const thingNode = (schemaName: string) =>
      new PostgresNamespaceSchemaNode({
        schemaName,
        tables: {
          thing: new PostgresTableSchemaNode({
            name: 'thing',
            columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
        },
      });
    const tree = new PostgresDatabaseSchemaNode({
      namespaces: { public: thingNode('public'), auth: thingNode('auth') },
      roles: [],
      existingSchemas: ['public', 'auth'],
      pgVersion: '',
    });

    // The same table name in two schemas has no unambiguous single-bucket model:
    // throw rather than silently dropping one namespace's table.
    expect(() => inferPostgresPslContract(tree)).toThrow(
      /duplicate table name "thing" across schemas is not yet supported/i,
    );
    let caught: unknown;
    try {
      inferPostgresPslContract(tree);
    } catch (error) {
      caught = error;
    }
    expect(isStructuredError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: 'CONTRACT.INFER_UNSUPPORTED',
      meta: { tableName: 'thing' },
    });
  });
});
