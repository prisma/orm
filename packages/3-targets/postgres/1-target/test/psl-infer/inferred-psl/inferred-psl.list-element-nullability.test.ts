/**
 * A list column's elements are non-null only when the live table carries a
 * check under exactly the derived wire name (prefix and content hash). Any
 * other name, including the same prefix with a different hash, leaves the
 * elements nullable, so infer writes `T?[]`.
 */
import {
  composeCheckWirePrefix,
  computeCheckContentHash,
  formatWireName,
} from '@internal/sql-schema-ir/naming';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { postgresRenderCheckExpressions } from '../../../src/core/check-expressions';
import { printPslFromFlat } from '../fixtures';

const elementCandidate = postgresRenderCheckExpressions({
  tableName: 'users',
  columnName: 'tags',
  many: { elementNullable: false },
  memberValues: undefined,
  valueObject: undefined,
})[0];

const derivedPrefix = composeCheckWirePrefix('users', 'tags', 'elementNotNull');
const derivedHash = computeCheckContentHash(elementCandidate?.expression ?? '');

function schemaWithCheck(hash: string | undefined): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      users: {
        name: 'users',
        columns: {
          id: { name: 'id', typeText: 'int4', nullable: false },
          tags: { name: 'tags', typeText: 'text', nullable: false, many: true },
        },
        primaryKey: { columns: ['id'] },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        ...(hash !== undefined
          ? {
              checks: [
                {
                  naming: { kind: 'wire' as const, prefix: derivedPrefix, hash },
                  expression: elementCandidate?.expression ?? '',
                  dependsOn: undefined,
                },
              ],
            }
          : {}),
      },
    },
  });
}

describe('printPsl — list element nullability', async () => {
  it('writes T[] when a live check has exactly the derived wire name', async () => {
    const psl = await printPslFromFlat(schemaWithCheck(derivedHash));
    expect(formatWireName(derivedPrefix, derivedHash)).toMatch(
      /^users_tags_elem_not_null_[0-9a-f]{8}$/,
    );
    expect(psl).toMatch(/tags\s+String\[\]\s*$/m);
  });

  it('writes T?[] when a live check has the derived prefix but a different hash', async () => {
    const psl = await printPslFromFlat(schemaWithCheck('deadbeef'));
    expect(psl).toMatch(/tags\s+String\?\[\]\s*$/m);
  });

  it('writes T?[] when there is no live check', async () => {
    const psl = await printPslFromFlat(schemaWithCheck(undefined));
    expect(psl).toMatch(/tags\s+String\?\[\]\s*$/m);
  });
});
