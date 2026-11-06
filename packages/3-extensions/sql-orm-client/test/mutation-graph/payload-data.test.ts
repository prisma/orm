import { describe, expect, it } from 'vitest';
import { PayloadData } from '../../src/mutation-graph/payload-data';
import { columnPairs, positions } from './statements';

const [from] = positions();
const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);

describe('PayloadData', () => {
  it('holds its source position and its column pairs, and is frozen', () => {
    const edge = new PayloadData(from, idToUserId);

    expect(edge).toMatchObject({ from, columns: [[{ alias: 'id' }, { alias: 'user_id' }]] });
    expect(Object.isFrozen(edge)).toBe(true);
  });

  it('gives a record of values for the target columns from one source row', () => {
    const pairs = columnPairs('users', 'posts', [
      ['id', 'user_id'],
      ['name', 'title'],
    ]);

    expect(new PayloadData(from, pairs).output({ id: 7, name: 'Ada', email: 'a@b.c' })).toEqual({
      user_id: expect.objectContaining({ kind: 'param-ref', value: 7, name: 'user_id' }),
      title: expect.objectContaining({ kind: 'param-ref', value: 'Ada', name: 'title' }),
    });
  });

  it('builds each value as a parameter with the codec of its target column', () => {
    const [[, target] = []] = idToUserId;

    const payload = new PayloadData(from, idToUserId).output({ id: 7 });

    expect(target?.codec).toBeDefined();
    expect(payload['user_id']).toMatchObject({ codec: target?.codec });
  });
});
