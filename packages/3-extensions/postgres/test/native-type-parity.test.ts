import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import postgres from '@internal/target-postgres/control';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
});

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'native-type-parity.test.psl',
    context: contractSourceContextFromControlStack(stack, {
      dataTypeLookup: postgresDataTypeLookup,
    }),
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

interface StorageTypeShape {
  readonly kind: string;
  readonly codecId: string;
  readonly dataType: string;
  readonly typeParams: Record<string, unknown>;
}

interface ColumnShape {
  readonly codecId: string;
  readonly dataType: string;
  readonly typeParams?: Record<string, unknown>;
  readonly typeRef?: string;
}

function storageOf(value: unknown) {
  return (
    value as {
      readonly storage: {
        readonly types?: Record<string, StorageTypeShape>;
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
    title: 'Timestamp(3)',
    bare: 'Timestamp(3)',
    alias: 'Timestamp(3)',
    expected: {
      dataType: 'pg/timestamp',
      codecId: 'pg/timestamp-temporal@1',
      typeParams: { precision: 3 },
    },
  },
  {
    title: 'Timestamp — bare',
    bare: 'Timestamp',
    alias: 'Timestamp',
    expected: { dataType: 'pg/timestamp', codecId: 'pg/timestamp-temporal@1', typeParams: {} },
  },
  {
    title: 'Timestamptz(6)',
    bare: 'Timestamptz(6)',
    alias: 'Timestamptz(6)',
    expected: {
      dataType: 'pg/timestamptz',
      codecId: 'pg/timestamptz-temporal@1',
      typeParams: { precision: 6 },
    },
  },
  {
    title: 'Timestamptz — bare',
    bare: 'Timestamptz',
    alias: 'Timestamptz',
    expected: { dataType: 'pg/timestamptz', codecId: 'pg/timestamptz-temporal@1', typeParams: {} },
  },
  {
    title: 'Time(3)',
    bare: 'Time(3)',
    alias: 'Time(3)',
    expected: { dataType: 'pg/time', codecId: 'pg/time-temporal@1', typeParams: { precision: 3 } },
  },
  {
    title: 'Time — bare',
    bare: 'Time',
    alias: 'Time',
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
    title: 'Date — bare',
    bare: 'Date',
    alias: 'Date',
    expected: { dataType: 'pg/date', codecId: 'pg/date-temporal@1', typeParams: {} },
  },
];

describe('native types as bare scalar types — parity with the live bare-type path', () => {
  it.each(parityCases)('$title', ({ bare, alias, expected }) => {
    const result = emit(schemaFor(bare, alias));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = storageOf(result.value);
    const aliasType = storage.types?.['Alias'];
    const namedType = storage.types?.['Named'];

    expect(aliasType).toEqual({ kind: 'codec-instance', ...expected });
    expect(namedType).toEqual(aliasType);

    const columns = storage.namespaces['public']?.entries.table['sample']?.columns;
    const direct = columns?.['direct'];
    expect(direct).toBeDefined();
    if (!direct || !aliasType) return;
    expect({
      dataType: direct.dataType,
      codecId: direct.codecId,
      typeParams: direct.typeParams ?? {},
    }).toEqual({
      dataType: aliasType.dataType,
      codecId: aliasType.codecId,
      typeParams: aliasType.typeParams,
    });

    expect(columns?.['viaNamed']).toMatchObject({
      codecId: expected.codecId,
      typeRef: 'Named',
    });
  });

  it('lowers the Date updatedAt shorthand identically to explicit Date clock phases', () => {
    const shorthand = emit(`model sample {
      id Int @id
      at temporal.updatedAtJsDate()
    }`);
    const explicit = emit(`model sample {
      id Int @id
      at temporal.timestamptzJsDate(onCreate: now, onUpdate: now)
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

  it('lowers the Date createdAt shorthand identically to an explicit create clock phase', () => {
    const result = emit(`model sample {
      id Int @id
      at temporal.createdAtJsDate()
    }`);
    const explicit = emit(`model sample {
      id Int @id
      at temporal.timestamptzJsDate(onCreate: now)
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

  it('rejects a non-integer precision via the declarative integer constraint', () => {
    const result = emit(`model sample {
  id Int @id
  at Timestamp(1.5)
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
          message: expect.stringContaining('must be an integer'),
        }),
      ]),
    );
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
