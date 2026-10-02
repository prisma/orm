import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { float4Column, int4Column } from '@internal/adapter-postgres/column-types';
import type { Contract } from '@internal/contract/types';
import { defineContract, field, model } from '@internal/postgres/contract-builder';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { composePostgresStack, sourceContext } from '../psl-print/print-and-read-back';
import { authorSqlContractFromPsl, findStorageColumn } from '../scalar-lists/psl-list-authoring';

const stack = composePostgresStack();

/** A schema loaded the way `defineConfig` loads it, enum inference included. */
async function load(schema: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'psl-codec-reads-')), 'schema.prisma');
  writeFileSync(path, `// use prisma-8\n\n${schema}`, 'utf-8');
  return prismaContract(path, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  }).source.load(sourceContext(stack, [path]));
}

async function diagnosticsOf(schema: string) {
  const result = await load(schema);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

/** The values an enum typed by `codecId` stores for `members`, or the diagnostics that refuse it. */
async function storedEnumValues(codecId: string, members: readonly string[]) {
  const result = await load(`
enum Priority {
  @@type("${codecId}")
${members.map((line) => `  ${line}`).join('\n')}
}

model Task {
  id       Int      @id
  priority Priority
}
`);
  if (!result.ok) {
    return {
      diagnostics: result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
    };
  }
  const { storage } = result.value as Contract<SqlStorage>;
  return {
    values: Object.values(storage.namespaces).flatMap(
      (namespace) => namespace.entries.valueSet?.['Priority']?.values ?? [],
    ),
  };
}

describe('PSL defaults read by the Postgres codecs', () => {
  it('a Uuid default in any form PostgreSQL reads is stored in the form PostgreSQL writes', async () => {
    const forms = [
      'A0EEBC99-9C0B-4EF8-BB6D-6BB9BD380A11',
      '{a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11}',
      'a0eebc999c0b4ef8bb6d6bb9bd380a11',
      'a0ee-bc99-9c0b-4ef8-bb6d-6bb9-bd38-0a11',
    ];
    const authored = await authorSqlContractFromPsl(`
model Token {
  id Int @id
${forms.map((form, index) => `  u${index} Uuid @default("${form}")`).join('\n')}
}
`);

    expect({
      diagnostics: authored.diagnostics,
      defaults: forms.map(
        (_, index) => findStorageColumn(authored.contract!, `u${index}`)?.['default'],
      ),
    }).toEqual({
      diagnostics: [],
      defaults: forms.map(() => ({
        kind: 'literal',
        value: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      })),
    });
  });

  it('a Uuid default PostgreSQL does not read is refused', async () => {
    const authored = await authorSqlContractFromPsl(`
model Token {
  id Int  @id
  u  Uuid @default("nope")
}
`);

    expect(authored.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_INVALID_LITERAL',
        message:
          'Field "Token.u": "nope" is not a UUID: PostgreSQL reads 32 hexadecimal digits, with a hyphen after any group of four and optionally in braces.',
      },
    ]);
  });

  it('a VarChar default longer than its length is refused', async () => {
    const authored = await authorSqlContractFromPsl(`
model Token {
  id Int            @id
  s  VarChar(3) @default("toolong")
}
`);

    expect(authored.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message:
          'Field "Token.s": sql/varchar@1 JSON value must be a string of at most 3 characters',
      },
    ]);
  });

  it('a Numeric default the type would round is refused', async () => {
    expect(
      await diagnosticsOf(`
model Price {
  id Int            @id
  n  Numeric(5, 2) @default(1.555)
}
`),
    ).toEqual([
      {
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message:
          'Field "Price.n": pg/numeric@1 JSON value must be a decimal string that numeric(5, 2) stores without rounding',
      },
    ]);
  });

  it('an inferred integer enum member outside the int4 range is refused', async () => {
    expect(
      await diagnosticsOf(`
enum Priority {
  Low  = 3000000000
  High = 1
}

model Task {
  id Int @id
}
`),
    ).toEqual([
      {
        code: 'PSL_EXTENSION_INVALID_VALUE',
        message:
          'enum "Priority" member "Low": pg/int4 has no cast from pg/int8; it casts from pg/int2',
      },
    ]);
  });

  describe('an enum member its @@type codec does not take', () => {
    const enumOf = (members: string) => `
enum Priority {
${members}
}

model Task {
  id Int @id
}
`;

    it.each([
      [
        'a text member under an integer codec',
        '  @@type("pg/int4@1")\n  Low = "low"',
        'PSL_EXTENSION_INVALID_VALUE',
        'enum "Priority" member "Low" was rejected by codec "pg/int4@1": pg/int4@1 JSON value must be an integer from -2147483648 to 2147483647',
      ],
      [
        'a bare member under an integer codec',
        '  @@type("pg/int4@1")\n  Low',
        'PSL_ENUM_BARE_MEMBER_NON_STRING_CODEC',
        'enum "Priority" member "Low" has no value and codec "pg/int4@1" does not accept a bare name as input',
      ],
      [
        'a number member under a text codec',
        '  @@type("pg/text@1")\n  Low = 1',
        'PSL_EXTENSION_INVALID_VALUE',
        'enum "Priority" member "Low": pg/text has no cast from pg/int2; it casts from nothing',
      ],
      [
        'a fraction under an integer codec',
        '  @@type("pg/int4@1")\n  Low = 1.5',
        'PSL_EXTENSION_INVALID_VALUE',
        'enum "Priority" member "Low": pg/int4 has no cast from pg/numeric; it casts from pg/int2',
      ],
    ])('refuses %s', async (_name, members, code, message) => {
      expect(await diagnosticsOf(enumOf(members))).toEqual([{ code, message }]);
    });
  });

  describe('an enum member written as a number literal, read from its source text', () => {
    it('stores a pg/int8@1 member past 2^53 with every digit, so the integer below it is not a duplicate', async () => {
      expect(
        await storedEnumValues('pg/int8@1', ['A = 9007199254740993', 'B = 9007199254740992']),
      ).toEqual({ values: ['9007199254740993', '9007199254740992'] });
    });

    it('stores every digit of a pg/numeric@1 member', async () => {
      expect(await storedEnumValues('pg/numeric@1', ['A = 0.12345678901234567890'])).toEqual({
        values: ['0.12345678901234567890'],
      });
    });
  });

  describe('an enum member written as a string literal, read by its codec', () => {
    it.each([
      ['pg/int8@1', '"9007199254740993"', '9007199254740993'],
      ['pg/int8number@1', '"42"', '42'],
      ['pg/unboundedint@1', '"9223372036854775808"', '9223372036854775808'],
      ['pg/numeric@1', '"1.50"', '1.50'],
      ['pg/json@1', '"low"', 'low'],
      ['pg/jsonb@1', '"low"', 'low'],
    ])('accepts a %s member written as %s', async (codecId, written, stored) => {
      expect(await storedEnumValues(codecId, [`Low = ${written}`])).toEqual({ values: [stored] });
    });
  });

  describe('a default PostgreSQL would refuse at the first insert', () => {
    it('refuses an integer outside int4 for an sql/int@1 enum member, whose column is int4', async () => {
      expect(
        await diagnosticsOf(`
enum Priority {
  @@type("sql/int@1")
  Low = 3000000000
}

model Task {
  id Int @id
}
`),
      ).toEqual([
        {
          code: 'PSL_EXTENSION_INVALID_VALUE',
          message:
            'enum "Priority" member "Low": pg/int4 has no cast from pg/int8; it casts from pg/int2',
        },
      ]);
    });

    it('refuses a Char default longer than one character, which is what a Char with no length holds', async () => {
      expect(
        await diagnosticsOf(`
model Tag {
  id Int  @id
  c  Char @default("abc")
}
`),
      ).toEqual([
        {
          code: 'PSL_INVALID_DEFAULT_LITERAL',
          message:
            'Field "Tag.c": sql/char@1 JSON value must be a string of at most 1 character before any trailing spaces',
        },
      ]);
    });

    it.each([
      [
        'a float4 default outside the float4 range',
        () => field.column(float4Column).default(1e300),
        'pg/float4@1',
        'Field "Reading.value" has a default that its codec refuses: pg/float4@1 JSON value must be a number float4 holds, at most 3.4028234663852886e+38 in magnitude and not so small that it becomes 0, or the text NaN, Infinity or -Infinity',
      ],
      [
        'a bit default of two bits on a bit column with no length, which holds one',
        () => field.column({ codecId: 'pg/bit@1' } as const).default('01'),
        'pg/bit@1',
        'Field "Reading.value" has a default that its codec refuses: pg/bit@1 JSON value must be a string of exactly 1 bit',
      ],
    ])('refuses %s when the TypeScript contract is built', (_name, value, codecId, message) => {
      const build = () =>
        defineContract({
          models: {
            Reading: model('Reading', {
              fields: { id: field.column(int4Column).id(), value: value() },
            }).sql({ table: 'readings' }),
          },
        });
      expect(build).toThrow(
        expect.objectContaining({
          code: 'CONTRACT.DEFAULT_INVALID',
          message,
          meta: expect.objectContaining({
            modelName: 'Reading',
            fieldName: 'value',
            codecId,
            reason: 'codec-refused-default',
          }),
        }),
      );
    });
  });
});
