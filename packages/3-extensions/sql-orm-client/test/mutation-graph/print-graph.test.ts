import { describe, expect, it } from 'vitest';
import { filterData } from '../../src/mutation-graph/filter-data';
import { printGraph } from './print-graph';
import {
  columnPairs,
  deletePosts,
  deleteUsers,
  findUsers,
  graphOfUsers,
  nameIsAda,
  updateUsers,
} from './statements';

describe('printGraph', () => {
  it('prints one node and the result that names it', () => {
    const graph = graphOfUsers('rows');
    graph.setResult(
      graph.add(updateUsers({ email: 'ada@example.com' }, nameIsAda), { filter: [] }),
    );

    expect(printGraph(graph)).toBe(
      ["n1 Update users set email = 'ada@example.com' where name = 'Ada'", 'result: n1 rows'].join(
        '\n',
      ),
    );
  });

  it('prints a FilterData edge with its column pair', () => {
    const graph = graphOfUsers('first row');
    const find = graph.add(findUsers([nameIsAda]), { filter: [] });
    const sameId = columnPairs('users', 'users', [['id', 'id']]);
    graph.setResult(graph.add(deleteUsers(), { filter: [filterData(find, sameId)] }));

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada'",
        'n2 Delete users <- FilterData n1 (id->id)',
        'result: n2 first row',
      ].join('\n'),
    );
  });

  it('prints every column pair of a FilterData edge', () => {
    const graph = graphOfUsers('count');
    const find = graph.add(findUsers(), { filter: [] });
    const pairs = columnPairs('users', 'posts', [
      ['id', 'user_id'],
      ['name', 'title'],
    ]);
    graph.setResult(graph.add(deletePosts(), { filter: [filterData(find, pairs)] }));

    expect(printGraph(graph)).toBe(
      [
        'n1 Find users',
        'n2 Delete posts <- FilterData n1 (id->user_id, name->title)',
        'result: n2 count',
      ].join('\n'),
    );
  });

  it('prints an After edge after the data edges of a node', () => {
    const graph = graphOfUsers('rows');
    const find = graph.add(findUsers(), { filter: [] });
    const other = graph.add(findUsers(), { filter: [] });
    const sameId = columnPairs('users', 'users', [['id', 'id']]);
    const del = graph.add(deleteUsers(), { filter: [filterData(find, sameId)] });
    graph.after(other, del);
    graph.setResult(find);

    expect(printGraph(graph)).toBe(
      [
        'n1 Find users',
        'n2 Find users',
        'n3 Delete users <- FilterData n1 (id->id), After n2',
        'result: n1 rows',
      ].join('\n'),
    );
  });

  it('prints none for a result with no node', () => {
    const graph = graphOfUsers('first row');
    graph.add(findUsers(), { filter: [] });

    expect(printGraph(graphOfUsers())).toBe('result: none');
    expect(printGraph(graph)).toBe(['n1 Find users', 'result: none'].join('\n'));
  });
});
