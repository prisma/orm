import { BinaryExpr, ColumnRef, OrderByItem, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Graph } from '../../src/mutation-graph/graph';
import { Delete, Find, Update } from '../../src/mutation-graph/nodes';
import { userTable } from './tables';

const idIsOne = BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1));

describe('Find', () => {
  it('holds its table and where', () => {
    const find = new Find(userTable, [idIsOne]);

    expect(find.table).toEqual(userTable);
    expect(find.where).toEqual([idIsOne]);
  });

  it('reads without order, offset, cursor, distinct or limit by default', () => {
    expect(new Find(userTable, []).read).toEqual({
      orderBy: undefined,
      offset: undefined,
      cursor: undefined,
      distinct: undefined,
      distinctOn: undefined,
      limit: undefined,
    });
  });

  it('holds the read state it is given', () => {
    const read = {
      orderBy: [OrderByItem.asc(ColumnRef.of('user', 'name'))],
      offset: 2,
      cursor: { id: 5 },
      distinct: ['name'],
      distinctOn: ['email'],
      limit: 1,
    };

    expect(new Find(userTable, [], read).read).toEqual(read);
  });

  it('is frozen', () => {
    const find = new Find(userTable, [idIsOne]);

    expect(Object.isFrozen(find)).toBe(true);
    expect(Object.isFrozen(find.table)).toBe(true);
    expect(Object.isFrozen(find.where)).toBe(true);
    expect(Object.isFrozen(find.read)).toBe(true);
  });

  it('does not change when the array it was built from changes', () => {
    const where = [idIsOne];
    const find = new Find(userTable, where);

    where.push(idIsOne);

    expect(find.where).toEqual([idIsOne]);
  });

  it('is its own peephole result', () => {
    const find = new Find(userTable, []);

    expect(find.peephole(new Graph())).toBe(find);
  });
});

describe('Update', () => {
  it('holds its table, the values to set and where', () => {
    const update = new Update(userTable, { name: 'Ada' }, [idIsOne]);

    expect(update.table).toEqual(userTable);
    expect(update.set).toEqual({ name: 'Ada' });
    expect(update.where).toEqual([idIsOne]);
  });

  it('is frozen', () => {
    const update = new Update(userTable, { name: 'Ada' }, [idIsOne]);

    expect(Object.isFrozen(update)).toBe(true);
    expect(Object.isFrozen(update.table)).toBe(true);
    expect(Object.isFrozen(update.set)).toBe(true);
    expect(Object.isFrozen(update.where)).toBe(true);
  });

  it('does not change when the values it was built from change', () => {
    const set: Record<string, unknown> = { name: 'Ada' };
    const update = new Update(userTable, set, []);

    set['email'] = 'ada@example.com';

    expect(update.set).toEqual({ name: 'Ada' });
  });

  it('is its own peephole result when it sets a value', () => {
    const update = new Update(userTable, { name: 'Ada' }, []);

    expect(update.peephole(new Graph())).toBe(update);
  });

  it('has no peephole result when it sets nothing', () => {
    const update = new Update(userTable, {}, [idIsOne]);

    expect(update.peephole(new Graph())).toBeUndefined();
  });
});

describe('Delete', () => {
  it('holds its table and where', () => {
    const del = new Delete(userTable, [idIsOne]);

    expect(del.table).toEqual(userTable);
    expect(del.where).toEqual([idIsOne]);
  });

  it('is frozen', () => {
    const del = new Delete(userTable, [idIsOne]);

    expect(Object.isFrozen(del)).toBe(true);
    expect(Object.isFrozen(del.table)).toBe(true);
    expect(Object.isFrozen(del.where)).toBe(true);
  });

  it('is its own peephole result', () => {
    const del = new Delete(userTable, []);

    expect(del.peephole(new Graph())).toBe(del);
  });
});
