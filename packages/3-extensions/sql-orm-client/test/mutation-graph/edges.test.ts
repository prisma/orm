import { describe, expect, it } from 'vitest';
import { After, after, FilterData, filterData } from '../../src/mutation-graph/edges';

describe('After', () => {
  it('holds the position it comes from and the position it goes to', () => {
    expect(new After(0, 1)).toMatchObject({ from: 0, to: 1 });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new After(0, 1))).toBe(true);
  });
});

describe('FilterData', () => {
  it('holds its positions and its column pairs', () => {
    const edge = new FilterData(0, 1, [
      ['tenant_id', 'tenant_id'],
      ['id', 'user_id'],
    ]);

    expect(edge).toMatchObject({
      from: 0,
      to: 1,
      columns: [
        ['tenant_id', 'tenant_id'],
        ['id', 'user_id'],
      ],
    });
  });

  it('is frozen', () => {
    const edge = new FilterData(0, 1, [['id', 'id']]);

    expect(Object.isFrozen(edge)).toBe(true);
    expect(Object.isFrozen(edge.columns)).toBe(true);
  });
});

describe('inputs', () => {
  it('after gives an After once it is told where it goes', () => {
    expect(after(0)(3)).toEqual(new After(0, 3));
  });

  it('filterData gives a FilterData once it is told where it goes', () => {
    expect(filterData(0, [['id', 'user_id']])(3)).toEqual(
      new FilterData(0, 3, [['id', 'user_id']]),
    );
  });
});
