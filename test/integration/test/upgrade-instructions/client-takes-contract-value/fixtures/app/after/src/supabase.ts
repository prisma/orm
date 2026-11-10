import { type SupabaseDb, supabase } from '@prisma/orm-extension-supabase/runtime';
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export function createDb(url: string, middleware: SqlMiddleware[]): Promise<SupabaseDb<Contract>> {
  return supabase({ url, contract, jwtSecret: 'secret', middleware });
}
