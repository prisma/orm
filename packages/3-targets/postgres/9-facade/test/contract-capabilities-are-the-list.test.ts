import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { postgresCapabilitiesByVersion } from '@internal/target-postgres/server-version';
import { describe, expect, it } from 'vitest';
import { defineContract, field, model, postgres18 } from '../src/exports/contract-builder';
import { buildPostgresStaticContext } from '../src/static/postgres-static';

const User = model('User', {
  fields: { id: field.column({ codecId: 'pg/int4@1' } as const).id() },
}).sql({ table: 'users' });

const withLocking = defineContract({ requiredCapabilities: postgres18, models: { User } });
const withoutLocking = defineContract({
  requiredCapabilities: postgres18.filter((capability) => capability !== 'sql.forUpdate'),
  models: { User },
});

// Before the contract stated its version, the adapter declared every PostgreSQL flag and the client added them to any contract. This adapter does that again, so the test shows the client no longer adds them.
const adapterDeclaringEveryFlag = {
  ...postgresAdapter,
  capabilities: postgresCapabilitiesByVersion[18],
};

function clientFor<TContract extends Contract<SqlStorage>>(contract: TContract) {
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: adapterDeclaringEveryFlag,
    driver: postgresDriver,
  });
  const context = createExecutionContext({ contract, stack });
  const { sql } = buildPostgresStaticContext(contract, context, stack);
  const runtime = {
    query: () => {
      throw new Error('no statement runs in these tests');
    },
    execute: () => {
      throw new Error('no statement runs in these tests');
    },
  };
  return { context, sql, orm: orm({ context, runtime }) };
}

const capabilityMissing = expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' });

describe("a client goes by the contract's capabilities, not its stack's", () => {
  it('keeps the contract’s list as it is', () => {
    expect(clientFor(withoutLocking).context.contract.capabilities['sql']).not.toHaveProperty(
      'forUpdate',
    );
  });

  it('offers locking to a contract that lists it', () => {
    const client = clientFor(withLocking);
    expect(() => client.sql.public.users.select('id').forUpdate().build()).not.toThrow();
    expect(() => client.orm.public.User.forUpdate()).not.toThrow();
  });

  it('refuses it to a contract that does not, though the adapter declares it', () => {
    const client = clientFor(withoutLocking);
    expect(() =>
      // @ts-expect-error the contract declares no dependency on sql.forUpdate
      client.sql.public.users.select('id').forUpdate().build(),
    ).toThrow(capabilityMissing);
    expect(() =>
      // @ts-expect-error the contract declares no dependency on sql.forUpdate
      client.orm.public.User.forUpdate(),
    ).toThrow(capabilityMissing);
  });
});
