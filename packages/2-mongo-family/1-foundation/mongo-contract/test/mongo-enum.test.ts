import { describe, expect, it } from 'vitest';
import { mongoValueSetsOf } from '../src/mongo-enum';

describe('mongoValueSetsOf', () => {
  it("lists each enum's stored members as its value set", () => {
    expect(
      mongoValueSetsOf({
        Role: {
          codecId: 'test/upper@1',
          members: [
            { name: 'Admin', value: 'ADMIN' },
            { name: 'User', value: 'USER' },
          ],
        },
      }),
    ).toEqual({ Role: { kind: 'valueSet', values: ['ADMIN', 'USER'] } });
  });
});
