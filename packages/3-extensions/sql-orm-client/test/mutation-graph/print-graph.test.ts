import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  ListExpression,
  LiteralExpr,
  NullCheckExpr,
  OrderByItem,
  OrExpr,
  ParamRef,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { After, IntoWhere } from '../../src/mutation-graph/edges';
import { Graph } from '../../src/mutation-graph/graph';
import { Delete, Find, Node, Update } from '../../src/mutation-graph/nodes';
import { printGraph } from '../../src/mutation-graph/print-graph';
import { postTable, userTable } from './tables';

const id = ColumnRef.of('user', 'id');
const name = ColumnRef.of('user', 'name');
const idIsOne = BinaryExpr.eq(id, ParamRef.of(1));

function printFind(find: Find): string {
  const graph = new Graph();
  graph.add(find);
  return printGraph(graph);
}

function printWhere(...where: ConstructorParameters<typeof Find>[1]): string {
  return printFind(new Find(userTable, where));
}

describe('printGraph', () => {
  describe('graphs of the update and delete methods', () => {
    it('prints one Update as the rows result', () => {
      const graph = new Graph();
      const update = graph.add(new Update(userTable, { name: 'Ada', age: 36 }, [idIsOne]));
      graph.setResult({ node: update, form: 'rows', selectedFields: undefined, includes: [] });

      expect(printGraph(graph)).toBe(
        ["n1 Update user set name = 'Ada', age = 36 where id = 1", 'result: n1 rows'].join('\n'),
      );
    });

    it('prints a Find and a Delete after it, with the Find as the result', () => {
      const graph = new Graph();
      const find = new Find(userTable, [idIsOne]);
      graph.add(find);
      const del = new Delete(userTable, [idIsOne]);
      graph.add(del, new After(find, del));
      graph.setResult({ node: find, form: 'rows', selectedFields: undefined, includes: [] });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find user where id = 1',
          'n2 Delete user where id = 1 <- After n1',
          'result: n1 rows',
        ].join('\n'),
      );
    });

    it('prints a Find whose row goes into the where of an Update', () => {
      const graph = new Graph();
      const find = new Find(userTable, [idIsOne]);
      graph.add(find);
      const update = new Update(userTable, { name: 'Ada' }, []);
      graph.add(update, new IntoWhere(find, update, [['id', 'id']]));
      graph.setResult({ node: update, form: 'first row', selectedFields: undefined, includes: [] });

      expect(printGraph(graph)).toBe(
        [
          'n1 Find user where id = 1',
          "n2 Update user set name = 'Ada' <- IntoWhere n1 (id->id)",
          'result: n2 first row',
        ].join('\n'),
      );
    });

    it('prints a count result', () => {
      const graph = new Graph();
      const del = graph.add(new Delete(userTable, [idIsOne]));
      graph.setResult({ node: del, form: 'count', selectedFields: undefined, includes: [] });

      expect(printGraph(graph)).toBe(
        ['n1 Delete user where id = 1', 'result: n1 count'].join('\n'),
      );
    });
  });

  describe('result line', () => {
    it('says when no result is set', () => {
      expect(printGraph(new Graph())).toBe('result: not set');
    });

    it('prints none for the node of an empty result', () => {
      const graph = new Graph();
      const find = new Find(userTable, [idIsOne]);
      graph.add(find);
      const update = new Update(userTable, {}, []);
      const added = graph.add(update, new IntoWhere(find, update, [['id', 'id']]));
      graph.setResult({ node: added, form: 'first row', selectedFields: undefined, includes: [] });

      expect(printGraph(graph)).toBe(['n1 Find user where id = 1', 'result: none'].join('\n'));
    });
  });

  describe('edges', () => {
    it('prints every column pair of an IntoWhere and every input of a node', () => {
      const graph = new Graph();
      const findUser = new Find(userTable, []);
      graph.add(findUser);
      const findPost = new Find(postTable, []);
      graph.add(findPost);
      const del = new Delete(postTable, []);
      graph.add(
        del,
        new IntoWhere(findUser, del, [
          ['tenant_id', 'tenant_id'],
          ['id', 'author_id'],
        ]),
        new After(findPost, del),
      );

      expect(printGraph(graph)).toBe(
        [
          'n1 Find user',
          'n2 Find post',
          'n3 Delete post <- IntoWhere n1 (tenant_id->tenant_id, id->author_id), After n2',
          'result: not set',
        ].join('\n'),
      );
    });
  });

  describe('table', () => {
    it('prints the variant after the table', () => {
      const find = new Find({ ...userTable, variantName: 'Admin' }, []);

      expect(printFind(find)).toBe(['n1 Find user variant Admin', 'result: not set'].join('\n'));
    });
  });

  describe('where', () => {
    it('joins the expressions of the list with and', () => {
      expect(printWhere(idIsOne, BinaryExpr.neq(name, LiteralExpr.of('Ada')))).toBe(
        ["n1 Find user where id = 1 and name <> 'Ada'", 'result: not set'].join('\n'),
      );
    });

    it('prints comparison operators', () => {
      expect(
        printWhere(
          BinaryExpr.gt(id, ParamRef.of(1)),
          BinaryExpr.gte(id, ParamRef.of(2)),
          BinaryExpr.lt(id, ParamRef.of(3)),
          BinaryExpr.lte(id, ParamRef.of(4)),
          BinaryExpr.like(name, ParamRef.of('A%')),
        ),
      ).toBe(
        [
          "n1 Find user where id > 1 and id >= 2 and id < 3 and id <= 4 and name like 'A%'",
          'result: not set',
        ].join('\n'),
      );
    });

    it('prints in and not in with a list', () => {
      expect(
        printWhere(
          BinaryExpr.in(id, ListExpression.fromValues([1, 2])),
          BinaryExpr.notIn(id, ListExpression.fromValues([3])),
        ),
      ).toBe(['n1 Find user where id in (1, 2) and id not in (3)', 'result: not set'].join('\n'));
    });

    it('puts nested and and or in parentheses', () => {
      const nested = OrExpr.of([idIsOne, AndExpr.of([idIsOne, NullCheckExpr.isNull(name)])]);

      expect(printWhere(nested)).toBe(
        ['n1 Find user where (id = 1 or (id = 1 and name is null))', 'result: not set'].join('\n'),
      );
    });

    it('prints an and of nothing as true and an or of nothing as false', () => {
      expect(printWhere(AndExpr.true(), OrExpr.false())).toBe(
        ['n1 Find user where true and false', 'result: not set'].join('\n'),
      );
    });

    it('prints not and null checks', () => {
      expect(printWhere(idIsOne.not(), NullCheckExpr.isNotNull(name))).toBe(
        ['n1 Find user where not (id = 1) and name is not null', 'result: not set'].join('\n'),
      );
    });

    it('prints the table of a column of another table', () => {
      expect(printWhere(BinaryExpr.eq(id, ColumnRef.of('post', 'author_id')))).toBe(
        ['n1 Find user where id = post.author_id', 'result: not set'].join('\n'),
      );
    });

    it('prints the kind of an expression it has no text for', () => {
      const exists = ExistsExpr.exists(SelectAst.from(TableSource.named('post')));

      expect(printWhere(exists)).toBe(
        ['n1 Find user where <exists>', 'result: not set'].join('\n'),
      );
    });
  });

  describe('values', () => {
    it('prints null, booleans, bigints, dates and objects', () => {
      const graph = new Graph();
      graph.add(
        new Update(
          userTable,
          {
            deleted_at: null,
            active: true,
            visits: 10n,
            seen_at: new Date('2026-01-02T03:04:05.000Z'),
            settings: { theme: 'dark' },
          },
          [],
        ),
      );

      expect(printGraph(graph)).toBe(
        [
          'n1 Update user set deleted_at = null, active = true, visits = 10, seen_at = 2026-01-02T03:04:05.000Z, settings = {"theme":"dark"}',
          'result: not set',
        ].join('\n'),
      );
    });
  });

  describe('read state of a Find', () => {
    it('prints order, limit, offset, cursor, distinct and distinct on', () => {
      const find = new Find(userTable, [idIsOne], {
        orderBy: [OrderByItem.asc(name, { nulls: 'last' }), OrderByItem.desc(id)],
        limit: 1,
        offset: 2,
        cursor: { id: 5, name: 'Ada' },
        distinct: ['name'],
        distinctOn: ['email', 'name'],
      });

      expect(printFind(find)).toBe(
        [
          "n1 Find user where id = 1 order by name asc nulls last, id desc limit 1 offset 2 cursor (id = 5, name = 'Ada') distinct (name) distinct on (email, name)",
          'result: not set',
        ].join('\n'),
      );
    });

    it('prints a limit that is an expression', () => {
      const find = new Find(userTable, [], {
        orderBy: undefined,
        limit: ParamRef.of(10),
        offset: undefined,
        cursor: undefined,
        distinct: undefined,
        distinctOn: undefined,
      });

      expect(printFind(find)).toBe(['n1 Find user limit 10', 'result: not set'].join('\n'));
    });
  });

  describe('nodes it does not know', () => {
    it('refuses to print', () => {
      class Unknown extends Node {}
      const graph = new Graph();
      graph.add(new Unknown());

      expect(() => printGraph(graph)).toThrow('Unknown');
    });
  });
});
