/**
 * A full-text index is stored in the contract as data and compared, when the
 * database is verified, as the expression index its search document renders.
 * The live database reprints that expression in its own normal form, so these
 * tests create the index from the DDL the migration planner renders and verify
 * against what the database returns.
 */

import {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import { fullTextIndex } from '@internal/postgres/contract-builder';
import { postgresRenderDefault } from '@internal/target-postgres/control';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { CreateIndexCall } from '@internal/target-postgres/op-factory-call';
import { contractToPostgresDatabaseSchemaNode } from '@internal/target-postgres/planner';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  defineContract,
  field,
  int4Column,
  model,
  PostgresContractSerializer,
  runSchemaVerify,
  textColumn,
  timeouts,
  useDevDatabase,
  withClient,
} from './family.schema-verify.helpers';
import { postgresTypeLookups } from './postgres-type-lookups';

function postContract(naming: { readonly name: string } | { readonly map: string }) {
  return defineContract({
    models: {
      Post: model('Post', {
        fields: {
          id: field.column(int4Column).id(),
          title: field.column(textColumn),
          subtitle: field.column(textColumn).optional(),
          body: field.column(textColumn).optional(),
        },
      }).sql(({ cols }) => ({
        table: 'post',
        indexes: [
          'name' in naming
            ? fullTextIndex([[cols.title, cols.subtitle], cols.body], { name: naming.name })
            : fullTextIndex([[cols.title, cols.subtitle], cols.body], { map: naming.map }),
        ],
      })),
    },
  });
}

/** The CREATE INDEX the migration planner's op factory renders for the contract's index. */
async function createIndexStatements(contract: unknown): Promise<readonly string[]> {
  const validated = blindCast<
    Parameters<typeof contractToPostgresDatabaseSchemaNode>[0],
    'the contract was built for the Postgres target; the serializer returns the framework supertype'
  >(new PostgresContractSerializer().deserializeContract(contract));
  const root = contractToPostgresDatabaseSchemaNode(validated, {
    annotationNamespace: 'pg',
    renderDefault: postgresRenderDefault,
    ...postgresTypeLookups,
  });
  const [index] = root.namespaces['public']?.tables['post']?.indexes ?? [];
  if (index?.expression === undefined) throw new Error('the post table has no expression index');
  const op = await new CreateIndexCall(
    'public',
    'post',
    index.name,
    { expression: index.expression },
    { type: index.type ?? 'gin' },
  ).toOp(
    new PostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
      createPostgresBuiltinDataTypeLookup(),
    ),
  );
  return op.execute.map((step) => step.sql);
}

async function createPostTableWithIndex(
  connectionString: string,
  contract: unknown,
  options: { readonly withIndex: boolean } = { withIndex: true },
) {
  const statements = options.withIndex ? await createIndexStatements(contract) : [];
  await withClient(connectionString, async (client) => {
    await client.query('DROP TABLE IF EXISTS "post"');
    await client.query(`
      CREATE TABLE "post" (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        subtitle TEXT,
        body TEXT
      )
    `);
    for (const statement of statements) await client.query(statement);
  });
}

describe('a weighted full-text index in a live database', () => {
  const { getConnectionString } = useDevDatabase();

  it(
    'verifies clean against its contract when wire-named',
    async () => {
      const contract = postContract({ name: 'post_search' });
      await createPostTableWithIndex(getConnectionString(), contract);

      const result = await runSchemaVerify(getConnectionString(), contract);

      expect(result.schema.issues).toEqual([]);
      expect(result.ok).toBe(true);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reports the index missing when the database has none',
    async () => {
      const contract = postContract({ name: 'post_search' });
      await createPostTableWithIndex(getConnectionString(), contract, { withIndex: false });

      const result = await runSchemaVerify(getConnectionString(), contract);

      expect(result.ok).toBe(false);
      expect(result.schema.issues).toEqual([
        expect.objectContaining({
          path: [
            'database',
            'public',
            'post',
            expect.stringMatching(/^index:post_search_[0-9a-f]{8}$/),
          ],
        }),
      ]);
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'reprints the expression in its own normal form, which an exact name compares byte for byte',
    async () => {
      const contract = postContract({ map: 'legacy_post_search' });
      await createPostTableWithIndex(getConnectionString(), contract);

      const definition = await withClient(getConnectionString(), async (client) =>
        client.query(`SELECT pg_get_indexdef('legacy_post_search'::regclass) AS def`),
      );
      const result = await runSchemaVerify(getConnectionString(), contract);

      expect(definition.rows[0].def).toContain(
        `setweight(to_tsvector('english'::regconfig, COALESCE(title, ''::text)), 'A'::"char")`,
      );
      expect(result.schema.issues).toContainEqual(
        expect.objectContaining({
          path: ['database', 'public', 'post', 'index:legacy_post_search'],
        }),
      );
    },
    timeouts.spinUpPpgDev,
  );
});
