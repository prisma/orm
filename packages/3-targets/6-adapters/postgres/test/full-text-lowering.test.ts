import { ColumnRef } from '@internal/sql-relational-core/ast';
import {
  createRawSql,
  type Expression,
  type ScopeField,
} from '@internal/sql-relational-core/expression';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { websearchToTsquery } from '@internal/target-postgres/full-text';
import postgresTargetDescriptor from '@internal/target-postgres/runtime';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { postgresRawCodecInferer } from '../src/core/adapter';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'full-text-test',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'full-text-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            post: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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

const rawSql = createRawSql(postgresRawCodecInferer, { contract });

const title = {
  returnType: { codecId: 'pg/text@1', nullable: false },
  buildAst: () => ColumnRef.of('post', 'title'),
};

function fullTextMatches(query: unknown): Expression<ScopeField> {
  const operations = postgresTargetDescriptor.queryOperations();
  return operations['fullTextMatches']!.impl(
    ...([title, query] as never[]),
  ) as Expression<ScopeField>;
}

function lowerWhere(query: unknown) {
  const plan = rawSql`SELECT id FROM "post" WHERE ${fullTextMatches(query)}`
    .returnsRow({ id: 'pg/int4@1' })
    .build();
  return renderLoweredSql(plan.ast, contract, postgresCodecDescriptorRegistry);
}

describe('full-text lowering', () => {
  it('binds a tsquery value read back from a query as a tsquery-cast parameter', () => {
    const lowered = lowerWhere("'zeb':*");

    expect(lowered).toEqual({
      sql: `SELECT id FROM "post" WHERE to_tsvector('english', "post"."title") @@ $1::tsquery`,
      params: [{ kind: 'literal', value: "'zeb':*" }],
    });
  });

  it('renders a parser expression as the Postgres function over a text parameter, uncast', () => {
    const lowered = lowerWhere(websearchToTsquery('zebra grazing'));

    expect(lowered).toEqual({
      sql: `SELECT id FROM "post" WHERE to_tsvector('english', "post"."title") @@ websearch_to_tsquery('english', $1)`,
      params: [{ kind: 'literal', value: 'zebra grazing' }],
    });
  });
});
