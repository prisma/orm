import { defineContract } from '@internal/postgres/contract-builder';
import { test } from 'vitest';
import supabase from '../src/runtime/supabase';

test('creating the client is a type error when its adapter and driver lack a capability the contract requires', () => {
  const contract = defineContract({
    databaseVersion: 18,
    capabilities: [{ http: { batch: true } }],
  });
  // @ts-expect-error http.batch is required by the contract but not provided by its database version, adapter, driver or extensions
  void supabase({ contract, jwtSecret: 'secret' });
  void supabase({ contract: defineContract({ databaseVersion: 18 }), jwtSecret: 'secret' });
});
