import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { SqlCheckConstraintIR } from '@internal/sql-schema-ir/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../src/core/control-adapter';

/**
 * Drives `introspect` with a driver that answers the catalog queries from
 * canned rows. The `check_expression` values are real `pg_get_expr` output
 * captured from Postgres 17, not hand-written approximations.
 */
async function checksOf(
  tableName: string,
  checkRows: ReadonlyArray<{ constraint_name: string; check_expression: string }>,
) {
  const adapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());
  const mockDriver: SqlControlDriverInstance<'postgres'> = {
    familyId: 'sql',
    targetId: 'postgres',
    query: async <Row = Record<string, unknown>>(sql: string) => {
      if (sql.includes('information_schema.tables')) {
        return { rows: [{ table_name: tableName }] as unknown as Row[] };
      }
      if (sql.includes('information_schema.columns')) {
        return {
          rows: [
            {
              table_name: tableName,
              column_name: 'status',
              data_type: 'text',
              udt_name: 'text',
              is_nullable: 'NO',
              character_maximum_length: null,
              numeric_precision: null,
              numeric_scale: null,
              column_default: null,
              formatted_type: null,
            },
          ] as unknown as Row[],
        };
      }
      if (sql.includes('pg_constraint') && sql.includes("contype = 'c'")) {
        return {
          rows: checkRows.map((row) => ({ table_name: tableName, ...row })) as unknown as Row[],
        };
      }
      return { rows: [] as unknown as Row[] };
    },
    close: async () => {},
  };
  const result = await adapter.introspect(mockDriver);
  return Object.values(result.namespaces)[0]?.tables[tableName]?.checks;
}

describe('PostgresControlAdapter.introspect — check constraints are opaque', () => {
  it('captures a free-form predicate verbatim', async () => {
    expect(
      await checksOf('order', [
        { constraint_name: 'positive_amount', check_expression: '(amount > (0)::numeric)' },
      ]),
    ).toEqual([
      new SqlCheckConstraintIR({
        naming: { kind: 'exact', name: 'positive_amount' },
        expression: '(amount > (0)::numeric)',
        dependsOn: undefined,
      }),
    ]);
  });

  it('captures a composite AND predicate verbatim', async () => {
    const expression = `((a > 0) AND (b <> ''::text))`;
    expect(
      await checksOf('post', [{ constraint_name: 'post_both', check_expression: expression }]),
    ).toEqual([
      new SqlCheckConstraintIR({
        naming: { kind: 'exact', name: 'post_both' },
        expression,
        dependsOn: undefined,
      }),
    ]);
  });

  it('captures the varchar-column membership shape without parsing it', async () => {
    // The reprint that defeated the old predicate parser.
    const expression = `((status)::text = ANY ((ARRAY['a'::character varying, 'b'::character varying])::text[]))`;
    expect(
      await checksOf('post', [
        { constraint_name: 'post_status_check', check_expression: expression },
      ]),
    ).toEqual([
      new SqlCheckConstraintIR({
        naming: { kind: 'exact', name: 'post_status_check' },
        expression,
        dependsOn: undefined,
      }),
    ]);
  });

  it('claims wire naming for a wire-shaped name', async () => {
    const checks = await checksOf('post', [
      {
        constraint_name: 'post_status_check_0a1b2c3d',
        check_expression: `(status = 'draft'::text)`,
      },
    ]);
    expect({ name: checks?.[0]?.name, prefix: checks?.[0]?.prefix }).toEqual({
      name: 'post_status_check_0a1b2c3d',
      prefix: 'post_status_check',
    });
  });

  it('claims exact naming for a name with no wire-shaped suffix', async () => {
    const checks = await checksOf('post', [
      { constraint_name: 'post_status_check', check_expression: `(status = 'draft'::text)` },
    ]);
    expect({ name: checks?.[0]?.name, prefix: checks?.[0]?.prefix }).toEqual({
      name: 'post_status_check',
      prefix: undefined,
    });
  });

  it('captures every row — nothing is skipped for being unparseable', async () => {
    const checks = await checksOf('post', [
      { constraint_name: 'a_free_form', check_expression: '(price > (0)::numeric)' },
      { constraint_name: 'b_composite', check_expression: `((a > 0) AND (b <> ''::text))` },
      {
        constraint_name: 'c_elem_not_null',
        check_expression: '(array_position(tags, NULL::text) IS NULL)',
      },
    ]);
    expect(checks?.map((c) => c.name)).toEqual(['a_free_form', 'b_composite', 'c_elem_not_null']);
  });

  it('leaves checks absent when a table has none', async () => {
    expect(await checksOf('user', [])).toBeUndefined();
  });
});
