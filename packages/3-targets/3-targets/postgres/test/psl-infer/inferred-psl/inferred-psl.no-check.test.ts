/**
 * Pins infer's `@noCheck(elementNotNull)` emission rule at the unit level:
 * a list column counts as enforced only when the live table carries a check
 * under exactly the derived wire name (prefix AND content hash); any other
 * name — including the same prefix with a different hash — emits the
 * opt-out. The name is composed with the same shared naming helpers
 * authoring uses, so the comparison cannot drift.
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
  many: true,
  memberValues: undefined,
})[0];

const derivedPrefix = composeCheckWirePrefix('users', 'tags', 'elementNotNull');
const derivedHash = computeCheckContentHash(elementCandidate?.expression ?? '');

function schemaWithCheck(hash: string | undefined): SqlSchemaIR {
  return new SqlSchemaIR({
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

describe('printPsl — @noCheck emission', () => {
  it('a live check at exactly the derived wire name emits no @noCheck', () => {
    const psl = printPslFromFlat(schemaWithCheck(derivedHash));
    expect(formatWireName(derivedPrefix, derivedHash)).toMatch(
      /^users_tags_elem_not_null_[0-9a-f]{8}$/,
    );
    expect(psl).toMatch(/tags\s+String\[\]\s*$/m);
    expect(psl).not.toContain('@noCheck');
  });

  it('a live check under the same prefix but a different hash emits @noCheck(elementNotNull)', () => {
    const psl = printPslFromFlat(schemaWithCheck('deadbeef'));
    expect(psl).toMatch(/tags\s+String\[\]\s+@noCheck\(elementNotNull\)/);
  });

  it('no live check at all emits @noCheck(elementNotNull)', () => {
    const psl = printPslFromFlat(schemaWithCheck(undefined));
    expect(psl).toMatch(/tags\s+String\[\]\s+@noCheck\(elementNotNull\)/);
  });
});
