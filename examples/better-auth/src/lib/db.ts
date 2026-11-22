import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import type { Contract } from '../../prisma/contract';
import contractJson from '../../prisma/contract.json' with { type: 'json' };

const url = process.env['DATABASE_URL'];
const building = process.env['NEXT_PHASE'] === PHASE_PRODUCTION_BUILD;
if (url === undefined && !building) {
  throw new Error('DATABASE_URL is not set. Set it to your Postgres connection string.');
}

export const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  ...(url !== undefined && { url }),
});
