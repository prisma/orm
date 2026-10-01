import {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import { postgresRenderDefault } from '@internal/target-postgres/control';
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

const controlAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

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
    { annotationNamespace: 'pg', renderDefault: postgresRenderDefault },
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
