/**
 * verifySqlSchemaByDiff envelope: the family verify wraps the differ verdict
 * in the issue-based result. `ok` derives from the FAILURE lists only; a
 * warn-graded finding (an `observed`-policy subject's drift) keeps `ok: true`
 * but MUST surface in `schema.warnings` — the regression this pins is the
 * envelope silently dropping the graded warnings.
 */

import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { relationalNodeGranularity, SqlColumnIR, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { verifySqlSchemaByDiff } from '../src/core/diff/schema-verify';
import type { SqlSchemaDiffFn } from '../src/exports/control';
import { createTestContract } from './schema-verify.helpers';

/**
 * A stub target diff: the live DB is missing the `user.email` column, so the
 * differ emits one `not-found` issue whose subject table resolves to `control`.
 */
function stubDiff(control: 'observed' | 'managed'): SqlSchemaDiffFn {
  return () => ({
    issues: [
      {
        path: ['database', 'user', 'column:email'],
        expected: new SqlColumnIR({ name: 'email', typeText: 'text', nullable: false }),
      },
    ],
    resolveControlPolicy: () => control,
    namespacePairs: [],
  });
}

const contract = createTestContract({}) as Contract<SqlStorage>;

describe('verifySqlSchemaByDiff surfaces warnings without failing', () => {
  it('an observed subject drifts: ok stays true, the warning is carried in the envelope', () => {
    const result = verifySqlSchemaByDiff({
      contract,
      schema: new SqlSchemaIR({ tables: {} }),
      strict: false,
      frameworkComponents: [],
      diffSchema: stubDiff('observed'),
      granularityOf: relationalNodeGranularity,
    });

    expect(result.ok).toBe(true);
    expect(result.schema.issues).toEqual([]);
    expect(result.schema.warnings?.issues).toHaveLength(1);
    expect(result.schema.warnings?.issues[0]?.path.join('/')).toContain('column:email');
  });

  it('a managed subject drifts: it fails, and the failure is not double-counted as a warning', () => {
    const result = verifySqlSchemaByDiff({
      contract,
      schema: new SqlSchemaIR({ tables: {} }),
      strict: false,
      frameworkComponents: [],
      diffSchema: stubDiff('managed'),
      granularityOf: relationalNodeGranularity,
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toHaveLength(1);
    expect(result.schema.warnings?.issues ?? []).toEqual([]);
  });
});
