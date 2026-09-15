/**
 * The relation fields of each implicit many-to-many junction model carry the
 * names `contract infer` gives the same junction table's foreign keys, so a
 * project that later adopts the database through infer sees the same names.
 * The SQL Prisma 7.10.0 generated for
 * `fixtures/prisma7-source/implicit-many-to-many-names` is applied unchanged.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Contract } from '@internal/contract/types';
import { createControlStack } from '@internal/framework-components/control';
import { flatPslModels, type PslModel } from '@internal/framework-components/psl-ast';
import { prisma7Schema } from '@internal/postgres/config';
import type { SqlModelStorage, SqlStorage } from '@internal/sql-contract/types';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { timeouts, withClient, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  createFamilyInstance,
  postgres,
  postgresAdapter,
  postgresDriver,
  sql,
  withDriver,
} from '../family.schema-verify.helpers';

type JunctionFields = Record<string, Record<string, string>>;

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures/prisma7-source');

async function interpret(schemaPath: string): Promise<Contract<SqlStorage>> {
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
  });
  const loaded = await prisma7Schema(schemaPath).source.load({
    composedExtensions: [],
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [schemaPath],
    capabilities: stack.capabilities,
  });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure.diagnostics));
  return loaded.value as Contract<SqlStorage>;
}

function interpretedJunctionFields(
  contract: Contract<SqlStorage>,
  namespaceIds: readonly string[],
): JunctionFields {
  const tableOf = (namespace: string, model: string): string =>
    (contract.domain.namespaces[namespace]?.models[model]?.storage as SqlModelStorage | undefined)
      ?.table ?? '';
  const fields: JunctionFields = {};
  for (const namespace of namespaceIds) {
    for (const [modelName, model] of Object.entries(
      contract.domain.namespaces[namespace]?.models ?? {},
    )) {
      const table = tableOf(namespace, modelName);
      if (!table.startsWith('_')) continue;
      fields[table] = Object.fromEntries(
        Object.entries(model.relations).map(([fieldName, relation]) => [
          fieldName,
          tableOf(relation.to.namespace, relation.to.model),
        ]),
      );
    }
  }
  return fields;
}

function inferredJunctionFields(models: readonly PslModel[]): JunctionFields {
  const tableOf = (model: PslModel): string => {
    const map = model.attributes.find((attribute) => attribute.name === 'map')?.args[0]?.value;
    return map === undefined ? model.name : (JSON.parse(map) as string);
  };
  const byName = new Map(models.map((model) => [model.name, model]));
  const fields: JunctionFields = {};
  for (const model of models) {
    if (!tableOf(model).startsWith('_')) continue;
    fields[tableOf(model)] = Object.fromEntries(
      model.fields.flatMap((field) => {
        const target = byName.get(field.typeName);
        return target === undefined ? [] : [[field.name, tableOf(target)]];
      }),
    );
  }
  return fields;
}

/**
 * Applies the fixture's Prisma 7 SQL, drops `droppedSchemas`, and returns the
 * junction relation field names infer gives the tables left, next to the
 * interpreter's names for the junctions in `namespaceIds`.
 */
async function junctionFieldNames(
  fixture: string,
  namespaceIds: readonly string[],
  droppedSchemas: readonly string[] = [],
): Promise<{ readonly interpreted: JunctionFields; readonly inferred: JunctionFields }> {
  const contract = await interpret(join(fixturesDir, fixture, 'schema.prisma'));
  const migrationSql = readFileSync(join(fixturesDir, fixture, 'migration.sql'), 'utf8');
  return withDevDatabase(async ({ connectionString }) => {
    await withClient(connectionString, async (client) => {
      await client.query(migrationSql);
      for (const schema of droppedSchemas) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    });
    const inferred = await withDriver(connectionString, async (driver) => {
      const family = createFamilyInstance();
      const schema = await family.introspect({
        driver,
        contract: new PostgresContractSerializer().serializeContract(contract),
      });
      return flatPslModels(family.inferPslContract(schema));
    });
    return {
      interpreted: interpretedJunctionFields(contract, namespaceIds),
      inferred: inferredJunctionFields(inferred),
    };
  });
}

describe('implicit many-to-many junction relation field names', () => {
  it(
    'match the names contract infer gives the junction tables Prisma 7 created',
    async () => {
      const { interpreted, inferred } = await junctionFieldNames('implicit-many-to-many-names', [
        'public',
        'shop',
      ]);
      expect(interpreted).toEqual(inferred);
      expect(interpreted).toEqual({
        _AToB: { a2: 'A', b2: 'B' },
        _CategoryToProduct: { category: 'Category', product: 'Product' },
        _Favorites: { blogPosts: 'blog_posts', user: 'User' },
        _Follows: { user: 'User', userUser: 'User' },
        _Loop: { a2: 'A', aA: 'A' },
        _PostToTag: { blogPosts: 'blog_posts', tag: 'Tag' },
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'match infer for relations with one name in two schemas, one schema at a time',
    async () => {
      const one = await junctionFieldNames(
        'implicit-many-to-many-names-two-schemas',
        ['one'],
        ['two'],
      );
      const two = await junctionFieldNames(
        'implicit-many-to-many-names-two-schemas',
        ['two'],
        ['one'],
      );
      expect({ one: one.interpreted, two: two.interpreted }).toEqual({
        one: one.inferred,
        two: two.inferred,
      });
      expect({ one: one.interpreted, two: two.interpreted }).toEqual({
        one: { _X: { a2: 'A', b2: 'B' } },
        two: { _X: { c: 'C', d: 'D' } },
      });
    },
    timeouts.spinUpPpgDev,
  );
});
