/**
 * Managed and external native enums against a live (PGlite) database, as their members change:
 *
 *  - External untouched (R5): an external native enum yields ZERO enum ops and no drift, also
 *    when a value is appended in the database.
 *  - Suffix-append (R8): a single or multi-value append plans/applies as `ALTER TYPE … ADD VALUE`,
 *    ordered, and re-verifies clean.
 *  - Member-change refusal (R9): rename/removal/reorder each plan zero ops and leave the database
 *    untouched.
 */
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { issueOutcome } from '@internal/framework-components/control';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ALLOW_DESTRUCTIVE,
  applyBaseEnumContract,
  applyPlan,
  buildContractFromPsl,
  nativeEnumMembers,
  opIds,
  orderStatusRefusalMessage,
  PSL_ENUM_MEMBER_REMOVED,
  PSL_ENUM_RENAMED,
  PSL_ENUM_REORDERED,
  PSL_ENUM_SIX_MEMBERS,
  PSL_ENUM_TWO_MEMBERS,
  PSL_ENUM_VALUE_CHANGED,
  PSL_WITH_ENUM,
  planContract,
  planDirect,
} from './fixtures/native-enum-lifecycle';
import {
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

describe('external native enum stays untouched (R5)', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    if (driver) await driver.close();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  it(
    'migrate from empty produces ZERO enum ops for an external enum',
    async () => {
      const contract = buildContractFromPsl(PSL_WITH_ENUM, 'external');
      const plan = await planContract(contract, emptySchema, INIT_ADDITIVE_POLICY);
      const ids = await opIds(plan);
      expect(ids.some((id) => id.startsWith('createNativeEnumType.'))).toBe(false);
      expect(ids.some((id) => id.startsWith('dropNativeEnumType.'))).toBe(false);
    },
    testTimeout,
  );

  it(
    'verify FAILS on external enum member drift (strict — no valueDrift forgiveness)',
    async () => {
      // Live DB has the type with REORDERED members. Post-#949 the enum rides
      // the DEFAULT reason→category path: a member-drifted enum is a plain
      // `not-equal` → `declaredIncompatible`, which `external` does NOT forgive
      // (it only suppresses EXTRA objects). Strict verify: a drifted enum
      // fails regardless of grade.
      await driver!.query(`CREATE TYPE order_status AS ENUM ('review', 'draft', 'done')`);
      await driver!
        .query(`ALTER TABLE "public"."orders" ADD COLUMN status order_status`)
        .catch(async () => {
          await driver!.query('CREATE TABLE "public"."orders" (id int PRIMARY KEY)');
          await driver!.query(`ALTER TABLE "public"."orders" ADD COLUMN status order_status`);
        });

      const contract = buildContractFromPsl(PSL_WITH_ENUM, 'external');
      const introspected = await familyInstance.introspect({ driver: driver! });
      const verify = familyInstance.verifySchema({
        contract,
        schema: introspected,
        strict: true,
        frameworkComponents,
      });

      expect(verify.ok).toBe(false);
      const mismatch = verify.schema.issues.filter(
        (i) => issueOutcome(i) === 'not-equal' && i.path.some((p) => p.includes('order_status')),
      );
      expect(mismatch.length).toBeGreaterThan(0);
    },
    testTimeout,
  );
});

describe('managed native-enum suffix-append (R8)', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  it(
    'single append: plans one addNativeEnumValue op (caveat in its description), applies, re-verifies clean',
    async () => {
      const baseContract = buildContractFromPsl(PSL_ENUM_TWO_MEMBERS, 'managed');
      const basePlan = await planContract(baseContract, emptySchema, INIT_ADDITIVE_POLICY);
      await applyPlan(driver, basePlan, baseContract, INIT_ADDITIVE_POLICY);

      const introspectedBase = await familyInstance.introspect({ driver, contract: baseContract });
      const appendedContract = buildContractFromPsl(PSL_WITH_ENUM, 'managed');
      const appendPlan = await planContract(
        appendedContract,
        introspectedBase,
        INIT_ADDITIVE_POLICY,
      );

      const ids = await opIds(appendPlan);
      expect(ids).toEqual(['addNativeEnumValue.order_status.done']);

      // The op's rendered description carries the non-transactional caveat
      // (spec §4) — the text `migration plan` shows for this op at plan time.
      const ops = await Promise.all(appendPlan.operations);
      expect(ops[0]?.summary).toContain(
        'A newly added enum value cannot be used until the transaction that adds it commits',
      );

      await applyPlan(driver, appendPlan, appendedContract, INIT_ADDITIVE_POLICY);

      const introspectedAfterApply = await familyInstance.introspect({
        driver,
        contract: appendedContract,
      });
      expect(nativeEnumMembers(introspectedAfterApply, 'public', 'order_status')).toEqual([
        'draft',
        'review',
        'done',
      ]);

      const verify = familyInstance.verifySchema({
        contract: appendedContract,
        schema: introspectedAfterApply,
        strict: true,
        frameworkComponents,
      });
      expect(verify.ok).toBe(true);
    },
    testTimeout,
  );

  it(
    'multi append: three appended members apply in declaration order, verify green',
    async () => {
      const currentContract = buildContractFromPsl(PSL_WITH_ENUM, 'managed');
      const introspectedBefore = await familyInstance.introspect({
        driver,
        contract: currentContract,
      });

      const targetContract = buildContractFromPsl(PSL_ENUM_SIX_MEMBERS, 'managed');
      const plan = await planContract(targetContract, introspectedBefore, INIT_ADDITIVE_POLICY);

      const ids = await opIds(plan);
      expect(ids).toEqual([
        'addNativeEnumValue.order_status.archived',
        'addNativeEnumValue.order_status.cancelled',
        'addNativeEnumValue.order_status.refunded',
      ]);

      await applyPlan(driver, plan, targetContract, INIT_ADDITIVE_POLICY);

      const introspectedAfter = await familyInstance.introspect({
        driver,
        contract: targetContract,
      });
      expect(nativeEnumMembers(introspectedAfter, 'public', 'order_status')).toEqual([
        'draft',
        'review',
        'done',
        'archived',
        'cancelled',
        'refunded',
      ]);

      const verify = familyInstance.verifySchema({
        contract: targetContract,
        schema: introspectedAfter,
        strict: true,
        frameworkComponents,
      });
      expect(verify.ok).toBe(true);
    },
    testTimeout,
  );
});

describe('managed native-enum member-change refusal end-to-end (R9)', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    if (driver) await driver.close();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await applyBaseEnumContract(driver);
  }, testTimeout);

  const refusalCases: ReadonlyArray<{
    readonly label: string;
    readonly psl: string;
    readonly expectedMembers: readonly string[];
  }> = [
    { label: 'rename', psl: PSL_ENUM_RENAMED, expectedMembers: ['draft', 'reviewed', 'done'] },
    { label: 'removal', psl: PSL_ENUM_MEMBER_REMOVED, expectedMembers: ['draft', 'done'] },
    { label: 'reorder', psl: PSL_ENUM_REORDERED, expectedMembers: ['review', 'draft', 'done'] },
  ];

  for (const { label, psl, expectedMembers } of refusalCases) {
    it(
      `${label}: refused with the exact diagnostic, zero ops, database untouched`,
      async () => {
        const introspectedBase = await familyInstance.introspect({
          driver: driver!,
          contract: buildContractFromPsl(PSL_WITH_ENUM, 'managed'),
        });
        const actualMembers = nativeEnumMembers(introspectedBase, 'public', 'order_status');
        expect(actualMembers).toEqual(['draft', 'review', 'done']);

        const changedContract = buildContractFromPsl(psl, 'managed');
        const result = planDirect(changedContract, introspectedBase, ALLOW_DESTRUCTIVE);

        expect(result.kind).toBe('failure');
        if (result.kind !== 'failure') return;
        expect(result.conflicts).toEqual([
          {
            kind: 'unsupportedOperation',
            summary: orderStatusRefusalMessage(expectedMembers, actualMembers!),
            why: 'Use `migration new` to author a custom migration for this change.',
          },
        ]);

        // Database untouched: a failed plan is never applied, and the live
        // members are exactly what they were before the attempt.
        const introspectedAfter = await familyInstance.introspect({
          driver: driver!,
          contract: buildContractFromPsl(PSL_WITH_ENUM, 'managed'),
        });
        expect(nativeEnumMembers(introspectedAfter, 'public', 'order_status')).toEqual(
          actualMembers,
        );
      },
      testTimeout,
    );
  }

  it(
    'a member that keeps its name with a new stored value: refused with the exact diagnostic when the plan has an origin contract, database untouched',
    async () => {
      const base = buildContractFromPsl(PSL_WITH_ENUM, 'managed');
      const introspectedBase = await familyInstance.introspect({ driver: driver!, contract: base });

      const result = planDirect(
        buildContractFromPsl(PSL_ENUM_VALUE_CHANGED, 'managed'),
        introspectedBase,
        ALLOW_DESTRUCTIVE,
        base,
      );

      expect(result.kind === 'failure' && result.conflicts).toEqual([
        {
          kind: 'unsupportedOperation',
          summary: orderStatusRefusalMessage(
            ['draft', 'reviewed', 'done'],
            ['draft', 'review', 'done'],
          ),
          why: 'Use `migration new` to author a custom migration for this change.',
        },
      ]);
      const introspectedAfter = await familyInstance.introspect({
        driver: driver!,
        contract: base,
      });
      expect(nativeEnumMembers(introspectedAfter, 'public', 'order_status')).toEqual([
        'draft',
        'review',
        'done',
      ]);
    },
    testTimeout,
  );
});

describe('external native enum: live-appended value produces ZERO ops (R5)', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (driver) await driver.close();
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    if (driver) await driver.close();
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  it(
    'a live-appended value the contract does not know about is left alone under the external grade',
    async () => {
      // The type is created OUTSIDE our tool (modeling an externally-managed
      // enum, e.g. one hand-authored by the operator) with a fourth member
      // the contract does not declare.
      await driver!.query(
        `CREATE TYPE order_status AS ENUM ('draft', 'review', 'done', 'archived')`,
      );
      await driver!.query('CREATE TABLE "public"."orders" (id int PRIMARY KEY)');
      await driver!.query('ALTER TABLE "public"."orders" ADD COLUMN status order_status NOT NULL');

      const contract = buildContractFromPsl(PSL_WITH_ENUM, 'external');
      const introspected = await familyInstance.introspect({ driver: driver!, contract });
      const result = planDirect(contract, introspected, ALLOW_DESTRUCTIVE);

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;
      const ids = await opIds(result.plan);
      expect(ids.some((id) => id.startsWith('addNativeEnumValue.'))).toBe(false);
      expect(ids.some((id) => id.startsWith('createNativeEnumType.'))).toBe(false);
      expect(ids.some((id) => id.startsWith('dropNativeEnumType.'))).toBe(false);

      // Untouched: the live member list still carries the fourth value.
      const reintrospected = await familyInstance.introspect({ driver: driver!, contract });
      expect(nativeEnumMembers(reintrospected, 'public', 'order_status')).toEqual([
        'draft',
        'review',
        'done',
        'archived',
      ]);
    },
    testTimeout,
  );
});
