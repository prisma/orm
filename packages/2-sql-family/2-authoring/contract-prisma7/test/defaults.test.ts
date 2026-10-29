import type { ContractSourceContext } from '@internal/config/config-types';
import type { JsonValue } from '@internal/contract/types';
import { dataTypeId } from '@internal/framework-components/codec';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { prisma7Contract } from '../src/provider';
import {
  fixturesDir,
  interpretSchemaText,
  interpretSchemaTextResult,
  loadFixtureTable,
  postgresSourceContext,
  postgresSourceContextWithout,
} from './support';

describe('DateTime string defaults', () => {
  it('store the value Postgres stores for each native type, read through the type tag', async () => {
    const { columns } = await loadFixtureTable('datetime-defaults', 'Scalars');
    const expressionOf = (column: string) => columns[column]?.['default'];
    expect({
      tsPlus: expressionOf('tsPlus'),
      tzPlus: expressionOf('tzPlus'),
      dMinus: expressionOf('dMinus'),
      tMs: expressionOf('tMs'),
      ttzPlus: expressionOf('ttzPlus'),
    }).toEqual({
      tsPlus: { kind: 'literal', value: '2024-01-02T03:04:05' },
      tzPlus: { kind: 'literal', value: '2024-01-02T01:04:05Z' },
      dMinus: { kind: 'literal', value: '2024-01-02' },
      tMs: { kind: 'literal', value: '12:34:56.789' },
      ttzPlus: { kind: 'literal', value: '03:04:05+02:00' },
    });
  });
});

describe('Bytes[] and DateTime[] list defaults', () => {
  it('store each element as the value Postgres stores', async () => {
    const { columns } = await loadFixtureTable('list-defaults', 'Lists');
    expect(
      Object.fromEntries(
        ['bl', 'blEmpty', 'dl', 'dlEmpty', 'tzl', 'datel', 'timel', 'timetzl', 'ts6l'].map(
          (column) => [column, columns[column]?.['default']],
        ),
      ),
    ).toEqual({
      bl: { kind: 'literal', value: ['aGVsbG8=', 'd29ybGQ='] },
      blEmpty: { kind: 'literal', value: [] },
      dl: { kind: 'literal', value: ['2024-01-01T00:00:00', '2024-01-02T03:04:05.123'] },
      dlEmpty: { kind: 'literal', value: [] },
      tzl: { kind: 'literal', value: ['2024-01-02T03:04:05Z'] },
      datel: { kind: 'literal', value: ['2024-01-02'] },
      timel: { kind: 'literal', value: ['12:34:56'] },
      timetzl: { kind: 'literal', value: ['12:34:56Z'] },
      ts6l: { kind: 'function', expression: "ARRAY['2024-01-02T03:04:05.123456']::timestamp(6)[]" },
    });
  });
});

describe('dbgenerated("<sql>")', () => {
  it('lowers to a raw SQL default without a registry entry for dbgenerated', async () => {
    const { columns } = await loadFixtureTable(
      'defaults',
      'Defaults',
      'public',
      postgresSourceContextWithout('dbgenerated'),
    );
    expect(columns['generated']?.['default']).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
  });

  it('is refused unless the argument list is a single positional string with text in it', async () => {
    expect(await diagnosticsOf('dbgenerated-without-expression', 'unread-argument.prisma')).toEqual(
      [
        'Field "T.number": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.two": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.named": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.blank": @default function "dbgenerated()" has an argument this contract source does not read.',
        'Field "T.spaces": @default function "dbgenerated()" has an argument this contract source does not read.',
      ],
    );
  });
});

describe('dbgenerated() with no expression', () => {
  it('describes a required column with no default and reports nothing', async () => {
    const { columns } = await loadFixtureTable('dbgenerated-without-expression', 'T');
    expect(columns['a']).toEqual({
      dataType: 'pg/text',
      codecId: 'pg/text@1',
      nullable: false,
      many: false,
    });
  });

  it('describes an optional or list column with no default, as Prisma 7 creates it', async () => {
    const { columns } = await loadFixtureTable('dbgenerated-without-expression-optional', 'T');
    expect({ a: columns['a'], list: columns['list'] }).toEqual({
      a: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: true, many: false },
      list: {
        dataType: 'pg/text',
        codecId: 'pg/text@1',
        nullable: true,
        many: { elementNullable: true },
      },
    });
  });
});

describe('Decimal and BigInt number defaults', () => {
  it("keep the number as decimal text, spelled with the column's scale", async () => {
    const { columns } = await loadFixtureTable('number-defaults', 'Decimals');
    expect(
      Object.fromEntries(
        [
          'long',
          'tiny',
          'negative',
          'whole',
          'zerosBare',
          'zerosScaled',
          'zerosDefault',
          'list',
          'bigLong',
          'bigList',
        ].map((column) => [column, columns[column]?.['default']]),
      ),
    ).toEqual({
      long: { kind: 'literal', value: '12345678901234567890.123456789000000000000000000000' },
      tiny: { kind: 'literal', value: '0.000000000000000001000000000000' },
      negative: { kind: 'literal', value: '-1.500000000000000000000000000000' },
      whole: { kind: 'literal', value: '42.000000000000000000000000000000' },
      zerosBare: { kind: 'literal', value: '1.50' },
      zerosScaled: { kind: 'literal', value: '1.50' },
      zerosDefault: { kind: 'literal', value: '1.500000000000000000000000000000' },
      list: {
        kind: 'literal',
        value: [
          '1.500000000000000000000000000000',
          '-2.000000000000000000000000000000',
          '0.000000000000000001000000000000',
        ],
      },
      bigLong: { kind: 'literal', value: '9007199254740993' },
      bigList: { kind: 'literal', value: ['9007199254740993', '-1'] },
    });
  });

  it("drop leading zeros and the sign of zero, keep trailing zeros and pad to the column's scale, as PostgreSQL prints the value", async () => {
    const { columns } = await loadFixtureTable('number-default-spellings', 'Spellings');
    expect(
      Object.fromEntries(
        Object.entries(columns).flatMap(([name, column]) =>
          column['default'] === undefined ? [] : [[name, column['default']]],
        ),
      ),
    ).toEqual({
      leadingZeros: { kind: 'literal', value: '7.000000000000000000000000000000' },
      negativeZero: { kind: 'literal', value: '0.000000000000000000000000000000' },
      leadingZeroFraction: { kind: 'literal', value: '0.100000000000000000000000000000' },
      bareLeadingZeros: { kind: 'literal', value: '7' },
      bareNegativeZero: { kind: 'literal', value: '0' },
      bareLeadingZeroFraction: { kind: 'literal', value: '0.10' },
      long: { kind: 'literal', value: '12345678901234567890.123456789' },
      tiny: { kind: 'literal', value: '0.000000000000000001' },
      zerosBare: { kind: 'literal', value: '1.50' },
      zerosScaled: { kind: 'literal', value: '1.50' },
      bigLong: { kind: 'literal', value: '9007199254740993' },
      bigNegativeZero: { kind: 'literal', value: '0' },
      bigLeadingZeros: { kind: 'literal', value: '7' },
      mixed: {
        kind: 'literal',
        value: ['7', '0', '0.10', '12345678901234567890.123456789', '0.000000000000000001', '1.50'],
      },
      bigMixed: { kind: 'literal', value: ['9007199254740993', '0', '7'] },
    });
  });
});

async function diagnosticsOf(
  caseName: string,
  file: string,
  contextFor: (resolvedInputs: readonly string[]) => ContractSourceContext = postgresSourceContext,
) {
  const schemaPath = join(fixturesDir, caseName, file);
  const result = await prisma7Contract(schemaPath, {
    binding: prisma7PostgresBinding,
  }).source.load(contextFor([schemaPath]));
  return result.ok ? [] : result.failure.diagnostics.map((diagnostic) => diagnostic.message);
}

/** The Postgres composition, with `pg/float8` given a list cast that takes whole numbers. */
function withFloatListCast(resolvedInputs: readonly string[]): ContractSourceContext {
  const context = postgresSourceContext(resolvedInputs);
  const { lookup } = context.dataTypes;
  const float8 = lookup.get(dataTypeId('pg/float8'));
  if (float8 === undefined) throw new Error('the Postgres stack registers pg/float8');
  const withListCast = {
    ...float8,
    listCast: { of: [dataTypeId('pg/int2')], cast: (elements: readonly JsonValue[]) => elements },
  };
  return {
    ...context,
    dataTypes: {
      ...context.dataTypes,
      lookup: {
        get: (id) => (id === float8.id ? withListCast : lookup.get(id)),
        has: (id) => lookup.has(id),
      },
    },
  };
}

describe('Number defaults on String, Bytes, DateTime and Boolean fields', () => {
  it('are refused, naming the data type and the casts the column type has', async () => {
    expect(await diagnosticsOf('number-default-spellings', 'other-types.prisma')).toEqual([
      'Field "OtherTypes.name": @default holds a pg/int2 value, which pg/text has no cast from; it casts from nothing.',
      'Field "OtherTypes.payload": @default holds a pg/int2 value, which pg/bytea has no cast from; it casts from nothing.',
      'Field "OtherTypes.at": @default holds a pg/int2 value, which pg/timestamp has no cast from; it casts from nothing.',
      'Field "OtherTypes.flag": @default holds a pg/int2 value, which pg/bool has no cast from; it casts from nothing.',
    ]);
  });
});

describe('Number defaults written with a plus sign', () => {
  it('are read as the number without the sign', async () => {
    expect(await diagnosticsOf('number-default-spellings', 'plus-sign.prisma')).toEqual([]);
  });
});

describe('Number defaults too large for the column', () => {
  it('are refused before anything is decoded, naming the data type', async () => {
    expect(await diagnosticsOf('number-default-spellings', 'out-of-range.prisma')).toEqual([
      'Field "OutOfRange.count": @default holds a pg/int8 value, which pg/int4 has no cast from; it casts from pg/int2.',
      'Field "OutOfRange.small": @default holds a pg/int4 value, which pg/int2 has no cast from; it casts from nothing.',
      'Field "OutOfRange.ints": @default holds a pg/int8 value at element 2, which pg/int4 has no cast from; it casts from pg/int2.',
    ]);
  });
});

describe('Written lists on single-value columns', () => {
  it('are refused, naming the casts of a type with no list cast', async () => {
    expect(
      await diagnosticsOf('number-default-spellings', 'lists-on-single-values.prisma'),
    ).toEqual([
      'Field "Lists.count": @default holds a list, which pg/int4 has no cast from; it casts from pg/int2.',
      'Field "Lists.ratio": @default holds a list, which pg/float8 has no cast from; it casts from pg/int2, pg/int4, pg/int8, pg/numeric.',
    ]);
  });

  it('are refused at an element the list cast does not take, naming the types it takes', async () => {
    expect(
      await diagnosticsOf(
        'number-default-spellings',
        'lists-on-single-values.prisma',
        withFloatListCast,
      ),
    ).toEqual([
      'Field "Lists.count": @default holds a list, which pg/int4 has no cast from; it casts from pg/int2.',
      'Field "Lists.ratio": @default holds a pg/text value at element 2, which the list cast of pg/float8 does not take; it takes pg/int2.',
    ]);
  });
});

describe('Json defaults whose text is not a JSON document', () => {
  it('are rejected, carrying the JSON parser message', async () => {
    expect(await diagnosticsOf('number-default-spellings', 'unreadable-json.prisma')).toEqual([
      expect.stringMatching(
        /^Field "UnreadableJson\.broken": @default holds text that this contract source does not read: /,
      ),
      expect.stringMatching(
        /^Field "UnreadableJson\.list": @default holds text at element 2 that this contract source does not read: /,
      ),
    ]);
  });
});

describe('Json, Decimal, BigInt and Float literal defaults', () => {
  it('lower through the column codec', async () => {
    const { columns } = await loadFixtureTable('defaults', 'Defaults');
    expect(
      Object.fromEntries(
        ['jsonLiteral', 'decimalLiteral', 'bigIntLiteral', 'floatLiteral', 'intLiteral'].map(
          (column) => [column, columns[column]?.['default']],
        ),
      ),
    ).toEqual({
      jsonLiteral: { kind: 'literal', value: { a: 1 } },
      decimalLiteral: { kind: 'literal', value: '12.340000000000000000000000000000' },
      bigIntLiteral: { kind: 'literal', value: '9007199254740993' },
      floatLiteral: { kind: 'literal', value: 1.5 },
      intLiteral: { kind: 'literal', value: 42 },
    });
  });
});

describe('client functions on VarChar and Char columns', () => {
  it('resolve through the generator function the column codec binds', () => {
    const contract = interpretSchemaText(`datasource db {
  provider = "postgresql"
}

model Account {
  id    String @id @db.VarChar(36) @default(uuid())
  token String @db.VarChar(191) @default(nanoid())
  code  String @db.Char(36) @default(nanoid())
}
`);
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', entry: 'Account', field: 'code' },
        onCreate: { kind: 'generator', id: 'nanoid' },
      },
      {
        ref: { namespace: 'public', entry: 'Account', field: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
      {
        ref: { namespace: 'public', entry: 'Account', field: 'token' },
        onCreate: { kind: 'generator', id: 'nanoid' },
      },
    ]);
  });
});

describe('a client function whose value does not fit its column', () => {
  it.each([
    {
      column: '@db.Char(10) @default(nanoid())',
      message:
        'Field "Account.code": @default(nanoid()) cannot fill its column: nanoid() writes 21 characters, which does not fit a column of 10 characters.',
    },
    {
      column: '@db.VarChar(10) @default(nanoid( 16 ))',
      message:
        'Field "Account.code": @default(nanoid( 16 )) cannot fill its column: nanoid(16) writes 16 characters, which does not fit a column of 10 characters.',
    },
  ])('is refused on $column, since Postgres refuses the insert', ({ column, message }) => {
    const result = interpretSchemaTextResult(`datasource db {
  provider = "postgresql"
}

model Account {
  id   Int    @id
  code String ${column}
}
`);
    expect(
      result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    ).toEqual([{ code: 'PSL.PRISMA7_GENERATOR_REFUSED', message }]);
  });
});
