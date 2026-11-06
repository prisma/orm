import { InsertOnConflict } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import { FilterData } from '../../src/mutation-graph/filter-data';
import { Graph } from '../../src/mutation-graph/graph';
import { Insert } from '../../src/mutation-graph/insert';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { PayloadData } from '../../src/mutation-graph/payload-data';
import { Rows } from '../../src/mutation-graph/rows';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { printGraph } from './print-graph';
import {
  aliasedTable,
  columnPairs,
  deletePosts,
  deleteUsers,
  findUsers,
  insertInto,
  nameIsAda,
  updateUsers,
} from './statements';

describe('printGraph', () => {
  it('prints one node and the result that names it', () => {
    const graph = new Graph();
    graph.setResult(
      graph.add(updateUsers({ email: 'ada@example.com' }, nameIsAda), { filter: [] }),
    );

    expect(printGraph(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1'].join('\n'),
    );
  });

  it('prints a FilterData edge with its column pair', () => {
    const graph = new Graph();
    const find = graph.add(findUsers([nameIsAda]), { filter: [] });
    const sameId = columnPairs('users', 'users', [['id', 'id']]);
    graph.setResult(graph.add(deleteUsers(), { filter: [new FilterData(find, sameId)] }));

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n2',
      ].join('\n'),
    );
  });

  it('prints every column pair of a FilterData edge', () => {
    const graph = new Graph();
    const find = graph.add(findUsers(), { filter: [] });
    const pairs = columnPairs('users', 'posts', [
      ['id', 'user_id'],
      ['name', 'title'],
    ]);
    graph.setResult(graph.add(deletePosts(), { filter: [new FilterData(find, pairs)] }));

    expect(printGraph(graph)).toBe(
      [
        'n1 Find users',
        'n2 Delete posts <- FilterData n1 (id->user_id, name->title)',
        'result: n2',
      ].join('\n'),
    );
  });

  it('prints every input of a node', () => {
    const graph = new Graph();
    const find = graph.add(findUsers(), { filter: [] });
    const other = graph.add(findUsers(), { filter: [] });
    const sameId = columnPairs('users', 'users', [['id', 'id']]);
    graph.add(deleteUsers(), {
      filter: [new FilterData(find, sameId), new FilterData(other, sameId)],
    });
    graph.setResult(find);

    expect(printGraph(graph)).toBe(
      [
        'n1 Find users',
        'n2 Find users',
        'n3 Delete users <- FilterData n1 (id->id), FilterData n2 (id->id)',
        'result: n1',
      ].join('\n'),
    );
  });

  it('prints none for a result with no node', () => {
    const graph = new Graph();
    graph.add(findUsers(), { filter: [] });

    expect(printGraph(new Graph())).toBe('result: none');
    expect(printGraph(graph)).toBe(['n1 Find users', 'result: none'].join('\n'));
  });

  describe('inserts', () => {
    it('prints an Insert of one row and of several rows', () => {
      const graph = new Graph();
      graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])), { payload: [] });
      graph.setResult(
        graph.add(new Insert(insertInto('users', [{ name: 'a' }, { name: 'b' }, { name: 'c' }])), {
          payload: [],
        }),
      );

      expect(printGraph(graph)).toBe(
        ['n1 Insert users', 'n2 Insert users 3 rows', 'result: n2'].join('\n'),
      );
    });

    it('prints the conflict clause of an Insert', () => {
      const users = aliasedTable('users');
      const ast = insertInto('users', [{ email: 'a@b.c' }]);
      const graph = new Graph();
      graph.add(
        new Insert(
          ast.withOnConflict(
            InsertOnConflict.on([users.column('email')]).doUpdateSet({
              email: users.column('email'),
            }),
          ),
        ),
        { payload: [] },
      );
      graph.add(
        new Insert(ast.withOnConflict(InsertOnConflict.on([users.column('email')]).doNothing())),
        {
          payload: [],
        },
      );
      graph.add(new Insert(ast.withOnConflict(InsertOnConflict.doNothing())), { payload: [] });

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert users on conflict (email) do update',
          'n2 Insert users on conflict (email) do nothing',
          'n3 Insert users on conflict do nothing',
          'result: none',
        ].join('\n'),
      );
    });

    it('prints an InsertChunked with the number of its statements', () => {
      const graph = new Graph();
      const chunked = new InsertChunked([
        insertInto('users', [{ name: 'Ada' }]),
        insertInto('users', [{ name: 'Grace', email: 'g@h.io' }]),
      ]);
      graph.setResult(graph.add(chunked, {}));

      expect(printGraph(graph)).toBe(
        ['n1 InsertChunked users (2 statements)', 'result: n1'].join('\n'),
      );
    });

    it('prints the chain of a variant create: Insert, Insert with PayloadData, CrossJoin, UnionAll', () => {
      const graph = new Graph();
      const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);
      const sameUserId = columnPairs('users', 'users', [['id', 'id']]);
      const samePostId = columnPairs('posts', 'posts', [['id', 'id']]);
      const joins = [1, 2].map(() => {
        const base = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])), { payload: [] });
        const variant = graph.add(new Insert(insertInto('posts', [{ title: 'Hello' }])), {
          payload: [new PayloadData(base, idToUserId)],
        });
        return graph.add(new CrossJoin(), {
          left: new Rows(base, sameUserId),
          right: new Rows(variant, samePostId),
        });
      });
      graph.setResult(
        graph.add(new UnionAll(), { rows: joins.map((join) => new Rows(join, sameUserId)) }),
      );

      expect(printGraph(graph)).toBe(
        [
          'n1 Insert users',
          'n2 Insert posts <- PayloadData n1 (id->user_id)',
          'n3 CrossJoin <- Rows n1, Rows n2',
          'n4 Insert users',
          'n5 Insert posts <- PayloadData n4 (id->user_id)',
          'n6 CrossJoin <- Rows n4, Rows n5',
          'n7 UnionAll <- Rows n3, Rows n6',
          'result: n7',
        ].join('\n'),
      );
    });
  });
});
