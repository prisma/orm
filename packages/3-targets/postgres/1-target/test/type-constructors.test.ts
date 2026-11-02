import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  collectScalarTypeConstructors,
  findAuthoringTypeConstructorCall,
  instantiateAuthoringTypeAlias,
  instantiateAuthoringTypeCall,
  instantiateAuthoringTypeConstructor,
  validateAuthoringTypeParams,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { unquotedSqlBaseNameOfCodec } from '@internal/sql-contract/data-type';
import { generatedIdColumnAliases } from '@internal/sql-contract/generated-id-column-aliases';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringTypes } from '../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { postgresDataTypes } from '../src/core/data-types';
import {
  postgresExplicitScalarTypes,
  postgresNativeAuthoringTypes,
  postgresScalarAndNativeTypeConstructors,
  postgresScalarAuthoringTypes,
} from '../src/core/type-constructors';
import postgresTargetPack from '../src/exports/pack';

describe('the constructor contract print writes for a Temporal column', () => {
  it.each([
    [{ codecId: 'pg/timestamptz-temporal@1' }, ['TimestamptzTemporal'], []],
    [{ codecId: 'pg/date-temporal@1' }, ['DateTemporal'], []],
    [{ codecId: 'pg/time-temporal@1', typeParams: { precision: 0 } }, ['TimeTemporal'], [0]],
  ])(
    'is the explicit type for %o, not a name the convenience types will take',
    (output, path, args) => {
      expect(findAuthoringTypeConstructorCall(postgresTargetPack.authoring.type, output)).toEqual({
        path,
        args,
      });
    },
  );
});

describe('the type constructors the target contributes', () => {
  it('are the scalar, native and target-only ones, so PSL and type.* see the same names', () => {
    expect(postgresTargetPack.authoring.type).toEqual({
      ...postgresScalarAndNativeTypeConstructors,
      ...postgresAuthoringTypes,
    });
    expect(Object.keys(postgresAuthoringTypes)).toEqual([
      'sql',
      'UuidString',
      'Ulid',
      'Nanoid',
      'Cuid2',
      'Ksuid',
      'pg',
      'temporal',
    ]);
  });

  it('contributes the family’s sql.String, whose length is a value of pg/int4', () => {
    expect(postgresAuthoringTypes.sql.String.args).toEqual([
      { kind: 'value', dataType: 'pg/int4', name: 'length' },
    ]);
  });

  it('contributes the identifier type aliases as top-level names, beside Char and Uuid', () => {
    const { UuidString, Ulid, Nanoid, Cuid2, Ksuid } = postgresAuthoringTypes;
    expect({ UuidString, Ulid, Nanoid, Cuid2, Ksuid }).toEqual(generatedIdColumnAliases);
  });

  it.each([
    ['UuidString', 36],
    ['Ulid', 26],
    ['Nanoid', 21],
    ['Cuid2', 24],
    ['Ksuid', 27],
  ] as const)('stores %s as Char(%i) stores it, with params its codec accepts', (name, length) => {
    const alias = instantiateAuthoringTypeAlias(postgresAuthoringTypes[name]);
    expect(alias).toEqual({
      type: instantiateAuthoringTypeConstructor(postgresExplicitScalarTypes.Char, [length]),
    });
    const paramsSchema = createPostgresBuiltinCodecLookup().descriptorFor?.(
      alias.type.codecId,
    )?.paramsSchema;
    expect(paramsSchema).toBeDefined();
    expect(() =>
      validateAuthoringTypeParams(
        name,
        postgresAuthoringTypes[name].output.type,
        alias.type.typeParams,
        paramsSchema,
      ),
    ).not.toThrow();
  });

  it.each([
    ...Object.entries(postgresAuthoringTypes).filter(
      ([name]) => name !== 'pg' && name !== 'sql' && name !== 'temporal',
    ),
    ...Object.entries(postgresAuthoringTypes.temporal),
  ])('documents %s', (_name, descriptor) => {
    expect(descriptor).toHaveProperty('documentation', expect.stringMatching(/\S.+/));
  });

  it('document what each temporal type alias sets and the value it gives', () => {
    expect(
      Object.fromEntries(
        Object.entries(postgresAuthoringTypes.temporal).map(([name, { documentation }]) => [
          name,
          documentation,
        ]),
      ),
    ).toEqual({
      CreatedAt:
        'A timestamp the client sets to now when a row is created. Its value is a JavaScript Date.',
      UpdatedAt:
        'A timestamp the client sets to now when a row is created and every time it is updated. Its value is a JavaScript Date.',
    });
  });

  it('contribute the temporal type aliases on the type bare DateTime becomes', () => {
    const dateTime = instantiateAuthoringTypeCall(
      postgresScalarAndNativeTypeConstructors,
      'DateTime',
      [],
    );
    expect(
      Object.fromEntries(
        Object.entries(postgresAuthoringTypes.temporal).map(([name, { kind, output }]) => [
          name,
          { kind, ...output },
        ]),
      ),
    ).toEqual({
      CreatedAt: { kind: 'typeAlias', type: dateTime, onCreate: now },
      UpdatedAt: { kind: 'typeAlias', type: dateTime, onCreate: now, onUpdate: now },
    });
    expect(dateTime).toEqual({ codecId: 'pg/timestamptz-date@1', typeParams: { precision: 3 } });
  });
});

const now = { name: 'now', args: {} };

const everyPostgresConstructor = {
  ...postgresAuthoringTypes,
  ...postgresScalarAndNativeTypeConstructors,
};

/** The constructor `contract infer` prints for each data type that has one. */
const INFERRED = [
  'Text',
  'Bool',
  'Int4',
  'Int8BigInt',
  'Float8',
  'NumericString',
  'Json',
  'Jsonb',
  'Bytea',
  'Int2',
  'Float4',
  'Char',
  'Varchar',
  'Uuid',
  'Inet',
  'DateString',
  'TimeString',
  'Timetz',
  'TimestampJsDate',
  'TimestamptzJsDate',
  'Bit',
  'VarBit',
  'Xml',
  'Oid',
  'Money',
  'IntervalString',
  'pg.enum',
];

function constructorPaths(namespace: object, prefix: readonly string[] = []): string[] {
  return Object.entries(namespace).flatMap(([name, value]) =>
    value !== null && typeof value === 'object' && 'kind' in value
      ? [[...prefix, name].join('.')]
      : constructorPaths(value, [...prefix, name]),
  );
}

function constructorAt(path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (current, segment) =>
        current !== null && typeof current === 'object'
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      everyPostgresConstructor,
    );
}

function markedInferred(): string[] {
  return constructorPaths(everyPostgresConstructor).filter((path) => {
    const descriptor = constructorAt(path);
    return descriptor !== null && typeof descriptor === 'object' && 'inferred' in descriptor;
  });
}

describe('the constructors contract infer prints', () => {
  it('are marked inferred, and no other constructor is', () => {
    expect(markedInferred().sort()).toEqual([...INFERRED].sort());
  });

  it.each(INFERRED)('%s is marked with true', (path) => {
    expect(constructorAt(path)).toHaveProperty('inferred', true);
  });
});

describe('postgresExplicitScalarTypes', () => {
  const codecLookup = createPostgresBuiltinCodecLookup();
  const namespace: AuthoringTypeNamespace = postgresExplicitScalarTypes;

  const expected = [
    ['Int2', 'pg/int2@1', 'int2'],
    ['Int4', 'pg/int4@1', 'int4'],
    ['Int8BigInt', 'pg/int8@1', 'int8'],
    ['Int8Number', 'pg/int8number@1', 'int8'],
    ['NumericString', 'pg/numeric@1', 'numeric'],
    ['NumericBigInt', 'pg/unboundedint@1', 'numeric'],
    ['Float4', 'pg/float4@1', 'float4'],
    ['Float8', 'pg/float8@1', 'float8'],
    ['Text', 'pg/text@1', 'text'],
    ['Varchar', 'sql/varchar@1', 'character varying'],
    ['Char', 'sql/char@1', 'character'],
    ['Bool', 'pg/bool@1', 'bool'],
    ['Bytea', 'pg/bytea@1', 'bytea'],
  ] as const;

  it('names each explicit type after its database type, and its codec', () => {
    expect(
      Object.fromEntries(
        Object.entries(namespace).map(([name, descriptor]) => [
          name,
          descriptor.kind === 'typeConstructor' ? descriptor.output.codecId : descriptor.kind,
        ]),
      ),
    ).toEqual(Object.fromEntries(expected.map(([name, codecId]) => [name, codecId])));
  });

  it.each(expected)('%s stores %s as %s', (_name, codecId, typeName) => {
    expect(
      unquotedSqlBaseNameOfCodec(codecId, undefined, {
        codecLookup,
        dataTypeLookup: createDataTypeLookup(postgresDataTypes),
      }),
    ).toBe(typeName);
  });
});

describe('postgresScalarAuthoringTypes', () => {
  it('holds the JSON types, which keep their names', () => {
    expect(postgresScalarAuthoringTypes).toEqual({
      Json: {
        kind: 'typeConstructor',
        inferred: true,
        documentation: 'A JSON value stored as PostgreSQL json.',
        output: { codecId: 'pg/json@1' },
      },
      Jsonb: {
        kind: 'typeConstructor',
        inferred: true,
        documentation: 'A JSON value stored in PostgreSQL binary jsonb format.',
        output: { codecId: 'pg/jsonb@1' },
      },
    });
  });
});

const explicitTypes = { ...postgresExplicitScalarTypes, ...postgresNativeAuthoringTypes };

describe('postgresNativeAuthoringTypes', () => {
  it('contributes all native types as bare-eligible top-level constructors', () => {
    const derived = collectScalarTypeConstructors(postgresNativeAuthoringTypes);

    expect(Object.fromEntries(derived)).toEqual({
      TimestampTemporal: { codecId: 'pg/timestamp-temporal@1' },
      TimestamptzTemporal: { codecId: 'pg/timestamptz-temporal@1' },
      TimeTemporal: { codecId: 'pg/time-temporal@1' },
      Timetz: { codecId: 'pg/timetz@1' },
      Uuid: { codecId: 'pg/uuid@1' },
      Inet: { codecId: 'pg/inet@1' },
      DateTemporal: { codecId: 'pg/date-temporal@1' },
      DateString: { codecId: 'pg/date-string@1' },
      TimestampString: { codecId: 'pg/timestamp-string@1' },
      TimestamptzString: { codecId: 'pg/timestamptz-string@1' },
      TimestamptzJsDate: { codecId: 'pg/timestamptz-date@1' },
      TimeString: { codecId: 'pg/time-string@1' },
      Bit: { codecId: 'pg/bit@1' },
      VarBit: { codecId: 'pg/varbit@1' },
      Xml: { codecId: 'pg/xml@1' },
      Oid: { codecId: 'pg/oid@1' },
      Money: { codecId: 'pg/money@1' },
      IntervalParts: { codecId: 'pg/interval@1' },
      IntervalString: { codecId: 'pg/interval-string@1' },
      TimestampJsDate: { codecId: 'pg/timestamp-date@1' },
      TimestampInstant: { codecId: 'pg/timestamp-instant@1' },
    });
  });

  it('materializes typeParams keys only for arguments that are given', () => {
    expect(instantiateAuthoringTypeConstructor(postgresExplicitScalarTypes.Varchar, [191])).toEqual(
      {
        codecId: 'sql/varchar@1',
        typeParams: { length: 191 },
      },
    );
    expect(
      instantiateAuthoringTypeConstructor(postgresExplicitScalarTypes.NumericString, [10]),
    ).toEqual({
      codecId: 'pg/numeric@1',
      typeParams: { precision: 10 },
    });
    expect(
      instantiateAuthoringTypeConstructor(postgresExplicitScalarTypes.NumericString, [10, 2]),
    ).toEqual({
      codecId: 'pg/numeric@1',
      typeParams: { precision: 10, scale: 2 },
    });
    expect(instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.Timetz, [2])).toEqual({
      codecId: 'pg/timetz@1',
      typeParams: { precision: 2 },
    });
  });

  it.each([
    ['Bit', [], { codecId: 'pg/bit@1' }],
    ['Bit', [8], { codecId: 'pg/bit@1', typeParams: { length: 8 } }],
    ['VarBit', [], { codecId: 'pg/varbit@1' }],
    ['VarBit', [16], { codecId: 'pg/varbit@1', typeParams: { length: 16 } }],
    ['IntervalParts', [], { codecId: 'pg/interval@1' }],
    ['IntervalParts', [3], { codecId: 'pg/interval@1', typeParams: { precision: 3 } }],
    ['IntervalString', [3], { codecId: 'pg/interval-string@1', typeParams: { precision: 3 } }],
    ['TimestampJsDate', [3], { codecId: 'pg/timestamp-date@1', typeParams: { precision: 3 } }],
    ['TimestampInstant', [6], { codecId: 'pg/timestamp-instant@1', typeParams: { precision: 6 } }],
  ] as const)('maps %s(%s) onto the parameter of the same name', (name, args, expected) => {
    expect(instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes[name], args)).toEqual(
      expected,
    );
  });

  describe('arguments are bounded by the codec’s data type, not by the constructor', () => {
    const codecLookup = createPostgresBuiltinCodecLookup();
    const check = (name: keyof typeof explicitTypes, args: readonly unknown[]) => {
      const descriptor = explicitTypes[name];
      const output = instantiateAuthoringTypeConstructor(descriptor, args);
      validateAuthoringTypeParams(
        name,
        descriptor.output,
        output.typeParams,
        codecLookup.descriptorFor?.(output.codecId)?.paramsSchema,
      );
    };

    it.each([
      ['Varchar', [0]],
      ['Varchar', [10485761]],
      ['Char', [0]],
      ['Char', [10485761]],
      ['NumericString', [0]],
      ['NumericString', [1001]],
      ['NumericString', [10, 1001]],
      ['TimestampTemporal', [-1]],
      ['TimestampTemporal', [7]],
      ['TimestamptzTemporal', [7]],
      ['TimeTemporal', [7]],
      ['Timetz', [7]],
      ['TimestamptzJsDate', [7]],
      ['Bit', [0]],
      ['VarBit', [0]],
      ['IntervalParts', [7]],
      ['IntervalString', [7]],
      ['TimestampInstant', [7]],
      ['TimestampJsDate', [7]],
    ] as const)('refuses %s(%s)', (name, args) => {
      expect(() => check(name, args)).toThrow(
        expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
      );
    });

    it.each([
      ['Varchar', [1]],
      ['Varchar', [10485760]],
      ['Char', [10485760]],
      ['NumericString', [1000, 1000]],
      ['NumericString', [1, 0]],
      ['TimestampTemporal', [0]],
      ['TimestampTemporal', [6]],
      ['Timetz', [6]],
      ['TimestampJsDate', [0]],
      ['TimestampJsDate', [6]],
      ['TimestampInstant', [6]],
      ['IntervalString', [6]],
    ] as const)('accepts %s(%s)', (name, args) => {
      expect(() => check(name, args)).not.toThrow();
    });

    it('declares no minimum or maximum on any argument', () => {
      const bounded = Object.entries(explicitTypes).filter(([, descriptor]) =>
        (('args' in descriptor ? descriptor.args : undefined) ?? []).some(
          (arg) => 'minimum' in arg || 'maximum' in arg,
        ),
      );
      expect(bounded.map(([name]) => name)).toEqual([]);
    });
  });

  it('has no type named Timestamptz, Timestamp or Interval', () => {
    for (const removed of ['Timestamptz', 'Timestamp', 'Interval']) {
      expect(everyPostgresConstructor).not.toHaveProperty(removed);
    }
  });

  it('gives DateTime, Date, Time and Duration to the convenience types, not to explicit types', () => {
    expect(
      Object.fromEntries(
        ['DateTime', 'Date', 'Time', 'Duration'].map((name) => [
          name,
          (everyPostgresConstructor as Record<string, { readonly kind?: string }>)[name]?.kind,
        ]),
      ),
    ).toEqual({
      DateTime: 'typeChoice',
      Date: 'typeChoice',
      Time: 'typeChoice',
      Duration: 'typeChoice',
    });
  });

  it('offers only the precision-bearing TimestamptzJsDate for a Date-backed timestamptz', () => {
    expect(everyPostgresConstructor).not.toHaveProperty('DateTimeDate');
    expect(everyPostgresConstructor).not.toHaveProperty('TimestamptzDate');
    expect(postgresNativeAuthoringTypes).toHaveProperty('TimestamptzJsDate', {
      kind: 'typeConstructor',
      inferred: true,
      documentation:
        'An instant stored as PostgreSQL timestamptz and represented as a JavaScript Date.',
      args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
      output: {
        codecId: 'pg/timestamptz-date@1',
        typeParams: { precision: { kind: 'arg', index: 0 } },
      },
    });
    expect(postgresNativeAuthoringTypes.TimestamptzTemporal.output.codecId).toBe(
      'pg/timestamptz-temporal@1',
    );
  });
});

describe('precision is a value of pg/int4, bounded by the data type', () => {
  it.each([
    'TimestampTemporal',
    'TimestamptzTemporal',
    'TimeTemporal',
    'Timetz',
    'TimestampString',
    'TimestamptzString',
    'TimeString',
  ] as const)('%s declares no bound of its own on precision', (typeName) => {
    const typeConstructor = postgresScalarAndNativeTypeConstructors[typeName];
    expect(typeConstructor.args?.find((arg) => arg.name === 'precision')).toEqual({
      kind: 'value',
      dataType: 'pg/int4',
      name: 'precision',
      optional: true,
    });
  });
});
