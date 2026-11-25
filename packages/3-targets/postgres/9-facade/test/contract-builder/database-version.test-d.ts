import { postgresAdapterContractContributions } from '@internal/adapter-postgres/adapter';
import { createPostgresBuiltinCodecLookup } from '@internal/adapter-postgres/control';
import sqlFamilyPack from '@internal/family-sql/pack';
import { buildBoundContract } from '@internal/sql-contract-ts/contract-builder';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { postgresServerVersions } from '@internal/target-postgres/server-version';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { expectTypeOf, test } from 'vitest';
import { capabilitiesForVersion, postgresTargetWith } from '../../src/contract/database-version';
import { defineContract, field, model } from '../../src/exports/contract-builder';
import postgres from '../../src/exports/runtime';

const { forNoKeyUpdate: _forNoKeyUpdate, ...postgres15Flags } = postgresServerVersions[15].postgres;

// No PostgreSQL feature Prisma supports needs a version above 15 today, so every row of the real table is equal. This table makes `FOR NO KEY UPDATE` arrive with 17 to show that the version a contract states decides what the client offers.
const versionsWithALaterFeature = {
  16: { ...postgresServerVersions[15], postgres: postgres15Flags },
  17: postgresServerVersions[17],
} as const;

const User = model('User', {
  fields: { id: field.column({ codecId: 'pg/int4@1' } as const).id() },
}).sql({ table: 'users' });

function contractFor<const Version extends keyof typeof versionsWithALaterFeature>(
  version: Version,
) {
  return buildBoundContract(
    sqlFamilyPack,
    postgresTargetWith(capabilitiesForVersion(versionsWithALaterFeature, version)),
    {
      models: { User },
      adapter: { ...postgresAdapterContractContributions, capabilities: {} },
      createNamespace: postgresCreateNamespace,
      codecLookup: createPostgresBuiltinCodecLookup(),
      dataTypeLookup: createPostgresBuiltinDataTypeLookup(),
    },
  );
}

test('a contract for 16 does not offer a feature that needs 17', () => {
  const db = postgres({ contract: contractFor(16), url: 'postgres://localhost/db' });
  db.orm.public.User.forUpdate();
  // @ts-expect-error FOR NO KEY UPDATE arrives with 17 in this table
  db.orm.public.User.forNoKeyUpdate();
});

test('a contract for 17 offers it', () => {
  const db = postgres({ contract: contractFor(17), url: 'postgres://localhost/db' });
  db.orm.public.User.forNoKeyUpdate();
});

test('the contract capabilities are the version row and the merged capabilities list', () => {
  const contract = defineContract({
    version: 18,
    capabilities: [{ sql: { interactiveTransactions: true } }, { http: { batch: true } }],
  });
  expectTypeOf(contract.capabilities.sql.interactiveTransactions).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.http.batch).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.postgres.forNoKeyUpdate).toEqualTypeOf<true>();
  expectTypeOf(contract.capabilities.postgres).not.toHaveProperty('returning');
  expectTypeOf(contract.capabilities.sql).not.toHaveProperty('enums');
});

test('a version outside the table is a type error', () => {
  // @ts-expect-error 14 is not a supported PostgreSQL version
  defineContract({ version: 14 });
  // @ts-expect-error the version is required
  defineContract({});
});
