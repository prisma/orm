import { beforeEach, describe, expect, it, vi } from 'vitest';

const clients: FakeClient[] = [];
let connectError: Error | undefined;
let versionRow = 'PostgreSQL 16.1 on x86_64-pc-linux-gnu';
let queryError: Error | undefined;
let connectStalls = false;
const endSpy = vi.fn(async () => {});

class FakeClient {
  readonly listeners = new Map<string, (err: Error) => void>();
  constructor(readonly config: Record<string, unknown>) {
    clients.push(this);
  }
  on(event: string, listener: (err: Error) => void): this {
    this.listeners.set(event, listener);
    return this;
  }
  listenedWhileConnecting = false;
  async connect(): Promise<void> {
    this.listenedWhileConnecting = this.listeners.has('error');
    if (connectStalls) await new Promise(() => {});
    if (connectError !== undefined) throw connectError;
  }
  readonly queries: unknown[] = [];
  async query(config: unknown): Promise<{ rows: Array<{ version: string }> }> {
    this.queries.push(config);
    if (queryError !== undefined) throw queryError;
    return { rows: [{ version: versionRow }] };
  }
  end = endSpy;
}

vi.mock('pg', () => ({ default: { Client: FakeClient } }));

const { parsePostgresVersion, probePostgres } = await import('../../src/init/probe');

beforeEach(() => {
  clients.length = 0;
  connectError = undefined;
  versionRow = 'PostgreSQL 16.1 on x86_64-pc-linux-gnu';
  queryError = undefined;
  connectStalls = false;
  endSpy.mockClear();
});

describe('parsePostgresVersion (FR8.3)', () => {
  it('extracts the version from a typical SELECT version() row', () => {
    expect(
      parsePostgresVersion('PostgreSQL 14.10 on x86_64-pc-linux-gnu, compiled by gcc 11.4.0'),
    ).toBe('14.10');
  });

  it('falls back to the major when no minor is present', () => {
    expect(parsePostgresVersion('PostgreSQL 16 on aarch64-apple-darwin')).toBe('16');
  });

  it('reads nothing from a row that does not start with PostgreSQL', () => {
    expect(parsePostgresVersion('NotPostgres 1.0')).toBeUndefined();
  });
});

describe('probePostgres', () => {
  it('reads the server version', async () => {
    await expect(
      probePostgres('postgres://localhost:5432/db', new AbortController().signal),
    ).resolves.toEqual({
      kind: 'server-version',
      serverVersion: '16.1',
    });
  });

  it('says it could not read the version when the connected server refuses the query', async () => {
    queryError = new Error('permission denied for function version');

    await expect(
      probePostgres('postgres://localhost:5432/db', new AbortController().signal),
    ).resolves.toEqual({
      kind: 'version-unreadable',
      detail: 'SELECT version() failed: permission denied for function version',
    });
    expect(endSpy).toHaveBeenCalledTimes(1);
  });

  it('reports a driver that is installed but fails to load, keeping the cause', async () => {
    await expect(
      probePostgres('postgres://localhost:5432/db', new AbortController().signal, async () => {
        throw new Error('native binding failed');
      }),
    ).resolves.toEqual({ kind: 'driver-failed', driver: 'pg', cause: 'native binding failed' });
  });

  it('reports a driver that is not installed', async () => {
    const missing = Object.assign(new Error("Cannot find package 'pg'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });

    await expect(
      probePostgres('postgres://localhost:5432/db', new AbortController().signal, async () => {
        throw missing;
      }),
    ).resolves.toEqual({ kind: 'driver-missing', driver: 'pg', cause: "Cannot find package 'pg'" });
  });

  it('says the version could not be read when the row holds none', async () => {
    versionRow = 'CockroachDB CCL v23.1';

    await expect(
      probePostgres('postgres://localhost:5432/db', new AbortController().signal),
    ).resolves.toEqual({
      kind: 'version-unreadable',
      detail: 'could not parse PostgreSQL version from `CockroachDB CCL v23.1`',
    });
  });

  it('bounds the connection and the version query with the driver timeouts', async () => {
    await probePostgres('postgres://localhost:5432/db', new AbortController().signal);

    expect(clients[0]?.config).toEqual({
      connectionString: 'postgres://localhost:5432/db',
      connectionTimeoutMillis: 20_000,
      query_timeout: 20_000,
    });
  });

  it('bounds the version query itself, so a query_timeout in the URL cannot lift the limit', async () => {
    await probePostgres(
      'postgres://localhost:5432/db?query_timeout=0',
      new AbortController().signal,
    );

    expect(clients[0]?.queries).toEqual([
      { text: 'SELECT version() as version', query_timeout: 20_000 },
    ]);
  });

  it('attaches an error listener so a dropped connection cannot crash the process', async () => {
    await probePostgres('postgres://localhost:5432/db', new AbortController().signal);

    expect(clients).toHaveLength(1);
    expect(clients[0]?.listenedWhileConnecting).toBe(true);
    const errorListener = clients[0]?.listeners.get('error');
    expect(errorListener).toBeDefined();
    expect(() => errorListener?.(new Error('connection terminated unexpectedly'))).not.toThrow();
  });

  it('ends the client when the signal aborts while it waits', async () => {
    connectStalls = true;
    const controller = new AbortController();

    const pending = probePostgres('postgres://localhost:5432/db', controller.signal);
    void pending.catch(() => undefined);
    await vi.waitFor(() => expect(clients[0]?.listenedWhileConnecting).toBe(true));
    expect(endSpy).not.toHaveBeenCalled();
    controller.abort();

    expect(endSpy).toHaveBeenCalled();
  });

  it('ends the client when connect() rejects', async () => {
    connectError = new Error('password authentication failed');

    await expect(
      probePostgres('postgres://localhost:5432/db', new AbortController().signal),
    ).rejects.toThrow('password authentication failed');
    expect(endSpy).toHaveBeenCalledTimes(1);
  });
});
