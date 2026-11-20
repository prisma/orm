import { describe, expect, it } from 'vitest';
import {
  assertPlainNamedEntries,
  ensureNamedEntries,
  type NamedEntriesSite,
  type NameSite,
  namedEntriesFrom,
  namespaceNameSite,
  nameUnusableAsKeyReason,
  readNamedEntry,
  writeNamedEntry,
} from '../src/named-entries';

const tableSite: NameSite = { kind: 'table', namespaceId: 'public' };

function namespaceSite(fields: {
  readonly modelName?: string;
  readonly tableName?: string;
  readonly entityKind?: string;
  readonly entityName?: string;
}): NameSite {
  return {
    kind: 'namespace',
    modelName: fields.modelName,
    tableName: fields.tableName,
    entityKind: fields.entityKind,
    entityName: fields.entityName,
  };
}

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
      writeNamedEntry(entries, '__proto__', 1, namespaceSite({ modelName: 'User' })),
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
      namespaceSite({ tableName: 'users' }),
      'The namespace of table "users"',
      { kind: 'namespace', tableName: 'users' },
    ],
    [
      namespaceSite({ entityKind: 'gadget', entityName: 'g1' }),
      'The namespace of "gadget" entity "g1"',
      { kind: 'namespace', entityKind: 'gadget', entityName: 'g1' },
    ],
    [namespaceNameSite, 'A namespace', { kind: 'namespace' }],
    [tableSite, 'A table in namespace "public"', { kind: 'table', namespaceId: 'public' }],
    [
      { kind: 'column', tableName: 'users' },
      'A column of table "users"',
      { kind: 'column', tableName: 'users' },
    ],
    [
      { kind: 'model', namespaceId: 'public' },
      'A model in namespace "public"',
      { kind: 'model', namespaceId: 'public' },
    ],
    [{ kind: 'model', namespaceId: undefined }, 'A model', { kind: 'model' }],
    [
      { kind: 'field', modelName: 'User' },
      'A field of model "User"',
      { kind: 'field', modelName: 'User' },
    ],
    [{ kind: 'field', modelName: undefined }, 'A field of a model', { kind: 'field' }],
    [
      { kind: 'relation', modelName: 'User' },
      'A relation of model "User"',
      { kind: 'relation', modelName: 'User' },
    ],
    [{ kind: 'relation', modelName: undefined }, 'A relation of a model', { kind: 'relation' }],
    [
      { kind: 'enum', namespaceId: 'public' },
      'An enum in namespace "public"',
      { kind: 'enum', namespaceId: 'public' },
    ],
    [
      { kind: 'valueSet', namespaceId: 'public' },
      'A value set in namespace "public"',
      { kind: 'valueSet', namespaceId: 'public' },
    ],
    [{ kind: 'valueObject' }, 'A value object', { kind: 'valueObject' }],
    [
      { kind: 'valueObjectField', valueObjectName: 'Address' },
      'A field of value object "Address"',
      { kind: 'valueObjectField', valueObjectName: 'Address' },
    ],
    [{ kind: 'databaseType' }, 'A database type', { kind: 'databaseType' }],
    [
      { kind: 'entity', entityKind: 'gadget', namespaceId: 'public' },
      'A "gadget" entity in namespace "public"',
      { kind: 'gadget', namespaceId: 'public' },
    ],
  ])('words %o as its subject and meta', (site, subject, meta) => {
    expect(() => writeNamedEntry({}, '__proto__', 1, site)).toThrow(
      expect.objectContaining({
        message: `${subject} is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.`,
        meta: { name: '__proto__', ...meta, reason: 'name-not-a-key' },
      }),
    );
  });
});

describe('ensureNamedEntries', () => {
  it('stores an empty object under a new name and returns it', () => {
    const entries: Record<string, Record<string, number>> = {};
    const inner = ensureNamedEntries(entries, 'constructor', namespaceNameSite);
    inner['User'] = 1;
    expect(entries).toEqual({ constructor: { User: 1 } });
    expect(ensureNamedEntries(entries, 'constructor', namespaceNameSite)).toBe(inner);
  });

  it('refuses __proto__', () => {
    expect(() => ensureNamedEntries({}, '__proto__', namespaceNameSite)).toThrow(
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
  class UserFields {
    id = 1;
  }

  it.each([
    ['a plain object', { constructor: 1, User: 2 }],
    ['an object with no prototype', Object.create(null)],
  ])('accepts %s', (_label, entries) => {
    expect(() => assertPlainNamedEntries(entries, { kind: 'databaseType' })).not.toThrow();
  });

  it.each([
    ['an object literal with a __proto__ key', { id: 1, __proto__: { id: 2 } }],
    ['a class instance', new UserFields()],
    ['an object made from another object', Object.create({ id: 2 })],
  ])('refuses %s', (_label, entries) => {
    expect(() => assertPlainNamedEntries(entries, { kind: 'field', modelName: 'User' })).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.NAME_UNUSABLE_AS_KEY',
        message:
          'The fields of model "User" are not a plain object: their prototype has been replaced. A key written as "__proto__" in an object literal does this. Use a plain object, and choose another name for a "__proto__" key.',
        meta: { kind: 'field', modelName: 'User', reason: 'prototype-replaced' },
      }),
    );
  });

  it.each<readonly [NamedEntriesSite, string]>([
    [{ kind: 'field', modelName: undefined }, 'The fields of a model'],
    [{ kind: 'relation', modelName: 'User' }, 'The relations of model "User"'],
    [{ kind: 'relation', modelName: undefined }, 'The relations of a model'],
    [{ kind: 'model' }, 'The models of the contract'],
    [{ kind: 'enum' }, 'The enums of the contract'],
    [{ kind: 'databaseType' }, 'The database types of the contract'],
    [{ kind: 'extensionPack' }, 'The extensions of the contract'],
  ])('words %o as its subject', (site, subject) => {
    expect(() => assertPlainNamedEntries(Object.create({}), site)).toThrow(
      expect.objectContaining({
        message: expect.stringMatching(new RegExp(`^${subject} are not a plain object`)),
      }),
    );
  });
});
