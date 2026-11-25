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
import {
  type SqlSchemaDiffFn,
  VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED,
} from '../src/exports/control';
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
    capabilityShortfall: undefined,
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

describe('verifySqlSchemaByDiff refuses a database that lacks capabilities the contract requires', () => {
  const database = new SqlSchemaIR({ tables: {} });
  const shortfall = {
    path: ['database'],
    expected: database,
    actual: database,
    explanation: {
      text: 'Your contract requires PostgreSQL 17 or later. This database runs PostgreSQL 15.4.',
      cause: 'differs' as const,
    },
  };

  function verifyWithShortfall(control: 'observed' | 'managed', strict: boolean) {
    return verifySqlSchemaByDiff({
      contract: createTestContract({}, {}, undefined, { defaultControlPolicy: control }),
      schema: database,
      strict,
      frameworkComponents: [],
      diffSchema: (input) => ({ ...stubDiff(control)(input), capabilityShortfall: shortfall }),
      granularityOf: relationalNodeGranularity,
    });
  }

  it.each([
    ['managed', true],
    ['observed', false],
  ] as const)(
    'with its own code and summary, under a %s policy (strict: %s)',
    (control, strict) => {
      const result = verifyWithShortfall(control, strict);

      expect(result).toMatchObject({
        ok: false,
        code: VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED,
        summary: shortfall.explanation.text,
      });
      expect(result.schema.issues[0]).toBe(shortfall);
      expect(result.schema.warnings?.issues ?? []).not.toContain(shortfall);
    },
  );
});
