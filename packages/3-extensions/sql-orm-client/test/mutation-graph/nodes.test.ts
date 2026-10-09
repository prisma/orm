import { describe, expect, it } from 'vitest';
import { Delete, Find, Update } from '../../src/mutation-graph/nodes';
import { deleteUsers, findUsers, graphOfUsers, nameIsAda, updateUsers } from './statements';

describe('Find', () => {
  it('holds its statement as a select', () => {
    const { ast } = findUsers([nameIsAda]);

    expect(ast.kind).toBe('select');
    expect(new Find(ast).ast).toBe(ast);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(findUsers())).toBe(true);
  });

  it('is its own peephole result', () => {
    const find = findUsers();

    expect(find.peephole(graphOfUsers())).toBe(find);
  });
});

describe('Update', () => {
  it('holds its statement as an update', () => {
    const { ast } = updateUsers({ name: 'Ada' }, nameIsAda);

    expect(ast.kind).toBe('update');
    expect(new Update(ast).ast).toBe(ast);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(updateUsers({ name: 'Ada' }))).toBe(true);
  });

  it('is its own peephole result when it sets a value', () => {
    const update = updateUsers({ name: 'Ada' });

    expect(update.peephole(graphOfUsers())).toBe(update);
  });

  it('has no peephole result when it sets nothing', () => {
    expect(updateUsers({}, nameIsAda).peephole(graphOfUsers())).toBeUndefined();
  });
});

describe('Delete', () => {
  it('holds its statement as a delete', () => {
    const { ast } = deleteUsers(nameIsAda);

    expect(ast.kind).toBe('delete');
    expect(new Delete(ast).ast).toBe(ast);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(deleteUsers())).toBe(true);
  });

  it('is its own peephole result', () => {
    const del = deleteUsers();

    expect(del.peephole(graphOfUsers())).toBe(del);
  });
});
