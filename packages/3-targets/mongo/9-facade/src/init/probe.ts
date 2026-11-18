import type { InitProbeResult } from '@internal/cli/init-contribution';
import type * as MongoDriver from 'mongodb';

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
  const client = new mongodb.MongoClient(databaseUrl);
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
