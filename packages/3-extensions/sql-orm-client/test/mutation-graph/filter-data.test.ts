import { describe, expect, it } from 'vitest';
import { FilterData, filterData } from '../../src/mutation-graph/filter-data';
import { printExpression } from './print-expression';
import { columnPairs, positions } from './statements';

const [from, to, other] = positions();

const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);
const idAndName = columnPairs('users', 'posts', [
  ['id', 'user_id'],
  ['name', 'title'],
]);

describe('FilterData', () => {
  it('holds its positions and its column pairs', () => {
    expect(new FilterData(from, to, idToUserId)).toMatchObject({
      from,
      to,
      columns: [[{ alias: 'id' }, { alias: 'user_id' }]],
    });
  });

  it('is frozen', () => {
    const edge = new FilterData(from, to, idToUserId);

    expect(Object.isFrozen(edge)).toBe(true);
    expect(Object.isFrozen(edge.columns)).toBe(true);
  });

  it('gives target = value for one source row', () => {
    const condition = new FilterData(from, to, idToUserId).output({ id: 7, name: 'Ada' });

    expect(printExpression(condition, 'posts')).toBe('user_id = 7');
  });

  it('gives an and of target = value for several column pairs', () => {
    const condition = new FilterData(from, to, idAndName).output({ id: 7, name: 'Ada' });

    expect(printExpression(condition, 'posts')).toBe("(user_id = 7 and title = 'Ada')");
  });

  it('builds the value as a parameter with the name and the codec of the target column', () => {
    const [[, target] = []] = idToUserId;

    expect(new FilterData(from, to, idToUserId).output({ id: 7 })).toMatchObject({
      kind: 'binary',
      op: 'eq',
      left: { kind: 'column-ref', table: 'posts', column: 'user_id' },
      right: { kind: 'param-ref', value: 7, name: 'user_id', codec: target?.codec },
    });
    expect(target?.codec).toBeDefined();
  });

  it('is made by filterData once it is told where it goes', () => {
    expect(filterData(from, idToUserId)(other)).toEqual(new FilterData(from, other, idToUserId));
  });
});
