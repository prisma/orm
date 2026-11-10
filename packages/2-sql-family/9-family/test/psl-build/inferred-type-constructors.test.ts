import type {
  AuthoringTypeNamespace,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { createDataTypeLookup, dataTypeId } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import type { ReportedSqlType, SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { SqlColumnIR } from '@internal/sql-schema-ir/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import {
  type IntrospectedTable,
  inferColumnTypes,
  type PslTypeCall,
} from '../../src/core/psl-build/column-types';
import {
  fewestArgumentsCall,
  inferredTypeConstructors,
  writtenTypeChoiceCall,
} from '../../src/core/psl-build/inferred-type-constructors';

const numeric = sqlDataType('t/numeric', {
  read: (json) => json,
  params: type({
    'precision?': 'number.integer >= 1',
    'scale?': 'number.integer >= 0',
  }),
  texts: [
    { text: 'numeric', written: true, catalog: true },
    { text: 'numeric({precision})', written: true },
    { text: 'numeric({precision},{scale})', written: true, catalog: true },
  ],
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
});

const text = sqlDataType('t/text', {
  read: (json) => json,
  texts: [{ text: 'text', written: true, catalog: true }],
});

const int = sqlDataType('t/int', {
  read: (json) => json,
  texts: [{ text: 'int', written: true, catalog: true }],
});

const stamp = sqlDataType('t/stamp', {
  read: (json) => json,
  params: type({ 'precision?': 'number.integer >= 0 & number.integer <= 6' }),
  texts: [
    { text: 'stamp', written: true, catalog: true },
    { text: 'stamp({precision})', written: true, catalog: true },
  ],
  normalize: (params) => (params.precision === undefined ? { ...params, precision: 6 } : params),
});

const clock = sqlDataType('t/clock', {
  read: (json) => json,
  params: type({ 'precision?': 'number.integer >= 0 & number.integer <= 6' }),
  texts: [
    { text: 'clock', written: true, catalog: true },
    { text: 'clock({precision})', written: true, catalog: true },
  ],
  normalize: (params) => (params.precision === undefined ? { ...params, precision: 6 } : params),
});

const labelled = sqlDataType('t/labelled', {
  read: (json) => json,
  params: type({ label: 'string' }),
  claimsKind: 'labelled',
  fromReported: (reported) => ({ label: reported.name ?? '' }),
  render: ({ label }) => label,
});

const authoringTypes = {
  Text: { kind: 'typeConstructor', inferred: true, output: { codecId: 't/text@1' } },
  Numeric: {
    kind: 'typeConstructor',
    inferred: true,
    args: [
      { kind: 'value', dataType: 't/int', name: 'precision', optional: true },
      { kind: 'value', dataType: 't/int', name: 'scale', optional: true },
    ],
    output: {
      codecId: 't/numeric@1',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  StampDate: {
    kind: 'typeConstructor',
    inferred: true,
    args: [{ kind: 'value', dataType: 't/int', name: 'precision', optional: true }],
    output: { codecId: 't/stamp-date@1', typeParams: { precision: { kind: 'arg', index: 0 } } },
  },
  StampText: {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 't/int', name: 'precision', optional: true }],
    output: { codecId: 't/stamp-text@1', typeParams: { precision: { kind: 'arg', index: 0 } } },
  },
  Stamp: {
    kind: 'typeChoice',
    args: [
      { kind: 'option', name: 'value', values: ['date', 'text'], default: 'date', optional: true },
      { kind: 'value', dataType: 't/int', name: 'precision', optional: true },
    ],
    choices: [
      { when: { value: 'date' }, type: 'StampDate', defaults: { precision: 3 } },
      { when: { value: 'text' }, type: 'StampText' },
    ],
  },
  ClockText: {
    kind: 'typeConstructor',
    inferred: true,
    args: [{ kind: 'value', dataType: 't/int', name: 'precision', optional: true }],
    output: { codecId: 't/clock-text@1', typeParams: { precision: { kind: 'arg', index: 0 } } },
  },
  Clock: {
    kind: 'typeChoice',
    args: [
      { kind: 'option', name: 'value', values: ['text'], default: 'text', optional: true },
      { kind: 'value', dataType: 't/int', name: 'precision', optional: true },
    ],
    choices: [{ when: { value: 'text' }, type: 'ClockText' }],
  },
  ext: {
    Labelled: {
      kind: 'typeConstructor',
      inferred: true,
      args: [{ kind: 'value', dataType: 't/text', name: 'label' }],
      output: { codecId: 't/labelled@1', typeParams: { label: { kind: 'arg', index: 0 } } },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const dataTypeOfCodec: Record<string, string> = {
  't/text@1': 't/text',
  't/numeric@1': 't/numeric',
  't/labelled@1': 't/labelled',
  't/stamp-date@1': 't/stamp',
  't/stamp-text@1': 't/stamp',
  't/clock-text@1': 't/clock',
};

const constructors = inferredTypeConstructors({
  authoringTypes,
  codecLookup: {
    descriptorFor: (codecId) =>
      dataTypeOfCodec[codecId] === undefined
        ? undefined
        : ({ dataType: dataTypeOfCodec[codecId] } as unknown as AnyCodecDescriptor),
  },
  dataTypeLookup: createDataTypeLookup([numeric, text, labelled, stamp, clock]),
});

const dataTypes: DataTypeSupport = {
  entries: {
    [int.id]: {
      written: {
        kind: 'plain',
        syntax: 'number',
        types: [int.id],
        classify: (written) =>
          /^\d+$/.test(written) ? { type: int.id, value: Number(written) } : undefined,
      },
      print: String,
      documentation: 'A whole number.',
    },
    [text.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (written) => written },
      print: String,
      documentation: 'Text.',
    },
  },
  lookup: createDataTypeLookup([int, numeric, text, labelled, stamp, clock]),
  dataTypeOfCodec: (codecId) => {
    const id = dataTypeOfCodec[codecId];
    return id === undefined ? undefined : dataTypeId(id);
  },
};

describe('inferredTypeConstructors', () => {
  it('finds the marked constructor of each data type, by its path', () => {
    expect(
      Object.fromEntries([...constructors].map(([dataType, { path }]) => [dataType, path])),
    ).toEqual({
      't/text': ['Text'],
      't/numeric': ['Numeric'],
      't/stamp': ['StampDate'],
      't/clock': ['ClockText'],
      't/labelled': ['ext', 'Labelled'],
    });
  });
});

describe('fewestArgumentsCall', () => {
  const call = (dataType: string, params: Record<string, unknown>) =>
    fewestArgumentsCall(constructors.get(dataType)!, params);

  it('drops arguments from the end while the normal form stays the same', () => {
    expect({
      bare: call('t/numeric', {}),
      precision: call('t/numeric', { precision: 10, scale: 0 }),
      both: call('t/numeric', { precision: 10, scale: 2 }),
    }).toEqual({
      bare: { path: ['Numeric'], args: [] },
      precision: { path: ['Numeric'], args: [10] },
      both: { path: ['Numeric'], args: [10, 2] },
    });
  });
});

function column(name: string, reportedType: ReportedSqlType, rest: Partial<SqlColumnIRInput> = {}) {
  return new SqlColumnIR({
    name,
    typeText: reportedType.text,
    nullable: false,
    reportedType,
    ...rest,
  });
}

const catalog = (text: string): ReportedSqlType => ({
  text,
  kind: undefined,
  schema: 'pg_catalog',
  name: undefined,
});

describe('writtenTypeChoiceCall', () => {
  const write = (path: readonly string[], args: readonly unknown[]) =>
    writtenTypeChoiceCall({
      authoringTypes,
      call: { path, args },
      dataTypes,
      sameOutput: undefined,
    });

  it('writes the type choice call that becomes the constructor call, each argument by name', () => {
    expect([
      write(['StampDate'], [3]),
      write(['StampText'], [2]),
      write(['StampText'], []),
    ]).toEqual([
      { path: ['Stamp'], args: [], becomes: { path: ['StampDate'], args: [3] } },
      {
        path: ['Stamp'],
        args: [
          { name: 'value', text: 'text' },
          { name: 'precision', text: '2' },
        ],
        becomes: { path: ['StampText'], args: [2] },
      },
      {
        path: ['Stamp'],
        args: [{ name: 'value', text: 'text' }],
        becomes: { path: ['StampText'], args: [] },
      },
    ]);
  });

  it('writes nothing for a call no type choice reproduces exactly, or one no type choice names', () => {
    expect([write(['StampDate'], []), write(['Numeric'], [10])]).toEqual([undefined, undefined]);
  });
});

describe('inferColumnTypes', () => {
  const infer = (
    tables: readonly IntrospectedTable[],
    readsDefault: Parameters<typeof inferColumnTypes>[0]['readsDefault'] = undefined,
  ) =>
    inferColumnTypes({
      tables,
      constructors,
      authoringTypes,
      dataTypes,
      isEnumColumn: () => false,
      readsDefault,
    });

  it("writes each column as its data type's marked constructor, quoting a string argument", async () => {
    const typeOf = await infer([
      {
        schemaName: 'public',
        tableName: 'thing',
        columns: [
          column('amount', catalog('numeric(10,0)')),
          column('label', {
            text: 'gold',
            kind: 'labelled',
            schema: 'public',
            name: 'gold',
          }),
        ],
      },
    ]);
    expect({ amount: typeOf('thing', 'amount'), label: typeOf('thing', 'label') }).toEqual({
      amount: {
        path: ['Numeric'],
        args: [{ name: undefined, text: '10' }],
        explicit: { path: ['Numeric'], values: [10] },
      },
      label: {
        path: ['ext', 'Labelled'],
        args: [{ name: undefined, text: '"gold"' }],
        explicit: { path: ['ext', 'Labelled'], values: ['gold'] },
      },
    });
  });

  it('writes the type choice that becomes the marked constructor, with the arguments that differ from its defaults', async () => {
    const typeOf = await infer([
      {
        schemaName: 'public',
        tableName: 'event',
        columns: [column('at', catalog('stamp')), column('paid', catalog('stamp(3)'))],
      },
    ]);
    expect({ at: typeOf('event', 'at'), paid: typeOf('event', 'paid') }).toEqual({
      at: {
        path: ['Stamp'],
        args: [{ name: 'precision', text: '6' }],
        explicit: { path: ['StampDate'], values: [6] },
      },
      paid: { path: ['Stamp'], args: [], explicit: { path: ['StampDate'], values: [3] } },
    });
  });

  it('records the explicit call the written type choice call becomes, not the column parameters in normal form', async () => {
    const typeOf = await infer([
      { schemaName: 'public', tableName: 'shop', columns: [column('opens', catalog('clock'))] },
    ]);
    expect(typeOf('shop', 'opens')).toEqual({
      path: ['Clock'],
      args: [],
      explicit: { path: ['ClockText'], values: [] },
    });
  });

  it('fails on every column no marked constructor writes, listing them sorted', async () => {
    await expect(
      infer([
        {
          schemaName: 'public',
          tableName: 'zeta',
          columns: [column('tags', catalog('tsquery'), { many: true })],
        },
        { schemaName: 'public', tableName: 'alpha', columns: [column('meta', catalog('hstore'))] },
      ]),
    ).rejects.toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        fix: `No configured pack has a type for these columns. If a type comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts. Otherwise, to keep such a column, write the schema by hand and declare its field as Raw(sql\`<type>\`) with the type as listed, or change the column's type or remove the column from the database.`,
        meta: { columns: ['public.alpha.meta: hstore', 'public.zeta.tags: tsquery[]'] },
      }),
    );
  });

  it('treats a column without a reported type as an internal error', async () => {
    await expect(
      infer([
        {
          schemaName: 'public',
          tableName: 'thing',
          columns: [new SqlColumnIR({ name: 'id', typeText: 'int4', nullable: false })],
        },
      ]),
    ).rejects.toThrow(/without the type the database reported/);
  });

  describe('when the codec of the type choice call cannot read the column default', () => {
    const event: readonly IntrospectedTable[] = [
      { schemaName: 'public', tableName: 'event', columns: [column('at', catalog('stamp(3)'))] },
    ];

    it('writes the first row of the same type choice whose codec reads it', async () => {
      const readsDefault = async (_table: string, _column: SqlColumnIR, call: PslTypeCall) =>
        call.explicit.path.join('.') !== 'StampDate';
      const typeOf = await infer(event, readsDefault);
      expect(typeOf('event', 'at')).toEqual({
        path: ['Stamp'],
        args: [
          { name: 'value', text: 'text' },
          { name: 'precision', text: '3' },
        ],
        explicit: { path: ['StampText'], values: [3] },
      });
    });

    it('keeps the type choice call when no row reads it', async () => {
      const typeOf = await infer(event, async () => false);
      expect(typeOf('event', 'at')).toEqual({
        path: ['Stamp'],
        args: [],
        explicit: { path: ['StampDate'], values: [3] },
      });
    });
  });

  it('asks nothing of a column written as the fewest-arguments call of its constructor', async () => {
    const asked: string[] = [];
    const typeOf = await infer(
      [
        {
          schemaName: 'public',
          tableName: 'thing',
          columns: [column('amount', catalog('numeric(10,0)'))],
        },
      ],
      async (_table, column) => {
        asked.push(column.name);
        return false;
      },
    );
    expect({ amount: typeOf('thing', 'amount'), asked }).toEqual({
      amount: {
        path: ['Numeric'],
        args: [{ name: undefined, text: '10' }],
        explicit: { path: ['Numeric'], values: [10] },
      },
      asked: [],
    });
  });
});
