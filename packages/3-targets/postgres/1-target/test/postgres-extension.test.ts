import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { extensionEntityKind } from '../src/core/entity-kinds';
import { PostgresExtension } from '../src/core/postgres-extension';
import { PostgresNativeEnum } from '../src/core/postgres-native-enum';
import { PostgresExtensionSchema } from '../src/core/postgres-validators';

describe('PostgresExtension', () => {
  it('serializes its name and kind, and omits control when not given', () => {
    const extension = new PostgresExtension({ name: 'pg_trgm' });
    expect(JSON.parse(JSON.stringify(extension))).toEqual({ kind: 'extension', name: 'pg_trgm' });
  });

  it('serializes control when given', () => {
    const extension = new PostgresExtension({ name: 'vector', control: 'external' });
    expect(JSON.parse(JSON.stringify(extension))).toEqual({
      kind: 'extension',
      name: 'vector',
      control: 'external',
    });
  });

  it('is frozen', () => {
    const extension = new PostgresExtension({ name: 'pg_trgm' });
    expect(Object.isFrozen(extension)).toBe(true);
    expect(() => {
      (extension as { name: string }).name = 'other';
    }).toThrow();
  });

  it('is recognised by its guard, and nothing else is', () => {
    expect(PostgresExtension.is(new PostgresExtension({ name: 'pg_trgm' }))).toBe(true);
    expect(
      PostgresExtension.is(new PostgresNativeEnum({ typeName: 'pg_trgm', members: ['a'] })),
    ).toBe(false);
    expect(PostgresExtension.is(undefined)).toBe(false);
  });
});

describe('PostgresExtensionSchema', () => {
  it('accepts a name with an optional control policy', () => {
    expect(PostgresExtensionSchema({ kind: 'extension', name: 'pg_trgm' })).toEqual({
      kind: 'extension',
      name: 'pg_trgm',
    });
    expect(
      PostgresExtensionSchema({ kind: 'extension', name: 'vector', control: 'external' }),
    ).toEqual({ kind: 'extension', name: 'vector', control: 'external' });
  });

  it('refuses an unknown control policy, a missing name and an unknown field', () => {
    expect(
      PostgresExtensionSchema({ kind: 'extension', name: 'pg_trgm', control: 'owned' }),
    ).toBeInstanceOf(type.errors);
    expect(PostgresExtensionSchema({ kind: 'extension' })).toBeInstanceOf(type.errors);
    expect(
      PostgresExtensionSchema({ kind: 'extension', name: 'pg_trgm', version: '1.6' }),
    ).toBeInstanceOf(type.errors);
  });
});

describe('extensionEntityKind', () => {
  it('files extensions under the extension entries key and builds the class', () => {
    expect(extensionEntityKind.kind).toBe('extension');
    expect(extensionEntityKind.construct({ name: 'pg_trgm' })).toEqual(
      new PostgresExtension({ name: 'pg_trgm' }),
    );
  });
});
