import { rmSync } from 'node:fs';
import { asNamespaceId, type Contract, type ContractMarkerRecord } from '@internal/contract/types';
import {
  type ControlAdapterInstance,
  type ControlDriverInstance,
  type ControlFamilyInstance,
  type MigrationDataLoss,
  type MigrationPlannerResult,
  type MigrationPlanOperation,
  type MigrationRunnerResult,
  migrationRunnerFailure,
  type TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { formatMigrationDirName, writeMigrationPackage } from '@internal/migration-tools/io';
import type { MigrationMetadata } from '@internal/migration-tools/metadata';
import { writeRef } from '@internal/migration-tools/refs';
import { notOk, ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import type { PlanQuestion } from '../../src/control-api/statements/plan-questions';
import { createTestProjectDir } from '../utils/test-project-dir';
import { contractOf } from './statements/statement-fixtures';

/**
 * Advice after `db update --to <ref>` names the ref: each place the run hands a `migration plan` to
 * its advice hands the one that ends there, or, when migrations on disk already lead there, says so.
 */

const GIVEN = {
  cwd: '/work/app',
  configPath: undefined,
  dbGiven: false,
  rerunArgs: ['--to', 'production', '--permit-policy-change'],
};
const APPLY = '`{bin} db migrate --to production --permit-policy-change`';

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);
const app = asNamespaceId('app');
const OPERATION: MigrationPlanOperation = { id: 'op', label: 'Change', operationClass: 'additive' };

function contractAt(storageHash: string, geoPoint: readonly string[], status: readonly string[]) {
  const base = contractOf({
    app: {
      models: {
        Place: {
          fields: ['id', 'location'],
          fieldTypes: { location: { valueObject: 'GeoPoint' } },
        },
      },
      valueObjects: { GeoPoint: geoPoint },
      enums: { Status: status },
    },
  });
  return {
    ...base,
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storage: { ...base.storage, storageHash },
  } as unknown as Contract;
}

const origin = contractAt(ORIGIN_HASH, ['lat', 'lng'], ['OLD', 'NEW']);
const destination = contractAt(DESTINATION_HASH, ['latitude', 'lng'], ['NEW']);

const marker: ContractMarkerRecord = {
  storageHash: ORIGIN_HASH,
  profileHash: '',
  contractJson: null,
  canonicalVersion: null,
  updatedAt: new Date(0),
  appTag: null,
  meta: {},
  invariants: [],
};

const family = {
  familyId: 'sql',
  readAllMarkers: async () => new Map([['app', marker]]),
  introspect: async () => ({ tables: {} }),
  deserializeContract: (json: unknown) => json as Contract,
  toOperationPreview: () => ({ statements: [] }),
} as unknown as ControlFamilyInstance<'sql', unknown>;

const LOSSES: readonly MigrationDataLoss[] = [
  {
    operationIndex: 0,
    subject: { kind: 'valueObjectField', namespaceId: app, valueObject: 'GeoPoint', field: 'lat' },
    loss: 'drop',
    label: 'Remove key',
  },
  {
    operationIndex: 0,
    subject: { kind: 'enumValue', namespaceId: app, enum: 'Status', member: 'OLD' },
    loss: 'drop',
    label: 'Drop value',
    keepDataEdit: { remove: 'this.drop()', replaceWith: 'this.keep()' },
  } as MigrationDataLoss,
];

function planned(dataLoss: readonly MigrationDataLoss[]): MigrationPlannerResult {
  return {
    kind: 'success',
    appliedStatements: [],
    dataLoss,
    accessChanges: [],
    temporaryValues: [],
    plan: {
      targetId: 'postgres',
      origin: { storageHash: ORIGIN_HASH },
      destination: { storageHash: DESTINATION_HASH },
      operations: [OPERATION],
      renderTypeScript: () => '',
    },
  } as MigrationPlannerResult;
}

const TYPE_CHANGE: readonly MigrationDataLoss[] = [
  {
    operationIndex: 0,
    subject: { kind: 'field', namespaceId: app, model: 'Place', field: 'id' },
    loss: 'typeChange',
    label: 'Change the type of id',
  } as MigrationDataLoss,
];

const RUNNER_FAILED: MigrationRunnerResult = notOk(
  migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'The check failed', {
    meta: {
      failingSpace: 'app',
      databaseUnchanged: true,
      rowsFailingCheck: { check: 'c', replacedCheck: 'b', operationIndex: 0 },
    },
  }),
);

const RUNNER_SUCCEEDED: MigrationRunnerResult = ok({
  perSpaceResults: [{ space: 'app', value: { operationsPlanned: 1, operationsExecuted: 1 } }],
});

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A migration from the database's contract to the ref's, written to disk. */
async function writeMigrationToRef(migrationsDir: string): Promise<void> {
  for (const [name, from, to] of [
    ['init', null, ORIGIN_HASH],
    ['change', ORIGIN_HASH, DESTINATION_HASH],
  ] as const) {
    const metadata: Omit<MigrationMetadata, 'migrationHash'> = {
      from,
      to,
      providedInvariants: [],
      createdAt: '2026-01-01T10:00:00.000Z',
    };
    await writeMigrationPackage(
      join(
        migrationsDir,
        'app',
        formatMigrationDirName(new Date(`2026-01-0${from === null ? 1 : 2}T10:00:00Z`), name),
      ),
      { ...metadata, migrationHash: computeMigrationHash(metadata, [OPERATION]) },
      [OPERATION],
    );
  }
}

async function runToProduction(options: {
  readonly mode: 'apply' | 'plan';
  readonly migrationToRef: boolean;
  readonly planner?: MigrationPlannerResult;
  readonly runner?: MigrationRunnerResult;
  readonly statements?: readonly { readonly verb: 'backfill'; readonly text: string }[];
  readonly forbidDataLoss?: boolean;
  readonly invariants?: readonly string[];
}) {
  const dir = createTestProjectDir('db-update-advice-target');
  tempDirs.push(dir);
  const migrationsDir = join(dir, 'migrations');
  for (const contract of [origin, destination]) {
    await writeContractSnapshot(migrationsDir, contract.storage.storageHash, {
      contractJson: contract,
      contractDts: '',
    });
  }
  const refs = join(migrationsDir, 'app', 'refs');
  await writeRef(refs, 'db', { hash: ORIGIN_HASH, invariants: [] });
  const invariants = options.invariants ?? [];
  await writeRef(refs, 'production', { hash: DESTINATION_HASH, invariants });
  if (options.migrationToRef) await writeMigrationToRef(migrationsDir);
  const asked: PlanQuestion[] = [];
  const migrations = {
    createPlanner: () => ({ plan: () => options.planner ?? planned([]) }),
    createRunner: () => ({ execute: async () => options.runner ?? RUNNER_SUCCEEDED }),
  } as unknown as TargetMigrationsCapability<
    'sql',
    'postgres',
    ControlFamilyInstance<'sql', unknown>
  >;
  const result = await executeDbUpdate({
    invocation: GIVEN,
    driver: { close: vi.fn() } as unknown as ControlDriverInstance<'sql', 'postgres'>,
    adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
    familyInstance: family,
    contract: destination,
    mode: options.mode,
    migrations,
    frameworkComponents: [],
    migrationsDir,
    answerQuestions: async (questions) => {
      asked.push(...questions);
      return questions.map(({ subject }) => ({ verb: 'delete', text: subject }));
    },
    targetId: 'postgres',
    statements: options.statements ?? [],
    ref: {
      name: 'production',
      hash: DESTINATION_HASH,
      invariants,
      ...(options.forbidDataLoss === true
        ? { policies: { dataProtection: { dataLoss: 'data-loss-forbidden' as const } } }
        : {}),
    },
    permitPolicyChange: true,
  }).catch((error: unknown) => notOk(error as { readonly fix?: string }));
  return { result, asked };
}

function adviceOf(result: Awaited<ReturnType<typeof runToProduction>>['result']): string {
  if (result.ok) return '';
  const failure = result.failure as {
    readonly fix?: string;
    readonly nextActions?: readonly { readonly label: string }[];
  };
  return [failure.fix ?? '', ...(failure.nextActions ?? []).map(({ label }) => label)].join('\n');
}

const PLAN_TO_PRODUCTION_END = {
  to: { kind: 'reference', reference: 'production' },
};
const PLAN_TO_PRODUCTION = {
  from: { kind: 'reference', reference: 'db' },
  to: { kind: 'reference', reference: 'production' },
  migrationsToTarget: { kind: 'not-on-disk', missingInvariants: [] },
};

describe('db update --to <ref> with no migration on disk that leads there', () => {
  it('plans to the ref after a failed apply, and applies to it with the flags given', async () => {
    const { result } = await runToProduction({
      mode: 'apply',
      migrationToRef: false,
      runner: RUNNER_FAILED,
    });

    const advice = adviceOf(result);
    expect(advice).toContain('`{bin} migration plan --from db --to production');
    expect(advice).toContain(APPLY);
  });

  it('hands the plan to the ref to a dry run and an apply, for the temporary-value note', async () => {
    const runs = await Promise.all(
      (['plan', 'apply'] as const).map((mode) => runToProduction({ mode, migrationToRef: false })),
    );

    expect(runs.map(({ result }) => (result.ok ? result.value.migrationPlan : undefined))).toEqual([
      PLAN_TO_PRODUCTION,
      PLAN_TO_PRODUCTION,
    ]);
  });

  it('plans to the ref when a statement needs a migration file', async () => {
    const { result } = await runToProduction({
      mode: 'apply',
      migrationToRef: false,
      statements: [{ verb: 'backfill', text: 'GeoPoint.latitude' }],
    });

    const advice = adviceOf(result);
    expect(advice).toContain(
      '`{bin} migration plan --from db --to production --backfill GeoPoint.latitude`',
    );
    expect(advice).toContain(APPLY);
  });

  it('plans the conversion to the ref when its data protection policy refuses a type change', async () => {
    const { result } = await runToProduction({
      mode: 'apply',
      migrationToRef: false,
      planner: planned(TYPE_CHANGE),
      forbidDataLoss: true,
    });

    expect(adviceOf(result)).toContain(
      `For a type change, write the conversion with \`{bin} migration plan --from db --to production --convert <field>\`, run \`node <migration directory>/migration.ts\` for the directory it writes, and apply it with ${APPLY}.`,
    );
  });

  it('plans to the ref in the questions an apply asks', async () => {
    const { asked } = await runToProduction({
      mode: 'apply',
      migrationToRef: false,
      planner: planned(LOSSES),
    });

    const questions = asked.map(({ question }) => question);
    expect(questions).toContainEqual(
      expect.stringContaining(
        '`{bin} migration plan --from db --to production --backfill GeoPoint.latitude`',
      ),
    );
    expect(questions).toContainEqual(
      expect.stringContaining(
        '`{bin} migration plan --from db --to production --delete Status.OLD`',
      ),
    );
    expect(questions).toContainEqual(expect.stringContaining(APPLY));
  });
});

describe('db update --to <ref> when migrations on disk already lead there', () => {
  const ON_DISK_REASON =
    'Migrations on disk already lead from the database to `production`, so a migration planned now would be a second path between the same two contracts, and `db migrate` applies only one of them';
  const ON_DISK = `${ON_DISK_REASON}. Apply them with ${APPLY}`;

  it('says to apply them after a failed apply, and plans no second path', async () => {
    const { result } = await runToProduction({
      mode: 'apply',
      migrationToRef: true,
      runner: RUNNER_FAILED,
    });

    const advice = adviceOf(result);
    expect(advice).not.toContain('{bin} migration plan');
    expect(advice).toContain(ON_DISK);
  });

  it('marks the plan a dry run and an apply hand over', async () => {
    const runs = await Promise.all(
      (['plan', 'apply'] as const).map((mode) => runToProduction({ mode, migrationToRef: true })),
    );

    expect(runs.map(({ result }) => (result.ok ? result.value.migrationPlan : undefined))).toEqual([
      {
        from: { kind: 'reference', reference: ORIGIN_HASH },
        ...PLAN_TO_PRODUCTION_END,
        migrationsToTarget: { kind: 'on-disk' },
      },
      {
        from: { kind: 'reference', reference: ORIGIN_HASH },
        ...PLAN_TO_PRODUCTION_END,
        migrationsToTarget: { kind: 'on-disk' },
      },
    ]);
  });

  it('says to apply them when a statement needs a migration file', async () => {
    const { result } = await runToProduction({
      mode: 'apply',
      migrationToRef: true,
      statements: [{ verb: 'backfill', text: 'GeoPoint.latitude' }],
    });

    const advice = adviceOf(result);
    expect(advice).not.toContain('{bin} migration plan');
    expect(result.ok ? undefined : (result.failure as { readonly why?: string }).why).toContain(
      ON_DISK_REASON,
    );
    expect(advice).toContain(`apply the migrations with ${APPLY}`);
  });

  it('says to write a refused type change in them', async () => {
    const { result } = await runToProduction({
      mode: 'apply',
      migrationToRef: true,
      planner: planned(TYPE_CHANGE),
      forbidDataLoss: true,
    });

    const advice = adviceOf(result);
    expect(advice).not.toContain('{bin} migration plan');
    expect(advice).toContain(
      `For a type change, write the conversion in the migration.ts of the one that changes the field, run that migration.ts with \`node\`, and apply them with ${APPLY}.`,
    );
  });

  it('says to apply them in the questions an apply asks', async () => {
    const { asked } = await runToProduction({
      mode: 'apply',
      migrationToRef: true,
      planner: planned(LOSSES),
    });

    const questions = asked.map(({ question }) => question).join('\n');
    expect(questions).not.toContain('{bin} migration plan');
    expect(questions).toContain(APPLY);
  });
});

describe('db update --to <ref> when the migrations on disk that lead there lack an invariant it requires', () => {
  it('plans a migration to the ref that provides the invariant after a failed apply', async () => {
    const { result } = await runToProduction({
      mode: 'apply',
      migrationToRef: true,
      runner: RUNNER_FAILED,
      invariants: ['seeded'],
    });

    const advice = adviceOf(result);
    expect(advice).toContain('`{bin} migration plan --from');
    expect(advice).toContain('--to production');
    expect(advice).toContain('add to it a `dataTransform` with `invariantId` "seeded"');
    expect(advice).toContain(APPLY);
  });
});
