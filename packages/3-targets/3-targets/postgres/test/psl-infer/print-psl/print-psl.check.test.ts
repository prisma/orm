/**
 * Pins infer's `@@check` emission rule at the unit level: a live check emits
 * `@@check(expression: …, map: …)` iff its physical name is NOT the derived
 * wire name for some column/kind of its table — the same full-hash rule
 * `@noCheck` waiving uses (print-psl.no-check.test.ts), now shared through
 * `computeDerivedCheckNames`. A table carrying both a derived and a
 * hand-written check emits exactly one `@@check`, for the hand-written one.
 */
import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  parseNaming,
} from '@internal/sql-schema-ir/naming';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { postgresRenderCheckExpressions } from '../../../src/core/check-expressions';
import { printPslFromFlat } from '../fixtures';

const elementCandidate = postgresRenderCheckExpressions({
  tableName: 'users',
  columnName: 'tags',
  many: true,
  memberValues: undefined,
})[0];

const derivedPrefix = composeCheckWirePrefix('users', 'tags', 'elementNotNull');
const derivedHash = computeCheckContentHash(elementCandidate?.expression ?? '');

describe('printPsl — @@check emission', () => {
  it('a live check at exactly the derived wire name emits no @@check', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            tags: { name: 'tags', nativeType: 'text', nullable: false, many: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          checks: [
            {
              naming: { kind: 'wire' as const, prefix: derivedPrefix, hash: derivedHash },
              expression: elementCandidate?.expression ?? '',
              dependsOn: undefined,
            },
          ],
        },
      },
    });
    const psl = printPslFromFlat(schemaIR);
    expect(psl).not.toContain('@@check');
    expect(psl).not.toContain('@noCheck');
  });

  it('a live hand-written check emits @@check with the verbatim reprint', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        orders: {
          name: 'orders',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            total: { name: 'total', nativeType: 'int4', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          checks: [
            {
              naming: parseNaming('positive_total', undefined),
              expression: '(total > (0)::numeric)',
              dependsOn: undefined,
            },
          ],
        },
      },
    });
    const psl = printPslFromFlat(schemaIR);
    expect(psl).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Orders {
        id    Int @id
        total Int

        @@check(expression: "(total > (0)::numeric)", map: "positive_total")
        @@map("orders")
      }
      "
    `);
  });

  it('a table carrying both a derived and a hand-written check emits exactly one @@check', () => {
    const schemaIR = new SqlSchemaIR({
      tables: {
        users: {
          name: 'users',
          columns: {
            id: { name: 'id', nativeType: 'int4', nullable: false },
            tags: { name: 'tags', nativeType: 'text', nullable: false, many: true },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
          checks: [
            {
              naming: { kind: 'wire' as const, prefix: derivedPrefix, hash: derivedHash },
              expression: elementCandidate?.expression ?? '',
              dependsOn: undefined,
            },
            {
              naming: parseNaming('users_soft_delete_check', undefined),
              expression: 'deleted_at IS NULL OR deleted_at > now()',
              dependsOn: undefined,
            },
          ],
        },
      },
    });
    const psl = printPslFromFlat(schemaIR);
    expect(psl.match(/@@check/g) ?? []).toHaveLength(1);
    expect(psl).not.toContain('@noCheck');
    expect(psl).toMatchInlineSnapshot(`
      "// use prisma-8
      // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

      model Users {
        id   Int      @id
        tags String[]

        @@check(expression: "deleted_at IS NULL OR deleted_at > now()", map: "users_soft_delete_check")
        @@map("users")
      }
      "
    `);
  });
});
