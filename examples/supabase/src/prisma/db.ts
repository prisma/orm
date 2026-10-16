import { type SupabaseDb, supabase } from '@prisma/orm-extension-supabase/runtime';
import type { SqlMiddleware } from '@prisma/orm-postgres/family-runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from '../contract';
import contractJson from '../contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export const fixtureJwt = 'fixture-jwt-signing-input-not-a-real-credential';

export async function createDb(
  url: string,
  options?: { readonly middleware?: readonly SqlMiddleware[] },
): Promise<SupabaseDb<Contract>> {
  return supabase({
    contract,
    url,
    jwtSecret: process.env['SUPABASE_JWT_SECRET'] ?? fixtureJwt,
    ...options,
  });
}
