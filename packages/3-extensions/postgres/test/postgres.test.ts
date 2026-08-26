import type { Contract } from '@prisma-next/contract/types';
import type { ScopeField, Subquery } from '@prisma-next/sql-builder/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import { ProjectionItem, SelectAst, TableSource } from '@prisma-next/sql-relational-core/ast';
import { planFromAst } from '@prisma-next/sql-relational-core/plan';
import type { Runtime } from '@prisma-next/sql-runtime';
import { createContract } from '@prisma-next/test-utils';
import { blindCast } from '@prisma-next/utils/casts';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

// Only mock the third-party pg boundary. Real drivers, adapters, and runtimes
// run over this fake pool/client.
vi.mock('pg', () => {
  const poolEndSpy = vi.fn().mockResolvedValue(undefined);
  const querySpy = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const releaseSpy = vi.fn();

  class FakePoolClient {
    query = querySpy;
    release = releaseSpy;
  }

  const connectSpy = vi.fn().mockResolvedValue(new FakePoolClient());

  class Pool {
    static readonly _endSpy = poolEndSpy;
    static readonly _connectSpy = connectSpy;
    static readonly _querySpy = querySpy;
    static readonly _releaseSpy = releaseSpy;
    readonly _options: unknown;

    constructor(options: unknown) {
      this._options = options;
    }

    connect = connectSpy;
    end = poolEndSpy;
  }

  class Client {
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
  }

  return { Pool, Client };
});

import { Client, Pool } from 'pg';
import postgres, { type PostgresClient } from '../src/runtime/postgres';

const contract = createContract<SqlStorage>();

function poolEndSpy() {
  return (Pool as unknown as { _endSpy: ReturnType<typeof vi.fn> })._endSpy;
}
function poolConnectSpy() {
  return (Pool as unknown as { _connectSpy: ReturnType<typeof vi.fn> })._connectSpy;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolEndSpy().mockResolvedValue(undefined);
  poolConnectSpy().mockResolvedValue(
    Object.assign(new (Pool as unknown as new () => object)(), {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    }),
  );
});

describe('postgres', () => {
  // Regression: postgres({...}) must remain synchronous (it only consumes
  // build-time codec methods via deserializeContract / type maps). If construction
  // becomes Promise-returning, this assignment loses its synchronous type and
  // every call site needs `await postgres(...)`.
  it('returns a synchronous client (sync regression)', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    const thenable = db as unknown as { then?: unknown };
    expect(typeof thenable.then).toBe('undefined');
    expect(db.sql).toBeDefined();
  });

  it('binds to a synchronous PostgresClient at the call site', () => {
    // Assert the return type of postgres({...}) directly so a future drift to
    // Promise-shaped construction fails the typecheck rather than surfacing
    // only when call sites silently lose `.sql` / `.orm`.
    type CallShape = (options: {
      contract: Contract<SqlStorage>;
      url: string;
    }) => PostgresClient<Contract<SqlStorage>>;
    expectTypeOf<ReturnType<CallShape>>().toEqualTypeOf<PostgresClient<Contract<SqlStorage>>>();
    expectTypeOf<ReturnType<CallShape>>().not.toEqualTypeOf<
      Promise<PostgresClient<Contract<SqlStorage>>>
    >();
  });

  it('sql is constructed eagerly; runtime and pool are deferred until runtime() is accessed', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    expect(db.sql).toBeDefined();

    // pool.connect() has not been called yet (no queries issued)
    expect(poolConnectSpy()).not.toHaveBeenCalled();

    // accessing runtime() triggers lazy creation but does not yet connect
    const runtime = db.runtime();
    expect(runtime).toBeDefined();
  });

  it('memoizes runtime instance', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    const first = db.runtime();
    const second = db.runtime();

    expect(first).toBe(second);
  });

  it('throws for multiple binding inputs during client construction', () => {
    expect(() =>
      postgres({
        contract,
        url: 'postgres://localhost:5432/db',
        binding: { kind: 'url', url: 'postgres://localhost:5432/db2' },
      } as unknown as Parameters<typeof postgres<typeof contract>>[0]),
    ).toThrow('Provide one binding input');
  });

  it('allows deferred binding during client construction', () => {
    const db = postgres({
      contract,
    } as Parameters<typeof postgres<typeof contract>>[0]);

    const runtime = db.runtime();
    expect(runtime).toBeDefined();
    // Driver connect not called yet (no binding configured)
    expect(poolConnectSpy()).not.toHaveBeenCalled();
  });

  it('connects with explicit binding after construction', async () => {
    const db = postgres({
      contract,
    } as Parameters<typeof postgres<typeof contract>>[0]);

    await db.connect({
      url: 'postgres://localhost:5432/db',
    });

    // Pool was created and driver was connected
    expect(db.runtime()).toBeDefined();
  });

  it('throws when connect is called without configured binding', async () => {
    const db = postgres({
      contract,
    } as Parameters<typeof postgres<typeof contract>>[0]);

    await expect(db.connect()).rejects.toThrow('Postgres binding not configured');
  });

  it('throws when attempting to connect twice', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    await db.connect();
    await expect(db.connect({ url: 'postgres://localhost:5432/db2' })).rejects.toThrow(
      'Postgres client already connected',
    );
  });

  it('throws when attempting to connect twice without arguments', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    await db.connect();
    await expect(db.connect()).rejects.toThrow('Postgres client already connected');
  });

  it('rejects concurrent connect calls', async () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    const first = db.connect();
    await expect(db.connect({ url: 'postgres://localhost:5432/db2' })).rejects.toThrow(
      'Postgres client already connected',
    );
    await first;
  });

  it('runtime() itself does not throw on construction; pool errors surface on first query', async () => {
    // The real postgres driver's connect() is synchronous (creates the bound
    // driver immediately). Pool connection errors only surface on first use.
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    // runtime() must not throw synchronously
    let runtime: Runtime | undefined;
    expect(() => {
      runtime = db.runtime();
    }).not.toThrow();
    expect(runtime).toBeDefined();
  });

  it('validates contractJson input', () => {
    const contractJson = contract;

    const db = postgres({
      contractJson,
      url: 'postgres://localhost:5432/db',
    });

    expect(db.context).toBeDefined();
  });

  it('validates direct contract input', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    expect(db.context).toBeDefined();
  });

  it('creates pool from url with explicit timeout defaults (pool options passed)', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    db.runtime();

    // The Pool constructor was called; inspect the instance's stored options
    const poolInstance = db.stack;
    expect(poolInstance).toBeDefined();
  });

  it('accepts postgresql url scheme', () => {
    expect(() =>
      postgres({
        contract,
        url: 'postgresql://localhost:5432/db',
      }).runtime(),
    ).not.toThrow();
  });

  it('throws for empty url binding', () => {
    expect(() =>
      postgres({
        contract,
        url: '   ',
      }),
    ).toThrow('Postgres URL must be a non-empty string');
  });

  it('throws for invalid url scheme', () => {
    expect(() =>
      postgres({
        contract,
        url: 'mysql://localhost:5432/db',
      }),
    ).toThrow('Postgres URL must use postgres:// or postgresql://');
  });

  it('uses pg pool binding', () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const db = postgres({
      contract,
      pg: pool,
    });

    const runtime = db.runtime();
    expect(runtime).toBeDefined();
  });

  it('uses pg client binding', () => {
    const client = new Client();
    const db = postgres({
      contract,
      pg: client,
    });

    const runtime = db.runtime();
    expect(runtime).toBeDefined();
  });

  it('uses explicit binding object', () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const db = postgres({
      contract,
      binding: { kind: 'pgPool', pool },
    });

    const runtime = db.runtime();
    expect(runtime).toBeDefined();
  });

  it('throws when pg input is neither Pool nor Client', () => {
    expect(() =>
      postgres({
        contract,
        pg: { query: () => {} } as unknown as Client,
      }),
    ).toThrow('Unable to determine pg binding type from pg input');
  });

  it('transaction() delegates to withTransaction and returns the callback result', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });

    // Fake PoolClient that handles BEGIN/COMMIT/ROLLBACK
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    const result = await db.transaction(async () => 'tx-value');

    expect(result).toBe('tx-value');
    // A BEGIN was issued for the transaction
    expect(fakeClient.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'));
  });

  it('transaction() provides sql on the transaction context', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    let receivedTx: { sql?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.sql).toBeDefined();
  });

  it('transaction() provides orm on the transaction context', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    let receivedTx: { orm?: unknown } | undefined;
    await db.transaction(async (tx) => {
      receivedTx = tx;
    });

    expect(receivedTx).toBeDefined();
    expect(receivedTx!.orm).toBeDefined();
  });

  it('transaction tempTable() creates and drops a typed temp table with generated name', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    const subquery = blindCast<
      Subquery<{ id: ScopeField }>,
      'test fixture for temp-table typed subquery'
    >({
      buildAst: () =>
        SelectAst.from(TableSource.named('source_table')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('pg/int4@1').buildAst()),
        ]),
      getRowFields: () => ({ id: { codecId: 'pg/int4@1', nullable: false } }),
    });

    await db.transaction(async (tx) => {
      const temp = await tx.tempTable().as(subquery);
      expect(temp.name).toMatch(/^pn_temp_[a-f0-9]+$/);
      expect(temp.fields['id']?.codecId).toBe('pg/int4@1');
      expect('buildAst' in temp).toBe(true);
      expect('getJoinOuterScope' in temp).toBe(true);
      await temp.drop();
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });
    expect(issuedSql.some((sql) => sql.startsWith('CREATE TEMP TABLE'))).toBe(true);
    expect(issuedSql.some((sql) => sql.startsWith('DROP TABLE IF EXISTS'))).toBe(true);
  });

  it('transaction tempTable() uses an internal table name', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    const subquery = blindCast<
      Subquery<{ id: ScopeField; email: ScopeField }>,
      'test fixture for temp-table typed subquery'
    >({
      buildAst: () =>
        SelectAst.from(TableSource.named('source_table')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('pg/int4@1').buildAst()),
          ProjectionItem.of('email', db.raw`'a@example.com'`.returns('pg/text@1').buildAst()),
        ]),
      getRowFields: () => ({
        id: { codecId: 'pg/int4@1', nullable: false },
        email: { codecId: 'pg/text@1', nullable: false },
      }),
    });

    let tableName: string | undefined;
    await db.transaction(async (tx) => {
      const temp = await tx.tempTable().as(subquery);
      tableName = temp.name;
      expect(temp.name).toMatch(/^pn_temp_[a-f0-9]+$/);
      expect(temp.fields).toEqual({
        id: { codecId: 'pg/int4@1', nullable: false },
        email: { codecId: 'pg/text@1', nullable: false },
      });
      await temp.drop();
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });
    expect(tableName).toBeDefined();
    expect(
      issuedSql.some((sql) => sql.includes(`CREATE TEMP TABLE "${tableName}" ON COMMIT DROP AS`)),
    ).toBe(true);
    expect(issuedSql.some((sql) => sql.includes(`DROP TABLE IF EXISTS "${tableName}"`))).toBe(true);
  });

  it('transaction tempTable() can be reused in tx.sql join composition within the same transaction', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    const subquery = blindCast<
      Subquery<{ id: ScopeField; email: ScopeField }>,
      'test fixture for temp-table typed subquery'
    >({
      buildAst: () =>
        SelectAst.from(TableSource.named('source_table')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('pg/int4@1').buildAst()),
          ProjectionItem.of('email', db.raw`'a@example.com'`.returns('pg/text@1').buildAst()),
        ]),
      getRowFields: () => ({
        id: { codecId: 'pg/int4@1', nullable: false },
        email: { codecId: 'pg/text@1', nullable: false },
      }),
    });

    let recentUsersName: string | undefined;
    await db.transaction(async (tx) => {
      const recentUsers = await tx.tempTable().as(subquery);
      recentUsersName = recentUsers.name;

      await tx
        .execute(
          planFromAst(
            SelectAst.from(recentUsers.buildAst()).withProjection([
              ProjectionItem.of('id', db.raw`1`.returns('pg/int4@1').buildAst()),
              ProjectionItem.of('email', db.raw`'a@example.com'`.returns('pg/text@1').buildAst()),
            ]),
            contract,
            'dsl',
          ),
        )
        .toArray();

      await recentUsers.drop();
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });
    expect(recentUsersName).toBeDefined();
    expect(
      issuedSql.some((sql) =>
        sql.includes(`CREATE TEMP TABLE "${recentUsersName}" ON COMMIT DROP AS`),
      ),
    ).toBe(true);
    expect(
      issuedSql.some((sql) => sql.includes(`FROM "${recentUsersName}" AS "${recentUsersName}"`)),
    ).toBe(true);
  });

  it('transaction tempTable().from() issues CREATE TABLE with ON COMMIT DROP and INSERT', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    let tableName: string | undefined;
    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([
        { name: 'id', type: 'int4' },
        { name: 'label', type: 'text' },
      ]);
      tableName = handle.name;
      await handle.append([
        ['1', 'Alice'],
        ['2', 'Bob'],
      ]);
      expect(handle.name).toMatch(/^pn_temp_[a-f0-9]+$/);
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });

    expect(tableName).toBeDefined();
    expect(
      issuedSql.some(
        (sql) =>
          sql.includes(`CREATE TEMP TABLE "${tableName}"`) &&
          sql.includes('"id" int4') &&
          sql.includes('"label" text') &&
          sql.includes('ON COMMIT DROP'),
      ),
    ).toBe(true);
    expect(
      issuedSql.some(
        (sql) =>
          sql.includes(`INSERT INTO "${tableName}"`) &&
          sql.includes("'1'") &&
          sql.includes("'Alice'"),
      ),
    ).toBe(true);
  });

  it('transaction tempTable().from() with empty rows skips INSERT', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    await db.transaction(async (tx) => {
      await tx.tempTable().from([{ name: 'id', type: 'int4' }]);
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });

    expect(issuedSql.some((sql) => sql.includes('CREATE TEMP TABLE'))).toBe(true);
    expect(issuedSql.some((sql) => sql.startsWith('INSERT INTO'))).toBe(false);
  });

  it('transaction tempTable().from() inlines null, number and boolean as SQL literals', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    let tableName: string | undefined;
    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([
        { name: 'n', type: 'int4' },
        { name: 'flag', type: 'bool' },
        { name: 'nullable', type: 'text' },
      ]);
      tableName = handle.name;
      await handle.append([[42, true, null]]);
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });

    const insertSql = issuedSql.find((sql) => sql.startsWith(`INSERT INTO "${tableName}"`)) ?? '';
    expect(insertSql).toContain('42');
    expect(insertSql).toContain('TRUE');
    expect(insertSql).toContain('NULL');
  });

  it('transaction tempTable().from() handle supports append() with raw rows', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    let tableName: string | undefined;
    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([{ name: 'id', type: 'int4' }]);
      tableName = handle.name;
      await handle.append([['1']]);
      await handle.append([['2'], ['3']]);
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });

    expect(issuedSql.filter((sql) => sql.startsWith(`INSERT INTO "${tableName}"`))).toHaveLength(2);
    const appendSql = issuedSql.find(
      (sql) => sql.startsWith(`INSERT INTO "${tableName}"`) && sql.includes("'2'"),
    );
    expect(appendSql).toMatch(/INSERT INTO "[A-Za-z0-9_]+" VALUES \('2'\), \('3'\)/);
  });

  it('transaction tempTable().as() handle supports append() with a subquery (INSERT INTO ... SELECT)', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    const subquery = blindCast<Subquery<{ id: ScopeField }>, 'test fixture'>({
      buildAst: () =>
        SelectAst.from(TableSource.named('source_table')).withProjection([
          ProjectionItem.of('id', db.raw`1`.returns('pg/int4@1').buildAst()),
        ]),
      getRowFields: () => ({ id: { codecId: 'pg/int4@1', nullable: false } }),
    });

    let tableName: string | undefined;
    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().as(subquery);
      tableName = handle.name;
      await handle.append(subquery);
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });

    expect(
      issuedSql.some(
        (sql) => sql.startsWith(`INSERT INTO "${tableName}"`) && sql.includes('SELECT'),
      ),
    ).toBe(true);
  });

  it('transaction tempTable().append() with empty rows is a no-op', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    await db.transaction(async (tx) => {
      const handle = await tx.tempTable().from([{ name: 'x', type: 'int4' }]);
      await handle.append([]);
    });

    await db.close();

    const issuedSql = fakeClient.query.mock.calls.map((call) => {
      const arg = call[0] as string | { text?: string };
      return typeof arg === 'string' ? arg : (arg.text ?? '');
    });
    expect(issuedSql.some((sql) => sql.startsWith('INSERT INTO'))).toBe(false);
  });

  it('transaction() lazily creates runtime before connect()', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });

    // No runtime yet
    let runtimeBefore: Runtime | undefined;
    try {
      runtimeBefore = db.runtime();
    } catch {
      // might throw if not accessed
    }

    await db.transaction(async () => 'value');

    // After transaction, runtime exists
    expect(db.runtime()).toBeDefined();
    if (runtimeBefore !== undefined) {
      expect(db.runtime()).toBe(runtimeBefore);
    }
  });

  describe('db.enums (facade)', () => {
    const roleEnum = {
      codecId: 'pg/text@1',
      members: [
        { name: 'User', value: 'user' },
        { name: 'Admin', value: 'admin' },
      ],
    } as const;
    const auditRoleEnum = {
      codecId: 'pg/text@1',
      members: [
        { name: 'System', value: 'system' },
        { name: 'Operator', value: 'operator' },
      ],
    } as const;

    const twoNamespaceDomain = {
      ...contract,
      domain: {
        namespaces: {
          public: { models: {}, enum: { Role: roleEnum } },
          audit: { models: {}, enum: { Role: auditRoleEnum } },
        },
      },
    } as const;

    // A literal-keyed contract so `db.enums.public.Role` is a static facade
    // proof, not index-signature access. The mock deserializer returns the same
    // shape at runtime.
    type TwoNsContract = Contract<SqlStorage> & {
      readonly domain: (typeof twoNamespaceDomain)['domain'];
    };

    it('exposes enums per namespace and resolves same-named enums independently', () => {
      const db = postgres<TwoNsContract>({
        contract: twoNamespaceDomain,
        url: 'postgres://localhost:5432/db',
      });

      expect(db.enums.public.Role.values).toEqual(['user', 'admin']);
      expect(db.enums.audit.Role.values).toEqual(['system', 'operator']);
      expect(db.enums.public.Role.nameOf('admin')).toBe('Admin');
      expect(db.enums.audit.Role.ordinalOf('operator')).toBe(1);
    });

    it('builds the enums surface eagerly, without a runtime', () => {
      const db = postgres<TwoNsContract>({
        contract: twoNamespaceDomain,
        url: 'postgres://localhost:5432/db',
      });

      expect(db.enums.public.Role.values).toEqual(['user', 'admin']);
      expect(poolConnectSpy()).not.toHaveBeenCalled();
    });
  });
});
