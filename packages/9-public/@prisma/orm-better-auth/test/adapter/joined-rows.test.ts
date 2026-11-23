import { describe, expect, it } from 'vitest';
import { moveJoinedRows } from '../../src/joins';

describe('moveJoinedRows', () => {
  it('moves each relation to its join key', () => {
    expect(
      moveJoinedRows({ id: 'u1', sessions: [{ id: 's1' }] }, [
        { relation: 'sessions', key: 'session' },
      ]),
    ).toEqual({ id: 'u1', session: [{ id: 's1' }] });
  });

  it('keeps a relation whose name is already its join key', () => {
    expect(
      moveJoinedRows({ id: 'u1', session: [{ id: 's1' }] }, [
        { relation: 'session', key: 'session' },
      ]),
    ).toEqual({ id: 'u1', session: [{ id: 's1' }] });
  });

  it('keeps every value when one join key is another join’s relation name', () => {
    expect(
      moveJoinedRows({ id: 'u1', account: [{ id: 'a1' }], session: [{ id: 's1' }] }, [
        { relation: 'account', key: 'session' },
        { relation: 'session', key: 'account' },
      ]),
    ).toEqual({ id: 'u1', session: [{ id: 'a1' }], account: [{ id: 's1' }] });
  });
});
