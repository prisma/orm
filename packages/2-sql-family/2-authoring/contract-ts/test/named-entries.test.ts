import { describe, expect, it } from 'vitest';
import {
  namedEntriesFrom,
  namedEntriesIn,
  nameUnusableAsKeyReason,
  readNamedEntry,
  writeNamedEntry,
} from '../src/named-entries';

describe('nameUnusableAsKeyReason', () => {
  it('gives a reason for __proto__', () => {
    expect(nameUnusableAsKeyReason('__proto__')).toBe(
      'JavaScript reads as the prototype of an object rather than as a key',
    );
  });

  it.each(['User', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', ''])(
    'accepts "%s"',
    (name) => {
      expect(nameUnusableAsKeyReason(name)).toBeUndefined();
    },
  );
});

describe('readNamedEntry', () => {
  it('reads an own entry', () => {
    expect(readNamedEntry({ User: 1 }, 'User')).toBe(1);
  });

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'reads no inherited "%s"',
    (name) => {
      expect(readNamedEntry<unknown>({}, name)).toBeUndefined();
    },
  );

  it('reads an own constructor entry', () => {
    const entries: Record<string, number> = {};
    writeNamedEntry(entries, 'constructor', 7, 'a namespace');
    expect(readNamedEntry(entries, 'constructor')).toBe(7);
  });
});

describe('writeNamedEntry', () => {
  it.each(['constructor', 'toString', 'valueOf'])('stores "%s" as an own key', (name) => {
    const entries: Record<string, number> = {};
    writeNamedEntry(entries, name, 1, 'a table');
    expect(Object.hasOwn(entries, name)).toBe(true);
    expect(Object.keys(entries)).toEqual([name]);
    expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
  });

  it('refuses __proto__ and names what the name was', () => {
    const entries: Record<string, number> = {};
    expect(() => writeNamedEntry(entries, '__proto__', 1, 'the namespace of model "User"')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message:
          'The namespace of model "User" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.',
        meta: { name: '__proto__', nameOf: 'the namespace of model "User"' },
      }),
    );
    expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
  });
});

describe('namedEntriesIn', () => {
  it('stores an empty object under a new name and returns it', () => {
    const entries: Record<string, Record<string, number>> = {};
    const inner = namedEntriesIn(entries, 'constructor', 'a namespace');
    inner['User'] = 1;
    expect(entries).toEqual({ constructor: { User: 1 } });
    expect(namedEntriesIn(entries, 'constructor', 'a namespace')).toBe(inner);
  });

  it('refuses __proto__', () => {
    expect(() => namedEntriesIn({}, '__proto__', 'a namespace')).toThrow(
      expect.objectContaining({ code: 'CONTRACT.NAME_UNUSABLE_AS_KEY' }),
    );
  });
});

describe('namedEntriesFrom', () => {
  it('builds an object of own entries', () => {
    const entries = namedEntriesFrom(
      [
        ['constructor', 1],
        ['User', 2],
      ],
      'a model',
    );
    expect(Object.keys(entries)).toEqual(['constructor', 'User']);
    expect(readNamedEntry(entries, 'constructor')).toBe(1);
  });

  it('refuses __proto__', () => {
    expect(() => namedEntriesFrom([['__proto__', 1]], 'a model')).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message: expect.stringMatching(/^A model is named "__proto__"/),
      }),
    );
  });
});
