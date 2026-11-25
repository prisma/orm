import { defineContract } from '@internal/postgres/contract-builder';
import { test } from 'vitest';
import supabase from '../src/runtime/supabase';

test('creating the client is a type error when its adapter and driver lack a capability the contract requires', () => {
  const contract = defineContract({
    databaseVersion: 18,
    capabilities: [{ http: { batch: true } }],
  });
  // @ts-expect-error the adapter and driver do not provide http.batch
  void supabase({ contract, jwtSecret: 'secret' });
  void supabase({ contract: defineContract({ databaseVersion: 18 }), jwtSecret: 'secret' });
});
