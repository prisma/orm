import { contractFromJson } from '@internal/postgres/static';
import { expectTypeOf, test } from 'vitest';
import supabase, { type SupabaseDb } from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import contractJson from './fixtures/example-app/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);
const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';

test('supabase() infers the contract type from the value', () => {
  expectTypeOf(supabase({ contract, jwtSecret })).toEqualTypeOf<Promise<SupabaseDb<Contract>>>();
});

test('supabase() does not take contractJson', () => {
  // @ts-expect-error the contract is passed as a value
  supabase<Contract>({ contractJson, jwtSecret });
  // @ts-expect-error the contract is passed as a value
  supabase({ contractJson, jwtSecret });
});
