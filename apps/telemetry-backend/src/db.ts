import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './prisma/contract';
import contractJson from './prisma/contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export type TelemetryDb = ReturnType<typeof postgres<Contract>>;

export function createTelemetryDb(url: string): TelemetryDb {
  return postgres({ contract, url });
}
