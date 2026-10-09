import { describe, expect, it } from 'vitest';
import { After, FilterData, filterData } from '../../src/mutation-graph/edges';
import { printExpression } from '../../src/mutation-graph/print-expression';
import { columnPairs } from './statements';

const idToUserId = columnPairs('users', 'posts', [['id', 'user_id']]);
const idAndName = columnPairs('users', 'posts', [
  ['id', 'user_id'],
  ['name', 'title'],
]);

describe('FilterData', () => {
  it('holds its positions and its column pairs', () => {
    expect(new FilterData(0, 1, idToUserId)).toMatchObject({
      from: 0,
      to: 1,
      columns: [[{ alias: 'id' }, { alias: 'user_id' }]],
    });
  });

  it('is frozen', () => {
    const edge = new FilterData(0, 1, idToUserId);

    expect(Object.isFrozen(edge)).toBe(true);
    expect(Object.isFrozen(edge.columns)).toBe(true);
  });

  it('gives target = value for one source row', () => {
    const condition = new FilterData(0, 1, idToUserId).output({ id: 7, name: 'Ada' });

    expect(printExpression(condition, 'posts')).toBe('user_id = 7');
  });

  it('gives an and of target = value for several column pairs', () => {
    const condition = new FilterData(0, 1, idAndName).output({ id: 7, name: 'Ada' });

    expect(printExpression(condition, 'posts')).toBe("(user_id = 7 and title = 'Ada')");
  });

  it('builds the value as a parameter with the name and the codec of the target column', () => {
    const [[, target] = []] = idToUserId;

    expect(new FilterData(0, 1, idToUserId).output({ id: 7 })).toMatchObject({
      kind: 'binary',
      op: 'eq',
      left: { kind: 'column-ref', table: 'posts', column: 'user_id' },
      right: { kind: 'param-ref', value: 7, name: 'user_id', codec: target?.codec },
    });
    expect(target?.codec).toBeDefined();
  });

  it('is made by filterData once it is told where it goes', () => {
    expect(filterData(0, idToUserId)(3)).toEqual(new FilterData(0, 3, idToUserId));
  });
});

describe('After', () => {
  it('holds the position it comes from and the position it goes to', () => {
    expect(new After(0, 1)).toMatchObject({ from: 0, to: 1 });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new After(0, 1))).toBe(true);
  });
});
