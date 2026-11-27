import { defineContract, postgres18, postgresDriver } from '@internal/postgres/contract-builder';
import { test } from 'vitest';
import supabase from '../src/runtime/supabase';

test('creating the client is a type error when its adapter and driver lack a capability the contract requires', () => {
  const contract = defineContract({
    requiredCapabilities: [...postgres18, ...postgresDriver, 'http.batch'],
  });
  // @ts-expect-error http.batch is required by the contract but not provided by this client's connection
  void supabase({ contract, jwtSecret: 'secret' });
  void supabase({
    contract: defineContract({ requiredCapabilities: [...postgres18, ...postgresDriver] }),
    jwtSecret: 'secret',
  });
});
