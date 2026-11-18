import { describe, expect, it } from 'vitest';
import {
  BinaryExpr,
  collectTableSources,
  DeleteAst,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  FunctionSource,
  InsertAst,
  InsertOnConflict,
  JoinAst,
  ProjectionItem,
  RawQueryAst,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '../../src/ast/types';
import { col, param } from './test-helpers';

function inNamespace(name: string, namespaceId: string, alias?: string): TableSource {
  return TableSource.named(name, alias, namespaceId);
}

function selectFrom(source: TableSource): SelectAst {
  return SelectAst.from(source).withProjection([
    ProjectionItem.of('id', col(source.alias ?? source.name, 'id')),
  ]);
}

describe('collectTableSources', () => {
  it('gives the table source of a FROM', () => {
    expect(collectTableSources(selectFrom(inNamespace('user', 'public', 'u')))).toEqual([
      inNamespace('user', 'public', 'u'),
    ]);
  });

  it('gives every table source in the order it is named, including a repeated table', () => {
    const ast = selectFrom(inNamespace('user', 'public')).withJoins([
      JoinAst.inner(
        inNamespace('post', 'public'),
        EqColJoinOn.of(col('user', 'id'), col('post', 'user_id')),
      ),
      JoinAst.left(
        inNamespace('user', 'public', 'author'),
        EqColJoinOn.of(col('post', 'user_id'), col('author', 'id')),
      ),
    ]);

    expect(collectTableSources(ast)).toEqual([
      inNamespace('user', 'public'),
      inNamespace('post', 'public'),
      inNamespace('user', 'public', 'author'),
    ]);
  });

  it('tells apart tables of the same name in different namespaces', () => {
    const ast = selectFrom(inNamespace('tasks', 'a')).withJoins([
      JoinAst.inner(
        inNamespace('tasks', 'b', 'tasks_2'),
        EqColJoinOn.of(col('tasks', 'id'), col('tasks_2', 'id')),
      ),
    ]);

    expect(collectTableSources(ast)).toEqual([
      inNamespace('tasks', 'a'),
      inNamespace('tasks', 'b', 'tasks_2'),
    ]);
  });

  it('reaches tables in derived tables, lateral joins and function source arguments', () => {
    const lateral = DerivedTableSource.as('posts', selectFrom(inNamespace('post', 'public')));
    const ast = SelectAst.from(
      DerivedTableSource.as('inner', selectFrom(inNamespace('user', 'public'))),
    )
      .withProjection([ProjectionItem.of('id', col('inner', 'id'))])
      .withJoins([
        JoinAst.left(lateral, BinaryExpr.eq(col('inner', 'id'), col('posts', 'id')), true),
        JoinAst.inner(
          FunctionSource.of('unnest', [SubqueryExpr.of(selectFrom(inNamespace('tag', 'public')))]),
          BinaryExpr.eq(col('inner', 'id'), col('inner', 'id')),
        ),
      ]);

    expect(collectTableSources(ast)).toEqual([
      inNamespace('user', 'public'),
      inNamespace('post', 'public'),
      inNamespace('tag', 'public'),
    ]);
  });

  it('reaches tables in subqueries of the projection and the condition, at any depth', () => {
    const deepest = selectFrom(inNamespace('tag', 'public'));
    const nested = selectFrom(inNamespace('post', 'public')).withWhere(ExistsExpr.exists(deepest));
    const ast = selectFrom(inNamespace('user', 'public'))
      .withProjection([ProjectionItem.of('posts', SubqueryExpr.of(nested))])
      .withWhere(ExistsExpr.exists(selectFrom(inNamespace('comment', 'public'))));

    expect(collectTableSources(ast)).toEqual([
      inNamespace('user', 'public'),
      inNamespace('post', 'public'),
      inNamespace('tag', 'public'),
      inNamespace('comment', 'public'),
    ]);
  });

  it('gives the target of an insert and the tables its conflict clause and returning read', () => {
    const ast = InsertAst.into(inNamespace('user', 'public'))
      .withRows([{ email: param('a@example.com') }])
      .withOnConflict(
        InsertOnConflict.on([col('user', 'email')]).doUpdateSet({
          name: SubqueryExpr.of(selectFrom(inNamespace('profile', 'public'))),
        }),
      )
      .withReturning([
        ProjectionItem.of('posts', SubqueryExpr.of(selectFrom(inNamespace('post', 'public')))),
      ]);

    expect(collectTableSources(ast)).toEqual([
      inNamespace('user', 'public'),
      inNamespace('profile', 'public'),
      inNamespace('post', 'public'),
    ]);
  });

  it('gives the target of an update and the tables its values and condition read', () => {
    const ast = UpdateAst.table(inNamespace('user', 'public', 'u'))
      .withSet({ name: SubqueryExpr.of(selectFrom(inNamespace('profile', 'public'))) })
      .withWhere(ExistsExpr.exists(selectFrom(inNamespace('post', 'public'))));

    expect(collectTableSources(ast)).toEqual([
      inNamespace('user', 'public', 'u'),
      inNamespace('profile', 'public'),
      inNamespace('post', 'public'),
    ]);
  });

  it('gives the target of a delete and the tables its condition reads', () => {
    const ast = DeleteAst.from(inNamespace('user', 'public')).withWhere(
      ExistsExpr.exists(selectFrom(inNamespace('post', 'public'))),
    );

    expect(collectTableSources(ast)).toEqual([
      inNamespace('user', 'public'),
      inNamespace('post', 'public'),
    ]);
  });

  it('gives the tables of the expressions in a raw query', () => {
    const ast = RawQueryAst.affectedCount([
      'select ',
      SubqueryExpr.of(selectFrom(inNamespace('user', 'public'))),
    ]);

    expect(collectTableSources(ast)).toEqual([inNamespace('user', 'public')]);
  });
});
