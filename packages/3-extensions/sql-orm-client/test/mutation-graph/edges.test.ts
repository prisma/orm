import { describe, expect, it } from 'vitest';
import { After, IntoWhere } from '../../src/mutation-graph/edges';
import { Delete, Find } from '../../src/mutation-graph/nodes';
import { userTable } from './tables';

describe('After', () => {
  it('holds the node it comes from and the node it goes to', () => {
    const find = new Find(userTable, []);
    const del = new Delete(userTable, []);

    const edge = new After(find, del);

    expect(edge.from).toBe(find);
    expect(edge.to).toBe(del);
  });

  it('is frozen', () => {
    const edge = new After(new Find(userTable, []), new Delete(userTable, []));

    expect(Object.isFrozen(edge)).toBe(true);
  });

  it('gives a new edge with one node replaced', () => {
    const find = new Find(userTable, []);
    const del = new Delete(userTable, []);
    const otherFind = new Find(userTable, []);

    const edge = new After(find, del).replaceNode(find, otherFind);

    expect(edge).toBeInstanceOf(After);
    expect(edge.from).toBe(otherFind);
    expect(edge.to).toBe(del);
  });
});

describe('IntoWhere', () => {
  it('holds its nodes and its column pairs', () => {
    const find = new Find(userTable, []);
    const del = new Delete(userTable, []);

    const edge = new IntoWhere(find, del, [
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
    const edge = new IntoWhere(new Find(userTable, []), new Delete(userTable, []), [['id', 'id']]);

    expect(Object.isFrozen(edge)).toBe(true);
    expect(Object.isFrozen(edge.columns)).toBe(true);
  });

  it('gives a new edge with one node replaced and the same column pairs', () => {
    const find = new Find(userTable, []);
    const del = new Delete(userTable, []);
    const otherDelete = new Delete(userTable, []);

    const edge = new IntoWhere(find, del, [['id', 'id']]).replaceNode(del, otherDelete);

    expect(edge).toBeInstanceOf(IntoWhere);
    expect(edge.from).toBe(find);
    expect(edge.to).toBe(otherDelete);
    expect(edge).toMatchObject({ columns: [['id', 'id']] });
  });
});
