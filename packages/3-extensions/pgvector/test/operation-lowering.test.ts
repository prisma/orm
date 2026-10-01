import type { PostgresContract } from '@internal/adapter-postgres/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../2-sql/9-family/test/test-sql-contract-serializer';
import pgvectorRuntime from '../src/exports/runtime';
import { createComposedPostgresAdapter } from './helpers/composed-adapter';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-hash',
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
                vector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
                otherVector: { codecId: 'pg/vector@1', nativeType: 'vector', nullable: false },
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

describe('Operation lowering', () => {
  // The bare `createPostgresAdapter()` factory cannot see extension codecs
  // (ADR 205); these tests use `pg/vector@1` which lives in pgvector, so we
  // compose a stack with the pgvector runtime descriptor.
  const adapter = createComposedPostgresAdapter({ extensions: [pgvectorRuntime] });

  function distanceExpr() {
    return new OperationExpr({
      method: 'cosineDistance',
      self: ColumnRef.of('user', 'vector'),
      args: [
        ParamRef.of([1, 2, 3], {
          name: 'other',
          codec: { codecId: 'pg/vector@1', typeParams: { length: 3 } },
        }),
      ],
      returns: { codecId: 'core/float8', nullable: false },
      lowering: {
        targetFamily: 'sql',
        template: '{{self}} <=> {{arg0}}',
      },
    });
  }

  it('lowers infix operations in projections', () => {
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ProjectionItem.of('distance', distanceExpr()),
    ]);

    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toContain('"user"."vector" <=> $1::vector');
    expect(lowered.sql).toContain('AS "distance"');
  });

  it('lowers function operations with multiple arguments', () => {
    const operationExpr = new OperationExpr({
      method: 'cosineSimilarity',
      self: ColumnRef.of('user', 'vector'),
      args: [
        ColumnRef.of('user', 'otherVector'),
        ParamRef.of([1, 2, 3], {
          name: 'param',
          codec: { codecId: 'pg/vector@1', typeParams: { length: 3 } },
        }),
        LiteralExpr.of(42),
      ],
      returns: { codecId: 'core/float8', nullable: false },
      lowering: {
        targetFamily: 'sql',
        template: 'cosine_similarity({{self}}, {{arg0}}, {{arg1}}, {{arg2}})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('similarity', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract });
    expect(lowered.sql).toContain(
      'cosine_similarity("user"."vector", "user"."otherVector", $1::vector, 42)',
    );
  });

  it('lowers operations in where and orderBy clauses', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          distanceExpr(),
          ParamRef.of(0.5, { name: 'threshold', codec: { codecId: 'pg/float8@1' } }),
        ),
      )
      .withOrderBy([OrderByItem.asc(distanceExpr())]);

    const lowered = adapter.lower(ast, { contract });

    expect(lowered.sql).toContain('WHERE ("user"."vector" <=> $1::vector) = $2');
    expect(lowered.sql).toContain('ORDER BY "user"."vector" <=> $3::vector ASC');
  });

  it('lowers operations with literal arguments', () => {
    const operationExpr = new OperationExpr({
      method: 'contains',
      self: ColumnRef.of('user', 'email'),
      args: [LiteralExpr.of("test'value")],
      returns: { codecId: 'core/bool', nullable: false },
      lowering: {
        targetFamily: 'sql',
        template: 'contains({{self}}, {{arg0}})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('matches', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.sql).toContain(`contains("user"."email", 'test''value')`);
  });

  it('does not re-substitute tokens that appear inside an already-rendered argument', () => {
    // Regression: the previous implementation called `String.prototype.replace`
    // for `{{self}}` first and then for each `{{argN}}` against the running
    // result, so a literal containing `{{arg1}}` rendered into the SQL got
    // corrupted on the second pass. The single-pass callback must preserve it.
    const operationExpr = new OperationExpr({
      method: 'echo',
      self: LiteralExpr.of('{{arg1}}'),
      args: [LiteralExpr.of('replacement')],
      returns: { codecId: 'pg/text@1', nullable: false },
      lowering: {
        targetFamily: 'sql',
        template: 'echo({{self}}, {{arg0}})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('echoed', operationExpr),
    ]);

    const lowered = adapter.lower(ast, { contract, params: [] });
    expect(lowered.sql).toContain(`echo('{{arg1}}', 'replacement')`);
  });

  it('throws when the lowering template references an argument that the descriptor does not provide', () => {
    const operationExpr = new OperationExpr({
      method: 'partial',
      self: ColumnRef.of('user', 'email'),
      args: [LiteralExpr.of('only-arg-0')],
      returns: { codecId: 'core/bool', nullable: false },
      lowering: {
        targetFamily: 'sql',
        template: 'partial({{self}}, {{arg0}}, {{arg1}})',
      },
    });
    const ast = SelectAst.from(TableSource.named('user')).withProjection([
      ProjectionItem.of('result', operationExpr),
    ]);

    expect(() => adapter.lower(ast, { contract, params: [] })).toThrow(
      /Operation lowering template for "partial" referenced missing argument \{\{arg1\}\}; template has 1 arg\(s\)/,
    );
  });
});
