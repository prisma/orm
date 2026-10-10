import { describe, expect, it } from 'vitest';
import { graphOfUsers, nameIsAda, updateUsers } from './statements';

describe('Update', () => {
  it('has no peephole result when it sets nothing', () => {
    expect(updateUsers({}, nameIsAda).peephole(graphOfUsers(), 0)).toBeUndefined();
  });
});
