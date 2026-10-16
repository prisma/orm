import { type SupabaseDb, supabase } from '@prisma/orm-extension-supabase/runtime';
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export function createDb(url: string, middleware: SqlMiddleware[]): Promise<SupabaseDb<Contract>> {
  return supabase<Contract>({ url, contractJson, jwtSecret: 'secret', middleware });
}
