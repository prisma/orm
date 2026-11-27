import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED } from '@internal/family-sql/control';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import type { SqlStorage as SqlStorageType } from '@internal/sql-contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { diffPostgresSchema } from '../../src/core/migrations/diff-database-schema';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { postgresDiffSubjectGranularity } from '../../src/core/schema-ir/schema-node-kinds';
import { postgresCapabilitiesByVersion } from '../../src/core/server-version';
import postgresTargetDescriptor from '../../src/exports/control';
import { postgresTypeComponents } from '../postgres-type-lookups';

const observingContract: Contract<SqlStorageType> = {
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: profileHash('database-capabilities-verdict-test'),
  defaultControlPolicy: 'observed',
  storage: new SqlStorage({
    storageHash: coreHash('database-capabilities-verdict-test'),
    namespaces: { public: new PostgresSchema({ id: 'public', entries: { table: {} } }) },
  }),
  roots: {},
  domain: applicationDomainOf({ models: {} }),
  capabilities: {
    ...postgresCapabilitiesByVersion[15],
    sql: { ...postgresCapabilitiesByVersion[15].sql, interactiveTransactions: true },
  },
  extensions: {},
  meta: {},
};

function databaseRunning(serverVersionNumber: number | undefined) {
  return new PostgresDatabaseSchemaNode({
    namespaces: {},
    roles: [],
    extensions: [],
    existingSchemas: ['public'],
    serverVersionNumber,
  });
}

function verify(serverVersionNumber: number | undefined, contract = observingContract) {
  return verifySqlSchemaByDiff({
    contract,
    schema: databaseRunning(serverVersionNumber),
    strict: false,
    frameworkComponents: postgresTypeComponents,
    diffSchema: diffPostgresSchema,
    granularityOf: postgresDiffSubjectGranularity,
    databaseCapabilitiesNotProvided: postgresTargetDescriptor.databaseCapabilitiesNotProvided,
  });
}

describe('PostgreSQL verification checks the database provides what the contract requires of it', () => {
  it('passes a server the table supports', () => {
    expect(verify(150004)).toMatchObject({ ok: true, schema: { issues: [] } });
  });

  it('passes a contract that requires a capability no row of the table names, which the client reports', () => {
    const withUnknownCapability = {
      ...observingContract,
      capabilities: {
        ...observingContract.capabilities,
        sql: { ...observingContract.capabilities['sql'], someNewThing: true },
      },
    };

    expect(verify(150004, withUnknownCapability)).toMatchObject({
      ok: true,
      schema: { issues: [] },
    });
  });

  it('fails a server older than the first supported version with its own code, even under an observing policy', () => {
    const message =
      'This release of Prisma requires PostgreSQL 15 or later. This database runs PostgreSQL 14.10. Upgrade the database to PostgreSQL 15 or later.';
    const result = verify(140010);

    expect(result).toMatchObject({
      ok: false,
      code: VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED,
      summary: message,
    });
    expect(result.schema.issues).toEqual([
      expect.objectContaining({
        path: ['capabilities'],
        explanation: {
          text: message,
          cause: 'database-capabilities-not-provided',
          notProvided: {
            database: 'PostgreSQL',
            findings: [
              { kind: 'older-than-supported', databaseVersion: '14.10', oldestSupported: 15 },
            ],
          },
        },
      }),
    ]);
    expect(result.schema.warnings?.issues).toEqual([]);
  });

  it('fails a server whose version could not be read', () => {
    expect(verify(undefined)).toMatchObject({
      ok: false,
      code: VERIFY_CODE_DATABASE_CAPABILITIES_NOT_PROVIDED,
      summary:
        "Prisma could not read this database's PostgreSQL version, so it cannot check that the database provides what your contract requires. Check that the connection reaches a PostgreSQL server, and that SHOW server_version_num returns its version there.",
    });
  });
});
