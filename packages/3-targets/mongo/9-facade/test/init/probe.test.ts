import type * as MongoDriver from 'mongodb';
import { describe, expect, it, vi } from 'vitest';
import { probeMongo } from '../../src/init/probe';

function driverAnswering(buildInfo: Record<string, unknown> | Error) {
  const close = vi.fn(async () => {});
  const constructed: unknown[][] = [];
  const commands: unknown[] = [];
  class FakeClient {
    constructor(...args: unknown[]) {
      constructed.push(args);
    }
    async connect(): Promise<void> {}
    db() {
      return {
        admin: () => ({
          command: async (command: unknown) => {
            commands.push(command);
            if (buildInfo instanceof Error) throw buildInfo;
            return buildInfo;
          },
        }),
      };
    }
    close = close;
  }
  const driver = { MongoClient: FakeClient } as unknown as Pick<typeof MongoDriver, 'MongoClient'>;
  return { load: async () => driver, close, constructed, commands };
}

describe('probeMongo', () => {
  it('reads the server version from buildInfo and closes the client', async () => {
    const { load, close, commands } = driverAnswering({ version: '8.0.4' });

    await expect(probeMongo('mongodb://localhost:27017/db', load)).resolves.toEqual({
      kind: 'server-version',
      serverVersion: '8.0.4',
    });
    expect(commands).toEqual([{ buildInfo: 1 }]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('bounds server selection, the connection and buildInfo with the driver timeout', async () => {
    const { load, constructed } = driverAnswering({ version: '8.0.4' });

    await probeMongo('mongodb://localhost:27017/db', load);

    expect(constructed).toEqual([
      ['mongodb://localhost:27017/db', { timeoutMS: 20_000, serverSelectionTimeoutMS: 20_000 }],
    ]);
  });

  it('says it could not read the version when the server refuses buildInfo', async () => {
    const { load, close } = driverAnswering(new Error('not authorized on admin'));

    await expect(probeMongo('mongodb://localhost:27017/db', load)).resolves.toEqual({
      kind: 'version-unreadable',
      detail: 'buildInfo failed: not authorized on admin',
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

  it('reports a driver that is installed but fails to load, keeping the cause', async () => {
    await expect(
      probeMongo('mongodb://localhost:27017/db', async () => {
        throw new Error('broken driver');
      }),
    ).resolves.toEqual({ kind: 'driver-failed', driver: 'mongodb', cause: 'broken driver' });
  });
});
