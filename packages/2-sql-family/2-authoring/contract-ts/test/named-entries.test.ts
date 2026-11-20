import { describe, expect, it } from 'vitest';
import {
  assertPlainNamedEntries,
  ensureNamedEntries,
  type NameSite,
  namedEntriesFrom,
  nameUnusableAsKeyReason,
  readNamedEntry,
  writeNamedEntry,
} from '../src/named-entries';

const tableSite: NameSite = { kind: 'table', namespaceId: 'public' };

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
    writeNamedEntry(entries, 'constructor', 7, tableSite);
    expect(readNamedEntry(entries, 'constructor')).toBe(7);
  });
});

describe('writeNamedEntry', () => {
  it.each(['constructor', 'toString', 'valueOf'])('stores "%s" as an own key', (name) => {
    const entries: Record<string, number> = {};
    writeNamedEntry(entries, name, 1, tableSite);
    expect(Object.hasOwn(entries, name)).toBe(true);
    expect(Object.keys(entries)).toEqual([name]);
    expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
  });

  it('refuses __proto__ with the kind and location of the name', () => {
    const entries: Record<string, number> = {};
    expect(() =>
      writeNamedEntry(entries, '__proto__', 1, {
        kind: 'namespace',
        modelName: 'User',
        tableName: undefined,
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message:
          'The namespace of model "User" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.',
        meta: { name: '__proto__', kind: 'namespace', modelName: 'User', reason: 'name-not-a-key' },
      }),
    );
    expect(Object.getPrototypeOf(entries)).toBe(Object.prototype);
  });

  it.each<readonly [NameSite, string, Record<string, string>]>([
    [
      { kind: 'namespace', modelName: undefined, tableName: 'users' },
      'The namespace of table "users"',
      { tableName: 'users' },
    ],
    [{ kind: 'namespace', modelName: undefined, tableName: undefined }, 'A namespace', {}],
    [
      { kind: 'table', namespaceId: 'public' },
      'A table in namespace "public"',
      { namespaceId: 'public' },
    ],
    [{ kind: 'column', tableName: 'users' }, 'A column of table "users"', { tableName: 'users' }],
    [
      { kind: 'model', namespaceId: 'public' },
      'A model in namespace "public"',
      { namespaceId: 'public' },
    ],
    [{ kind: 'model', namespaceId: undefined }, 'A model', {}],
    [{ kind: 'field', modelName: 'User' }, 'A field of model "User"', { modelName: 'User' }],
    [{ kind: 'field', modelName: undefined }, 'A field of a model', {}],
    [{ kind: 'relation', modelName: 'User' }, 'A relation of model "User"', { modelName: 'User' }],
    [
      { kind: 'enum', namespaceId: 'public' },
      'An enum in namespace "public"',
      { namespaceId: 'public' },
    ],
    [
      { kind: 'valueSet', namespaceId: 'public' },
      'A value set in namespace "public"',
      { namespaceId: 'public' },
    ],
    [{ kind: 'valueObject' }, 'A value object', {}],
    [
      { kind: 'valueObjectField', valueObjectName: 'Address' },
      'A field of value object "Address"',
      { valueObjectName: 'Address' },
    ],
    [{ kind: 'databaseType' }, 'A database type', {}],
    [
      { kind: 'entity', entityKind: 'gadget', namespaceId: 'public' },
      'A "gadget" entity in namespace "public"',
      { entityKind: 'gadget', namespaceId: 'public' },
    ],
  ])('words %o as its subject and meta', (site, subject, locating) => {
    expect(() => writeNamedEntry({}, '__proto__', 1, site)).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(
          new RegExp(`^${subject.replace(/"/g, '\\"')} is named "__proto__"`),
        ),
        meta: { name: '__proto__', kind: site.kind, ...locating, reason: 'name-not-a-key' },
      }),
    );
  });
});

describe('ensureNamedEntries', () => {
  it('stores an empty object under a new name and returns it', () => {
    const entries: Record<string, Record<string, number>> = {};
    const site: NameSite = { kind: 'namespace', modelName: undefined, tableName: undefined };
    const inner = ensureNamedEntries(entries, 'constructor', site);
    inner['User'] = 1;
    expect(entries).toEqual({ constructor: { User: 1 } });
    expect(ensureNamedEntries(entries, 'constructor', site)).toBe(inner);
  });

  it('refuses __proto__', () => {
    expect(() =>
      ensureNamedEntries({}, '__proto__', {
        kind: 'namespace',
        modelName: undefined,
        tableName: undefined,
      }),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.NAME_UNUSABLE_AS_KEY' }));
  });
});

describe('namedEntriesFrom', () => {
  it('builds an object of own entries', () => {
    const entries = namedEntriesFrom(
      [
        ['constructor', 1],
        ['User', 2],
      ],
      { kind: 'databaseType' },
    );
    expect(Object.keys(entries)).toEqual(['constructor', 'User']);
    expect(readNamedEntry(entries, 'constructor')).toBe(1);
  });

  it('refuses __proto__', () => {
    expect(() => namedEntriesFrom([['__proto__', 1]], { kind: 'databaseType' })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message: expect.stringMatching(/^A database type is named "__proto__"/),
      }),
    );
  });
});

describe('assertPlainNamedEntries', () => {
  it.each([
    ['a plain object', { constructor: 1, User: 2 }],
    ['an object with no prototype', Object.create(null)],
  ])('accepts %s', (_label, entries) => {
    expect(() => assertPlainNamedEntries(entries, { kind: 'databaseType' })).not.toThrow();
  });

  it('refuses an object literal whose __proto__ key replaced its prototype', () => {
    const entries = { id: 1, __proto__: { id: 2 } };
    expect(() => assertPlainNamedEntries(entries, { kind: 'field', modelName: 'User' })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message:
          'A field of model "User" is written under the key "__proto__" in an object literal. JavaScript takes that key as the prototype of the object and stores no entry under it. Choose another name.',
        meta: {
          name: '__proto__',
          kind: 'field',
          modelName: 'User',
          reason: 'object-literal-prototype',
        },
      }),
    );
  });
});
