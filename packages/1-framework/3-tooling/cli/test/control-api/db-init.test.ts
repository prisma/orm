import type { Contract } from '@internal/contract/types';
import {
  type ControlAdapterInstance,
  type ControlDriverInstance,
  type ControlFamilyInstance,
  migrationRunnerFailure,
  PRISMA_TABLES_SPACE_ID,
  type SchemaDiffIssue,
  schemaCheckWhy,
  type TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { notOk, ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { executeDbInit } from '../../src/control-api/operations/db-init';

const TEST_INVOCATION = { cwd: '/work/app', configPath: undefined, dbGiven: false };

function createMockDriver() {
  return {
    close: vi.fn(),
  } as unknown as ControlDriverInstance<'sql', 'postgres'>;
}

function createMockFamilyInstance() {
  return {
    familyId: 'sql',
    readAllMarkers: async () => new Map(),
    introspect: async () => ({ tables: {} }),
    deserializeContract: (ir: unknown) => ir as Contract,
    toOperationPreview: () => ({ statements: [] }),
  } as unknown as ControlFamilyInstance<'sql', unknown>;
}

const dummyContract = {
  schemaVersion: '1',
  target: 'postgres',
  storage: { storageHash: 'dummy', tables: {}, namespaces: {} },
} as unknown as Contract;

describe('executeDbInit', () => {
  describe('the check for rows of spaces the project does not declare', () => {
    const marker = { storageHash: 'other', profileHash: 'other', invariants: [], meta: {} };
    const migrations = {
      createPlanner: () => ({
        plan: vi.fn().mockReturnValue({
          kind: 'success',
          appliedStatements: [],
          plan: { targetId: 'postgres', destination: { storageHash: 'dest' }, operations: [] },
        }),
      }),
      createRunner: () => ({
        execute: vi.fn().mockResolvedValue(
          ok({
            perSpaceResults: [
              { space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } },
            ],
          }),
        ),
      }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;

    function applyWithRowOf(space: string) {
      return executeDbInit({
        invocation: TEST_INVOCATION,
        driver: createMockDriver(),
        adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
        familyInstance: {
          ...createMockFamilyInstance(),
          readAllMarkers: async () => new Map([[space, marker]]),
          markerLocation: '_prisma.marker',
        } as unknown as ControlFamilyInstance<'sql', unknown>,
        contract: dummyContract,
        mode: 'apply',
        migrations,
        frameworkComponents: [],
        migrationsDir: '/tmp/__test-db-init-migrations',
        targetId: 'postgres',
      });
    }

    it("counts the row of the space for Prisma's own tables as declared", async () => {
      expect((await applyWithRowOf(PRISMA_TABLES_SPACE_ID)).ok).toBe(true);
    });

    it('refuses a row of a space nothing declares', async () => {
      await expect(applyWithRowOf('cipher')).rejects.toMatchObject({
        code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
        meta: { violations: [{ kind: 'orphanMarker', spaceId: 'cipher' }] },
      });
    });
  });

  it('plans from no contract, asserts no origin, gives no statements, and reports none', async () => {
    const planFn = vi.fn().mockReturnValue({
      kind: 'success',
      appliedStatements: [],
      plan: {
        targetId: 'postgres',
        destination: { storageHash: 'dest' },
        operations: [],
      },
    });

    const migrations = {
      createPlanner: () => ({ plan: planFn }),
      createRunner: () => ({
        execute: vi.fn().mockResolvedValue(
          ok({
            perSpaceResults: [
              { space: 'app', value: { operationsPlanned: 0, operationsExecuted: 0 } },
            ],
          }),
        ),
      }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;

    const result = await executeDbInit({
      invocation: TEST_INVOCATION,
      driver: createMockDriver(),
      adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
      familyInstance: createMockFamilyInstance(),
      contract: dummyContract,
      mode: 'plan',
      migrations,
      frameworkComponents: [],
      migrationsDir: '/tmp/__test-db-init-migrations',
      targetId: 'postgres',
    });

    expect(planFn).toHaveBeenCalledWith(
      expect.objectContaining({ fromContract: null, origin: null, statements: [] }),
    );
    expect(result.assertOk()).not.toHaveProperty('appliedStatements');
  });

  it('reports a runner failure with its own code, message, why and meta, the db init advice, and the runner error as cause', async () => {
    const issue: SchemaDiffIssue = {
      path: ['public', 'event', 'id'],
      expected: { id: 'id', nodeKind: 'sql-column', isEqualTo: () => false, children: () => [] },
    };
    const runnerFailure = migrationRunnerFailure(
      'MIGRATION.SCHEMA_VERIFY_FAILED',
      'Database schema does not satisfy contract',
      { why: schemaCheckWhy([issue]), meta: { schemaIssues: [issue], failingSpace: 'app' } },
    );
    const migrations = {
      createPlanner: () => ({
        plan: vi.fn().mockReturnValue({
          kind: 'success',
          appliedStatements: [],
          dataLoss: [],
          accessChanges: [],
          temporaryValues: [],
          plan: {
            targetId: 'postgres',
            destination: { storageHash: 'dest' },
            operations: [
              { id: 'table.event', label: 'Create table event', operationClass: 'additive' },
            ],
          },
        }),
      }),
      createRunner: () => ({ execute: vi.fn().mockResolvedValue(notOk(runnerFailure)) }),
    } as unknown as TargetMigrationsCapability<
      'sql',
      'postgres',
      ControlFamilyInstance<'sql', unknown>
    >;

    const result = await executeDbInit({
      invocation: TEST_INVOCATION,
      driver: createMockDriver(),
      adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
      familyInstance: createMockFamilyInstance(),
      contract: dummyContract,
      mode: 'apply',
      migrations,
      frameworkComponents: [],
      migrationsDir: '/tmp/__test-db-init-migrations',
      targetId: 'postgres',
    });

    const failure = result.assertNotOk();
    expect({
      code: failure.code,
      message: failure.message,
      why: failure.why,
      fix: failure.fix,
      meta: failure.meta,
    }).toEqual({
      code: 'MIGRATION.SCHEMA_VERIFY_FAILED',
      message: 'Database schema does not satisfy contract',
      why: 'The schema check after apply found: missing: public/event/id.',
      fix: 'Change the contract source to resolve the issues listed, re-run `{bin} contract emit`, then re-run `{bin} db init`.',
      meta: runnerFailure.meta,
    });
    expect(failure.cause).toBe(runnerFailure);
  });
});
