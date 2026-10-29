import { inferredTypeConstructors } from '@internal/family-sql/psl-build';
import type { Codec } from '@internal/framework-components/codec';
import { type SqlColumnIRInput, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { describe, expect, it } from 'vitest';
import { pgTimestamp } from '../../../src/core/data-types';
import { inferredColumnDefaults } from '../../../src/core/psl-infer/infer-default-codec';
import { readDefaultWithCodec } from '../../../src/core/psl-infer/infer-read-defaults';
import { inferBuildContext, printPslFromFlat } from '../fixtures';

/** The backtick fencing a tagged literal, as an escape so no quoted string in this file holds one. */
const BACKTICK = '\u0060';

/** A tagged literal as the printer writes it: `json` plus its fenced body. */
const tagged = (tag: string, body: string): string => `${tag}${BACKTICK}${body}${BACKTICK}`;

function introspected(
  name: string,
  typeText: string,
  rawDefault: string,
  shape: { readonly many?: true } = {},
): SqlColumnIRInput {
  return {
    name,
    typeText,
    nullable: shape.many === true,
    default: rawDefault,
    ...ifDefined('many', shape.many),
  };
}

/** The `@default(...)` each column prints, keyed by field name. */
async function printedDefaults(
  columns: readonly SqlColumnIRInput[],
): Promise<Record<string, string>> {
  const output = await printPslFromFlat(
    new SqlSchemaIR({
      tables: {
        account: {
          name: 'account',
          columns: Object.fromEntries(
            [{ name: 'id', typeText: 'int4', nullable: false }, ...columns].map((column) => [
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
  it('prints every literal form the outcome schema writes', async () => {
    expect(
      await printedDefaults([
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
      price: '@default(1.5)',
      ratio: '@default(NaN)',
      active: '@default(true)',
      meta: `@default(${tagged('json', '{"plan":"free","seats":1}')})`,
      scores: '@default([1, 2])',
      docs: `@default([${tagged('json', '{}')}, ${tagged('json', '[]')}])`,
    });
  });

  it('prints a json or jsonb document that is a number, a boolean or null with the json tag', async () => {
    expect(
      await printedDefaults([
        introspected('count', 'jsonb', `'42'::jsonb`),
        introspected('flag', 'json', `'true'::json`),
        introspected('nothing', 'jsonb', `'null'::jsonb`),
      ]),
    ).toMatchObject({
      count: `@default(${tagged('json', '42')})`,
      flag: `@default(${tagged('json', 'true')})`,
      nothing: `@default(${tagged('json', 'null')})`,
    });
  });

  it('prints a whole number cast up to the column type', async () => {
    expect(await printedDefaults([introspected('balance', 'int8', "'42'::bigint")])).toEqual({
      balance: '@default(42)',
    });
  });

  it('prints text that a number would classify as text, because the column holds text', async () => {
    expect(await printedDefaults([introspected('name', 'text', "'100'::text")])).toEqual({
      name: '@default("100")',
    });
  });

  it.each([
    ['NaN', "'NaN'::numeric", '@default(NaN)'],
    ['Infinity', "'Infinity'::numeric", '@default(Infinity)'],
    ['-Infinity', "'-Infinity'::numeric", '@default(-Infinity)'],
  ])('prints the float8 %s unquoted', async (_name, rawDefault, expected) => {
    expect(await printedDefaults([introspected('ratio', 'float8', rawDefault)])).toEqual({
      ratio: expected,
    });
  });

  it.each([
    ['a quoted json null element', `ARRAY['null'::jsonb]`, `@default([${tagged('json', 'null')}])`],
    ['a quoted json document element', `ARRAY['{}'::jsonb]`, `@default([${tagged('json', '{}')}])`],
  ])('prints %s', async (_name, rawDefault, expected) => {
    expect(
      await printedDefaults([introspected('docs', 'jsonb', rawDefault, { many: true })]),
    ).toEqual({
      docs: expected,
    });
  });

  it.each([
    ['an unquoted SQL NULL element', 'ARRAY[NULL::jsonb]'],
    ['an unquoted SQL NULL in an array literal body', `'{NULL}'::jsonb[]`],
  ])(
    'falls back to the raw expression for %s, which is not the JSON value null',
    async (_name, rawDefault) => {
      const printed = await printedDefaults([
        introspected('docs', 'jsonb', rawDefault, { many: true }),
      ]);
      expect(printed['docs']).not.toContain(tagged('json', 'null'));
    },
  );

  it('prints a default with digits below a millisecond, which a Date cannot hold, as its raw expression', async () => {
    const rawDefault = "'2024-01-01 01:00:00.123456+00'::timestamp(6) with time zone";
    expect(await printedDefaults([introspected('stamp', 'timestamptz(6)', rawDefault)])).toEqual({
      stamp: `@default(sql\`${rawDefault}\`)`,
    });
  });

  it('prints a list default with an element a Date cannot hold as its raw expression, and one it holds as a literal list', async () => {
    const micro =
      "ARRAY['2024-01-01 01:00:00.123+00'::timestamp with time zone, '2024-01-01 01:00:00.123456+00'::timestamp with time zone]";
    const milli =
      "ARRAY['2024-01-01 01:00:00.123+00'::timestamp with time zone, '2024-01-01 01:00:00.5+00'::timestamp with time zone]";
    expect(
      await printedDefaults([
        introspected('micro', 'timestamptz(6)', micro, { many: true }),
        introspected('milli', 'timestamptz(6)', milli, { many: true }),
      ]),
    ).toEqual({
      micro: `@default(sql\`${micro}\`)`,
      milli:
        '@default([timestamptz`2024-01-01T01:00:00.123Z`, timestamptz`2024-01-01T01:00:00.5Z`])',
    });
  });

  it('prints the raw expression when the codec refuses the value its data type reads from the body', async () => {
    const codec = {
      id: 'test/strict-timestamp@1',
      dataType: pgTimestamp,
      fromWire: async () => new Date('2024-01-01T00:00:00Z'),
      toDataTypeValue: () => pgTimestamp.valueFrom('2024-01-01T00:00:00', {}),
      fromDataTypeValue: () => {
        throw new Error('the application value cannot hold this instant exactly');
      },
      toWire: async () => '',
    } as unknown as Codec;
    const raw = "'2024-01-01 00:00:00'::timestamp without time zone";
    expect(await readDefaultWithCodec(raw, false, codec)).toEqual({
      kind: 'function',
      expression: raw,
    });
  });

  it('prints a timestamp default written with an offset as the instant, when a Date holds it', async () => {
    expect(
      await printedDefaults([
        introspected(
          'stamp',
          'timestamptz(6)',
          "'2024-01-01 03:00:00.5+02'::timestamp with time zone",
        ),
      ]),
    ).toEqual({ stamp: '@default(timestamptz`2024-01-01T01:00:00.5Z`)' });
  });

  it.each([['-infinity', 'date', "'-infinity'::date"]])(
    'prints the %s sentinel on a %s column with the column type tag',
    async (sentinel, typeText, rawDefault) => {
      expect(await printedDefaults([introspected('stamp', typeText, rawDefault)])).toEqual({
        stamp: `@default(${tagged(typeText, sentinel)})`,
      });
    },
  );

  it.each([
    ['timestamp', "'2024-01-01 00:00:00'::timestamp without time zone", '2024-01-01T00:00:00'],
    ['timestamptz', "'2024-01-01 01:00:00+00'::timestamp with time zone", '2024-01-01T01:00:00Z'],
    ['date', "'2024-01-01'::date", '2024-01-01'],
    ['time', "'12:34:56.5'::time without time zone", '12:34:56.5'],
    ['timetz', "'12:34:56+02'::time with time zone", '12:34:56+02:00'],
    [
      'timestamptz',
      "'0044-03-15 00:00:00+00 BC'::timestamp with time zone",
      '-000043-03-15T00:00:00Z',
    ],
  ])(
    'prints a %s default with its tag, in canonical form',
    async (typeText, rawDefault, standard) => {
      expect(await printedDefaults([introspected('stamp', typeText, rawDefault)])).toEqual({
        stamp: `@default(${tagged(typeText, standard)})`,
      });
    },
  );

  it('prints a bytea default with the bytea tag, in the hex PostgreSQL prints', async () => {
    expect(
      await printedDefaults([
        introspected('blob', 'bytea', "'\\x68656c6c6f'::bytea"),
        introspected('empty', 'bytea', "'\\x'::bytea"),
        introspected('blobs', 'bytea', "ARRAY['\\x68656c6c6f'::bytea, '\\x0001'::bytea]", {
          many: true,
        }),
      ]),
    ).toEqual({
      blob: `@default(${tagged('bytea', '\\x68656c6c6f')})`,
      empty: `@default(${tagged('bytea', '\\x')})`,
      blobs: `@default([${tagged('bytea', '\\x68656c6c6f')}, ${tagged('bytea', '\\x0001')}])`,
    });
  });

  it.each([
    ['a database function', 'uuid', 'gen_random_uuid()'],
    ['an expression', 'timestamptz', "(now() + '00:03:00'::interval)"],
  ])('prints %s as a sql tagged literal', async (_name, typeText, rawDefault) => {
    expect(await printedDefaults([introspected('value', typeText, rawDefault)])).toEqual({
      value: `@default(sql${BACKTICK}${rawDefault}${BACKTICK})`,
    });
  });

  it('prints an expression holding a backtick inside the double-quote fence', async () => {
    const rawDefault = `concat('${BACKTICK}', 'x')`;
    expect(await printedDefaults([introspected('value', 'text', rawDefault)])).toEqual({
      value: `@default(sql"${rawDefault}")`,
    });
  });

  it('refuses a column whose type no data type in the stack claims', async () => {
    await expect(
      printedDefaults([introspected('area', 'geometry', "'POINT(0 0)'::geometry")]),
    ).rejects.toThrow(expect.objectContaining({ code: 'CONTRACT.INFER_COLUMN_TYPE_UNCLAIMED' }));
  });
});

describe('the codec of each inferred type name, from the stack', () => {
  const { codecOf } = inferredColumnDefaults(inferBuildContext);

  it('names one for every constructor contract infer writes', async () => {
    const paths = [
      ...inferredTypeConstructors({
        authoringTypes: inferBuildContext.authoringContributions.type,
        codecLookup: inferBuildContext.codecLookup,
        dataTypeLookup: inferBuildContext.dataTypes.lookup,
      }).values(),
    ]
      .map(({ path }) => path)
      .filter((path) => path.join('.') !== 'pg.enum');
    expect(paths.length).toBeGreaterThan(20);
    expect(paths.filter((path) => codecOf({ path }, false) === undefined)).toEqual([]);
  });

  it('reads an enum column through the text codec, whose members are text', async () => {
    expect(codecOf({ path: ['SomeEnum'] }, true)?.codecId).toBe('pg/text@1');
  });

  it('names nothing for a type no type constructor has', async () => {
    expect(codecOf({ path: ['NoSuchType'] }, false)).toBeUndefined();
  });
});

describe('a failure the default checks do not expect', () => {
  const codecId = 'pg/text@1';
  const textDescriptor = inferBuildContext.codecLookup.descriptorFor(codecId);
  const brokenContext = {
    ...inferBuildContext,
    codecLookup: {
      ...inferBuildContext.codecLookup,
      descriptorFor: (id: string) =>
        id === codecId && textDescriptor !== undefined
          ? {
              ...textDescriptor,
              factory: () => () => {
                throw new InternalError('a codec pack broke an invariant');
              },
            }
          : inferBuildContext.codecLookup.descriptorFor(id),
    },
  };
  const { readsBack } = inferredColumnDefaults(brokenContext);

  it('passes an internal error through instead of printing the default as raw SQL', async () => {
    expect(() => readsBack('abc', { path: ['String'] }, false, false)).toThrow(
      'a codec pack broke an invariant',
    );
  });

  it('still reads a structured refusal as a default the codec does not take', async () => {
    expect(
      inferredColumnDefaults(inferBuildContext).readsBack(1, { path: ['String'] }, false, false),
    ).toBe(false);
  });
});
