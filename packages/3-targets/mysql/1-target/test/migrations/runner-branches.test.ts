import type { ContractMarkerRecord } from '@internal/contract/types';
import type {
  SqlControlFamilyInstance,
  SqlMigrationPlanOperation,
} from '@internal/family-sql/control';
import { createMigrationPlan } from '@internal/family-sql/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { MysqlPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { createMysqlMigrationRunner } from '../../src/core/migrations/runner';

const DEST = 'sha256:dest';
const ORIGIN = 'sha256:origin';

type Op = SqlMigrationPlanOperation<MysqlPlanTargetDetails>;

interface Scenario {
  readonly marker?: Partial<ContractMarkerRecord> | null;
  readonly holds?: (sql: string) => boolean;
  readonly casWins?: boolean;
  readonly verifies?: boolean;
}

function op(overrides: Partial<Op> = {}): Op {
  return {
    id: 'table.T',
    label: 'Create table T',
    operationClass: 'additive',
    target: { id: 'mysql', details: { objectType: 'table', name: 'T' } },
    precheck: [{ description: 'absent', sql: 'PRE' }],
    execute: [{ description: 'create', sql: 'EXEC' }],
    postcheck: [{ description: 'present', sql: 'POST' }],
    ...overrides,
  };
}

function setup(scenario: Scenario) {
  const events: string[] = [];
  const driver = {
    familyId: 'sql',
    targetId: 'mysql',
    async query(sql: string) {
      events.push(sql.split('(')[0] ?? sql);
      if (sql.startsWith('SELECT GET_LOCK')) return { rows: [{ acquired: '1' }] };
      return { rows: [{ result: scenario.holds?.(sql) === false ? '0' : '1' }] };
    },
    async close() {},
  } as unknown as SqlControlDriverInstance<'mysql'>;
  const marker =
    scenario.marker === undefined || scenario.marker === null
      ? null
      : { storageHash: ORIGIN, profileHash: 'p', invariants: [], ...scenario.marker };
  const family = {
    bootstrapControlTableQueries: () => [{}],
    async lowerAst() {
      return { sql: 'CREATE TABLE IF NOT EXISTS control', params: [] };
    },
    async readMarker() {
      return marker;
    },
    async introspect() {
      return {};
    },
    verifySchema() {
      return scenario.verifies === false
        ? { ok: false, summary: 'Schema differs', schema: { issues: [] } }
        : { ok: true };
    },
    async initMarker() {
      events.push('initMarker');
    },
    async updateMarker() {
      events.push('updateMarker');
      return scenario.casWins !== false;
    },
    async writeLedgerEntry() {
      events.push('writeLedgerEntry');
    },
  } as unknown as SqlControlFamilyInstance;
  return { events, driver, family };
}

function run(
  scenario: Scenario,
  plan: {
    readonly operations?: readonly Op[];
    readonly origin?: { readonly storageHash: string; readonly profileHash?: string } | null;
    readonly destination?: { readonly storageHash: string; readonly profileHash?: string };
    readonly providedInvariants?: readonly string[];
    readonly classes?: readonly ('additive' | 'destructive')[];
    readonly contractHash?: string;
    readonly executionChecks?: { readonly idempotencyChecks?: boolean };
  } = {},
) {
  const { events, driver, family } = setup(scenario);
  const operations = plan.operations ?? [op()];
  const migrationPlan = createMigrationPlan<MysqlPlanTargetDetails>({
    targetId: 'mysql',
    spaceId: 'app',
    origin: plan.origin ?? null,
    destination: plan.destination ?? { storageHash: DEST },
    operations,
    providedInvariants: plan.providedInvariants ?? [],
  });
  const options = {
    space: 'app',
    plan: migrationPlan,
    driver,
    destinationContract: {
      storage: { storageHash: plan.contractHash ?? DEST },
      profileHash: 'p',
    } as never,
    policy: { allowedOperationClasses: plan.classes ?? ['additive'] },
    frameworkComponents: [],
    ...(plan.executionChecks === undefined ? {} : { executionChecks: plan.executionChecks }),
    migrationEdges: [
      {
        from: ORIGIN,
        to: DEST,
        dirName: 'm',
        migrationHash: 'h',
        operationCount: operations.length,
      } as never,
    ],
  };
  const runner = createMysqlMigrationRunner(family);
  return {
    events,
    execute: () => runner.execute({ driver, perSpaceOptions: [options] }),
    onConnection: () => runner.executeOnConnection(options),
    mismatched: () => runner.executeOnConnection({ ...options, space: 'other' }),
  };
}

async function failureOf(result: Awaited<ReturnType<ReturnType<typeof run>['execute']>>) {
  return result.ok ? undefined : { code: result.failure.code, message: result.failure.message };
}

describe('the MySQL migration runner, refusing an apply', () => {
  it.each([
    [
      'a plan whose destination is not the contract',
      {},
      { contractHash: 'sha256:other' },
      'MIGRATION.DESTINATION_CONTRACT_MISMATCH',
    ],
    [
      'a plan whose destination profile is not the contract’s',
      {},
      { destination: { storageHash: DEST, profileHash: 'other' } },
      'MIGRATION.DESTINATION_CONTRACT_MISMATCH',
    ],
    [
      'an operation the policy does not allow',
      {},
      { operations: [op({ operationClass: 'destructive' })] },
      'MIGRATION.POLICY_VIOLATION',
    ],
    [
      'a plan with an origin and no marker',
      { marker: null },
      { origin: { storageHash: ORIGIN } },
      'MIGRATION.MARKER_ORIGIN_MISMATCH',
    ],
    [
      'a marker at another contract',
      { marker: { storageHash: 'sha256:elsewhere' } },
      { origin: { storageHash: ORIGIN } },
      'MIGRATION.MARKER_ORIGIN_MISMATCH',
    ],
    [
      'a marker at another profile',
      { marker: {} },
      { origin: { storageHash: ORIGIN, profileHash: 'other' } },
      'MIGRATION.MARKER_ORIGIN_MISMATCH',
    ],
    [
      'a failed precheck',
      { holds: (sql: string) => sql !== 'PRE' && sql !== 'POST' },
      {},
      'MIGRATION.PRECHECK_FAILED',
    ],
    [
      'a failed postcheck',
      { holds: (sql: string) => sql !== 'POST' },
      {},
      'MIGRATION.POSTCHECK_FAILED',
    ],
    ['a schema that does not verify', { verifies: false }, {}, 'MIGRATION.SCHEMA_VERIFY_FAILED'],
    [
      'a marker another process advanced',
      { marker: {}, casWins: false },
      { origin: { storageHash: ORIGIN } },
      'MIGRATION.MARKER_CAS_FAILURE',
    ],
  ] as const)('refuses %s', async (_name, scenario, plan, code) => {
    const result = await run(scenario, plan).execute();
    expect((await failureOf(result))?.code).toBe(code);
  });

  it.each([
    ['a schema that does not verify', { verifies: false }, {}],
    [
      'a marker another process advanced',
      { marker: {}, casWins: false },
      { origin: { storageHash: ORIGIN } },
    ],
  ] as const)(
    'says the database changed when it refuses %s after an operation ran',
    async (_name, scenario, plan) => {
      const result = await run(scenario, {
        ...plan,
        executionChecks: { idempotencyChecks: false },
      }).execute();
      expect(result.ok ? undefined : result.failure.meta.databaseUnchanged).toBe(false);
    },
  );

  it('names the moved storage hash as the reason a marker another process advanced fails', async () => {
    const result = await run(
      { marker: {}, casWins: false },
      { origin: { storageHash: ORIGIN } },
    ).execute();
    expect(result.ok ? undefined : result.failure.meta).toMatchObject({
      reason: 'storageHash',
      space: 'app',
      expectedStorageHash: ORIGIN,
      foundStorageHash: ORIGIN,
      destinationStorageHash: DEST,
    });
  });

  it('refuses a space that is not the plan’s', async () => {
    await expect(run({}).mismatched()).rejects.toMatchObject({
      code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
    });
  });
});

describe('the MySQL migration runner, applying', () => {
  it('writes nothing for a self edge that changes nothing', async () => {
    const applied = run(
      { marker: { storageHash: DEST } },
      { origin: { storageHash: DEST }, operations: [] },
    );
    const result = await applied.execute();
    expect({ ok: result.ok, wrote: applied.events.includes('START TRANSACTION') }).toEqual({
      ok: true,
      wrote: false,
    });
  });

  it('runs an operation whose postcheck already holds when idempotency checks are off', async () => {
    const applied = run({}, { executionChecks: { idempotencyChecks: false } });
    await applied.execute();
    expect(applied.events.filter((event) => event === 'EXEC')).toEqual(['EXEC']);
  });

  it('advances an existing marker by compare-and-swap', async () => {
    const applied = run({ marker: {} }, { origin: { storageHash: ORIGIN } });
    expect((await applied.execute()).ok).toBe(true);
    expect(
      applied.events.filter((event) => /Marker|Ledger|TRANSACTION|COMMIT/.test(event)),
    ).toEqual(['START TRANSACTION', 'updateMarker', 'writeLedgerEntry', 'COMMIT']);
  });

  it('applies nothing for no spaces', async () => {
    const { driver, family } = setup({});
    expect(
      await createMysqlMigrationRunner(family).execute({ driver, perSpaceOptions: [] }),
    ).toMatchObject({ ok: true, value: { perSpaceResults: [] } });
  });
});
