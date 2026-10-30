import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'native-type-parity.test.psl',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

interface ColumnShape {
  readonly codecId: string;
  readonly dataType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly many?: false | { readonly elementNullable: boolean };
}

function storageOf(value: unknown) {
  return (
    value as {
      readonly storage: {
        readonly types?: Record<string, unknown>;
        readonly namespaces: Record<
          string,
          {
            readonly entries: {
              readonly table: Record<string, { columns: Record<string, ColumnShape> }>;
            };
          }
        >;
      };
    }
  ).storage;
}

function schemaFor(bare: string, alias: string): string {
  return `types {
  Alias = ${alias}
  Named = ${bare}
}

model sample {
  id Int @id
  viaAlias Alias
  viaNamed Named
  direct ${bare}
}
`;
}

interface ParityCase {
  readonly title: string;
  readonly bare: string;
  readonly alias: string;
  readonly expected: {
    readonly dataType: string;
    readonly codecId: string;
    readonly typeParams: Record<string, unknown>;
  };
}

const varcharOut = { dataType: 'pg/varchar', codecId: 'sql/varchar@1' } as const;
const charOut = { dataType: 'pg/char', codecId: 'sql/char@1' } as const;
const numericOut = { dataType: 'pg/numeric', codecId: 'pg/numeric@1' } as const;

const parityCases: readonly ParityCase[] = [
  ...[undefined, 0, 3, 6].map((precision): ParityCase => {
    const spelling =
      precision === undefined ? 'TimestamptzJsDate' : `TimestamptzJsDate(${precision})`;
    return {
      title: spelling,
      bare: spelling,
      alias: spelling,
      expected: {
        dataType: 'pg/timestamptz',
        codecId: 'pg/timestamptz-date@1',
        typeParams: precision === undefined ? {} : { precision },
      },
    };
  }),
  {
    title: 'VarChar(191)',
    bare: 'VarChar(191)',
    alias: 'VarChar(191)',
    expected: { ...varcharOut, typeParams: { length: 191 } },
  },
  {
    title: 'VarChar() — arg omitted',
    bare: 'VarChar()',
    alias: 'VarChar',
    expected: { ...varcharOut, typeParams: {} },
  },
  {
    title: 'VarChar — bare',
    bare: 'VarChar',
    alias: 'VarChar',
    expected: { ...varcharOut, typeParams: {} },
  },
  {
    title: 'Char(12)',
    bare: 'Char(12)',
    alias: 'Char(12)',
    expected: { ...charOut, typeParams: { length: 12 } },
  },
  {
    title: 'Char — bare',
    bare: 'Char',
    alias: 'Char',
    expected: { ...charOut, typeParams: {} },
  },
  {
    title: 'Numeric(10, 2)',
    bare: 'Numeric(10, 2)',
    alias: 'Numeric(10, 2)',
    expected: { ...numericOut, typeParams: { precision: 10, scale: 2 } },
  },
  {
    title: 'Numeric(10) — one arg',
    bare: 'Numeric(10)',
    alias: 'Numeric(10)',
    expected: { ...numericOut, typeParams: { precision: 10 } },
  },
  {
    title: 'Numeric — bare',
    bare: 'Numeric',
    alias: 'Numeric',
    expected: { ...numericOut, typeParams: {} },
  },
  {
    title: 'TimestampTemporal(3)',
    bare: 'TimestampTemporal(3)',
    alias: 'TimestampTemporal(3)',
    expected: {
      dataType: 'pg/timestamp',
      codecId: 'pg/timestamp-temporal@1',
      typeParams: { precision: 3 },
    },
  },
  {
    title: 'TimestampTemporal — bare',
    bare: 'TimestampTemporal',
    alias: 'TimestampTemporal',
    expected: { dataType: 'pg/timestamp', codecId: 'pg/timestamp-temporal@1', typeParams: {} },
  },
  {
    title: 'TimestamptzTemporal(6)',
    bare: 'TimestamptzTemporal(6)',
    alias: 'TimestamptzTemporal(6)',
    expected: {
      dataType: 'pg/timestamptz',
      codecId: 'pg/timestamptz-temporal@1',
      typeParams: { precision: 6 },
    },
  },
  {
    title: 'TimestamptzTemporal — bare',
    bare: 'TimestamptzTemporal',
    alias: 'TimestamptzTemporal',
    expected: { dataType: 'pg/timestamptz', codecId: 'pg/timestamptz-temporal@1', typeParams: {} },
  },
  {
    title: 'TimeTemporal(3)',
    bare: 'TimeTemporal(3)',
    alias: 'TimeTemporal(3)',
    expected: { dataType: 'pg/time', codecId: 'pg/time-temporal@1', typeParams: { precision: 3 } },
  },
  {
    title: 'TimeTemporal — bare',
    bare: 'TimeTemporal',
    alias: 'TimeTemporal',
    expected: { dataType: 'pg/time', codecId: 'pg/time-temporal@1', typeParams: {} },
  },
  // The representation-explicit spellings, which must carry precision exactly as their unsuffixed
  // counterparts do — the choice between them is about what a read hands back, not about fidelity.
  {
    title: 'TimestampString(3)',
    bare: 'TimestampString(3)',
    alias: 'TimestampString(3)',
    expected: {
      dataType: 'pg/timestamp',
      codecId: 'pg/timestamp-string@1',
      typeParams: { precision: 3 },
    },
  },
  {
    title: 'TimestampString — bare',
    bare: 'TimestampString',
    alias: 'TimestampString',
    expected: { dataType: 'pg/timestamp', codecId: 'pg/timestamp-string@1', typeParams: {} },
  },
  {
    title: 'TimestamptzString(6)',
    bare: 'TimestamptzString(6)',
    alias: 'TimestamptzString(6)',
    expected: {
      dataType: 'pg/timestamptz',
      codecId: 'pg/timestamptz-string@1',
      typeParams: { precision: 6 },
    },
  },
  {
    title: 'TimestamptzString — bare',
    bare: 'TimestamptzString',
    alias: 'TimestamptzString',
    expected: { dataType: 'pg/timestamptz', codecId: 'pg/timestamptz-string@1', typeParams: {} },
  },
  {
    title: 'TimeString(3)',
    bare: 'TimeString(3)',
    alias: 'TimeString(3)',
    expected: { dataType: 'pg/time', codecId: 'pg/time-string@1', typeParams: { precision: 3 } },
  },
  {
    title: 'TimeString — bare',
    bare: 'TimeString',
    alias: 'TimeString',
    expected: { dataType: 'pg/time', codecId: 'pg/time-string@1', typeParams: {} },
  },
  {
    title: 'DateString',
    bare: 'DateString',
    alias: 'DateString',
    expected: { dataType: 'pg/date', codecId: 'pg/date-string@1', typeParams: {} },
  },
  {
    title: 'Timetz(2)',
    bare: 'Timetz(2)',
    alias: 'Timetz(2)',
    expected: { dataType: 'pg/timetz', codecId: 'pg/timetz@1', typeParams: { precision: 2 } },
  },
  {
    title: 'Timetz — bare',
    bare: 'Timetz',
    alias: 'Timetz',
    expected: { dataType: 'pg/timetz', codecId: 'pg/timetz@1', typeParams: {} },
  },
  {
    title: 'Uuid() — called',
    bare: 'Uuid()',
    alias: 'Uuid',
    expected: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', typeParams: {} },
  },
  {
    title: 'Uuid — bare',
    bare: 'Uuid',
    alias: 'Uuid',
    expected: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', typeParams: {} },
  },
  {
    title: 'Inet — bare',
    bare: 'Inet',
    alias: 'Inet',
    expected: { dataType: 'pg/inet', codecId: 'pg/inet@1', typeParams: {} },
  },
  {
    title: 'Xml — bare',
    bare: 'Xml',
    alias: 'Xml',
    expected: { dataType: 'pg/xml', codecId: 'pg/xml@1', typeParams: {} },
  },
  {
    title: 'Oid — bare',
    bare: 'Oid',
    alias: 'Oid',
    expected: { dataType: 'pg/oid', codecId: 'pg/oid@1', typeParams: {} },
  },
  {
    title: 'Money — bare',
    bare: 'Money',
    alias: 'Money',
    expected: { dataType: 'pg/money', codecId: 'pg/money@1', typeParams: {} },
  },
  {
    title: 'SmallInt — bare',
    bare: 'SmallInt',
    alias: 'SmallInt',
    expected: { dataType: 'pg/int2', codecId: 'pg/int2@1', typeParams: {} },
  },
  {
    title: 'Real — bare',
    bare: 'Real',
    alias: 'Real',
    expected: { dataType: 'pg/float4', codecId: 'pg/float4@1', typeParams: {} },
  },
  {
    title: 'DateTemporal — bare',
    bare: 'DateTemporal',
    alias: 'DateTemporal',
    expected: { dataType: 'pg/date', codecId: 'pg/date-temporal@1', typeParams: {} },
  },
];

const bitAndIntervalCases = [
  ['Bit', 'pg/bit', 'pg/bit@1', {}],
  ['Bit(8)', 'pg/bit', 'pg/bit@1', { length: 8 }],
  ['VarBit', 'pg/varbit', 'pg/varbit@1', {}],
  ['VarBit(16)', 'pg/varbit', 'pg/varbit@1', { length: 16 }],
  ['IntervalParts', 'pg/interval', 'pg/interval@1', {}],
  ['IntervalParts(3)', 'pg/interval', 'pg/interval@1', { precision: 3 }],
] as const;

describe('Bit, VarBit and IntervalParts', () => {
  it.each(bitAndIntervalCases)(
    '%s gives its codec and parameters as a scalar and as a list',
    (spelling, dataType, codecId, typeParams) => {
      const result = emit(`model sample {
  id Int @id
  one ${spelling}
  many ${spelling}[]
}
`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const columns = storageOf(result.value).namespaces['public']?.entries.table['sample']
        ?.columns;
      const shape = (column: ColumnShape | undefined) => ({
        dataType: column?.dataType,
        codecId: column?.codecId,
        typeParams: column?.typeParams ?? {},
        many: column?.many,
      });
      expect({ one: shape(columns?.['one']), many: shape(columns?.['many']) }).toEqual({
        one: { dataType, codecId, typeParams, many: false },
        many: { dataType, codecId, typeParams, many: { elementNullable: false } },
      });
    },
  );
});

describe('native types as bare scalar types — parity with the live bare-type path', () => {
  it.each(parityCases)('$title', ({ bare, alias, expected }) => {
    const result = emit(schemaFor(bare, alias));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = storageOf(result.value);
    const columns = storage.namespaces['public']?.entries.table['sample']?.columns;
    const shape = (column: ColumnShape | undefined) => ({
      dataType: column?.dataType,
      codecId: column?.codecId,
      typeParams: column?.typeParams ?? {},
    });
    expect({
      types: storage.types,
      viaAlias: shape(columns?.['viaAlias']),
      viaNamed: shape(columns?.['viaNamed']),
      direct: shape(columns?.['direct']),
    }).toEqual({ types: undefined, viaAlias: expected, viaNamed: expected, direct: expected });
  });

  it('lowers the UpdatedAt alias identically to explicit Date clock phases', () => {
    const shorthand = emit(`model sample {
      id Int @id
      at temporal.UpdatedAt
    }`);
    const explicit = emit(`model sample {
      id Int @id
      at TimestamptzJsDate(3) @onCreate(now()) @onUpdate(now())
    }`);
    expect(shorthand.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    if (!shorthand.ok || !explicit.ok) return;
    expect(shorthand.value).toEqual(explicit.value);
    expect(
      storageOf(shorthand.value).namespaces['public']?.entries.table['sample']?.columns['at'],
    ).toMatchObject({
      codecId: 'pg/timestamptz-date@1',
    });
  });

  it('lowers the CreatedAt alias identically to an explicit create clock phase', () => {
    const result = emit(`model sample {
      id Int @id
      at temporal.CreatedAt
    }`);
    const explicit = emit(`model sample {
      id Int @id
      at TimestamptzJsDate(3) @onCreate(now())
    }`);
    expect(result.ok).toBe(true);
    expect(explicit.ok).toBe(true);
    if (!result.ok || !explicit.ok) return;
    expect(result.value).toEqual(explicit.value);
    const column = storageOf(result.value).namespaces['public']?.entries.table['sample']?.columns[
      'at'
    ];
    expect(column).toMatchObject({
      codecId: 'pg/timestamptz-date@1',
    });
    expect(column).not.toHaveProperty('default');
  });

  it('names the rewrite of a removed field preset through the SQL family', () => {
    const result = emit(`model sample {
  id Int @id
  at temporal.timestamptzJsDate(3, onCreate: now)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          'temporal.timestamptzJsDate(3, onCreate: now) was a field preset, and Prisma 8 removed field presets. Write DateTime @onCreate(now()).',
      },
    ]);
  });

  it('names Unsupported("x") as no Prisma 8 type through the SQL family', () => {
    const result = emit(`model sample {
  id Int @id
  meta Unsupported("hstore")
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          'Unsupported("hstore") is not a Prisma 8 type. Write the column\'s type with a type constructor, or as Raw(sql`hstore`) when no type constructor names it. If "hstore" comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts.',
      },
    ]);
  });

  it('rejects VarChar(0) in field position via its data type’s bound', () => {
    const result = emit(`model sample {
  id Int @id
  name VarChar(0)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be at least 1 (was 0)'),
        }),
      ]),
    );
  });

  it('rejects VarChar(0) in named-type position via its data type’s bound', () => {
    const result = emit(`types {
  Bad = VarChar(0)
}

model sample {
  id Int @id
  name Bad
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be at least 1 (was 0)'),
        }),
      ]),
    );
  });

  it('rejects Numeric(0) in field position, matching Numeric\u2019s positive-precision rule', () => {
    const result = emit(`model sample {
  id Int @id
  amount Numeric(0)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be at least 1 (was 0)'),
        }),
      ]),
    );
  });

  it('rejects Numeric(0) in named-type position, matching Numeric\u2019s positive-precision rule', () => {
    const result = emit(`types {
  Bad = Numeric(0)
}

model sample {
  id Int @id
  amount Bad
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be at least 1 (was 0)'),
        }),
      ]),
    );
  });

  it('rejects a non-integer precision, which pg/int4 cannot hold', () => {
    const result = emit(`model sample {
  id Int @id
  at TimestampTemporal(1.5)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_VALUE_TYPE_INCOMPATIBLE',
        message: 'Expected a number that pg/int4 can hold; got pg/numeric',
      }),
    ]);
  });

  it('rejects arguments on a no-arg native type', () => {
    const result = emit(`model sample {
  id Int @id
  ref Uuid(1)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('at most 0 argument(s)'),
        }),
      ]),
    );
  });
});
