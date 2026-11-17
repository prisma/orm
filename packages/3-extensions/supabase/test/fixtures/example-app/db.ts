import { contractFromJson } from '@internal/postgres/static';
import type { SqlMiddleware } from '@internal/sql-runtime';
import { type SupabaseDb, supabase } from '../../../src/exports/runtime';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

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
