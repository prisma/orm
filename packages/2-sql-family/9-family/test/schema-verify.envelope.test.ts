/**
 * verifySqlSchemaByDiff envelope: the family verify wraps the differ verdict
 * in the issue-based result. `ok` derives from the FAILURE lists only; a
 * warn-graded finding (an `observed`-policy subject's drift) keeps `ok: true`
 * but MUST surface in `schema.warnings` — the regression this pins is the
 * envelope silently dropping the graded warnings.
 */

import type { Contract } from '@internal/contract/types';
import {
  createAggregateContractSpace,
  createContractSpaceAggregate,
  verifyMigration,
} from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  relationalNodeGranularity,
  SqlColumnIR,
  SqlSchemaIR,
  SqlTableIR,
} from '@internal/sql-schema-ir/types';
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
      databaseCapabilitiesNotProvided: undefined,
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
      databaseCapabilitiesNotProvided: undefined,
    });

    expect(result.ok).toBe(false);
    expect(result.schema.issues).toHaveLength(1);
    expect(result.schema.warnings?.issues ?? []).toEqual([]);
  });
});

describe('verifySqlSchemaByDiff refuses a database that does not provide capabilities the contract requires', () => {
  const database = new SqlSchemaIR({ tables: {} });
  const notProvided = {
    database: 'PostgreSQL',
    findings: [{ kind: 'older-than-supported', databaseVersion: '14.10', oldestSupported: 15 }],
  } as const;
  const text =
    'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.';

  /** The live database also holds a table no contract declares, which a check across contract spaces strips from each space's result. */
  const withUndeclaredTable: SqlSchemaDiffFn = (input) => ({
    ...stubDiff('managed')(input),
    issues: [
      {
        path: ['orphan'],
        actual: new SqlTableIR({
          name: 'orphan',
          columns: {},
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
    ],
  });

  function verifyWith(input: {
    readonly control: 'observed' | 'managed';
    readonly strict: boolean;
    readonly diffSchema?: SqlSchemaDiffFn;
  }) {
    return verifySqlSchemaByDiff({
      contract: createTestContract({}, {}, undefined, { defaultControlPolicy: input.control }),
      schema: database,
      strict: input.strict,
      frameworkComponents: [],
      diffSchema: input.diffSchema ?? stubDiff(input.control),
      granularityOf: relationalNodeGranularity,
      databaseCapabilitiesNotProvided: () => notProvided,
    });
  }

  it.each([
    ['managed', true],
    ['observed', false],
  ] as const)(
    'with its own code and summary, under a %s policy (strict: %s)',
    (control, strict) => {
      const result = verifyWith({ control, strict });

      expect(result).toMatchObject({
        ok: false,
        code: VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED,
        summary: text,
      });
      expect(JSON.parse(JSON.stringify(result.schema.issues[0]))).toEqual({
        path: ['capabilities'],
        expected: { nodeKind: 'database-capabilities', id: 'capabilities' },
        explanation: { text, cause: 'database-not-provided', notProvided },
      });
      expect(result.schema.warnings?.issues ?? []).not.toContainEqual(
        expect.objectContaining({ path: ['capabilities'] }),
      );
    },
  );

  it('still fails each space of a check across contract spaces, which strips the undeclared table', () => {
    const contractSpace = createAggregateContractSpace({
      spaceId: 'app',
      packages: [],
      refs: {},
      headRef: null,
      refsDir: 'refs',
      migrationsDir: 'migrations',
      resolveContract: () => contract,
      deserializeContract: () => contract,
    });
    const verified = verifyMigration({
      aggregate: createContractSpaceAggregate({
        targetId: 'postgres',
        app: contractSpace,
        extensions: [],
        checkIntegrity: () => [],
      }),
      markersBySpaceId: new Map(),
      schemaIntrospection: database,
      mode: 'strict',
      verifySchemaForSpace: () =>
        verifyWith({ control: 'managed', strict: true, diffSchema: withUndeclaredTable }),
    });

    expect(verified.assertOk().schemaCheck.perSpace.get('app')).toMatchObject({
      ok: false,
      code: VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED,
      summary: text,
      schema: { issues: [expect.objectContaining({ path: ['capabilities'] })] },
    });
  });

  it('is not checked for a target without the hook', () => {
    const result = verifySqlSchemaByDiff({
      contract,
      schema: database,
      strict: false,
      frameworkComponents: [],
      diffSchema: stubDiff('observed'),
      granularityOf: relationalNodeGranularity,
      databaseCapabilitiesNotProvided: undefined,
    });

    expect(result.code).toBeUndefined();
  });
});
