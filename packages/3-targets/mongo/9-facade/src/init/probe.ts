import type { InitProbeResult } from '@internal/cli/init-contribution';
import type * as MongoDriver from 'mongodb';

/**
 * The driver's own deadlines: `timeoutMS` for each operation, connecting and `buildInfo` included,
 * and `serverSelectionTimeoutMS` for finding a server, so an unreachable server or a stalled
 * `buildInfo` rejects instead of hanging.
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
  loadDriver: LoadDriver = () => import('mongodb'),
): Promise<InitProbeResult> {
  let mongodb: Pick<typeof MongoDriver, 'MongoClient'>;
  try {
    mongodb = await loadDriver();
  } catch (error) {
    if (isModuleNotFound(error)) {
      return { kind: 'driver-missing', driver: 'mongodb', cause: causeMessage(error) };
    }
    throw error;
  }
  const client = new mongodb.MongoClient(databaseUrl, {
    timeoutMS: PROBE_TIMEOUT_MS,
    serverSelectionTimeoutMS: PROBE_TIMEOUT_MS,
  });
  await client.connect();
  try {
    const buildInfo = await client.db().admin().command({ buildInfo: 1 });
    const versionString = String(buildInfo['version'] ?? '');
    return versionString.length === 0
      ? { kind: 'version-unreadable', detail: 'buildInfo did not include a `version` field' }
      : { kind: 'server-version', serverVersion: versionString };
  } finally {
    await client.close().catch(() => undefined);
  }
}
