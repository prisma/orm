import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  DerivedTableSource,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Delete } from '../../src/mutation-graph/delete';
import type { ColumnPair } from '../../src/mutation-graph/edge';
import { filterData } from '../../src/mutation-graph/filter-data';
import { Find } from '../../src/mutation-graph/find';
import type { Node } from '../../src/mutation-graph/node';
import { printGraph } from '../../src/mutation-graph/print-graph';
import { Update } from '../../src/mutation-graph/update';
import { graphOfUsers } from './statements';

const user = TableSource.named('user');
const post = TableSource.named('post');
const id = ColumnRef.of('user', 'id');
const name = ColumnRef.of('user', 'name');
const idIsOne = BinaryExpr.eq(id, ParamRef.of(1));

function findUser(where?: AnyExpression): Find {
  return new Find(SelectAst.from(user).withWhere(where));
}

function updateUser(set: Record<string, AnyExpression>, where?: AnyExpression): Update {
  return new Update(UpdateAst.table(user).withSet(set).withWhere(where));
}

function deleteFrom(table: TableSource, where?: AnyExpression): Delete {
  return new Delete(DeleteAst.from(table).withWhere(where));
}

function pairs(...names: (readonly [string, string])[]): ColumnPair[] {
  return names.map(([source, target]) => [
    ProjectionItem.of(source, ColumnRef.of('user', source)),
    ProjectionItem.of(target, ColumnRef.of('post', target)),
  ]);
}

function printNode(node: Node): string {
  const graph = graphOfUsers();
  graph.add(node, { filter: [] });
  return printGraph(graph);
}

function printWhere(where: AnyExpression): string {
  return printNode(findUser(where));
}

describe('printGraph', () => {
  describe('graphs of the update and delete methods', () => {
    it('prints one Update as the rows result', () => {
      const graph = graphOfUsers('rows');
      const update = updateUser({ name: ParamRef.of('Ada'), age: ParamRef.of(36) }, idIsOne);
      graph.setResult(graph.add(update, { filter: [] }));

      expect(printGraph(graph)).toBe(
        ["n1 Update user set name = 'Ada', age = 36 where id = 1", 'result: n1 rows'].join('\n'),
      );
    });

    it('prints a Find and a Delete after it, with the Find as the result', () => {
      const graph = graphOfUsers('rows');
      const find = graph.add(findUser(idIsOne), { filter: [] });
      graph.after(find, graph.add(deleteFrom(user, idIsOne), { filter: [] }));
      graph.setResult(find);

      expect(printGraph(graph)).toBe(
        [
          'n1 Find user where id = 1',
          'n2 Delete user where id = 1 <- After n1',
          'result: n1 rows',
        ].join('\n'),
      );
    });

    it('prints a Find whose row goes into the where of an Update', () => {
      const graph = graphOfUsers('first row');
      const find = graph.add(findUser(idIsOne), { filter: [] });
      const update = updateUser({ name: ParamRef.of('Ada') });
      graph.setResult(graph.add(update, { filter: [filterData(find, pairs(['id', 'id']))] }));

      expect(printGraph(graph)).toBe(
        [
          'n1 Find user where id = 1',
          "n2 Update user set name = 'Ada' <- FilterData n1 (id->id)",
          'result: n2 first row',
        ].join('\n'),
      );
    });

    it('prints a count result', () => {
      const graph = graphOfUsers('count');
      graph.setResult(graph.add(deleteFrom(user, idIsOne), { filter: [] }));

      expect(printGraph(graph)).toBe(
        ['n1 Delete user where id = 1', 'result: n1 count'].join('\n'),
      );
    });
  });

  describe('names', () => {
    it('numbers the nodes that remain, without gaps', () => {
      const graph = graphOfUsers('rows');
      const first = graph.add(findUser(idIsOne), { filter: [] });
      const removed = graph.add(findUser(), { filter: [] });
      const del = graph.add(deleteFrom(user), { filter: [] });
      graph.after(first, del);
      graph.remove(removed);
      graph.setResult(del);

      expect(printGraph(graph)).toBe(
        ['n1 Find user where id = 1', 'n2 Delete user <- After n1', 'result: n2 rows'].join('\n'),
      );
    });
  });

  describe('result line', () => {
    it('prints none for a graph with no node', () => {
      expect(printGraph(graphOfUsers())).toBe('result: none');
    });

    it('prints none for an empty result next to other nodes', () => {
      const graph = graphOfUsers('first row');
      const find = graph.add(findUser(idIsOne), { filter: [] });
      graph.setResult(
        graph.add(updateUser({}), { filter: [filterData(find, pairs(['id', 'id']))] }),
      );

      expect(printGraph(graph)).toBe(['n1 Find user where id = 1', 'result: none'].join('\n'));
    });
  });

  describe('edges', () => {
    it('prints every column pair of a FilterData and every input of a node', () => {
      const graph = graphOfUsers();
      const findUsers = graph.add(findUser(), { filter: [] });
      const findPosts = graph.add(new Find(SelectAst.from(post)), { filter: [] });
      const del = graph.add(deleteFrom(post), {
        filter: [filterData(findUsers, pairs(['tenant_id', 'tenant_id'], ['id', 'author_id']))],
      });
      graph.after(findPosts, del);

      expect(printGraph(graph)).toBe(
        [
          'n1 Find user',
          'n2 Find post',
          'n3 Delete post <- FilterData n1 (tenant_id->tenant_id, id->author_id), After n2',
          'result: none',
        ].join('\n'),
      );
    });
  });

  describe('where', () => {
    it('prints the parts of a top-level and without parentheses', () => {
      expect(printWhere(AndExpr.of([idIsOne, BinaryExpr.neq(name, LiteralExpr.of('Ada'))]))).toBe(
        ["n1 Find user where id = 1 and name <> 'Ada'", 'result: none'].join('\n'),
      );
    });

    it('prints comparison operators', () => {
      expect(
        printWhere(
          AndExpr.of([
            BinaryExpr.gt(id, ParamRef.of(1)),
            BinaryExpr.gte(id, ParamRef.of(2)),
            BinaryExpr.lt(id, ParamRef.of(3)),
            BinaryExpr.lte(id, ParamRef.of(4)),
            BinaryExpr.like(name, ParamRef.of('A%')),
            new BinaryExpr('isDistinctFrom', id, ParamRef.of(5)),
            new BinaryExpr('isNotDistinctFrom', id, ParamRef.of(6)),
          ]),
        ),
      ).toBe(
        [
          "n1 Find user where id > 1 and id >= 2 and id < 3 and id <= 4 and name like 'A%' and id is distinct from 5 and id is not distinct from 6",
          'result: none',
        ].join('\n'),
      );
    });

    it('prints in and not in with a list', () => {
      expect(
        printWhere(
          AndExpr.of([
            BinaryExpr.in(id, ListExpression.fromValues([1, 2])),
            BinaryExpr.notIn(id, ListExpression.fromValues([3])),
          ]),
        ),
      ).toBe(['n1 Find user where id in (1, 2) and id not in (3)', 'result: none'].join('\n'));
    });

    it('puts nested and and or in parentheses', () => {
      const nested = OrExpr.of([idIsOne, AndExpr.of([idIsOne, NullCheckExpr.isNull(name)])]);

      expect(printWhere(nested)).toBe(
        ['n1 Find user where (id = 1 or (id = 1 and name is null))', 'result: none'].join('\n'),
      );
    });

    it('prints an and of nothing as true and an or of nothing as false', () => {
      expect(printWhere(AndExpr.true())).toBe(
        ['n1 Find user where true', 'result: none'].join('\n'),
      );
      expect(printWhere(OrExpr.false())).toBe(
        ['n1 Find user where false', 'result: none'].join('\n'),
      );
    });

    it('prints not and null checks', () => {
      expect(printWhere(AndExpr.of([idIsOne.not(), NullCheckExpr.isNotNull(name)]))).toBe(
        ['n1 Find user where not (id = 1) and name is not null', 'result: none'].join('\n'),
      );
    });

    it('prints the table of a column of another table', () => {
      expect(printWhere(BinaryExpr.eq(id, ColumnRef.of('post', 'author_id')))).toBe(
        ['n1 Find user where id = post.author_id', 'result: none'].join('\n'),
      );
    });

    it('prints the kind of an expression it has no text for', () => {
      expect(printWhere(ExistsExpr.exists(SelectAst.from(post)))).toBe(
        ['n1 Find user where <exists>', 'result: none'].join('\n'),
      );
    });
  });

  describe('values', () => {
    it('prints null, booleans, bigints, dates and objects', () => {
      const update = updateUser({
        deleted_at: ParamRef.of(null),
        active: ParamRef.of(true),
        visits: ParamRef.of(10n),
        seen_at: ParamRef.of(new Date('2026-01-02T03:04:05.000Z')),
        settings: ParamRef.of({ theme: 'dark' }),
      });

      expect(printNode(update)).toBe(
        [
          'n1 Update user set deleted_at = null, active = true, visits = 10, seen_at = 2026-01-02T03:04:05.000Z, settings = {"theme":"dark"}',
          'result: none',
        ].join('\n'),
      );
    });

    it('prints an Update that sets nothing, which only replace can put in a graph', () => {
      const graph = graphOfUsers();
      const find = graph.add(findUser(), { filter: [] });
      graph.replace(find, updateUser({}));

      expect(printGraph(graph)).toBe(['n1 Update user set nothing', 'result: none'].join('\n'));
    });
  });

  describe('a Find', () => {
    it('prints order, limit, offset and distinct on', () => {
      const find = new Find(
        SelectAst.from(user)
          .withWhere(idIsOne)
          .withOrderBy([OrderByItem.asc(name, { nulls: 'last' }), OrderByItem.desc(id)])
          .withLimit(1)
          .withOffset(2)
          .withDistinctOn([ColumnRef.of('user', 'email'), name]),
      );

      expect(printNode(find)).toBe(
        [
          'n1 Find user where id = 1 order by name asc nulls last, id desc limit 1 offset 2 distinct on (email, name)',
          'result: none',
        ].join('\n'),
      );
    });

    it('prints a limit that is an expression', () => {
      const find = new Find(SelectAst.from(user).withLimit(ParamRef.of(10)));

      expect(printNode(find)).toBe(['n1 Find user limit 10', 'result: none'].join('\n'));
    });

    it('prints the alias of a source that is not a table', () => {
      const find = new Find(SelectAst.from(DerivedTableSource.as('user', SelectAst.from(user))));

      expect(printNode(find)).toBe(['n1 Find user', 'result: none'].join('\n'));
    });
  });
});
