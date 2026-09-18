import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createSqliteBuiltinCodecLookup } from '../src/core/codec-lookup';
import {
  createSqliteDefaultFunctionRegistry,
  createSqliteDefaultLiteralTagRegistry,
  createSqliteMutationDefaultGeneratorDescriptors,
  sqliteScalarAuthoringTypes,
} from '../src/core/control-mutation-defaults';
import runtimeAdapterDescriptor from '../src/core/runtime-adapter';
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

describe('createSqliteDefaultLiteralTagRegistry', () => {
  const tagRegistry = createSqliteDefaultLiteralTagRegistry();

  it('registers sql and sqlite.sql, in that order', () => {
    expect([...tagRegistry.keys()]).toEqual(['sql', 'sqlite.sql']);
    expect(tagRegistry.get('sqlite.sql')?.usage).toBe('sqlite.sql`...`');
  });

  it('lowers sql`CURRENT_TIMESTAMP` verbatim, with no rewrite to now()', () => {
    const result = tagRegistry.get('sql')!.lower({
      literal: { tag: 'sql', body: 'CURRENT_TIMESTAMP', span: stubSpan },
      context: stubContext,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        kind: 'storage',
        defaultValue: { kind: 'function', expression: 'CURRENT_TIMESTAMP' },
      },
    });
  });

  it('is wired as the adapter descriptor tag registry', () => {
    const registries = sqliteAdapterDescriptor.controlMutationDefaults;
    if (registries === undefined)
      throw new Error('the adapter descriptor declares mutation defaults');
    expect([...registries.defaultLiteralTagRegistry.keys()]).toEqual(['sql', 'sqlite.sql']);
  });

  it.each([
    ['sql', 'now'],
    ['sqlite.sql', 'autoincrement'],
  ])('refuses %s`%s()`, which is a Prisma default function', (tag, name) => {
    const result = tagRegistry.get(tag)!.lower({
      literal: { tag, body: `${name}()`, span: stubSpan },
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: false,
      diagnostic: {
        code: 'PSL_INVALID_DEFAULT_SQL',
        message: `Write @default(${name}()) instead of ${tag}\`${name}()\`; ${name}() is a Prisma default function, not raw SQL.`,
      },
    });
  });

  it("accepts sql`now() + interval '1 day'`", () => {
    const result = tagRegistry.get('sql')!.lower({
      literal: { tag: 'sql', body: "now() + interval '1 day'", span: stubSpan },
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: true });
  });
});

describe('createSqliteMutationDefaultGeneratorDescriptors', () => {
  const descriptors = createSqliteMutationDefaultGeneratorDescriptors();

  it('includes timestampNow without applicableCodecIds (preset-only generator)', () => {
    const descriptor = descriptors.find((d) => d.id === 'timestampNow');

    // timestampNow ships only through the temporal.{createdAt,updatedAt}()
    // preset path; the codec is co-registered there, so the
    // @default(...) compatibility list is intentionally absent.
    expect(descriptor).toBeDefined();
    expect(descriptor?.applicableCodecIds).toBeUndefined();
  });
});

describe('sqlite runtime mutation default generators', () => {
  it('provides timestampNow as a Date generator', () => {
    const generator = (runtimeAdapterDescriptor.mutationDefaultGenerators?.() ?? []).find(
      (entry) => entry.id === 'timestampNow',
    );

    expect(generator?.generate()).toBeInstanceOf(Date);
  });
});

describe('sqliteScalarAuthoringTypes', () => {
  const codecLookup = createSqliteBuiltinCodecLookup();
  const namespace: AuthoringTypeNamespace = sqliteScalarAuthoringTypes;

  // The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned
  // name → codecId pairs below carry the retired map's claims forward.
  const expectedScalars = [
    ['String', 'sqlite/text@1'],
    ['Int', 'sqlite/integer@1'],
    ['BigInt', 'sqlite/bigint@1'],
    ['Float', 'sqlite/real@1'],
    ['Decimal', 'sqlite/text@1'],
    ['DateTime', 'sqlite/datetime@1'],
    ['Json', 'sqlite/json@1'],
    ['Bytes', 'sqlite/blob@1'],
  ] as const;

  it('pins every base scalar as a zero-arg type constructor with manifest-derived nativeType', () => {
    expect(Object.keys(namespace).sort()).toEqual(expectedScalars.map(([name]) => name).sort());
    for (const [name, codecId] of expectedScalars) {
      expect(namespace[name]).toEqual({
        kind: 'typeConstructor',
        documentation: expect.stringMatching(/\S/),
        output: { codecId, nativeType: codecLookup.targetTypesFor(codecId)?.[0] },
      });
    }
  });

  it('is wired as the adapter descriptor authoring type contribution', () => {
    expect(sqliteAdapterDescriptor.authoring?.type).toBe(sqliteScalarAuthoringTypes);
  });

  it('declares Json as the value-object storage type', () => {
    expect(sqliteAdapterDescriptor.authoring?.valueObjectStorageType).toBe('Json');
  });
});
