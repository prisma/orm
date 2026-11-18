import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const { sql, contract } = postgres<Contract>({ contractJson, url: 'postgres://localhost/app' });
export { sql, contract };
