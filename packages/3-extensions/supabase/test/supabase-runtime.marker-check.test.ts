import type {
  MarkerReadResult,
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlQueryable,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseRoleBinding } from '../src/runtime/supabase-runtime';
import { createTestSetup, stubPlan } from './supabase-runtime-fixtures';

const binding: SupabaseRoleBinding = { role: 'authenticated', claims: { sub: 'user-1' } };

const poolTimeout = new Error('timeout exceeded when trying to connect');

/** A driver over a pool of `size` connections, which, like `pg.Pool`, fails a wait for a connection after a timeout. The driver's own statements take a connection from the same pool. */
function createPooledDriver(size: number) {
  let free = size;
  const waiting: Array<() => void> = [];
  const roleStatements: string[] = [];

  const take = () =>
    new Promise<void>((resolve, reject) => {
      if (free > 0) {
        free -= 1;
        resolve();
        return;
      }
      const wake = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        waiting.splice(waiting.indexOf(wake), 1);
        reject(poolTimeout);
      }, 50);
      waiting.push(wake);
    });
  const give = () => {
    const next = waiting.shift();
    if (next === undefined) free += 1;
    else next();
  };

  async function* rows(): AsyncGenerator<Record<string, unknown>> {
    yield { id: 1 };
  }

  const driver: SqlDriver = {
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    execute: async () => {
      await take();
      give();
      return { affectedRows: 0 };
    },
    async *query<Row>(_request: SqlExecuteRequest): AsyncGenerator<Row> {
      await take();
      try {
        yield* rows() as AsyncGenerator<Row>;
      } finally {
        give();
      }
    },
    acquireConnection: async (): Promise<SqlConnection> => {
      await take();
      let role = 'postgres';
      return {
        execute: async (request) => {
          if (request.params?.[0] === 'role') role = String(request.params[1]);
          if (request.sql === 'RESET ROLE') role = 'postgres';
          return { affectedRows: 0 };
        },
        async *query<Row>(request: SqlExecuteRequest): AsyncGenerator<Row> {
          roleStatements.push(`${role}: ${request.sql}`);
          yield* rows() as AsyncGenerator<Row>;
        },
        beginTransaction: () => Promise.reject(new Error('not used')),
        release: async () => give(),
        destroy: async () => give(),
      };
    },
  };
  return { driver, roleStatements };
}

function markerReadThroughQueryable() {
  return vi.fn(async (queryable: SqlQueryable): Promise<MarkerReadResult> => {
    for await (const _row of queryable.query({ sql: 'select marker' })) {
      // drain
    }
    return { kind: 'absent' };
  });
}

describe('the contract marker check of a role-bound query', () => {
  it('runs through the driver, as the login role, before the role session is opened, on a pool of one', async () => {
    const { driver, roleStatements } = createPooledDriver(1);
    const readMarker = markerReadThroughQueryable();
    const { runtime } = createTestSetup({ driver, readMarker });

    const rows = await runtime.forRole(binding).query(stubPlan()).toArray();

    expect({ rows, readMarker: readMarker.mock.calls, roleStatements }).toEqual({
      rows: [{ id: 1 }],
      readMarker: [[driver]],
      roleStatements: [`authenticated: ${stubPlan().sql}`],
    });
  });

  it('lets first role-bound queries that take every connection of the pool all succeed', async () => {
    const { driver } = createPooledDriver(2);
    const readMarker = markerReadThroughQueryable();
    const { runtime } = createTestSetup({ driver, readMarker });
    const role = runtime.forRole(binding);

    const results = await Promise.allSettled([
      role.query(stubPlan()).toArray(),
      role.query(stubPlan()).toArray(),
    ]);

    expect(results).toEqual([
      { status: 'fulfilled', value: [{ id: 1 }] },
      { status: 'fulfilled', value: [{ id: 1 }] },
    ]);
    expect(readMarker).toHaveBeenCalledOnce();
  });
});
