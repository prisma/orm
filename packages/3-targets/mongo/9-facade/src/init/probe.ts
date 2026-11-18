import type { InitProbeResult } from '@internal/cli/init-contribution';
import type * as MongoDriver from 'mongodb';

function isModuleNotFound(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ERR_MODULE_NOT_FOUND';
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function probeMongo(databaseUrl: string): Promise<InitProbeResult> {
  let mongodb: typeof MongoDriver;
  try {
    mongodb = await import('mongodb');
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
    if (versionString.length === 0) {
      throw new Error('buildInfo did not include a `version` field');
    }
    return { kind: 'server-version', serverVersion: versionString };
  } finally {
    await client.close().catch(() => undefined);
  }
}
