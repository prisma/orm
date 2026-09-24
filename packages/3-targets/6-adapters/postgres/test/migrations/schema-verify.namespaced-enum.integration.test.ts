/**
 * A native enum that lives outside `public` verifies clean. Introspection
 * reports the column type through `format_type`, which spells a mixed-case
 * type outside the search path as `audit."AuditAction"`; the contract side
 * spells it `audit.AuditAction`. Both must compare equal, as they already do
 * for a `public` enum (`"AuditAction"` is unquoted on introspection).
 */
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { PostgresNativeEnum, postgresCreateNamespace } from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDriver,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

interface EnumTableCase {
  readonly schema: string;
  readonly table: string;
  readonly enumName: string;
  readonly typeName: string;
  /** The enum's members, `CREATE` and `DELETE` when omitted. */
  readonly members?: readonly [string, ...string[]];
  /** A default on `action`: declared on the contract as given, created live as the first member. */
  readonly contractDefault?:
    | { readonly kind: 'literal'; readonly value: string }
    | { readonly kind: 'function'; readonly expression: string };
}

const defaultMembers = ['CREATE', 'DELETE'] as const;

/** One table whose `action` column is typed by a native enum, in the given schema. */
function buildContract(input: EnumTableCase): Contract<SqlStorage> {
  const members = input.members ?? defaultMembers;
  const qualifiedType =
    input.schema === 'public' ? input.typeName : `${input.schema}.${input.typeName}`;
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('namespaced-enum'),
    storage: new SqlStorage({
      storageHash: coreHash('namespaced-enum'),
      namespaces: {
        [input.schema]: postgresCreateNamespace({
          id: asNamespaceId(input.schema),
          entries: {
            table: {
              [input.table]: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  action: {
                    nativeType: qualifiedType,
                    codecId: 'pg/enum@1',
                    nullable: false,
                    ...(input.contractDefault === undefined
                      ? {}
                      : { default: input.contractDefault }),
                    typeParams: { typeName: qualifiedType },
                    valueSet: {
                      plane: 'storage',
                      entityKind: 'valueSet',
                      namespaceId: input.schema,
                      entityName: input.enumName,
                    },
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
            },
            native_enum: {
              [input.enumName]: new PostgresNativeEnum({
                typeName: input.typeName,
                members: [...members],
              }),
            },
            valueSet: { [input.enumName]: { kind: 'valueSet', values: [...members] } },
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models: {} }),
    roots: {},
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

async function verifyEnumTable(
  driver: PostgresControlDriver,
  input: EnumTableCase,
): Promise<readonly (readonly string[])[]> {
  const members = input.members ?? defaultMembers;
  const quotedType = `"${input.schema}"."${input.typeName}"`;
  // `resetDatabase` clears `public` only; a schema created by an earlier case
  // (and the type inside it) would otherwise survive into this one.
  if (input.schema !== 'public') {
    await driver.query(`DROP SCHEMA IF EXISTS "${input.schema}" CASCADE`);
    await driver.query(`CREATE SCHEMA "${input.schema}"`);
  }
  await driver.query(`DROP TYPE IF EXISTS ${quotedType} CASCADE`);
  const memberList = members.map((member) => `'${member}'`).join(', ');
  await driver.query(`CREATE TYPE ${quotedType} AS ENUM (${memberList})`);
  const liveDefault = input.contractDefault === undefined ? '' : ` DEFAULT '${members[0]}'`;
  await driver.query(
    `CREATE TABLE "${input.schema}"."${input.table}" (id int PRIMARY KEY, action ${quotedType} NOT NULL${liveDefault})`,
  );
  const contract = buildContract(input);
  const introspected = await familyInstance.introspect({ driver, contract });
  const verifyResult = familyInstance.verifySchema({
    contract,
    schema: introspected,
    strict: false,
    frameworkComponents,
  });
  return verifyResult.schema.issues.map((issue) => issue.path);
}

describe('a native enum outside public verifies clean', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) await database.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('reports zero findings for a mixed-case enum type in another schema', {
    timeout: testTimeout,
  }, async () => {
    const paths = await verifyEnumTable(driver!, {
      schema: 'audit',
      table: 'audit_log',
      enumName: 'AuditAction',
      typeName: 'AuditAction',
    });
    expect(paths).toEqual([]);
  });

  it('reports zero findings for an enum default declared as a raw cast expression', {
    timeout: testTimeout,
  }, async () => {
    // A raw default written as sql`'x'::sch.t`, the form infer prints for an enum cast.
    const paths = await verifyEnumTable(driver!, {
      schema: 'audit',
      table: 'audit_log',
      enumName: 'AuditAction',
      typeName: 'AuditAction',
      contractDefault: { kind: 'function', expression: '\'CREATE\'::audit."AuditAction"' },
    });
    expect(paths).toEqual([]);
  });

  it('reports zero findings for an enum default declared as a raw cast to an unquoted schema-qualified type', {
    timeout: testTimeout,
  }, async () => {
    const paths = await verifyEnumTable(driver!, {
      schema: 'auth',
      table: 'oauth_clients',
      enumName: 'OauthClientType',
      typeName: 'oauth_client_type',
      members: ['confidential', 'public'],
      contractDefault: { kind: 'function', expression: "'confidential'::auth.oauth_client_type" },
    });
    expect(paths).toEqual([]);
  });

  it('reports zero findings for an enum default declared as a literal', {
    timeout: testTimeout,
  }, async () => {
    const paths = await verifyEnumTable(driver!, {
      schema: 'audit',
      table: 'audit_log',
      enumName: 'AuditAction',
      typeName: 'AuditAction',
      contractDefault: { kind: 'literal', value: 'CREATE' },
    });
    expect(paths).toEqual([]);
  });

  it('reports zero findings for a type name that contains a dot', {
    timeout: testTimeout,
  }, async () => {
    const paths = await verifyEnumTable(driver!, {
      schema: 'public',
      table: 'dotted_log',
      enumName: 'Dotted',
      typeName: 'a.b',
    });
    expect(paths).toEqual([]);
  });

  it('reports zero findings for a dotted type name in another schema', {
    timeout: testTimeout,
  }, async () => {
    const paths = await verifyEnumTable(driver!, {
      schema: 'sch',
      table: 'dotted_log',
      enumName: 'Dotted',
      typeName: 'a.b',
    });
    expect(paths).toEqual([]);
  });
});
