import { describe, expect, it } from 'vitest';
import { Rows } from '../../src/mutation-graph/rows';
import { columnPairs, positions } from './statements';

const [from] = positions();

describe('Rows', () => {
  it('holds its source position and its column pairs, and is frozen', () => {
    const edge = new Rows(from, columnPairs('users', 'users', [['id', 'id']]));

    expect(edge).toMatchObject({ from, columns: [[{ alias: 'id' }, { alias: 'id' }]] });
    expect(Object.isFrozen(edge)).toBe(true);
  });

  it('gives the source row restricted to the columns of the edge', () => {
    const edge = new Rows(
      from,
      columnPairs('users', 'users', [
        ['id', 'id'],
        ['name', 'name'],
      ]),
    );

    expect(edge.output({ id: 7, name: 'Ada', email: 'a@b.c' })).toEqual({ id: 7, name: 'Ada' });
  });

  it('passes each column through under the name it has in the source row', () => {
    const edge = new Rows(from, columnPairs('users', 'posts', [['id', 'user_id']]));

    expect(edge.output({ id: 7, name: 'Ada' })).toEqual({ id: 7 });
  });
});
