import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type SqlStorageInput } from '@internal/sql-contract/types';
import { SqlSchemaIR, type SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { verifyPostgresNamespacePresence } from '../../src/core/migrations/verify-postgres-namespaces';
import { PostgresSchema, PostgresUnboundSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';

function makeContract(
  namespaceIds: readonly string[],
  options: { useUnbound?: boolean } = {},
): Contract<SqlStorage> {
  const unboundEntry =
    options.useUnbound || !namespaceIds.includes(UNBOUND_NAMESPACE_ID)
      ? PostgresUnboundSchema.instance
      : new PostgresSchema({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
  const namespaces: SqlStorageInput['namespaces'] = {
    [UNBOUND_NAMESPACE_ID]: unboundEntry,
    ...Object.fromEntries(
      namespaceIds
        .filter((id) => id !== UNBOUND_NAMESPACE_ID)
        .map((id) => [id, new PostgresSchema({ id, entries: { table: {} } })]),
    ),
  };
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('contract'),
      namespaces,
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function makeSchema(existingSchemas?: readonly string[]): SqlSchemaIRNode {
  // `existingSchemas` is database-level, on the root node. A bare flat schema
  // (no root) exercises the `['public']` default — proving the consumer reads
  // `existingSchemas` from the database root (CF-1), not a per-namespace node.
  if (existingSchemas === undefined) {
    return new SqlSchemaIR({ tables: {} });
  }
  return new PostgresDatabaseSchemaNode({
    extensions: undefined,
    namespaces: {},
    roles: [],
    existingSchemas,
    pgVersion: 'unknown',
  });
}

describe('verifyPostgresNamespacePresence', () => {
  it('emits a postgres-namespace not-found issue for a declared namespace whose schema is absent from introspection', () => {
    const contract = makeContract(['auth']);
    const schema = makeSchema(['public']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: ['database', 'auth'],
      expected: { nodeKind: 'postgres-namespace', schemaName: 'auth' },
    });
  });

  it('does not emit missing_schema when the introspected list already contains the namespace', () => {
    const contract = makeContract(['auth']);
    const schema = makeSchema(['public', 'auth']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('does not emit missing_schema for the unbound singleton (no creatable schema name)', () => {
    const contract = makeContract([UNBOUND_NAMESPACE_ID], { useUnbound: true });
    const schema = makeSchema(['public']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(0);
  });

  it('defaults to treating public as present when introspection did not populate existingSchemas', () => {
    const contract = makeContract(['public', 'auth']);
    const schema = makeSchema();

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ path: ['database', 'auth'] });
  });

  it('emits a not-found issue for every declared-but-absent namespace in coordinate-sorted order', () => {
    const contract = makeContract(['analytics', 'auth', 'public']);
    const schema = makeSchema(['public']);

    const issues = verifyPostgresNamespacePresence({ contract, schema });

    expect(issues).toHaveLength(2);
    expect(issues.map((i) => i.path[1])).toEqual(['analytics', 'auth']);
  });
});
