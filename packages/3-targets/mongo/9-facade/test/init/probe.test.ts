import type * as MongoDriver from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { probeMongo } from '../../src/init/probe';

function driverAnswering(buildInfo: Record<string, unknown>) {
  const close = vi.fn(async () => {});
  class FakeClient {
    constructor(readonly url: string) {}
    async connect(): Promise<void> {}
    db() {
      return { admin: () => ({ command: async () => buildInfo }) };
    }
    close = close;
  }
  const driver = { MongoClient: FakeClient } as unknown as Pick<typeof MongoDriver, 'MongoClient'>;
  return { load: async () => driver, close };
}

describe('probeMongo', () => {
  it('reads the server version from buildInfo and closes the client', async () => {
    const { load, close } = driverAnswering({ version: '8.0.4' });

    await expect(probeMongo('mongodb://localhost:27017/db', load)).resolves.toEqual({
      kind: 'server-version',
      serverVersion: '8.0.4',
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('says the version could not be read when buildInfo has none', async () => {
    const { load } = driverAnswering({});

    await expect(probeMongo('mongodb://localhost:27017/db', load)).resolves.toEqual({
      kind: 'version-unreadable',
      detail: 'buildInfo did not include a `version` field',
    });
  });

  it('reports a driver that is not installed', async () => {
    const missing = Object.assign(new Error("Cannot find package 'mongodb'"), {
      code: 'ERR_MODULE_NOT_FOUND',
    });

    await expect(
      probeMongo('mongodb://localhost:27017/db', async () => {
        throw missing;
      }),
    ).resolves.toEqual({
      kind: 'driver-missing',
      driver: 'mongodb',
      cause: "Cannot find package 'mongodb'",
    });
  });

  it('rejects when loading the driver fails for another reason', async () => {
    await expect(
      probeMongo('mongodb://localhost:27017/db', async () => {
        throw new Error('broken driver');
      }),
    ).rejects.toThrow('broken driver');
  });
});
