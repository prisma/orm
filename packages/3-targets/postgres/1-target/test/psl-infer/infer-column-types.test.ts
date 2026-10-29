import type { ReportedSqlType } from '@internal/sql-schema-ir/types';
import { SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { describe, expect, it } from 'vitest';
import { printPslFromFlat } from './fixtures';

function reported(text: string, rest: Partial<ReportedSqlType> = {}): ReportedSqlType {
  return { text, kind: undefined, schema: 'pg_catalog', name: undefined, ...rest };
}

/** Each Postgres data type with a marked constructor, as Postgres reports a column of it, and what infer prints: the type choice that becomes the marked constructor where one does. */
const COLUMN_TYPES = [
  ['text', 'String'],
  ['boolean', 'Boolean'],
  ['integer', 'Int'],
  ['bigint', 'BigInt'],
  ['double precision', 'Float'],
  ['numeric', 'Numeric'],
  ['numeric(10,0)', 'Numeric(10)'],
  ['numeric(10,2)', 'Numeric(10, 2)'],
  ['numeric(10,-2)', 'Numeric(10, -2)'],
  ['json', 'Json'],
  ['jsonb', 'Jsonb'],
  ['bytea', 'Bytes'],
  ['smallint', 'SmallInt'],
  ['real', 'Real'],
  ['character(1)', 'Char'],
  ['character(5)', 'Char(5)'],
  ['character varying', 'VarChar'],
  ['character varying(20)', 'VarChar(20)'],
  ['uuid', 'Uuid'],
  ['inet', 'Inet'],
  ['date', 'Date'],
  ['time without time zone', 'Time'],
  ['time(0) without time zone', 'Time(precision: 0)'],
  ['time(3) without time zone', 'Time(precision: 3)'],
  ['time with time zone', 'Time(storage: timetz)'],
  ['time(2) with time zone', 'Time(storage: timetz, precision: 2)'],
  ['timestamp without time zone', 'DateTime(storage: timestamp, precision: 6)'],
  ['timestamp(3) without time zone', 'DateTime(storage: timestamp)'],
  ['timestamp with time zone', 'DateTime(precision: 6)'],
  ['timestamp(3) with time zone', 'DateTime'],
  ['timestamp(6) with time zone', 'DateTime(precision: 6)'],
  ['bit(1)', 'Bit'],
  ['bit(8)', 'Bit(8)'],
  ['bit varying', 'VarBit'],
  ['bit varying(16)', 'VarBit(16)'],
  ['interval', 'Duration'],
  ['interval(3)', 'Duration(precision: 3)'],
] as const;

function tableWith(columns: Record<string, { reportedType: ReportedSqlType; many?: true }>) {
  return {
    name: 'sample',
    columns: {
      id: { name: 'id', typeText: 'int4', nullable: false, reportedType: reported('integer') },
      ...Object.fromEntries(
        Object.entries(columns).map(([name, column]) => [
          name,
          { name, typeText: column.reportedType.text, nullable: false, ...column },
        ]),
      ),
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  };
}

function printedFieldTypes(printed: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const line of printed.split('\n')) {
    const match = /^\s+(c\d+)\s+([^@]+)/.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) fields[match[1]] = match[2].trim();
  }
  return fields;
}

describe('contract infer picks each column type through its data type', () => {
  it('prints the type choice with the arguments that differ from its defaults, or else the marked constructor with the fewest arguments, for a scalar and a list', async () => {
    const columns = Object.fromEntries(
      COLUMN_TYPES.flatMap(([text], index) => [
        [`c${index * 2}`, { reportedType: reported(text) }],
        [`c${index * 2 + 1}`, { reportedType: reported(text), many: true as const }],
      ]),
    );
    const printed = await printPslFromFlat(
      new SqlSchemaIR({ tables: { sample: tableWith(columns) } }),
    );

    expect(printedFieldTypes(printed)).toEqual(
      Object.fromEntries(
        COLUMN_TYPES.flatMap(([, psl], index) => [
          [`c${index * 2}`, psl],
          [`c${index * 2 + 1}`, `${psl}?[]`],
        ]),
      ),
    );
  });

  it('fails on every column no data type claims, listing them sorted, and prints nothing', async () => {
    const schema = new SqlSchemaIR({
      tables: {
        zeta: {
          ...tableWith({ c1: { reportedType: reported('tsquery') } }),
          name: 'zeta',
        },
        alpha: {
          ...tableWith({
            c1: { reportedType: reported('hstore', { schema: 'public' }) },
            c2: { reportedType: reported('tsquery'), many: true },
            c3: { reportedType: reported('positive', { kind: 'domain', schema: 'public' }) },
          }),
          name: 'alpha',
        },
      },
    });

    await expect(printPslFromFlat(schema)).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        message: [
          'contract infer: Prisma 8 cannot write these column types with the configured stack:',
          '  public.alpha.c1: hstore',
          '  public.alpha.c2: tsquery[]',
          '  public.alpha.c3: positive',
          '  public.zeta.c1: tsquery',
        ].join('\n'),
        meta: {
          columns: [
            'public.alpha.c1: hstore',
            'public.alpha.c2: tsquery[]',
            'public.alpha.c3: positive',
            'public.zeta.c1: tsquery',
          ],
        },
      }),
    );
  });
});
