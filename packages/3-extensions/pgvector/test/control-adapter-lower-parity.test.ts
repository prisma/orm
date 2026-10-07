import type { PostgresContract } from '@internal/adapter-postgres/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  type AnyQueryAst,
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
import pgvectorControl from '../src/exports/control';
import pgvectorRuntime from '../src/exports/runtime';
import {
  createComposedPostgresAdapter,
  createComposedPostgresControlAdapter,
} from './helpers/composed-adapter';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                vector: { codecId: 'pg/vector@1', dataType: 'pgvector/vector', nullable: false },
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

// Compose a stack with pgvector on both planes so the runtime and control
// adapters' codec lookups both contain `pg/vector@1`. The parity assertion
// requires both sides to see the same codec set.
const runtimeAdapter = createComposedPostgresAdapter({ extensions: [pgvectorRuntime] });
const controlAdapter = createComposedPostgresControlAdapter({ extensions: [pgvectorControl] });

function expectParity(ast: AnyQueryAst): void {
  const runtime = runtimeAdapter.lower(ast, { contract });
  const control = controlAdapter.lower(ast, { contract });
  expect(control).toEqual(runtime);
}

describe('PostgresControlAdapter.lower / PostgresAdapterImpl.lower parity', () => {
  it('matches on vector ParamRef casts', () => {
    const vectorAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'vector'),
          ParamRef.of([1, 2, 3], {
            name: 'vec',
            codec: { codecId: 'pg/vector@1', typeParams: { length: 3 } },
          }),
        ),
      );
    expectParity(vectorAst);

    expect(runtimeAdapter.lower(vectorAst, { contract }).sql).toContain('::vector');
  });
});
