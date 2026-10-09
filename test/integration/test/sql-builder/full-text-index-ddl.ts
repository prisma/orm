import postgresAdapterControl, {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sqlFamilyControl from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import postgresTargetControl, { postgresRenderDefault } from '@internal/target-postgres/control';
import { createPostgresBuiltinDataTypeLookup } from '@internal/target-postgres/data-types';
import { CreateIndexCall } from '@internal/target-postgres/op-factory-call';
import { contractToPostgresDatabaseSchemaNode } from '@internal/target-postgres/planner';
import { blindCast } from '@internal/utils/casts';

/** An index of the fixture contract, as the migration planner sees it and creates it. */
export interface PlannedIndex {
  readonly name: string;
  readonly prefix: string | undefined;
  /** The expression of the schema node the planner and verification compare. */
  readonly expression: string;
  /** The CREATE INDEX statement the planner's op factory renders for it. */
  readonly createSql: string;
}

/** The packs the fixture contract is built from, whose codecs and data types name its columns. */
const fixtureStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresTargetControl,
  adapter: postgresAdapterControl,
  extensions: [pgvector],
});

const controlAdapter = new PostgresControlAdapter(
  createPostgresBuiltinCodecLookup(),
  createPostgresBuiltinDataTypeLookup(),
);

/** The expression indexes of one table of the fixture contract, as the migration planner creates them. */
export async function plannedExpressionIndexes(
  contract: unknown,
  table: string,
): Promise<readonly PlannedIndex[]> {
  const root = contractToPostgresDatabaseSchemaNode(
    blindCast<
      Parameters<typeof contractToPostgresDatabaseSchemaNode>[0],
      'the fixture contract is a Postgres contract'
    >(contract),
    {
      annotationNamespace: 'pg',
      renderDefault: postgresRenderDefault,
      codecLookup: fixtureStack.codecLookup,
      dataTypeLookup: fixtureStack.dataTypes.lookup,
    },
  );
  const indexes = root.namespaces['public']?.tables[table]?.indexes ?? [];
  return Promise.all(
    indexes.flatMap((index) => {
      const expression = index.expression;
      if (expression === undefined) return [];
      return [
        new CreateIndexCall(
          'public',
          table,
          index.name,
          { expression },
          {
            type: index.type ?? 'btree',
            ...(index.where === undefined ? {} : { where: index.where }),
          },
        )
          .toOp(controlAdapter)
          .then((op) => ({
            name: index.name,
            prefix: index.prefix,
            expression,
            createSql: op.execute.map((step) => step.sql).join(';\n'),
          })),
      ];
    }),
  );
}
