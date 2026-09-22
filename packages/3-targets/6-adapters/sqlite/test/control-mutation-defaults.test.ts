import {
  isDataTypeLoweringEntry,
  loweringEntryKey,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createSqliteDefaultFunctionRegistry } from '../src/core/control-mutation-defaults';
import { createSqliteDataTypeEntries } from '../src/core/data-type-authoring';
import sqliteAdapterDescriptor from '../src/exports/control';

const stubSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
} as const;

const stubContext = {
  sourceId: 'test.prisma',
  modelName: 'TestModel',
  fieldName: 'testField',
} as const;

function makeCall(fn: string, args: Record<string, unknown> = {}) {
  return { fn, span: stubSpan, args };
}

describe('createSqliteDefaultFunctionRegistry — dbgenerated canonicalization', () => {
  const registry = createSqliteDefaultFunctionRegistry();
  const dbgenerated = registry.get('dbgenerated');
  if (!dbgenerated) throw new Error('expected `dbgenerated` registry entry');

  // Symmetric with `parseSqliteDefault` on the introspection side: SQLite's
  // synonyms for "current wall-clock time" all canonicalize to `now()` so
  // the verifier compares canonical-vs-canonical and a contract using
  // `dbgenerated("CURRENT_TIMESTAMP")` doesn't drift against the schema it
  // just produced.
  it('canonicalizes dbgenerated("CURRENT_TIMESTAMP") to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: 'CURRENT_TIMESTAMP' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('canonicalizes dbgenerated("current_timestamp") (lowercase) to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: 'current_timestamp' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('canonicalizes dbgenerated("datetime(\'now\')") to { function "now()" }', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: "datetime('now')" }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('preserves unknown expressions verbatim', () => {
    const result = dbgenerated.lower({
      call: makeCall('dbgenerated', { expression: 'random()' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'random()' } },
    });
  });
});

describe('createSqliteDataTypeEntries', () => {
  const entries = createSqliteDataTypeEntries();
  const loweringTag = (tag: string) => {
    const entry = entries[loweringEntryKey(tag)];
    if (entry === undefined || !isDataTypeLoweringEntry(entry)) {
      throw new Error(`the entries do not register "${tag}" as a lowering tag`);
    }
    return entry;
  };

  it('registers the json tag and the two lowering tags', () => {
    expect(
      Object.values(entries).flatMap((entry) =>
        entry.written.kind === 'tag' ? [entry.written.tag] : [],
      ),
    ).toEqual(['json', 'sql', 'sqlite.sql']);
  });

  it('registers json under its own data type, with no prefixed alias', () => {
    expect(entries['sqlite.json']).toBeUndefined();
    expect(loweringTag('sql').written.tag).toBe('sql');
  });

  it('lowers a body verbatim as a function default', () => {
    const result = loweringTag('sqlite.sql').lower({
      literal: { tag: 'sqlite.sql', body: "'{}'::jsonb", span: stubSpan },
      context: stubContext,
    });
    expect(result).toEqual({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: "'{}'::jsonb" } },
    });
  });

  it('is wired as the adapter descriptor authoring entries', () => {
    expect(Object.keys(sqliteAdapterDescriptor.authoring?.dataTypes ?? {})).toEqual(
      Object.keys(entries),
    );
  });

  it.each([
    ['sql', 'now'],
    ['sqlite.sql', 'autoincrement'],
  ])('refuses %s`%s()`, which is a Prisma default function', (tag, fn) => {
    const result = loweringTag(tag).lower({
      literal: { tag, body: `${fn}()`, span: stubSpan },
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'PSL_INVALID_DEFAULT_SQL',
        message: `Write @default(${fn}()) instead of ${tag}\`${fn}()\`; ${fn}() is a Prisma default function, not raw SQL.`,
      },
    });
  });

  it('lowers sql`gen_random_uuid()` verbatim', () => {
    const result = loweringTag('sql').lower({
      literal: { tag: 'sql', body: 'gen_random_uuid()', span: stubSpan },
      context: stubContext,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'storage',
        defaultValue: { kind: 'function', expression: 'gen_random_uuid()' },
      },
    });
  });
});
