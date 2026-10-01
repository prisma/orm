import type { Client } from 'pg';
import { types as pgTypes } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { PostgresControlDriver } from '../src/exports/control';

describe('@internal/driver-postgres control', () => {
  it('absorbs client error events after create() instead of crashing the process', async () => {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const mockClient = {
      connect: vi.fn(async () => {}),
      end: vi.fn(async () => {}),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener);
      }),
    };
    vi.doMock('pg', () => ({
      Client: vi.fn(function Client() {
        return mockClient;
      }),
    }));
    vi.resetModules();
    const { default: descriptor } = await import('../src/exports/control');

    const driver = await descriptor.create('postgres://localhost/test');

    expect(listeners.has('error')).toBe(true);
    expect(() =>
      listeners.get('error')?.(new Error('connection terminated unexpectedly')),
    ).not.toThrow();

    await driver.close();
    vi.doUnmock('pg');
  });

  it('queries arrays as raw text while preserving scalar parsers', async () => {
    const query = vi.fn(
      async (config: {
        readonly text: string;
        readonly values?: readonly unknown[];
        readonly types?: {
          readonly getTypeParser: (oid: number, format?: string) => (value: string) => unknown;
        };
      }) => {
        expect(config.types?.getTypeParser(1009, 'text')('{a,b}')).toBe('{a,b}');
        expect(config.types?.getTypeParser(1114, 'text')('2026-01-02 03:04:05')).toEqual(
          pgTypes.getTypeParser(1114, 'text')('2026-01-02 03:04:05'),
        );
        return { rows: [{ name: 'appdb' }] };
      },
    );
    const driver = new PostgresControlDriver({ query } as unknown as Client);

    await expect(driver.query('select 1')).resolves.toEqual({ rows: [{ name: 'appdb' }] });
  });

  it('names the connected database', async () => {
    const mockClient = {
      query: vi.fn(async () => ({ rows: [{ name: 'appdb' }] })),
    };
    const driver = new PostgresControlDriver(mockClient as unknown as Client);

    await expect(driver.databaseName()).resolves.toBe('appdb');
  });

  it('names nothing when the server returns no name', async () => {
    const mockClient = {
      query: vi.fn(async () => ({ rows: [] })),
    };
    const driver = new PostgresControlDriver(mockClient as unknown as Client);

    await expect(driver.databaseName()).resolves.toBeUndefined();
  });

  it('close() resolves even when the underlying client.end() rejects', async () => {
    const mockClient = {
      end: vi.fn(async () => {
        throw new Error('connection already dropped');
      }),
    };
    const driver = new PostgresControlDriver(mockClient as unknown as Client);

    await expect(driver.close()).resolves.toBeUndefined();
  });
});
