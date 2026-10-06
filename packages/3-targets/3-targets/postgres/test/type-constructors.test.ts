import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import {
  collectScalarTypeConstructors,
  instantiateAuthoringTypeConstructor,
  validateAuthoringTypeParams,
} from '@internal/framework-components/authoring';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { unquotedSqlBaseNameOfCodec } from '@internal/sql-contract/data-type';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringTypes } from '../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { postgresDataTypes } from '../src/core/data-types';
import { EXISTING_COLUMN_DATE_TIME_TYPES } from '../src/core/psl-build/existing-column-date-time-types';
import { INFERRED_PSL_TYPE_NAMES } from '../src/core/psl-build/postgres-type-map';
import {
  postgresNativeAuthoringTypes,
  postgresPslTypeConstructors,
  postgresScalarAuthoringTypes,
} from '../src/core/type-constructors';
import postgresTargetPack from '../src/exports/pack';

describe('the type constructors the target contributes', () => {
  it('are only the target’s own; the adapter contributes the scalar and native ones', () => {
    expect(postgresTargetPack.authoring.type).toBe(postgresAuthoringTypes);
    expect(Object.keys(postgresAuthoringTypes)).toEqual(['BigIntNumber', 'UnboundedInt', 'pg']);
  });

  it('define the PSL-only constructors as the scalar and native ones together', () => {
    expect(Object.keys(postgresPslTypeConstructors)).toEqual([
      ...Object.keys(postgresScalarAuthoringTypes),
      ...Object.keys(postgresNativeAuthoringTypes),
    ]);
  });

  it.each(Object.entries(postgresAuthoringTypes).filter(([name]) => name !== 'pg'))(
    'documents %s',
    (_name, descriptor) => {
      expect(descriptor).toHaveProperty('documentation', expect.stringMatching(/\S.+/));
    },
  );
});

const everyPostgresConstructor = {
  ...postgresAuthoringTypes,
  ...postgresPslTypeConstructors,
};

/** The constructor `contract infer` prints for each data type that has one. */
const INFERRED = [
  'String',
  'Boolean',
  'Int',
  'BigInt',
  'Float',
  'Numeric',
  'Json',
  'Jsonb',
  'Bytes',
  'SmallInt',
  'Real',
  'Char',
  'VarChar',
  'Uuid',
  'Inet',
  'DateString',
  'TimeString',
  'Timetz',
  'TimestampString',
  'TimestamptzString',
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

function constructorsByDataType(paths: readonly string[]): Record<string, string[]> {
  const codecLookup = createPostgresBuiltinCodecLookup();
  const byDataType: Record<string, string[]> = {};
  for (const path of paths) {
    const descriptor = constructorAt(path) as { output: { codecId: string } };
    const dataType = codecLookup.descriptorFor(descriptor.output.codecId)?.dataType ?? path;
    byDataType[dataType] = [...(byDataType[dataType] ?? []), path];
  }
  return byDataType;
}

describe('the constructors contract infer prints', () => {
  it('are marked inferred, and no other constructor is', () => {
    expect(markedInferred().sort()).toEqual([...INFERRED].sort());
  });

  it('are, for each data type, the one contract infer writes for a column of it', () => {
    const writtenByInfer = [...INFERRED_PSL_TYPE_NAMES, 'pg.enum'];
    expect(constructorsByDataType(markedInferred())).toEqual(
      constructorsByDataType(writtenByInfer),
    );
  });

  it('include every date and time constructor written for an existing column', () => {
    expect(
      Object.values(EXISTING_COLUMN_DATE_TIME_TYPES).filter(
        (name) => !markedInferred().includes(name),
      ),
    ).toEqual([]);
  });

  it.each(INFERRED)('%s is marked with true', (path) => {
    expect(constructorAt(path)).toHaveProperty('inferred', true);
  });
});

describe('postgresScalarAuthoringTypes', () => {
  const codecLookup = createPostgresBuiltinCodecLookup();
  const namespace: AuthoringTypeNamespace = postgresScalarAuthoringTypes;

  // The legacy scalar-type map channel (name-to-codecId, retired in TML-2985) is gone; the pinned
  // name → codecId pairs below carry the retired map's claims forward.
  const expectedScalars = [
    ['String', 'pg/text@1', 'text'],
    ['Boolean', 'pg/bool@1', 'bool'],
    ['Int', 'pg/int4@1', 'int4'],
    ['BigInt', 'pg/int8@1', 'int8'],
    ['Float', 'pg/float8@1', 'float8'],
    ['Decimal', 'pg/numeric@1', 'numeric'],
    ['DateTime', 'pg/timestamptz-temporal@1', 'timestamptz'],
    ['Json', 'pg/json@1', 'json'],
    ['Jsonb', 'pg/jsonb@1', 'jsonb'],
    ['Bytes', 'pg/bytea@1', 'bytea'],
  ] as const;

  it('pins every base scalar as a zero-arg type constructor naming its codec', () => {
    expect(Object.keys(namespace).sort()).toEqual(expectedScalars.map(([name]) => name).sort());
    for (const [name, codecId] of expectedScalars) {
      expect(namespace[name]).toEqual({
        kind: 'typeConstructor',
        documentation: expect.stringMatching(/\S/),
        ...(INFERRED.includes(name) ? { inferred: true } : {}),
        output: { codecId },
      });
    }
  });

  it.each(expectedScalars)(
    '%s keeps its type name, now its codec’s data type’s',
    (_name, codecId, typeName) => {
      expect(
        unquotedSqlBaseNameOfCodec(codecId, undefined, {
          codecLookup,
          dataTypeLookup: createDataTypeLookup(postgresDataTypes),
        }),
      ).toBe(typeName);
    },
  );
});

describe('postgresNativeAuthoringTypes', () => {
  it('contributes all native types as bare-eligible top-level constructors', () => {
    const derived = collectScalarTypeConstructors(postgresNativeAuthoringTypes);

    expect(Object.fromEntries(derived)).toEqual({
      VarChar: { codecId: 'sql/varchar@1' },
      Char: { codecId: 'sql/char@1' },
      Numeric: { codecId: 'pg/numeric@1' },
      Timestamp: { codecId: 'pg/timestamp-temporal@1' },
      Timestamptz: { codecId: 'pg/timestamptz-temporal@1' },
      Time: { codecId: 'pg/time-temporal@1' },
      Timetz: { codecId: 'pg/timetz@1' },
      Uuid: { codecId: 'pg/uuid@1' },
      Inet: { codecId: 'pg/inet@1' },
      SmallInt: { codecId: 'pg/int2@1' },
      Real: { codecId: 'pg/float4@1' },
      Date: { codecId: 'pg/date-temporal@1' },
      DateString: { codecId: 'pg/date-string@1' },
      TimestampString: { codecId: 'pg/timestamp-string@1' },
      TimestamptzString: { codecId: 'pg/timestamptz-string@1' },
      TimestamptzJsDate: { codecId: 'pg/timestamptz-date@1' },
      TimeString: { codecId: 'pg/time-string@1' },
    });
  });

  it('materializes typeParams keys only for arguments that are given', () => {
    expect(
      instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.VarChar, [191]),
    ).toEqual({
      codecId: 'sql/varchar@1',
      typeParams: { length: 191 },
    });
    expect(instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.Numeric, [10])).toEqual(
      {
        codecId: 'pg/numeric@1',
        typeParams: { precision: 10 },
      },
    );
    expect(
      instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.Numeric, [10, 2]),
    ).toEqual({
      codecId: 'pg/numeric@1',
      typeParams: { precision: 10, scale: 2 },
    });
    expect(instantiateAuthoringTypeConstructor(postgresNativeAuthoringTypes.Timetz, [2])).toEqual({
      codecId: 'pg/timetz@1',
      typeParams: { precision: 2 },
    });
  });

  describe('arguments are bounded by the codec’s data type, not by the constructor', () => {
    const codecLookup = createPostgresBuiltinCodecLookup();
    const check = (name: keyof typeof postgresNativeAuthoringTypes, args: readonly unknown[]) => {
      const descriptor = postgresNativeAuthoringTypes[name];
      const output = instantiateAuthoringTypeConstructor(descriptor, args);
      validateAuthoringTypeParams(
        name,
        descriptor.output,
        output.typeParams,
        codecLookup.descriptorFor?.(output.codecId)?.paramsSchema,
      );
    };

    it.each([
      ['VarChar', [0]],
      ['VarChar', [10485761]],
      ['Char', [0]],
      ['Char', [10485761]],
      ['Numeric', [0]],
      ['Numeric', [1001]],
      ['Numeric', [10, 1001]],
      ['Timestamp', [-1]],
      ['Timestamp', [7]],
      ['Timestamptz', [7]],
      ['Time', [7]],
      ['Timetz', [7]],
      ['TimestamptzJsDate', [7]],
    ] as const)('refuses %s(%s)', (name, args) => {
      expect(() => check(name, args)).toThrow(
        expect.objectContaining({ code: 'CONTRACT.ARGUMENT_INVALID' }),
      );
    });

    it.each([
      ['VarChar', [1]],
      ['VarChar', [10485760]],
      ['Char', [10485760]],
      ['Numeric', [1000, 1000]],
      ['Numeric', [1, 0]],
      ['Timestamp', [0]],
      ['Timestamp', [6]],
      ['Timetz', [6]],
    ] as const)('accepts %s(%s)', (name, args) => {
      expect(() => check(name, args)).not.toThrow();
    });

    it('declares no minimum or maximum on any argument', () => {
      const bounded = Object.entries(postgresNativeAuthoringTypes).filter(([, descriptor]) =>
        (('args' in descriptor ? descriptor.args : undefined) ?? []).some(
          (arg) => 'minimum' in arg || 'maximum' in arg,
        ),
      );
      expect(bounded.map(([name]) => name)).toEqual([]);
    });
  });

  it('offers only the precision-bearing TimestamptzJsDate for a Date-backed timestamptz', () => {
    expect(everyPostgresConstructor).not.toHaveProperty('DateTimeDate');
    expect(everyPostgresConstructor).not.toHaveProperty('TimestamptzDate');
    expect(postgresNativeAuthoringTypes).toHaveProperty('TimestamptzJsDate', {
      kind: 'typeConstructor',
      documentation:
        'An instant stored as PostgreSQL timestamptz and represented as a JavaScript Date.',
      args: [{ kind: 'number', name: 'precision', integer: true, optional: true }],
      output: {
        codecId: 'pg/timestamptz-date@1',
        typeParams: { precision: { kind: 'arg', index: 0 } },
      },
    });
    expect(postgresScalarAuthoringTypes.DateTime.output.codecId).toBe('pg/timestamptz-temporal@1');
    expect(postgresNativeAuthoringTypes.Timestamptz.output.codecId).toBe(
      'pg/timestamptz-temporal@1',
    );
  });
});

describe('precision bounds live on the data type', () => {
  it.each([
    'Timestamp',
    'Timestamptz',
    'Time',
    'Timetz',
    'TimestampString',
    'TimestamptzString',
    'TimeString',
  ] as const)('%s declares no bound of its own on precision', (typeName) => {
    const typeConstructor = postgresPslTypeConstructors[typeName];
    expect(typeConstructor.args?.find((arg) => arg.name === 'precision')).toEqual({
      kind: 'number',
      name: 'precision',
      integer: true,
      optional: true,
    });
  });
});
