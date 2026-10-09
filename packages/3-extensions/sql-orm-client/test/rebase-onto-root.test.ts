import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  EqColJoinOn,
  ExistsExpr,
  JoinAst,
  LiteralExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createTableScope } from '../src/table-scope';
import { rebaseOntoRoot } from '../src/where-interop';

const users = { namespaceId: 'public', tableName: 'users' };

function aliasedUsers() {
  const scope = createTableScope();
  scope.aliasTable(users);
  return scope.aliasTable(users);
}

const usersSource = () => TableSource.named('users', undefined, 'public');
const postsSource = () => TableSource.named('posts', undefined, 'public');

describe('rebaseOntoRoot', () => {
  it('rebases a flat expression onto the root alias', () => {
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Bob'));

    expect(rebaseOntoRoot(expr, aliasedUsers())).toEqual(
      BinaryExpr.eq(ColumnRef.of('users_2', 'name'), LiteralExpr.of('Bob')),
    );
  });

  it('returns the expression itself when the root keeps its table name', () => {
    const expr = BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Bob'));

    expect(rebaseOntoRoot(expr, createTableScope().aliasTable(users))).toBe(expr);
  });

  it('leaves the references of a subquery over the same table alone', () => {
    const expr = ExistsExpr.exists(
      SelectAst.from(usersSource())
        .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Bob'))),
    );

    expect(rebaseOntoRoot(expr, aliasedUsers())).toEqual(expr);
  });

  it('rebases a correlated reference inside a subquery over a different table', () => {
    const subquery = (correlated: string) =>
      ExistsExpr.exists(
        SelectAst.from(postsSource())
          .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
          .withWhere(
            BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of(correlated, 'id')),
          ),
      );

    expect(rebaseOntoRoot(subquery('users'), aliasedUsers())).toEqual(subquery('users_2'));
  });

  it('rebases outside a subquery over the same table while leaving its inside alone', () => {
    const inner = ExistsExpr.exists(
      SelectAst.from(usersSource())
        .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('users', 'name'), LiteralExpr.of('Bob'))),
    );
    const expr = AndExpr.of([
      BinaryExpr.eq(ColumnRef.of('users', 'email'), LiteralExpr.of('a@b.c')),
      inner,
    ]);

    expect(rebaseOntoRoot(expr, aliasedUsers())).toEqual(
      AndExpr.of([BinaryExpr.eq(ColumnRef.of('users_2', 'email'), LiteralExpr.of('a@b.c')), inner]),
    );
  });

  it('leaves a nested subquery alone when an enclosing subquery declares the table', () => {
    const nested = ExistsExpr.exists(
      SelectAst.from(postsSource())
        .withProjection([ProjectionItem.of('id', ColumnRef.of('posts', 'id'))])
        .withWhere(BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id'))),
    );
    const expr = ExistsExpr.exists(
      SelectAst.from(usersSource())
        .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
        .withWhere(nested),
    );

    expect(rebaseOntoRoot(expr, aliasedUsers())).toEqual(expr);
  });

  it('leaves a subquery alone when a join or an alias declares the table name', () => {
    const joined = ExistsExpr.exists(
      SelectAst.from(postsSource())
        .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
        .withJoins([
          JoinAst.inner(
            usersSource(),
            EqColJoinOn.of(ColumnRef.of('users', 'id'), ColumnRef.of('posts', 'user_id')),
          ),
        ]),
    );
    const aliased = ExistsExpr.exists(
      SelectAst.from(TableSource.named('posts', 'users', 'public')).withProjection([
        ProjectionItem.of('id', ColumnRef.of('users', 'id')),
      ]),
    );

    expect(rebaseOntoRoot(joined, aliasedUsers())).toEqual(joined);
    expect(rebaseOntoRoot(aliased, aliasedUsers())).toEqual(aliased);
  });

  it('rebases a reference inside a subquery that reads the table under another alias', () => {
    const subquery = (correlated: string) =>
      ExistsExpr.exists(
        SelectAst.from(TableSource.named('users', 'u', 'public'))
          .withProjection([ProjectionItem.of('id', ColumnRef.of('u', 'id'))])
          .withWhere(
            BinaryExpr.eq(ColumnRef.of('u', 'invited_by_id'), ColumnRef.of(correlated, 'id')),
          ),
      );

    expect(rebaseOntoRoot(subquery('users'), aliasedUsers())).toEqual(subquery('users_2'));
  });
});
