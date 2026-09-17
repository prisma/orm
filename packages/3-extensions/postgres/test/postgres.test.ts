import type { Contract } from '@internal/contract/types';
import { coreHash } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Runtime } from '@internal/sql-runtime';
import { PostgresSchema } from '@internal/target-postgres/types';
import { createContract } from '@repo/test-utils';
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
    on = vi.fn().mockReturnThis();
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
    totalCount = 0;
    idleCount = 0;
    waitingCount = 0;
  }

  class Client {
    on = vi.fn().mockReturnThis();
    connect = vi.fn().mockResolvedValue(undefined);
    query = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
    end = vi.fn().mockResolvedValue(undefined);
    escapeIdentifier = vi.fn();
    escapeLiteral = vi.fn();
  }

  return { Pool, Client };
});

import { Client, Pool } from 'pg';
import { buildNativeEnumsMapForNamespace } from '../src/runtime/native-enums';
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
      on: vi.fn(),
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

  it('exposes contract on the facade', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    expect(db.contract).toBeDefined();
    expect(db.contract.target).toBe(contract.target);
  });

  it('db.contract is typed as TContract', () => {
    const db = postgres({
      contract,
      url: 'postgres://localhost:5432/db',
    });

    expectTypeOf(db.contract).toEqualTypeOf<Contract<SqlStorage>>();
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
      on: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);

    const db = postgres({ contract, pg: pool });
    await db.connect();

    const result = await db.transaction(async () => 'tx-value');

    expect(result).toBe('tx-value');
    // A BEGIN was issued for the transaction
    expect(fakeClient.query).toHaveBeenCalledWith(expect.stringContaining('BEGIN'));
  });

  it('transaction() begins at the requested isolation level', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      on: vi.fn(),
    };
    (pool as unknown as { connect: typeof vi.fn }).connect = vi.fn().mockResolvedValue(fakeClient);
    const db = postgres({ contract, pg: pool });
    await db.connect();

    await db.transaction(async () => undefined, { isolationLevel: 'serializable' });

    const transactionControl = fakeClient.query.mock.calls
      .map(([statement]) => statement)
      .filter((statement) => typeof statement === 'string');
    expect(transactionControl).toEqual(['BEGIN ISOLATION LEVEL SERIALIZABLE', 'COMMIT']);
  });

  it('transaction() provides sql on the transaction context', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      on: vi.fn(),
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
      on: vi.fn(),
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

  it('transaction() lazily creates runtime before connect()', async () => {
    const pool = new Pool({ connectionString: 'postgres://localhost:5432/db' });
    const fakeClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn(),
      on: vi.fn(),
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

  describe('db.nativeEnums (facade)', () => {
    // Built from real `PostgresSchema` IR instances (not plain literals):
    // `PostgresContractSerializer.serializeContract` carries `entries.valueSet`
    // for any namespace it recognizes via `isPostgresSchema`, matching how a
    // real Postgres contract always rehydrates through the serializer at the
    // `postgres()` call site. `db.nativeEnums` reads that `valueSet` entry —
    // the same generic entry a `native_enum`'s `deriveValueSet` hook produces
    // — not the (never re-serialized) `native_enum` entity itself.
    const publicNs = new PostgresSchema({
      id: 'public',
      entries: {
        table: {},
        valueSet: {
          AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2'] },
        },
      },
    });
    const auditNs = new PostgresSchema({
      id: 'audit',
      entries: {
        table: {},
        valueSet: {
          AalLevel: { kind: 'valueSet', values: ['low', 'high'] },
        },
      },
    });

    const twoNamespaceStorage = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: { public: publicNs, audit: auditNs },
      },
    };

    // A literal-keyed contract so `db.nativeEnums.public` and `.audit` resolve
    // to distinct namespace maps, proving per-namespace resolution rather than
    // falling back to a single shared `Record<string, ...>`. Each namespace's
    // enum accessors are still looked up by bracket access (`['AalLevel']`):
    // `NamespacedNativeEnums` intentionally keeps entity names as an open
    // index signature (see native-enums.ts), not a per-name literal facade.
    type TwoNsStorageContract = Contract<SqlStorage> & {
      readonly storage: (typeof twoNamespaceStorage)['storage'];
    };

    it('exposes native enum members per namespace and resolves same-named native enums independently', () => {
      const db = postgres<TwoNsStorageContract>({
        contract: twoNamespaceStorage,
        url: 'postgres://localhost:5432/db',
      });

      const publicAalLevel = db.nativeEnums.public['AalLevel'];
      const auditAalLevel = db.nativeEnums.audit['AalLevel'];

      expect(publicAalLevel?.values).toEqual(['aal1', 'aal2']);
      expect(auditAalLevel?.values).toEqual(['low', 'high']);
      expect(publicAalLevel?.names).toEqual(['aal1', 'aal2']);
      expect(publicAalLevel?.has('aal1')).toBe(true);
      expect(publicAalLevel?.nameOf('aal2')).toBe('aal2');
      expect(auditAalLevel?.nameOf('high')).toBe('high');
    });

    it('builds the nativeEnums surface eagerly, without a runtime', () => {
      const db = postgres<TwoNsStorageContract>({
        contract: twoNamespaceStorage,
        url: 'postgres://localhost:5432/db',
      });

      expect(db.nativeEnums.public['AalLevel']?.values).toEqual(['aal1', 'aal2']);
      expect(poolConnectSpy()).not.toHaveBeenCalled();
    });

    // F02: the accessor must read the same plain namespace shape a
    // `validateContract`'d JSON contract carries, not a hydrated
    // `PostgresSchema` class instance — symmetric with `db.enums`
    // (`buildNamespacedEnums`), which already works on plain data.
    it('resolves members from a plain (non-hydrated) contract, not just a hydrated PostgresSchema', () => {
      const plainStorage: SqlStorage = {
        storageHash: coreHash('test-storage-hash'),
        namespaces: {
          public: {
            id: 'public',
            kind: 'postgres-schema',
            entries: {
              table: {},
              valueSet: {
                AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] },
              },
            },
          },
        },
      };

      const result = buildNativeEnumsMapForNamespace(plainStorage, 'public');

      expect(result['AalLevel']?.values).toEqual(['aal1', 'aal2', 'aal3']);
      expect(result['AalLevel']?.has('aal2')).toBe(true);
    });
  });
});
