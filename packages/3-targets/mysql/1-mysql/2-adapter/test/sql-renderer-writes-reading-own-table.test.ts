import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  EqColJoinOn,
  ExistsExpr,
  JoinAst,
  ParamRef,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { createMysqlBuiltinCodecLookup } from '@internal/target-mysql/codecs';
import { mysqlTargetDescriptorMetaRuntime } from '@internal/target-mysql/descriptor-meta-runtime';
import { describe, expect, it } from 'vitest';
import { MysqlSqlRenderer } from '../src/core/sql-renderer';

const renderer = new MysqlSqlRenderer(
  createMysqlBuiltinCodecLookup(),
  mysqlTargetDescriptorMetaRuntime,
);
/** Renders `ast` and records what it rendered as a snapshot, so every input below pins the SQL MySQL is sent. */
const lower = (ast: AnyQueryAst) => {
  const lowered = renderer.render(ast, undefined);
  expect(lowered).toMatchSnapshot();
  return lowered;
};
const sqlOf = (ast: AnyQueryAst) => lower(ast).sql;

const childOf = (alias: string, parent: string) =>
  BinaryExpr.eq(ColumnRef.of(alias, 'parentId'), ColumnRef.of(parent, 'id'));
const childrenOf = (parent: string, alias = 'task_2') =>
  SelectAst.from(TableSource.named('task', alias))
    .withProjection([ProjectionItem.of('_exists', ColumnRef.of(alias, 'parentId'))])
    .withWhere(childOf(alias, parent));

describe('MySQL lowering of an update or delete whose statement reads the written table', () => {
  it('reads the written table in a subquery of the WHERE through a derived table, keeping the correlation outside it', () => {
    expect(
      lower(
        UpdateAst.table(TableSource.named('task'))
          .withSet({ title: ParamRef.of('Has children') })
          .withWhere(ExistsExpr.exists(childrenOf('task'))),
      ),
    ).toEqual({
      sql: 'UPDATE `task` SET `title` = ?1 WHERE EXISTS (SELECT `task_2`.`parentId` AS `_exists` FROM (SELECT * FROM `task`) AS `task_2` WHERE `task_2`.`parentId` = `task`.`id`)',
      params: [{ kind: 'literal', value: 'Has children' }],
    });
  });

  it('reads the written table through a derived table in a delete, a join, a nested subquery and under the subquery table name when it has no alias', () => {
    const variantOfCopy = SelectAst.from(TableSource.named('task', 'task_2'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('task_2', 'id'))])
      .withJoins([
        JoinAst.inner(
          TableSource.named('feature', 'feature_2'),
          EqColJoinOn.of(ColumnRef.of('feature_2', 'id'), ColumnRef.of('task_2', 'id')),
        ),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('task_2', 'id'), ColumnRef.of('t', 'id')));
    const childOfCopy = SelectAst.from(TableSource.named('note', 'note'))
      .withProjection([ProjectionItem.of('_exists', ColumnRef.of('note', 'id'))])
      .withWhere(ExistsExpr.exists(childrenOf('note', 'task_3')));
    const unaliased = SelectAst.from(TableSource.named('task'))
      .withProjection([ProjectionItem.of('_exists', ColumnRef.of('task', 'id'))])
      .withWhere(childOf('task', 't'));
    expect({
      join: sqlOf(
        DeleteAst.from(TableSource.named('task', 't')).withWhere(ExistsExpr.exists(variantOfCopy)),
      ),
      nested: sqlOf(
        DeleteAst.from(TableSource.named('task', 't')).withWhere(ExistsExpr.notExists(childOfCopy)),
      ),
      unaliased: sqlOf(
        DeleteAst.from(TableSource.named('task', 't')).withWhere(ExistsExpr.exists(unaliased)),
      ),
    }).toEqual({
      join: 'DELETE FROM `task` AS `t` WHERE EXISTS (SELECT `task_2`.`id` AS `id` FROM (SELECT * FROM `task`) AS `task_2` INNER JOIN `feature` AS `feature_2` ON `feature_2`.`id` = `task_2`.`id` WHERE `task_2`.`id` = `t`.`id`)',
      nested:
        'DELETE FROM `task` AS `t` WHERE NOT EXISTS (SELECT `note`.`id` AS `_exists` FROM `note` AS `note` WHERE EXISTS (SELECT `task_3`.`parentId` AS `_exists` FROM (SELECT * FROM `task`) AS `task_3` WHERE `task_3`.`parentId` = `note`.`id`))',
      unaliased:
        'DELETE FROM `task` AS `t` WHERE EXISTS (SELECT `task`.`id` AS `_exists` FROM (SELECT * FROM `task`) AS `task` WHERE `task`.`parentId` = `t`.`id`)',
    });
  });

  it('reads the written table through a derived table in a value the update sets', () => {
    const anyId = SelectAst.from(TableSource.named('task', 'task_2')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('task_2', 'id')),
    ]);
    expect(
      sqlOf(
        UpdateAst.table(TableSource.named('task')).withSet({
          parentId: SubqueryExpr.of(anyId),
        }),
      ),
    ).toBe(
      'UPDATE `task` SET `parentId` = (SELECT `task_2`.`id` AS `id` FROM (SELECT * FROM `task`) AS `task_2`)',
    );
  });

  it('writes an update or delete whose subqueries read only other tables, and a select reading a table twice, as before', () => {
    const postsOf = SelectAst.from(TableSource.named('post', 'post'))
      .withProjection([ProjectionItem.of('_exists', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'authorId'), ColumnRef.of('user', 'id')));
    const derivedPosts = DerivedTableSource.as('p', postsOf);
    expect({
      update: sqlOf(
        UpdateAst.table(TableSource.named('user'))
          .withSet({ email: ParamRef.of('x') })
          .withWhere(ExistsExpr.exists(postsOf)),
      ),
      delete: sqlOf(
        DeleteAst.from(TableSource.named('user')).withWhere(ExistsExpr.exists(postsOf)),
      ),
      select: sqlOf(
        SelectAst.from(TableSource.named('task'))
          .withProjection([ProjectionItem.of('id', ColumnRef.of('task', 'id'))])
          .withWhere(ExistsExpr.exists(childrenOf('task'))),
      ),
      derived: sqlOf(
        SelectAst.from(derivedPosts).withProjection([
          ProjectionItem.of('id', ColumnRef.of('p', '_exists')),
        ]),
      ),
    }).toEqual({
      update:
        'UPDATE `user` SET `email` = ?1 WHERE EXISTS (SELECT `post`.`id` AS `_exists` FROM `post` AS `post` WHERE `post`.`authorId` = `user`.`id`)',
      delete:
        'DELETE FROM `user` WHERE EXISTS (SELECT `post`.`id` AS `_exists` FROM `post` AS `post` WHERE `post`.`authorId` = `user`.`id`)',
      select:
        'SELECT `task`.`id` AS `id` FROM `task` WHERE EXISTS (SELECT `task_2`.`parentId` AS `_exists` FROM `task` AS `task_2` WHERE `task_2`.`parentId` = `task`.`id`)',
      derived:
        'SELECT `p`.`_exists` AS `id` FROM (SELECT `post`.`id` AS `_exists` FROM `post` AS `post` WHERE `post`.`authorId` = `user`.`id`) AS `p`',
    });
  });
});
