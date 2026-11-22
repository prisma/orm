import { describe, expect, it } from 'vitest';
import { PostgresSchema } from '../src/core/postgres-schema';

describe('PostgresSchema native enum named __proto__', () => {
  it('keys the native enum by its type name as an own key', () => {
    const schema = new PostgresSchema({
      id: 'auth',
      entries: {
        table: {},
        native_enum: {
          Weird: { kind: 'postgres-enum', typeName: '__proto__', members: ['a'] },
        },
      },
    });
    const slot = schema.entries.native_enum;
    expect({
      prototypeIsPlain: Object.getPrototypeOf(slot) === Object.prototype,
      keys: Object.keys(slot ?? {}),
    }).toEqual({ prototypeIsPlain: true, keys: ['__proto__'] });
  });
});
