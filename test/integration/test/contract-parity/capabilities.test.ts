import { describe, expect, it } from 'vitest';
import { contract as postgresScalarSource } from '../planner-golden/fixtures/postgres/contract';
import postgresScalarEmitted from '../planner-golden/fixtures/postgres/generated/contract.json' with {
  type: 'json',
};
import { contract as sqliteScalarSource } from '../planner-golden/fixtures/sqlite/contract';
import sqliteScalarEmitted from '../planner-golden/fixtures/sqlite/generated/contract.json' with {
  type: 'json',
};
import { contract as relationsSource } from '../sql-builder/fixtures/contract-no-pgvector';
import relationsEmitted from '../sql-builder/fixtures/generated-no-pgvector/contract.json' with {
  type: 'json',
};
import { contract as postgresParitySource } from './fixtures/postgres/contract';
import postgresParityEmitted from './fixtures/postgres/generated/contract.json' with {
  type: 'json',
};
import { contract as sqliteParitySource } from './fixtures/sqlite/contract';
import sqliteParityEmitted from './fixtures/sqlite/generated/contract.json' with { type: 'json' };

describe('the capabilities of a defineContract contract are those of the emitted contract', () => {
  it.each([
    ['postgres parity', postgresParitySource.capabilities, postgresParityEmitted.capabilities],
    ['sqlite parity', sqliteParitySource.capabilities, sqliteParityEmitted.capabilities],
    ['postgres scalar', postgresScalarSource.capabilities, postgresScalarEmitted.capabilities],
    ['sqlite scalar', sqliteScalarSource.capabilities, sqliteScalarEmitted.capabilities],
    ['relations', relationsSource.capabilities, relationsEmitted.capabilities],
  ])('%s', (_name, built, emitted) => {
    expect(built).toEqual(emitted);
  });

  it('includes the adapter capabilities the type claims', () => {
    expect(postgresParitySource.capabilities.postgres.distinctOn).toBe(true);
    expect(sqliteParitySource.capabilities.sql.returning).toBe(true);
  });
});
