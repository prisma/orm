import { InsertOnConflict } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { CrossJoin } from '../../src/mutation-graph/cross-join';
import { Insert } from '../../src/mutation-graph/insert';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { UnionAll } from '../../src/mutation-graph/union-all';
import { printGraph } from './print-graph';
import {
  addFiltered,
  aliasedTable,
  columnPairs,
  deletePosts,
  deleteUsers,
  findUsers,
  insertInto,
  nameIsAda,
  newGraph,
  updateUsers,
} from './statements';

describe('printGraph', () => {
  it('prints one node and the result that names it', () => {
    const graph = newGraph();
    graph.setResult(graph.add(updateUsers({ email: 'ada@example.com' }, nameIsAda)));

    expect(printGraph(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1'].join('\n'),
    );
  });

  it('prints a FilterData edge with its column pair', () => {
    const graph = newGraph();
    const find = graph.add(findUsers([nameIsAda]));
    const sameId = columnPairs('users', 'users', [['id', 'id']]);
    graph.setResult(addFiltered(graph, deleteUsers(), [find, sameId]));

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n2',
      ].join('\n'),
    );
  });

  it('prints every column pair of a FilterData edge', () => {
    const graph = newGraph();
    const find = graph.add(findUsers());
    const pairs = columnPairs('users', 'posts', [
      ['id', 'user_id'],
      ['name', 'title'],
    ]);
    graph.setResult(addFiltered(graph, deletePosts(), [find, pairs]));

    expect(printGraph(graph)).toBe(
      [
        'n1 Find users',
        'n2 Delete posts <- FilterData n1 (id->user_id, name->title)',
        'result: n2',
      ].join('\n'),
    );
  });

  it('prints every input of a node', () => {
    const graph = newGraph();
    const find = graph.add(findUsers());
    const other = graph.add(findUsers());
    const sameId = columnPairs('users', 'users', [['id', 'id']]);
    addFiltered(graph, deleteUsers(), [find, sameId], [other, sameId]);
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
    const graph = newGraph();
    graph.add(findUsers());

    expect(printGraph(newGraph())).toBe('result: none');
    expect(printGraph(graph)).toBe(['n1 Find users', 'result: none'].join('\n'));
  });

  describe('inserts', () => {
    it('prints an Insert of one row and of several rows', () => {
      const graph = newGraph();
      graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])));
      graph.setResult(
        graph.add(new Insert(insertInto('users', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]))),
      );

      expect(printGraph(graph)).toBe(
        ['n1 Insert users', 'n2 Insert users 3 rows', 'result: n2'].join('\n'),
      );
    });

    it('prints the conflict clause of an Insert', () => {
      const users = aliasedTable('users');
      const ast = insertInto('users', [{ email: 'a@b.c' }]);
      const graph = newGraph();
      graph.add(
        new Insert(
          ast.withOnConflict(
            InsertOnConflict.on([users.column('email')]).doUpdateSet({
              email: users.column('email'),
            }),
          ),
        ),
      );
      graph.add(
        new Insert(ast.withOnConflict(InsertOnConflict.on([users.column('email')]).doNothing())),
      );
      graph.add(new Insert(ast.withOnConflict(InsertOnConflict.doNothing())));

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
      const graph = newGraph();
      const chunked = new InsertChunked([
        insertInto('users', [{ name: 'Ada' }]),
        insertInto('users', [{ name: 'Grace', email: 'g@h.io' }]),
      ]);
      graph.setResult(graph.add(chunked));

      expect(printGraph(graph)).toBe(
        ['n1 InsertChunked users (2 statements)', 'result: n1'].join('\n'),
      );
    });

    it('prints the chain of a variant create: Insert, Insert with PayloadData, CrossJoin, UnionAll', () => {
      const graph = newGraph();
      const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);
      const sameUserId = columnPairs('users', 'users', [['id', 'id']]);
      const samePostId = columnPairs('posts', 'posts', [['id', 'id']]);
      const joins = [1, 2].map(() => {
        const base = graph.add(new Insert(insertInto('users', [{ name: 'Ada' }])));
        const variant = graph.add(new Insert(insertInto('posts', [{ title: 'Hello' }])));
        graph.addPayloadDataEdge(base, variant, idToUserId);
        const join = graph.add(new CrossJoin());
        graph.addRowsEdge(base, join, 'left', sameUserId);
        graph.addRowsEdge(variant, join, 'right', samePostId);
        return join;
      });
      const union = graph.add(new UnionAll());
      for (const join of joins) {
        graph.addRowsEdge(join, union, 'rows', sameUserId);
      }
      graph.setResult(union);

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
