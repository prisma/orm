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
import { type MysqlContract, MysqlSqlRenderer } from '../src/core/sql-renderer';

const renderer = new MysqlSqlRenderer(
  createMysqlBuiltinCodecLookup(),
  mysqlTargetDescriptorMetaRuntime,
);
const sqlOf = (ast: AnyQueryAst, contract?: MysqlContract) => renderer.render(ast, contract).sql;
const refusalOf = (ast: AnyQueryAst, contract?: MysqlContract) => {
  try {
    sqlOf(ast, contract);
    return undefined;
  } catch (error) {
    const { code, message, why, fix, meta } = Object(error);
    return { code, message, why, fix, meta };
  }
};

const childOf = (alias: string, parent: string) =>
  BinaryExpr.eq(ColumnRef.of(alias, 'parentId'), ColumnRef.of(parent, 'id'));
const childrenOf = (parent: string, alias = 'task_2') =>
  SelectAst.from(TableSource.named('task', alias))
    .withProjection([ProjectionItem.of('_exists', ColumnRef.of(alias, 'parentId'))])
    .withWhere(childOf(alias, parent));

describe('MySQL lowering of an update or delete whose statement reads the written table', () => {
  const refusal = {
    code: 'RUNTIME.AST_UNSUPPORTED',
    message:
      'MySQL cannot run an UPDATE or DELETE whose filter or values read the table being written, `task`',
    why: 'MySQL refuses such a statement with its error 1093. The only form it accepts reads the table through a derived table, which copies the table and locks every row it copies, so concurrent writes deadlock.',
    fix: "Read the keys of the rows, and any values the write takes from this table, with a query first. Then update or delete those rows by key, writing those values (for a variant, through the base model's collection). The filter is not checked again when the rows are written.",
    meta: { target: 'mysql', feature: 'write-reads-written-table' },
  };

  it('refuses a read of the written table in a WHERE subquery, a join, a nested subquery, a subquery table with no alias, and a value the update sets', () => {
    const variantOfCopy = SelectAst.from(TableSource.named('task', 'task_2'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('task_2', 'id'))])
      .withJoins([
        JoinAst.inner(
          TableSource.named('task', 'task_3'),
          EqColJoinOn.of(ColumnRef.of('task_3', 'id'), ColumnRef.of('task_2', 'parentId')),
        ),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('task_2', 'id'), ColumnRef.of('t', 'id')));
    const joinedFromOtherTable = SelectAst.from(TableSource.named('note', 'note'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('note', 'id'))])
      .withJoins([
        JoinAst.inner(
          TableSource.named('task', 'task_2'),
          EqColJoinOn.of(ColumnRef.of('task_2', 'id'), ColumnRef.of('note', 'taskId')),
        ),
      ])
      .withWhere(BinaryExpr.eq(ColumnRef.of('task_2', 'id'), ColumnRef.of('t', 'id')));
    const childOfNote = SelectAst.from(TableSource.named('note', 'note'))
      .withProjection([ProjectionItem.of('_exists', ColumnRef.of('note', 'id'))])
      .withWhere(ExistsExpr.exists(childrenOf('note', 'task_3')));
    const unaliased = SelectAst.from(TableSource.named('task'))
      .withProjection([ProjectionItem.of('_exists', ColumnRef.of('task', 'id'))])
      .withWhere(childOf('task', 't'));
    const anyId = SelectAst.from(TableSource.named('task', 'task_2')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('task_2', 'id')),
    ]);
    const t = TableSource.named('task', 't');
    expect({
      updateWhere: refusalOf(
        UpdateAst.table(TableSource.named('task'))
          .withSet({ title: ParamRef.of('Has children') })
          .withWhere(ExistsExpr.exists(childrenOf('task'))),
      ),
      deleteWhere: refusalOf(DeleteAst.from(t).withWhere(ExistsExpr.exists(variantOfCopy))),
      join: refusalOf(DeleteAst.from(t).withWhere(ExistsExpr.exists(joinedFromOtherTable))),
      nested: refusalOf(DeleteAst.from(t).withWhere(ExistsExpr.notExists(childOfNote))),
      unaliased: refusalOf(DeleteAst.from(t).withWhere(ExistsExpr.exists(unaliased))),
      set: refusalOf(
        UpdateAst.table(TableSource.named('task')).withSet({ parentId: SubqueryExpr.of(anyId) }),
      ),
    }).toEqual({
      updateWhere: refusal,
      deleteWhere: refusal,
      join: refusal,
      nested: refusal,
      unaliased: refusal,
      set: refusal,
    });
  });

  it('refuses a read of the written table in its own namespace, and renders a read of a table of the same name in another namespace', () => {
    const qualifiedBy = (database: string) => ({
      qualifyTable: (name: string) => `\`${database}\`.\`${name}\``,
    });
    const twoDatabases = {
      storage: { namespaces: { app: qualifiedBy('app'), archive: qualifiedBy('archive') } },
    } as unknown as MysqlContract;
    const archivedChildrenOf = (namespaceId: string) =>
      SelectAst.from(TableSource.named('task', 'task_2', namespaceId))
        .withProjection([ProjectionItem.of('_exists', ColumnRef.of('task_2', 'parentId'))])
        .withWhere(childOf('task_2', 'task'));
    const deleteLeaves = (namespaceId: string) =>
      DeleteAst.from(TableSource.named('task', undefined, 'app')).withWhere(
        ExistsExpr.notExists(archivedChildrenOf(namespaceId)),
      );
    expect({
      other: sqlOf(deleteLeaves('archive'), twoDatabases),
      same: refusalOf(deleteLeaves('app'), twoDatabases),
    }).toEqual({
      other:
        'DELETE FROM `app`.`task` WHERE NOT EXISTS (SELECT `task_2`.`parentId` AS `_exists` FROM `archive`.`task` AS `task_2` WHERE `task_2`.`parentId` = `task`.`id`)',
      same: { ...refusal, message: refusal.message.replace('`task`', '`app`.`task`') },
    });
  });

  it('writes an update or delete whose subqueries read only other tables, and a select reading a table twice, as before', () => {
    const postsOf = SelectAst.from(TableSource.named('post', 'post'))
      .withProjection([ProjectionItem.of('_exists', ColumnRef.of('post', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('post', 'authorId'), ColumnRef.of('user', 'id')));
    const allPosts = SelectAst.from(TableSource.named('post', 'post')).withProjection([
      ProjectionItem.of('_exists', ColumnRef.of('post', 'id')),
    ]);
    expect({
      update: renderer.render(
        UpdateAst.table(TableSource.named('user'))
          .withSet({ email: ParamRef.of('x') })
          .withWhere(ExistsExpr.exists(postsOf)),
        undefined,
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
        SelectAst.from(DerivedTableSource.as('p', allPosts)).withProjection([
          ProjectionItem.of('id', ColumnRef.of('p', '_exists')),
        ]),
      ),
    }).toEqual({
      update: {
        sql: 'UPDATE `user` SET `email` = ?1 WHERE EXISTS (SELECT `post`.`id` AS `_exists` FROM `post` AS `post` WHERE `post`.`authorId` = `user`.`id`)',
        params: [{ kind: 'literal', value: 'x' }],
      },
      delete:
        'DELETE FROM `user` WHERE EXISTS (SELECT `post`.`id` AS `_exists` FROM `post` AS `post` WHERE `post`.`authorId` = `user`.`id`)',
      select:
        'SELECT `task`.`id` AS `id` FROM `task` WHERE EXISTS (SELECT `task_2`.`parentId` AS `_exists` FROM `task` AS `task_2` WHERE `task_2`.`parentId` = `task`.`id`)',
      derived:
        'SELECT `p`.`_exists` AS `id` FROM (SELECT `post`.`id` AS `_exists` FROM `post` AS `post`) AS `p`',
    });
  });
});
