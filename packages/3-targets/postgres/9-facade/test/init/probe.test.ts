import { beforeEach, describe, expect, it, vi } from 'vitest';

const clients: FakeClient[] = [];
let connectError: Error | undefined;
const endSpy = vi.fn(async () => {});

class FakeClient {
  readonly listeners = new Map<string, (err: Error) => void>();
  constructor(_cfg: { connectionString: string }) {
    clients.push(this);
  }
  on(event: string, listener: (err: Error) => void): this {
    this.listeners.set(event, listener);
    return this;
  }
  async connect(): Promise<void> {
    if (connectError !== undefined) throw connectError;
  }
  async query(): Promise<{ rows: Array<{ version: string }> }> {
    return { rows: [{ version: 'PostgreSQL 16.1 on x86_64-pc-linux-gnu' }] };
  }
  end = endSpy;
}

vi.mock('pg', () => ({ default: { Client: FakeClient } }));

const { parsePostgresVersion, probePostgres } = await import('../../src/init/probe');

beforeEach(() => {
  clients.length = 0;
  connectError = undefined;
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

  it('throws on a row that does not start with PostgreSQL', () => {
    expect(() => parsePostgresVersion('NotPostgres 1.0')).toThrow(/Could not parse/);
  });
});

describe('probePostgres', () => {
  it('reads the server version', async () => {
    await expect(probePostgres('postgres://localhost:5432/db')).resolves.toEqual({
      kind: 'server-version',
      serverVersion: '16.1',
    });
  });

  it('attaches an error listener so a dropped connection cannot crash the process', async () => {
    await probePostgres('postgres://localhost:5432/db');

    expect(clients).toHaveLength(1);
    const errorListener = clients[0]?.listeners.get('error');
    expect(errorListener).toBeDefined();
    expect(() => errorListener?.(new Error('connection terminated unexpectedly'))).not.toThrow();
  });

  it('ends the client when connect() rejects', async () => {
    connectError = new Error('password authentication failed');

    await expect(probePostgres('postgres://localhost:5432/db')).rejects.toThrow(
      'password authentication failed',
    );
    expect(endSpy).toHaveBeenCalledTimes(1);
  });
});
