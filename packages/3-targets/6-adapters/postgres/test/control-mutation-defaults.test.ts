import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  collectScalarTypeConstructors,
  instantiateAuthoringTypeConstructor,
  validateAuthoringHelperArguments,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-lookup';
import {
  createPostgresDefaultFunctionRegistry,
  createPostgresMutationDefaultGeneratorDescriptors,
  postgresAuthoringTypes,
  postgresNativeAuthoringTypes,
  postgresScalarAuthoringTypes,
} from '../src/core/control-mutation-defaults';
import postgresAdapterDescriptor from '../src/exports/control';
import runtimeAdapterDescriptor from '../src/exports/runtime';

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

describe('createPostgresDefaultFunctionRegistry', () => {
  const registry = createPostgresDefaultFunctionRegistry();

  it('contains all builtin default function entries', () => {
    expect([...registry.keys()]).toEqual(
      expect.arrayContaining([
        'autoincrement',
        'now',
        'uuid',
        'cuid',
        'ulid',
        'nanoid',
        'dbgenerated',
      ]),
    );
  });

  it('lowers autoincrement() to a storage default', () => {
    const handler = registry.get('autoincrement')!;
    const result = handler.lower({ call: makeCall('autoincrement'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'autoincrement()' } },
    });
  });

  it('lowers now() to a storage default', () => {
    const handler = registry.get('now')!;
    const result = handler.lower({ call: makeCall('now'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('lowers uuid() to uuidv4 execution generator', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({ call: makeCall('uuid'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv4' } },
    });
  });

  it('lowers uuid(7) to uuidv7 execution generator', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', { version: 7 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv7' } },
    });
  });

  it('lowers cuid(2) to cuid2 execution generator', () => {
    const handler = registry.get('cuid')!;
    const result = handler.lower({
      call: makeCall('cuid', { version: 2 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'cuid2' } },
    });
  });

  it('lowers ulid() to execution generator', () => {
    const handler = registry.get('ulid')!;
    const result = handler.lower({ call: makeCall('ulid'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'ulid' } },
    });
  });

  it('lowers nanoid() to execution generator', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({ call: makeCall('nanoid'), context: stubContext });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'nanoid' } },
    });
  });

  it('lowers nanoid(16) with size param', () => {
    const handler = registry.get('nanoid')!;
    const result = handler.lower({
      call: makeCall('nanoid', { size: 16 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'execution',
        generated: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
      },
    });
  });

  it('lowers dbgenerated("expr") to storage default', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', { expression: 'gen_random_uuid()' }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: {
        kind: 'storage',
        defaultValue: { kind: 'function', expression: 'gen_random_uuid()' },
      },
    });
  });

  it('rejects dbgenerated with empty string', () => {
    const handler = registry.get('dbgenerated')!;
    const result = handler.lower({
      call: makeCall('dbgenerated', { expression: '' }),
      context: stubContext,
    });
    expect(result).toMatchObject({ ok: false });
  });

  describe('dbgenerated keeps the raw expression verbatim, never resolving it', () => {
    // `lowerDbgenerated` must not resolve the raw SQL text — a literal-shaped
    // expression (e.g. `'{}'::jsonb`) is normalized once, at SchemaIR
    // construction on the expected side (`contractToSchemaIR`'s
    // target-supplied `resolveDefault` hook), not here. Rewriting here would
    // also discard the user's original expression for cases like
    // `nextval('my_seq')`, whose DDL must keep referencing the named sequence.
    const handler = createPostgresDefaultFunctionRegistry().get('dbgenerated')!;

    function lower(expression: string) {
      return handler.lower({
        call: makeCall('dbgenerated', { expression }),
        context: stubContext,
      });
    }

    it('keeps a jsonb literal expression as a function, unresolved', () => {
      const expression = "'{}'::jsonb";
      expect(lower(expression)).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'function', expression } },
      });
    });

    it('keeps a text[] literal expression as a function, unresolved', () => {
      const expression = "'{}'::text[]";
      expect(lower(expression)).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'function', expression } },
      });
    });

    it('keeps gen_random_uuid() a function', () => {
      const expression = 'gen_random_uuid()';
      expect(lower(expression)).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'function', expression } },
      });
    });

    it("keeps nextval(...) a function, unchanged (doesn't adopt the normalizer's autoincrement() rewrite)", () => {
      const expression = "nextval('seq'::regclass)";
      expect(lower(expression)).toMatchObject({
        ok: true,
        value: { kind: 'storage', defaultValue: { kind: 'function', expression } },
      });
    });
  });

  it('lowers uuid(4) explicitly to uuidv4 execution generator', () => {
    const handler = registry.get('uuid')!;
    const result = handler.lower({
      call: makeCall('uuid', { version: 4 }),
      context: stubContext,
    });
    expect(result).toMatchObject({
      ok: true,
      value: { kind: 'execution', generated: { kind: 'generator', id: 'uuidv4' } },
    });
  });
});

describe('createPostgresMutationDefaultGeneratorDescriptors', () => {
  const descriptors = createPostgresMutationDefaultGeneratorDescriptors();

  it('returns descriptors for all builtin generators', () => {
    const ids = descriptors.map((d) => d.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'ulid',
        'nanoid',
        'uuidv7',
        'uuidv4',
        'cuid2',
        'ksuid',
        'timestampNow',
      ]),
    );
  });

  it('omits applicableCodecIds for timestampNow (preset-only generator)', () => {
    const descriptor = descriptors.find((d) => d.id === 'timestampNow')!;

    // timestampNow is reachable only via temporal.{createdAt,updatedAt}()
    // preset descriptors that co-register the codec — the @default(...)
    // lowering compatibility check has no role to play here, so the
    // field is intentionally absent. F04 / spec NFR3 (corrected).
    expect(descriptor.applicableCodecIds).toBeUndefined();
  });

  it('keeps pg/text@1 applicable for every builtin generator so String fields never false-diagnose', () => {
    // The type position is the only storage decider (TML-2986); a generator
    // default on a `String` column must validate against pg/text@1.
    for (const id of ['ulid', 'nanoid', 'uuidv7', 'uuidv4', 'cuid2', 'ksuid'] as const) {
      const descriptor = descriptors.find((d) => d.id === id)!;
      expect(descriptor.applicableCodecIds).toContain('pg/text@1');
    }
  });
});

describe('postgres runtime mutation default generators', () => {
  it('provides timestampNow as a Date generator', () => {
    const generator = (runtimeAdapterDescriptor.mutationDefaultGenerators?.() ?? []).find(
      (entry) => entry.id === 'timestampNow',
    );

    expect(generator?.generate()).toBeInstanceOf(Date);
  });
});

describe('postgresScalarAuthoringTypes', () => {
  const codecLookup = createPostgresBuiltinCodecLookup();
  const namespace: AuthoringTypeNamespace = postgresScalarAuthoringTypes;

  // The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned
  // name → codecId pairs below carry the retired map's claims forward.
  const expectedScalars = [
    ['String', 'pg/text@1'],
    ['Boolean', 'pg/bool@1'],
    ['Int', 'pg/int4@1'],
    ['BigInt', 'pg/int8@1'],
    ['Float', 'pg/float8@1'],
    ['Decimal', 'pg/numeric@1'],
    ['DateTime', 'pg/timestamptz-temporal@1'],
    ['Json', 'pg/json@1'],
    ['Jsonb', 'pg/jsonb@1'],
    ['Bytes', 'pg/bytea@1'],
  ] as const;

  it('pins every base scalar as a zero-arg type constructor with manifest-derived nativeType', () => {
    expect(Object.keys(namespace).sort()).toEqual(expectedScalars.map(([name]) => name).sort());
    for (const [name, codecId] of expectedScalars) {
      expect(namespace[name]).toEqual({
        kind: 'typeConstructor',
        output: { codecId, nativeType: codecLookup.targetTypesFor(codecId)?.[0] },
      });
    }
  });

  it('is wired into the adapter descriptor authoring type contribution', () => {
    expect(postgresAdapterDescriptor.authoring?.type).toBe(postgresAuthoringTypes);
    expect(postgresAuthoringTypes).toEqual({
      ...postgresScalarAuthoringTypes,
      ...postgresNativeAuthoringTypes,
    });
  });

  it('declares Jsonb as the value-object storage type', () => {
    expect(postgresAdapterDescriptor.authoring?.valueObjectStorageType).toBe('Jsonb');
  });
});

describe('postgresNativeAuthoringTypes', () => {
  it('contributes all native types as bare-eligible top-level constructors', () => {
    const derived = collectScalarTypeConstructors(postgresNativeAuthoringTypes);

    expect(Object.fromEntries(derived)).toEqual({
      VarChar: { codecId: 'sql/varchar@1', nativeType: 'character varying' },
      Char: { codecId: 'sql/char@1', nativeType: 'character' },
      Numeric: { codecId: 'pg/numeric@1', nativeType: 'numeric' },
      Timestamp: { codecId: 'pg/timestamp-temporal@1', nativeType: 'timestamp' },
      Timestamptz: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz' },
      Time: { codecId: 'pg/time-temporal@1', nativeType: 'time' },
      Timetz: { codecId: 'pg/timetz@1', nativeType: 'timetz' },
      Uuid: { codecId: 'pg/uuid@1', nativeType: 'uuid' },
      Inet: { codecId: 'pg/inet@1', nativeType: 'inet' },
      SmallInt: { codecId: 'pg/int2@1', nativeType: 'int2' },
      Real: { codecId: 'pg/float4@1', nativeType: 'float4' },
      Date: { codecId: 'pg/date-temporal@1', nativeType: 'date' },
      DateString: { codecId: 'pg/date-string@1', nativeType: 'date' },
      TimestampString: { codecId: 'pg/timestamp-string@1', nativeType: 'timestamp' },
      TimestamptzString: { codecId: 'pg/timestamptz-string@1', nativeType: 'timestamptz' },
      TimeString: { codecId: 'pg/time-string@1', nativeType: 'time' },
    });
  });

  it('materializes typeParams keys only for arguments that are given', () => {
    expect(
      instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.VarChar, [191]),
    ).toEqual({
      codecId: 'sql/varchar@1',
      nativeType: 'character varying',
      typeParams: { length: 191 },
    });
    expect(instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.Numeric, [10])).toEqual(
      {
        codecId: 'pg/numeric@1',
        nativeType: 'numeric',
        typeParams: { precision: 10 },
      },
    );
    expect(
      instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.Numeric, [10, 2]),
    ).toEqual({
      codecId: 'pg/numeric@1',
      nativeType: 'numeric',
      typeParams: { precision: 10, scale: 2 },
    });
    expect(instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.Timetz, [2])).toEqual({
      codecId: 'pg/timetz@1',
      nativeType: 'timetz',
      typeParams: { precision: 2 },
    });
  });

  it('rejects out-of-range arguments via the declarative minimums', () => {
    expect(() =>
      validateAuthoringHelperArguments('VarChar', postgresNativeAuthoringTypes.VarChar.args, [0]),
    ).toThrow('must be >= 1');
    expect(() =>
      validateAuthoringHelperArguments('Numeric', postgresNativeAuthoringTypes.Numeric.args, [0]),
    ).toThrow('must be >= 1');
    expect(() =>
      validateAuthoringHelperArguments(
        'Timestamp',
        postgresNativeAuthoringTypes.Timestamp.args,
        [-1],
      ),
    ).toThrow('must be >= 0');
  });
});
