import { describe, expect, it } from 'vitest';
import { After, FilterData } from '../../src/mutation-graph/edges';
import { deleteUsers, findUsers } from './statements';

describe('After', () => {
  it('holds the node it comes from and the node it goes to', () => {
    const find = findUsers();
    const del = deleteUsers();

    const edge = new After(find, del);

    expect(edge.from).toBe(find);
    expect(edge.to).toBe(del);
  });

  it('is frozen', () => {
    const edge = new After(findUsers(), deleteUsers());

    expect(Object.isFrozen(edge)).toBe(true);
  });

  it('gives a new edge with one node replaced', () => {
    const find = findUsers();
    const del = deleteUsers();
    const otherFind = findUsers();

    const edge = new After(find, del).replaceNode(find, otherFind);

    expect(edge).toBeInstanceOf(After);
    expect(edge.from).toBe(otherFind);
    expect(edge.to).toBe(del);
  });
});

describe('FilterData', () => {
  it('holds its nodes and its column pairs', () => {
    const find = findUsers();
    const del = deleteUsers();

    const edge = new FilterData(find, del, [
      ['tenant_id', 'tenant_id'],
      ['id', 'user_id'],
    ]);

    expect(edge.from).toBe(find);
    expect(edge.to).toBe(del);
    expect(edge.columns).toEqual([
      ['tenant_id', 'tenant_id'],
      ['id', 'user_id'],
    ]);
  });

  it('is frozen', () => {
    const edge = new FilterData(findUsers(), deleteUsers(), [['id', 'id']]);

    expect(Object.isFrozen(edge)).toBe(true);
    expect(Object.isFrozen(edge.columns)).toBe(true);
  });

  it('gives a new edge with one node replaced and the same column pairs', () => {
    const find = findUsers();
    const del = deleteUsers();
    const otherDelete = deleteUsers();

    const edge = new FilterData(find, del, [['id', 'id']]).replaceNode(del, otherDelete);

    expect(edge).toBeInstanceOf(FilterData);
    expect(edge.from).toBe(find);
    expect(edge.to).toBe(otherDelete);
    expect(edge).toMatchObject({ columns: [['id', 'id']] });
  });
});
