import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
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
  const { document, sourceFile } = parse(schema);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
  });
  return interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: postgresPackRef,
    scalarColumnDescriptors: collectScalarTypeConstructors(stack.authoringContributions.type),
    authoringContributions: stack.authoringContributions,
    controlMutationDefaults: stack.controlMutationDefaults,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup: stack.codecLookup,
    capabilities: stack.capabilities,
  });
}

interface StorageTypeShape {
  readonly kind: string;
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
}

interface ColumnShape {
  readonly codecId: string;
  readonly nativeType: string;
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
    readonly codecId: string;
    readonly nativeType: string;
    readonly typeParams: Record<string, unknown>;
  };
}

const varcharOut = { codecId: 'sql/varchar@1', nativeType: 'character varying' } as const;
const charOut = { codecId: 'sql/char@1', nativeType: 'character' } as const;
const numericOut = { codecId: 'pg/numeric@1', nativeType: 'numeric' } as const;

const parityCases: readonly ParityCase[] = [
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
      codecId: 'pg/timestamp-temporal@1',
      nativeType: 'timestamp',
      typeParams: { precision: 3 },
    },
  },
  {
    title: 'Timestamp — bare',
    bare: 'Timestamp',
    alias: 'Timestamp',
    expected: { codecId: 'pg/timestamp-temporal@1', nativeType: 'timestamp', typeParams: {} },
  },
  {
    title: 'Timestamptz(6)',
    bare: 'Timestamptz(6)',
    alias: 'Timestamptz(6)',
    expected: {
      codecId: 'pg/timestamptz-temporal@1',
      nativeType: 'timestamptz',
      typeParams: { precision: 6 },
    },
  },
  {
    title: 'Timestamptz — bare',
    bare: 'Timestamptz',
    alias: 'Timestamptz',
    expected: { codecId: 'pg/timestamptz-temporal@1', nativeType: 'timestamptz', typeParams: {} },
  },
  {
    title: 'Time(3)',
    bare: 'Time(3)',
    alias: 'Time(3)',
    expected: { codecId: 'pg/time-temporal@1', nativeType: 'time', typeParams: { precision: 3 } },
  },
  {
    title: 'Time — bare',
    bare: 'Time',
    alias: 'Time',
    expected: { codecId: 'pg/time-temporal@1', nativeType: 'time', typeParams: {} },
  },
  // The representation-explicit spellings, which must carry precision exactly as their unsuffixed
  // counterparts do — the choice between them is about what a read hands back, not about fidelity.
  {
    title: 'TimestampString(3)',
    bare: 'TimestampString(3)',
    alias: 'TimestampString(3)',
    expected: {
      codecId: 'pg/timestamp-string@1',
      nativeType: 'timestamp',
      typeParams: { precision: 3 },
    },
  },
  {
    title: 'TimestampString — bare',
    bare: 'TimestampString',
    alias: 'TimestampString',
    expected: { codecId: 'pg/timestamp-string@1', nativeType: 'timestamp', typeParams: {} },
  },
  {
    title: 'TimestamptzString(6)',
    bare: 'TimestamptzString(6)',
    alias: 'TimestamptzString(6)',
    expected: {
      codecId: 'pg/timestamptz-string@1',
      nativeType: 'timestamptz',
      typeParams: { precision: 6 },
    },
  },
  {
    title: 'TimestamptzString — bare',
    bare: 'TimestamptzString',
    alias: 'TimestamptzString',
    expected: { codecId: 'pg/timestamptz-string@1', nativeType: 'timestamptz', typeParams: {} },
  },
  {
    title: 'TimeString(3)',
    bare: 'TimeString(3)',
    alias: 'TimeString(3)',
    expected: { codecId: 'pg/time-string@1', nativeType: 'time', typeParams: { precision: 3 } },
  },
  {
    title: 'TimeString — bare',
    bare: 'TimeString',
    alias: 'TimeString',
    expected: { codecId: 'pg/time-string@1', nativeType: 'time', typeParams: {} },
  },
  {
    title: 'DateString',
    bare: 'DateString',
    alias: 'DateString',
    expected: { codecId: 'pg/date-string@1', nativeType: 'date', typeParams: {} },
  },
  {
    title: 'Timetz(2)',
    bare: 'Timetz(2)',
    alias: 'Timetz(2)',
    expected: { codecId: 'pg/timetz@1', nativeType: 'timetz', typeParams: { precision: 2 } },
  },
  {
    title: 'Timetz — bare',
    bare: 'Timetz',
    alias: 'Timetz',
    expected: { codecId: 'pg/timetz@1', nativeType: 'timetz', typeParams: {} },
  },
  {
    title: 'Uuid() — called',
    bare: 'Uuid()',
    alias: 'Uuid',
    expected: { codecId: 'pg/uuid@1', nativeType: 'uuid', typeParams: {} },
  },
  {
    title: 'Uuid — bare',
    bare: 'Uuid',
    alias: 'Uuid',
    expected: { codecId: 'pg/uuid@1', nativeType: 'uuid', typeParams: {} },
  },
  {
    title: 'Inet — bare',
    bare: 'Inet',
    alias: 'Inet',
    expected: { codecId: 'pg/inet@1', nativeType: 'inet', typeParams: {} },
  },
  {
    title: 'SmallInt — bare',
    bare: 'SmallInt',
    alias: 'SmallInt',
    expected: { codecId: 'pg/int2@1', nativeType: 'int2', typeParams: {} },
  },
  {
    title: 'Real — bare',
    bare: 'Real',
    alias: 'Real',
    expected: { codecId: 'pg/float4@1', nativeType: 'float4', typeParams: {} },
  },
  {
    title: 'Date — bare',
    bare: 'Date',
    alias: 'Date',
    expected: { codecId: 'pg/date-temporal@1', nativeType: 'date', typeParams: {} },
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
      codecId: direct.codecId,
      nativeType: direct.nativeType,
      typeParams: direct.typeParams ?? {},
    }).toEqual({
      codecId: aliasType.codecId,
      nativeType: aliasType.nativeType,
      typeParams: aliasType.typeParams,
    });

    expect(columns?.['viaNamed']).toMatchObject({
      codecId: expected.codecId,
      nativeType: expected.nativeType,
      typeRef: 'Named',
    });
  });

  it('rejects VarChar(0) in field position via the declarative minimum', () => {
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
          message: expect.stringContaining('must be >= 1'),
        }),
      ]),
    );
  });

  it('rejects VarChar(0) in named-type position via the declarative minimum', () => {
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
          message: expect.stringContaining('must be >= 1'),
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
          message: expect.stringContaining('must be >= 1'),
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
          message: expect.stringContaining('must be >= 1'),
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
