import type { PostgresContract } from '@internal/adapter-postgres/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  BinaryExpr,
  ColumnRef,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createComposedPostgresAdapter } from './helpers/composed-adapter';

describe('pgvector cast policy', () => {
  it('emits $1::vector when pgvector is installed via stack.extensions', async () => {
    // Regression: `pgvectorRuntimeDescriptor` must expose its codecs via `types.codecTypes.codecDescriptors` so the adapter's runtime-plane codec lookup resolves `pg/vector@1` and the renderer emits the `::vector` cast. If the descriptor stops surfacing those codecs, the rendered SQL silently regresses to bare `$1`.
    const pgvectorRuntime = (await import('../src/exports/runtime')).default;

    const adapter = createComposedPostgresAdapter({ extensions: [pgvectorRuntime] });

    const vectorContract = new SqlContractSerializer().deserializeContract({
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'vector-cast-policy',
      roots: {},
      capabilities: {},
      extensions: {},
      meta: {},
      storage: {
        storageHash: 'vector-cast-policy',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                    vec: { codecId: 'pg/vector@1', dataType: 'pgvector/vector', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
      domain: applicationDomainOf({ models: {} }),
    }) as PostgresContract;

    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'vec'),
          ParamRef.of([1, 2, 3], {
            name: 'vec',
            codec: { codecId: 'pg/vector@1', typeParams: { length: 3 } },
          }),
        ),
      );
    const lowered = adapter.lower(ast, { contract: vectorContract });

    expect(lowered.sql).toBe(
      'SELECT "user"."id" AS "id" FROM "user" WHERE "user"."vec" = $1::vector',
    );
  });
});
