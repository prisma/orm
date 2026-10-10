import { describe, expect, it } from 'vitest';
import { graphOfUsers, nameIsAda, positions, updateUsers } from './statements';

const [position] = positions();

describe('Update', () => {
  it('has no peephole result when it sets nothing', () => {
    expect(updateUsers({}, nameIsAda).peephole(graphOfUsers(), position)).toBeUndefined();
  });
});
