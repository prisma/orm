import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SchemaDiffIssue } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { CheckConstraint, SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { computeCheckContentHash, formatWireName } from '@internal/sql-schema-ir/naming';
import { SqlCheckConstraintIR, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { planIssues } from '../../src/core/migrations/issue-planner';
import { postgresCreateNamespace } from '../../src/core/postgres-schema';
import { postgresTypeLookups } from '../postgres-type-lookups';

const TABLE_NAME = 'user';
const SCHEMA_NAME = 'public';
const PREFIX = 'user_status_check';
const EXPRESSION = `"status" IN ('active', 'inactive')`;
const WIRE_NAME = formatWireName(PREFIX, computeCheckContentHash(EXPRESSION));

function wireNaming(prefix: string, expression: string) {
  return { kind: 'wire' as const, prefix, hash: computeCheckContentHash(expression) };
}

function wireCheck(prefix: string, expression: string): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR({
    naming: wireNaming(prefix, expression),
    expression,
    dependsOn: undefined,
  });
}

function exactCheck(name: string, expression: string): SqlCheckConstraintIR {
  return new SqlCheckConstraintIR({
    naming: { kind: 'exact', name },
    expression,
    dependsOn: undefined,
  });
}

/** A contract whose table declares `checks`, replicated into each namespace. */
function contractWith(
  namespaceIds: readonly string[],
  checks: readonly CheckConstraint[],
): Contract<SqlStorage> {
  const namespaces = Object.fromEntries(
    namespaceIds.map((id) => [
      id,
      postgresCreateNamespace({
        id,
        entries: {
          table: {
            [TABLE_NAME]: new StorageTable({
              columns: {
                id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                status: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
              },
              primaryKey: { columns: ['id'] },
              foreignKeys: [],
              uniques: [],
              indexes: [],
              ...(checks.length > 0 ? { checks: [...checks] } : {}),
            }),
          },
        },
      }),
    ]),
  );
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({ storageHash: coreHash('contract'), namespaces }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function schemaWith(checks: readonly SqlCheckConstraintIR[]): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      [TABLE_NAME]: {
        name: TABLE_NAME,
        columns: { id: { name: 'id', nativeType: 'int4', nullable: false } },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        ...(checks.length > 0 ? { checks: [...checks] } : {}),
      },
    },
  });
}

/** A node-typed check issue, in the shape the one differ produces. */
function checkIssue(options: {
  readonly namespaceId?: string;
  readonly expected?: SqlCheckConstraintIR;
  readonly actual?: SqlCheckConstraintIR;
}): SchemaDiffIssue {
  const name = (options.expected ?? options.actual)?.name ?? '';
  return {
    path: ['database', options.namespaceId ?? UNBOUND_NAMESPACE_ID, TABLE_NAME, `check:${name}`],
    ...(options.expected !== undefined ? { expected: options.expected } : {}),
    ...(options.actual !== undefined ? { actual: options.actual } : {}),
  };
}

const defaultCtx = {
  schemaName: SCHEMA_NAME,
  codecHooks: new Map(),
  types: postgresTypeLookups,
  storageTypes: {},
};

describe('check planning is diff-driven', () => {
  it('a not-found check plans an add carrying the declared expression', () => {
    const result = planIssues({
      ...defaultCtx,
      issues: [checkIssue({ expected: wireCheck(PREFIX, EXPRESSION) })],
      toContract: contractWith(
        [UNBOUND_NAMESPACE_ID],
        [new CheckConstraint({ naming: wireNaming(PREFIX, EXPRESSION), expression: EXPRESSION })],
      ),
      fromContract: null,
      schema: schemaWith([]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.calls.filter((c) => c.factoryName === 'addCheckConstraint')).toMatchObject([
      {
        factoryName: 'addCheckConstraint',
        tableName: TABLE_NAME,
        constraintName: WIRE_NAME,
        expression: EXPRESSION,
      },
    ]);
  });

  it('a not-expected check plans a drop', () => {
    const live = exactCheck('legacy_check', '(status IS NOT NULL)');
    const result = planIssues({
      ...defaultCtx,
      issues: [checkIssue({ actual: live })],
      toContract: contractWith([UNBOUND_NAMESPACE_ID], []),
      fromContract: null,
      schema: schemaWith([live]),
      policy: { allowedOperationClasses: ['additive', 'destructive'] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.calls.filter((c) => c.factoryName === 'dropCheckConstraint')).toMatchObject(
      [
        {
          factoryName: 'dropCheckConstraint',
          tableName: TABLE_NAME,
          constraintName: 'legacy_check',
        },
      ],
    );
  });

  it('a not-equal check is a conflict — only an exact-named check can reach it', () => {
    const result = planIssues({
      ...defaultCtx,
      issues: [
        checkIssue({
          expected: exactCheck('legacy_check', '(price > 0)'),
          actual: exactCheck('legacy_check', '(price >= 0)'),
        }),
      ],
      toContract: contractWith(
        [UNBOUND_NAMESPACE_ID],
        [
          new CheckConstraint({
            naming: { kind: 'exact', name: 'legacy_check' },
            expression: '(price > 0)',
          }),
        ],
      ),
      fromContract: null,
      schema: schemaWith([exactCheck('legacy_check', '(price >= 0)')]),
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure).toMatchObject([{ kind: 'unsupportedOperation' }]);
  });
});

describe('a prefix-only change reaches the mapper as a missing/extra pair', () => {
  it('maps the pair to an add and a drop', () => {
    // Same predicate, different prefix: the hashes agree but the physical
    // names do not, so the differ reports one missing and one extra.
    //
    // This is the ISSUE MAPPER, which sits below the rename post-pass and
    // therefore never sees a pairing opportunity — drop + add is the correct
    // answer at this layer, and stays correct. Whether the two issues ever
    // reach it depends on the policy: `pairCheckRenames` consumes them into a
    // single RENAME CONSTRAINT when `widening` is allowed, and leaves them
    // alone otherwise. Both halves are pinned end-to-end through
    // `planner.plan` in `check-rename-planner.test.ts`.
    const expected = wireCheck('user_state_check', EXPRESSION);
    const actual = wireCheck(PREFIX, EXPRESSION);
    const result = planIssues({
      ...defaultCtx,
      issues: [checkIssue({ expected }), checkIssue({ actual })],
      toContract: contractWith(
        [UNBOUND_NAMESPACE_ID],
        [
          new CheckConstraint({
            naming: wireNaming('user_state_check', EXPRESSION),
            expression: EXPRESSION,
          }),
        ],
      ),
      fromContract: null,
      schema: schemaWith([actual]),
      policy: { allowedOperationClasses: ['additive', 'destructive'] },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.calls
        .filter(
          (c) => c.factoryName === 'addCheckConstraint' || c.factoryName === 'dropCheckConstraint',
        )
        .map((c) => ({ factoryName: c.factoryName, constraintName: c.constraintName })),
    ).toEqual(
      expect.arrayContaining([
        { factoryName: 'addCheckConstraint', constraintName: expected.name },
        { factoryName: 'dropCheckConstraint', constraintName: actual.name },
      ]),
    );
  });
});

describe('multi-namespace independence', () => {
  it('plans each schema against its own namespace when the names collide', () => {
    // The deleted direct-walk strategy probed a single namespace, so two
    // schemas carrying identically named tables and checks planned wrongly.
    const expected = wireCheck(PREFIX, EXPRESSION);
    const result = planIssues({
      ...defaultCtx,
      issues: [
        checkIssue({ namespaceId: 'tenant_a', expected }),
        checkIssue({ namespaceId: 'tenant_b', expected }),
      ],
      toContract: contractWith(
        ['tenant_a', 'tenant_b'],
        [new CheckConstraint({ naming: wireNaming(PREFIX, EXPRESSION), expression: EXPRESSION })],
      ),
      fromContract: null,
      schema: schemaWith([]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.value.calls
        .filter((c) => c.factoryName === 'addCheckConstraint')
        .map((c) => ({ schemaName: c.schemaName, constraintName: c.constraintName })),
    ).toEqual([
      { schemaName: 'tenant_a', constraintName: WIRE_NAME },
      { schemaName: 'tenant_b', constraintName: WIRE_NAME },
    ]);
  });
});
