import { namespacePslExtensionBlocks } from '@internal/framework-components/psl-ast';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  contract,
  createDriver,
  createTestDatabase,
  familyInstance,
  type PostgresControlDriver,
  resetDatabase,
  testTimeout,
} from './fixtures/runner-fixtures';

/**
 * Proves native-enum ADOPTION on the REAL introspect→infer path: a native
 * Postgres enum type in the database (via PGlite) flows through introspection
 * into a `native_enum` block + `pg.enum(<Name>)` column in the inferred PSL
 * AST, wrapped in an explicit `namespace <schema> { … }` block — replacing
 * the pre-adoption throw this file used to assert.
 */
describe('native enum inference adoption — end-to-end PGlite', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
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

  it('adopts a native enum type into a namespace-wrapped native_enum block and pg.enum column', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE role_t AS ENUM ('admin', 'user')`);
    await driver!.query(`CREATE TABLE "User" (id text PRIMARY KEY, role role_t NOT NULL)`);

    const schemaIR = await familyInstance.introspect({ driver: driver!, contract });
    const ast = await familyInstance.inferPslContract(schemaIR);

    const namespace = ast.namespaces.find((ns) => ns.name === 'public');
    expect(namespace).toBeDefined();
    const blocks = namespacePslExtensionBlocks(namespace!);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ kind: 'native_enum', name: 'RoleT' });
    expect(Object.keys(blocks[0]!.parameters)).toEqual(['admin', 'user']);

    const roleField = namespace!.models
      .find((m) => m.name === 'User')
      ?.fields.find((f) => f.name === 'role');
    expect(roleField?.typeConstructor).toMatchObject({
      path: ['pg', 'enum'],
      args: [{ kind: 'positional', value: 'RoleT' }],
    });
  });

  it('adopts every native enum type when multiple are present', {
    timeout: testTimeout,
  }, async () => {
    await driver!.query(`CREATE TYPE role_t AS ENUM ('admin', 'user')`);
    await driver!.query(`CREATE TYPE status_t AS ENUM ('active', 'inactive')`);
    await driver!.query(
      `CREATE TABLE "User" (id text PRIMARY KEY, role role_t NOT NULL, status status_t NOT NULL)`,
    );

    const schemaIR = await familyInstance.introspect({ driver: driver!, contract });
    const ast = await familyInstance.inferPslContract(schemaIR);

    const namespace = ast.namespaces.find((ns) => ns.name === 'public');
    expect(namespace).toBeDefined();
    const blockNames = namespacePslExtensionBlocks(namespace!)
      .map((b) => b.name)
      .sort();
    expect(blockNames).toEqual(['RoleT', 'StatusT']);
  });

  it('enum-free schemas keep the flat (unwrapped) output', { timeout: testTimeout }, async () => {
    await driver!.query(
      `CREATE TABLE "User" (id text PRIMARY KEY, role text NOT NULL CHECK (role IN ('admin', 'user')))`,
    );

    const schemaIR = await familyInstance.introspect({ driver: driver!, contract });
    const ast = await familyInstance.inferPslContract(schemaIR);

    expect(ast.namespaces).toHaveLength(1);
    expect(ast.namespaces[0]?.name).toBe('__unspecified__');
  });
});
