import type { InitProbeResult } from '@internal/cli/init-contribution';
import type * as MongoDriver from 'mongodb';

/**
 * The driver's own deadlines, which every 7.x driver honours: `serverSelectionTimeoutMS` for finding
 * a server, `connectTimeoutMS` for opening the connection and its handshake, and `socketTimeoutMS`
 * for a reply, so an unreachable server or a stalled `buildInfo` rejects instead of hanging. Not
 * `timeoutMS`: the driver ignores it from 7.8 on.
 */
const PROBE_TIMEOUT_MS = 20_000;

type LoadDriver = () => Promise<Pick<typeof MongoDriver, 'MongoClient'>>;

function isModuleNotFound(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ERR_MODULE_NOT_FOUND';
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function probeMongo(
  databaseUrl: string,
  signal: AbortSignal,
  loadDriver: LoadDriver = () => import('mongodb'),
): Promise<InitProbeResult> {
  let mongodb: Pick<typeof MongoDriver, 'MongoClient'>;
  try {
    mongodb = await loadDriver();
  } catch (error) {
    return {
      kind: isModuleNotFound(error) ? 'driver-missing' : 'driver-failed',
      driver: 'mongodb',
      cause: causeMessage(error),
    };
  }
  const client = new mongodb.MongoClient(databaseUrl, {
    serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
    connectTimeoutMS: PROBE_TIMEOUT_MS,
    socketTimeoutMS: PROBE_TIMEOUT_MS,
  });
  const closeOnAbort = (): void => {
    void client.close().catch(() => undefined);
  };
  signal.addEventListener('abort', closeOnAbort, { once: true });
  try {
    await client.connect();
    let buildInfo: MongoDriver.Document;
    try {
      buildInfo = await client.db().admin().command({ buildInfo: 1 });
    } catch (error) {
      return { kind: 'version-unreadable', detail: `buildInfo failed: ${causeMessage(error)}` };
    }
    const versionString = String(buildInfo['version'] ?? '');
    return versionString.length === 0
      ? { kind: 'version-unreadable', detail: 'buildInfo did not include a `version` field' }
      : { kind: 'server-version', serverVersion: versionString };
  } finally {
    signal.removeEventListener('abort', closeOnAbort);
    await client.close().catch(() => undefined);
  }
}
