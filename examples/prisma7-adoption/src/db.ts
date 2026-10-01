import 'dotenv/config';
import 'temporal-polyfill/full/global';
import { PrismaPg } from '@prisma/adapter-pg';
import postgres from '@prisma/orm-postgres/runtime';
import { PrismaClient } from '../generated/prisma7/client';
import type { Contract } from '../generated/prisma8/contract.d';
import contractJson from '../generated/prisma8/contract.json' with { type: 'json' };

const connectionString = process.env['DATABASE_URL'];
if (connectionString === undefined) {
  console.error('DATABASE_URL is not set. Run `pnpm db:start` in another terminal first.');
  process.exit(1);
}

/** The Prisma 7 client, exactly as the project used it before adopting Prisma 8. */
export const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

/** The Prisma 8 client over the contract emitted from the same prisma/schema.prisma. */
export const db = postgres<Contract>({ url: connectionString, contractJson });
