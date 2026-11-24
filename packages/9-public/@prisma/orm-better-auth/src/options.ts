import type { DBAdapterDebugLogOption } from '@better-auth/core/db/adapter';

export interface PrismaAdapterOptions {
  readonly namespace?: string | undefined;
  readonly usePlural?: boolean | undefined;
  readonly transaction?: boolean | undefined;
  readonly debugLogs?: DBAdapterDebugLogOption | undefined;
}
