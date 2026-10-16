import postgres from '@internal/postgres/runtime';
import { contractFromJson } from '@internal/postgres/static';
import type { SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { createContract } from '@repo/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import extensionContractJson from '../src/contract/contract.json' with { type: 'json' };
import supabase from '../src/runtime/supabase';
import type { Contract } from './fixtures/example-app/contract';
import fixtureContractJson from './fixtures/example-app/contract.json' with { type: 'json' };

const jwtSecret = 'fixture-jwt-signing-input-not-a-real-credential';

function spyOnApplicationContractValidation() {
  const deserialize = vi.spyOn(PostgresContractSerializer.prototype, 'deserializeContract');
  return () => deserialize.mock.calls.filter(([json]) => json !== extensionContractJson).length;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('supabase() and a contract value', () => {
  it('does not validate a contractFromJson value again', async () => {
    const contract = contractFromJson<Contract>(structuredClone(fixtureContractJson));
    const applicationContractValidations = spyOnApplicationContractValidation();

    const first = await supabase({ contract, jwtSecret });
    const second = await supabase({ contract, jwtSecret });

    expect(applicationContractValidations()).toBe(0);
    expect(first.context.contract.storage).toBe(contract.storage);
    expect(second.context.contract.storage).toBe(contract.storage);
  });

  it('validates once a contract a Postgres client and a Supabase client share', async () => {
    const applicationContractValidations = spyOnApplicationContractValidation();
    const authored = createContract<SqlStorage>();

    const db = postgres({ contract: authored });
    const supabaseDb = await supabase({ contract: authored, jwtSecret });

    expect(applicationContractValidations()).toBe(1);
    expect(supabaseDb.context.contract.storage).toBe(db.contract.storage);
  });

  it('validates a TypeScript-authored contract once', async () => {
    const applicationContractValidations = spyOnApplicationContractValidation();
    const authored = createContract<SqlStorage>();

    await supabase({ contract: authored, jwtSecret });
    await supabase({ contract: authored, jwtSecret });

    expect(applicationContractValidations()).toBe(1);
  });
});
