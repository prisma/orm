import type { Contract } from '@internal/contract/types';
import type { SqlControlFamilyInstance } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import type { SqlControlDriverInstance, SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { setDefault } from '../../src/core/migrations/operations/columns';
import { createPostgresMigrationRunner } from '../../src/core/migrations/runner';

function opLowerer(): ExecuteRequestLowerer {
  let calls = 0;
  return {
    lower: () => Object.freeze({ sql: 'UNUSED', params: Object.freeze([]) }),
    lowerToExecuteRequest: async () => {
      calls += 1;
      return Object.freeze({ sql: `CHECK ${calls}`, params: Object.freeze([]) });
    },
  };
}

function recordingDriver() {
  const statements: string[] = [];
  const driver: SqlControlDriverInstance<string> = {
    familyId: 'sql',
    targetId: 'postgres',
    query: async <Row>(sql: string, _params?: readonly unknown[]) => {
      statements.push(sql);
      if (sql.startsWith('CHECK')) {
        return { rows: [{ result: true } as Row] };
      }
      return { rows: [] as Row[] };
    },
    close: async () => {},
  };
  return { driver, statements };
}

function stubFamily() {
  return {
    bootstrapControlTableQueries: () => [{}],
    lowerAst: async () => ({ sql: 'BOOTSTRAP', params: [] }),
    readMarker: async () => null,
    initMarker: async () => {},
    writeLedgerEntry: async () => {},
  } as unknown as SqlControlFamilyInstance;
}

async function runPlan(
  operationClass: 'additive' | 'widening',
): Promise<{ ok: boolean; executed: number; statements: string[] }> {
  const op = await setDefault(
    'public',
    'instruments',
    'is_active',
    'DEFAULT false',
    opLowerer(),
    operationClass,
  );
  const { driver, statements } = recordingDriver();
  const runner = createPostgresMigrationRunner(stubFamily());
  const options = {
    destinationContract: {
      storage: { storageHash: 'dest-hash', namespaces: {} },
    } as Contract<SqlStorage>,
    driver,
    plan: {
      operations: [op],
      destination: { storageHash: 'dest-hash' },
      spaceId: 'test-space',
    },
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'] },
    migrationEdges: [
      {
        migrationHash: 'edge-hash',
        dirName: 'test-edge',
        from: 'a',
        to: 'b',
        operationCount: 1,
      },
    ],
  } as unknown as Parameters<typeof runner.executeOnConnection>[0];
  const result = await runner.executeOnConnection(options);
  if (!result.ok) {
    throw new Error(`runner failed: ${result.failure.summary}`);
  }
  return {
    ok: result.ok,
    executed: result.value.operationsExecuted,
    statements,
  };
}

describe('runner idempotency probe and skipIdempotencyProbe', () => {
  it('executes a widening setDefault even when its postcheck is pre-satisfied', async () => {
    const { ok, executed, statements } = await runPlan('widening');
    expect(ok).toBe(true);
    expect(executed).toBe(1);
    expect(statements.some((sql) => sql.startsWith('ALTER TABLE'))).toBe(true);
  });

  it('still skips an additive setDefault whose postcheck is pre-satisfied', async () => {
    const { ok, executed, statements } = await runPlan('additive');
    expect(ok).toBe(true);
    expect(executed).toBe(0);
    expect(statements.some((sql) => sql.startsWith('ALTER TABLE'))).toBe(false);
  });
});
