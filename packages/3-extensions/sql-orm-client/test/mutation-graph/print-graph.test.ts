import { InsertOnConflict } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Insert } from '../../src/mutation-graph/insert';
import { InsertChunked } from '../../src/mutation-graph/insert-chunked';
import { printGraph } from './print-graph';
import {
  addFiltered,
  aliasedTable,
  columnMappings,
  deletePosts,
  deleteUsers,
  findUsers,
  insertInto,
  insertOwner,
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

  it('prints a FilterData edge with its column mapping', () => {
    const graph = newGraph();
    const find = graph.add(findUsers([nameIsAda]));
    const sameId = columnMappings('users', 'users', [['id', 'id']]);
    graph.setResult(addFiltered(graph, deleteUsers(), [find, sameId]));

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n2',
      ].join('\n'),
    );
  });

  it('prints every column mapping of a FilterData edge', () => {
    const graph = newGraph();
    const find = graph.add(findUsers());
    const mappings = columnMappings('users', 'posts', [
      ['id', 'user_id'],
      ['name', 'title'],
    ]);
    graph.setResult(addFiltered(graph, deletePosts(), [find, mappings]));

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
    const sameId = columnMappings('users', 'users', [['id', 'id']]);
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
      graph.add(new Insert(insertInto('users', [{ name: 'Ada' }]), insertOwner));
      graph.setResult(
        graph.add(
          new Insert(
            insertInto('users', [{ name: 'a' }, { name: 'b' }, { name: 'c' }]),
            insertOwner,
          ),
        ),
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
          insertOwner,
        ),
      );
      graph.add(
        new Insert(
          ast.withOnConflict(InsertOnConflict.on([users.column('email')]).doNothing()),
          insertOwner,
        ),
      );
      graph.add(new Insert(ast.withOnConflict(InsertOnConflict.doNothing()), insertOwner));

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
      const chunked = new InsertChunked(
        [
          insertInto('users', [{ name: 'Ada' }]),
          insertInto('users', [{ name: 'Grace', email: 'g@h.io' }]),
        ],
        insertOwner,
      );
      graph.setResult(graph.add(chunked));

      expect(printGraph(graph)).toBe(
        ['n1 InsertChunked users (2 statements)', 'result: n1'].join('\n'),
      );
    });
  });
});
