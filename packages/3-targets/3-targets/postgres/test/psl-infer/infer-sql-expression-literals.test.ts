/**
 * `contract infer` prints the SQL of indexes, checks and policies as `sql` literals. It skips, with
 * a note on the model, an exact-named object whose SQL would not read back unchanged, and prints a
 * wire-named one with its canonical text.
 */
import { printPsl } from '@internal/psl-printer';
import {
  computeIndexContentHash,
  formatWireName,
  parseNaming,
} from '@internal/sql-schema-ir/naming';
import type {
  SqlCheckConstraintIRInput,
  SqlColumnIRInput,
  SqlIndexIRInput,
} from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringPslBlockDescriptors } from '../../src/core/authoring';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { inferBuildContext } from './fixtures';

function index(name: string, parts: Partial<SqlIndexIRInput>): SqlIndexIRInput {
  return {
    naming: parseNaming(name, undefined),
    unique: false,
    partial: parts.where !== undefined,
    annotations: undefined,
    dependsOn: undefined,
    ...parts,
  } as SqlIndexIRInput;
}

function check(name: string, expression: string): SqlCheckConstraintIRInput {
  return { naming: parseNaming(name, undefined), expression, dependsOn: undefined };
}

function policy(name: string, using: string, withCheck?: string): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    naming: parseNaming(name, undefined),
    tableName: 'profile',
    namespaceId: 'public',
    operation: withCheck === undefined ? 'select' : 'update',
    roles: ['app_user'],
    using,
    withCheck,
    permissive: true,
    dependsOn: undefined,
  });
}

function infer(input: {
  readonly columns?: Record<string, SqlColumnIRInput>;
  readonly indexes?: readonly SqlIndexIRInput[];
  readonly checks?: readonly SqlCheckConstraintIRInput[];
  readonly policies?: readonly PostgresPolicySchemaNode[];
}): string {
  const tree = new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          profile: new PostgresTableSchemaNode({
            name: 'profile',
            columns: {
              id: { name: 'id', nativeType: 'int4', nullable: false },
              owner_id: { name: 'owner_id', nativeType: 'int4', nullable: false },
              ...input.columns,
            },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [...(input.indexes ?? [])],
            checks: [...(input.checks ?? [])],
            policies: [...(input.policies ?? [])],
            rlsEnabled: (input.policies ?? []).length > 0,
          }),
        },
      }),
    },
    roles: [],
    existingSchemas: ['public'],
    pgVersion: '',
  });
  return printPsl(inferPostgresPslContract(tree, inferBuildContext), {
    pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
  });
}

const SKIP_NOTE = (kind: string, name: string) =>
  `// prisma: skipped ${kind} "${name}": its SQL cannot be written as a sql literal that reads back unchanged. It is not in this schema, so migration plan will drop it. A sql literal written by hand holds different text, so migration plan then stops with a conflict for an index or check, or drops and recreates a policy. Either change the SQL in the database to the text of the literal, or add the object without map: or @@map so Prisma names it.`;

describe('contract infer prints raw SQL as sql literals', () => {
  it('prints index expression and where as sql literals', () => {
    const psl = infer({
      indexes: [
        index('profile_lower', { expression: 'lower((owner_id)::text)' }),
        index('profile_active', { columns: ['owner_id'], where: '(owner_id > 0)' }),
      ],
    });

    expect(psl).toContain(
      '@@index(expression: sql`lower((owner_id)::text)`, map: "profile_lower")',
    );
    expect(psl).toContain('@@index([ownerId], map: "profile_active", where: sql`(owner_id > 0)`)');
  });

  it('prints a check expression as a sql literal', () => {
    expect(infer({ checks: [check('profile_owner', '(owner_id > 0)')] })).toContain(
      '@@check(expression: sql`(owner_id > 0)`, map: "profile_owner")',
    );
  });

  it('prints policy predicates as sql literals', () => {
    const psl = infer({ policies: [policy('p_write', '(owner_id = 1)', '(owner_id = 2)')] });

    expect(psl).toContain('using = sql`(owner_id = 1)`');
    expect(psl).toContain('withCheck = sql`(owner_id = 2)`');
  });

  it('prints a text holding a backtick in the double-quote form', () => {
    expect(infer({ checks: [check('profile_tick', "(owner_id <> '`'::text)")] })).toContain(
      '@@check(expression: sql"(owner_id <> \'`\'::text)", map: "profile_tick")',
    );
  });

  it('prints a multi-line text on its own lines', () => {
    const psl = infer({ policies: [policy('p_read', '(owner_id = 1)\nOR (id = 2)')] });

    expect(psl).toMatch(/using = sql`\n\s*\(owner_id = 1\)\n\s*OR \(id = 2\)\n\s*`/);
  });
});

describe('contract infer skips SQL that would not read back', () => {
  it('skips a check whose reprint holds a carriage return, with a note', () => {
    const psl = infer({
      checks: [check('profile_crlf', "(owner_id <> E'a\r\nb')"), check('profile_ok', '(id > 0)')],
    });

    expect(psl).not.toContain('map: "profile_crlf"');
    expect(psl).toContain('@@check(expression: sql`(id > 0)`, map: "profile_ok")');
    expect(psl).toContain(SKIP_NOTE('check', 'profile_crlf'));
  });

  it('skips an index whose where or expression would not read back, with a note', () => {
    const psl = infer({
      indexes: [
        index('profile_indented', { columns: ['owner_id'], where: '  (owner_id > 0)' }),
        index('profile_crlf_expr', { expression: "lower(E'a\r\nb')" }),
      ],
    });

    expect(psl).not.toContain('@@index');
    expect(psl).toContain(SKIP_NOTE('index', 'profile_indented'));
    expect(psl).toContain(SKIP_NOTE('index', 'profile_crlf_expr'));
  });

  it.each([
    ['a blank last line', '(owner_id > 0)\n'],
    ['two blank first lines', '\n\n(owner_id > 0)'],
  ])('prints a wire-named index whose where has %s with its canonical text', (_name, where) => {
    const name = formatWireName(
      'profile_owner_idx',
      computeIndexContentHash({ columns: ['owner_id'], where, unique: false }),
    );
    const psl = infer({ indexes: [index(name, { columns: ['owner_id'], where })] });

    expect(psl).toContain(
      '@@index([ownerId], name: "profile_owner_idx", where: sql`(owner_id > 0)`)',
    );
    expect(psl).not.toContain('prisma: skipped');
  });

  it('skips a policy whose using or withCheck would not read back, with a note', () => {
    const psl = infer({
      policies: [
        policy('p_crlf', "(owner_id = 1) OR (E'a\r\nb' = '')"),
        policy('p_blank', '(owner_id = 1)', '(owner_id = 2)\n'),
      ],
    });

    expect(psl).not.toContain('policy_');
    expect(psl).toContain(SKIP_NOTE('policy', 'p_crlf'));
    expect(psl).toContain(SKIP_NOTE('policy', 'p_blank'));
  });
});

describe('contract infer keeps a default whose text would not read back, with a note', () => {
  const DEFAULT_NOTE = (column: string) =>
    `// prisma: default of "${column}" holds text a sql literal cannot write back unchanged; check its string constants before applying a migration`;

  it('prints the default and notes it on the model', () => {
    const psl = infer({
      columns: {
        label: { name: 'label', nativeType: 'text', nullable: false, default: "lower('a\r\nb')" },
      },
    });

    expect(psl).toContain("  label   String @default(sql`\nlower('a\r\nb')\n`)\n");
    expect(psl).toContain(DEFAULT_NOTE('label'));
  });

  it('adds no note for a default that reads back', () => {
    const psl = infer({
      columns: {
        label: { name: 'label', nativeType: 'text', nullable: false, default: "lower('a')" },
      },
    });

    expect(psl).toContain("label   String @default(sql`lower('a')`)");
    expect(psl).not.toContain('prisma: default of');
  });
});
