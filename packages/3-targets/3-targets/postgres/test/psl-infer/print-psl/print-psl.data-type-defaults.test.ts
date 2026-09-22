import { type SqlColumnIRInput, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { parsePostgresDefault } from '../../../src/core/default-normalizer';
import {
  CODEC_ID_BY_PRINTED_TYPE,
  dataTypeForPrintedType,
} from '../../../src/core/psl-infer/infer-default-codec';
import { PRINTED_PSL_TYPE_NAMES } from '../../../src/core/psl-infer/postgres-type-map';
import { printPslFromFlat } from '../fixtures';

/** The backtick fencing a tagged literal, as an escape so no quoted string in this file holds one. */
const BACKTICK = '\u0060';

/** A tagged literal as the printer writes it: `json` plus its fenced body. */
const tagged = (tag: string, body: string): string => `${tag}${BACKTICK}${body}${BACKTICK}`;

function introspected(
  name: string,
  nativeType: string,
  rawDefault: string,
  shape: { readonly many?: true } = {},
): SqlColumnIRInput {
  const resolvedNativeType = shape.many ? `${nativeType}[]` : nativeType;
  return {
    name,
    nativeType,
    nullable: shape.many === true,
    default: rawDefault,
    ...ifDefined('many', shape.many),
    resolvedNativeType,
    ...ifDefined('resolvedDefault', parsePostgresDefault(rawDefault, resolvedNativeType)),
  };
}

/** The `@default(...)` each column prints, keyed by field name. */
function printedDefaults(columns: readonly SqlColumnIRInput[]): Record<string, string> {
  const output = printPslFromFlat(
    new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: Object.fromEntries(
            [{ name: 'id', nativeType: 'int4', nullable: false }, ...columns].map((column) => [
              column.name,
              column,
            ]),
          ),
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        },
      },
    }),
  );
  return Object.fromEntries(
    output
      .split('\n')
      .flatMap((line) => {
        const match = /^\s+(\w+)\s.*?(@default\(.*?\))(?:\s+@|\s*$)/.exec(line);
        return match?.[1] === undefined || match[2] === undefined ? [] : [[match[1], match[2]]];
      })
      .filter(([name]) => name !== 'id'),
  );
}

describe('printPsl writes each default as the literal the column data type takes', () => {
  it('prints every literal form the outcome schema writes', () => {
    expect(
      printedDefaults([
        introspected('name', 'text', "'anonymous'::text"),
        introspected('small', 'int2', "'100'::integer"),
        introspected('count', 'int4', "'100000'::integer"),
        introspected('balance', 'int8', "'100000000000000099'::bigint"),
        introspected('price', 'numeric(10,2)', '1.50'),
        introspected('ratio', 'float8', "'NaN'::numeric"),
        introspected('active', 'bool', 'true'),
        introspected('meta', 'jsonb', `'{"plan": "free", "seats": 1}'::jsonb`),
        introspected('scores', 'int4', "'{1,2}'::integer[]", { many: true }),
        introspected('docs', 'jsonb', `ARRAY['{}'::jsonb, '[]'::jsonb]`, { many: true }),
      ]),
    ).toEqual({
      name: '@default("anonymous")',
      small: '@default(100)',
      count: '@default(100000)',
      balance: '@default(100000000000000099)',
      price: '@default(1.50)',
      ratio: '@default(NaN)',
      active: '@default(true)',
      meta: `@default(${tagged('json', '{"plan":"free","seats":1}')})`,
      scores: '@default([1, 2])',
      docs: `@default([${tagged('json', '{}')}, ${tagged('json', '[]')}])`,
    });
  });

  it('prints every digit of an int8 past the safe integer range', () => {
    expect(printedDefaults([introspected('big', 'int8', "'9007199254740993'::bigint")])).toEqual({
      big: '@default(9007199254740993)',
    });
  });

  it('prints a whole number cast up to the column type', () => {
    expect(printedDefaults([introspected('balance', 'int8', "'42'::bigint")])).toEqual({
      balance: '@default(42)',
    });
  });

  it('prints text that a number would classify as text, because the column holds text', () => {
    expect(printedDefaults([introspected('name', 'text', "'100'::text")])).toEqual({
      name: '@default("100")',
    });
  });

  it.each([
    ['NaN', "'NaN'::numeric", '@default(NaN)'],
    ['Infinity', "'Infinity'::numeric", '@default(Infinity)'],
    ['-Infinity', "'-Infinity'::numeric", '@default(-Infinity)'],
  ])('prints the float8 %s unquoted', (_name, rawDefault, expected) => {
    expect(printedDefaults([introspected('ratio', 'float8', rawDefault)])).toEqual({
      ratio: expected,
    });
  });

  it.each([
    ['a quoted json null element', `ARRAY['null'::jsonb]`, `@default([${tagged('json', 'null')}])`],
    ['a quoted json document element', `ARRAY['{}'::jsonb]`, `@default([${tagged('json', '{}')}])`],
  ])('prints %s', (_name, rawDefault, expected) => {
    expect(printedDefaults([introspected('docs', 'jsonb', rawDefault, { many: true })])).toEqual({
      docs: expected,
    });
  });

  it.each([
    ['an unquoted SQL NULL element', 'ARRAY[NULL::jsonb]'],
    ['an unquoted SQL NULL in an array literal body', `'{NULL}'::jsonb[]`],
  ])(
    'falls back to the raw expression for %s, which is not the JSON value null',
    (_name, rawDefault) => {
      const printed = printedDefaults([introspected('docs', 'jsonb', rawDefault, { many: true })]);
      expect(printed['docs']).not.toContain(tagged('json', 'null'));
    },
  );

  it.each([
    ['infinity', "'infinity'::timestamp without time zone"],
    ['-infinity', "'-infinity'::timestamp without time zone"],
  ])(
    'falls back to the raw expression for the temporal sentinel %s, which its codec refuses',
    (_name, rawDefault) => {
      const printed = printedDefaults([introspected('stamp', 'timestamp', rawDefault)])['stamp'];
      expect(printed).toBe(`@default(sql${BACKTICK}${rawDefault}${BACKTICK})`);
    },
  );

  it('prints an ordinary temporal default as the string its codec reads', () => {
    expect(
      printedDefaults([
        introspected('stamp', 'timestamp', "'2024-01-01 00:00:00'::timestamp without time zone"),
      ]),
    ).toEqual({ stamp: '@default("2024-01-01 00:00:00")' });
  });

  it.each([
    ['a database function', 'uuid', 'gen_random_uuid()'],
    ['an expression', 'timestamptz', "(now() + '00:03:00'::interval)"],
  ])('prints %s as a sql tagged literal', (_name, nativeType, rawDefault) => {
    expect(printedDefaults([introspected('value', nativeType, rawDefault)])).toEqual({
      value: `@default(sql${BACKTICK}${rawDefault}${BACKTICK})`,
    });
  });

  it('prints an expression holding a backtick inside the double-quote fence', () => {
    const rawDefault = `concat('${BACKTICK}', 'x')`;
    expect(printedDefaults([introspected('value', 'text', rawDefault)])).toEqual({
      value: `@default(sql"${rawDefault}")`,
    });
  });

  it('prints a text literal cast to the column type as a string literal', () => {
    expect(printedDefaults([introspected('label', 'text', "'draft'::text")])).toEqual({
      label: '@default("draft")',
    });
  });

  it('prints a jsonb literal cast to the column type as a json literal', () => {
    expect(printedDefaults([introspected('meta', 'jsonb', "'{}'::jsonb")])).toEqual({
      meta: `@default(${tagged('json', '{}')})`,
    });
  });

  it('falls back to the raw expression for a column whose type the map does not recognise', () => {
    expect(printedDefaults([introspected('area', 'geometry', "'POINT(0 0)'::geometry")])).toEqual(
      {},
    );
  });
});

describe('the codec bound to each printed type name', () => {
  it('covers every PSL type name the type map prints', () => {
    expect(PRINTED_PSL_TYPE_NAMES.size).toBeGreaterThan(0);
    expect(
      [...PRINTED_PSL_TYPE_NAMES].filter((name) => !CODEC_ID_BY_PRINTED_TYPE.has(name)),
    ).toEqual([]);
  });

  it('names a registered codec that represents a data type for every printed type', () => {
    expect(
      [...CODEC_ID_BY_PRINTED_TYPE.keys()].filter(
        (typeName) => dataTypeForPrintedType(typeName, false) === undefined,
      ),
    ).toEqual([]);
  });

  it('reads an enum column through the text codec, whose members are text', () => {
    expect(dataTypeForPrintedType('SomeEnum', true)).toBe('pg/text');
  });

  it('names nothing for a type no codec is bound to', () => {
    expect(dataTypeForPrintedType('Unsupported', false)).toBeUndefined();
  });
});
