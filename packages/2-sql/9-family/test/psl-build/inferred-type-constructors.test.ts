import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { AnyCodecDescriptor } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import type { ReportedSqlType, SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { SqlColumnIR } from '@internal/sql-schema-ir/types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { type IntrospectedTable, inferColumnTypes } from '../../src/core/psl-build/column-types';
import {
  fewestArgumentsCall,
  inferredTypeConstructors,
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
      { kind: 'number', name: 'precision', integer: true, optional: true },
      { kind: 'number', name: 'scale', integer: true, optional: true },
    ],
    output: {
      codecId: 't/numeric@1',
      typeParams: {
        precision: { kind: 'arg', index: 0 },
        scale: { kind: 'arg', index: 1 },
      },
    },
  },
  ext: {
    Labelled: {
      kind: 'typeConstructor',
      inferred: true,
      args: [{ kind: 'string', name: 'label' }],
      output: { codecId: 't/labelled@1', typeParams: { label: { kind: 'arg', index: 0 } } },
    },
  },
} as const satisfies AuthoringTypeNamespace;

const dataTypeOfCodec: Record<string, string> = {
  't/text@1': 't/text',
  't/numeric@1': 't/numeric',
  't/labelled@1': 't/labelled',
};

const constructors = inferredTypeConstructors({
  authoringTypes,
  codecLookup: {
    descriptorFor: (codecId) =>
      dataTypeOfCodec[codecId] === undefined
        ? undefined
        : ({ dataType: dataTypeOfCodec[codecId] } as unknown as AnyCodecDescriptor),
  },
  dataTypeLookup: createDataTypeLookup([numeric, text, labelled]),
});

describe('inferredTypeConstructors', () => {
  it('finds the marked constructor of each data type, by its path', () => {
    expect(
      Object.fromEntries([...constructors].map(([dataType, { path }]) => [dataType, path])),
    ).toEqual({
      't/text': ['Text'],
      't/numeric': ['Numeric'],
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
    nativeType: reportedType.text,
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

describe('inferColumnTypes', () => {
  const infer = (tables: readonly IntrospectedTable[]) =>
    inferColumnTypes({ tables, constructors, isEnumColumn: () => false });

  it("writes each column as its data type's marked constructor, quoting a string argument", () => {
    const typeOf = infer([
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
      amount: { path: ['Numeric'], args: ['10'] },
      label: { path: ['ext', 'Labelled'], args: ['"gold"'] },
    });
  });

  it('fails on every column no marked constructor writes, listing them sorted', () => {
    expect(() =>
      infer([
        {
          schemaName: 'public',
          tableName: 'zeta',
          columns: [column('tags', catalog('tsquery'), { many: true })],
        },
        { schemaName: 'public', tableName: 'alpha', columns: [column('meta', catalog('hstore'))] },
      ]),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED',
        fix: "No configured pack has a type for these columns. If a type comes from a database extension that has a Prisma 8 pack, add the pack to extensions in prisma.config.ts. Otherwise change the column's type or remove the column from the database.",
        meta: { columns: ['public.alpha.meta: hstore', 'public.zeta.tags: tsquery[]'] },
      }),
    );
  });

  it('treats a column without a reported type as an internal error', () => {
    expect(() =>
      infer([
        {
          schemaName: 'public',
          tableName: 'thing',
          columns: [new SqlColumnIR({ name: 'id', nativeType: 'int4', nullable: false })],
        },
      ]),
    ).toThrow(/without the type the database reported/);
  });
});
