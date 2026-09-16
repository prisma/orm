import { type SqlColumnIRInput, SqlSchemaIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { parsePostgresDefault } from '../../../src/core/default-normalizer';
import { printPslFromFlat } from '../fixtures';

/**
 * A column as the control adapter introspects it: `rawDefault` is what Postgres printed for the
 * column, and the resolved default is read by the target's own parser.
 */
function introspected(
  name: string,
  nativeType: string,
  rawDefault: string,
  shape: { readonly many?: true; readonly nullable?: true } = {},
): SqlColumnIRInput {
  const resolvedNativeType = shape.many ? `${nativeType}[]` : nativeType;
  return {
    name,
    nativeType,
    nullable: shape.many === true || shape.nullable === true,
    default: rawDefault,
    ...ifDefined('many', shape.many),
    resolvedNativeType,
    ...ifDefined('resolvedDefault', parsePostgresDefault(rawDefault, resolvedNativeType)),
  };
}

function printTable(name: string, columns: readonly SqlColumnIRInput[]): string {
  return printPslFromFlat(
    new SqlSchemaIR({
      tables: {
        [name]: {
          name,
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
}

describe('printPsl literal defaults', () => {
  describe('given scalar columns', () => {
    it('prints each default as the literal its codec accepts, with every digit and no exponent', () => {
      const output = printTable('number_defaults', [
        introspected('negInt', 'int4', "'-1'::integer"),
        introspected('negSmallInt', 'int2', "'-2'::integer"),
        introspected('negFloat', 'float8', "'-1.5'::numeric"),
        introspected('tinyFloat', 'float8', '0.0000001'),
        introspected('negReal', 'float4', "'-2.5'::numeric"),
        introspected('negDecimal', 'numeric(65,30)', "'-0.5'::numeric"),
        introspected('longDecimal', 'numeric(65,30)', '12345678901234567890.123456789'),
        introspected('tinyDecimal', 'numeric(65,30)', '0.000000000000000001'),
        introspected('scaleDecimal', 'numeric(65,30)', '1.50'),
        introspected('scaledDecimal', 'numeric(10,2)', "'-1.25'::numeric"),
        introspected('safeBigInt', 'int8', '5'),
        introspected('negSafeBigInt', 'int8', "'-5'::integer"),
        introspected('negBigInt', 'int8', "'-9007199254740993'::bigint"),
        introspected('hugeBigInt', 'int8', "'9007199254740993'::bigint"),
      ]);

      expect(output).toMatchInlineSnapshot(`
        "// use prisma-8
        // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

        model NumberDefaults {
          id            Int             @id
          negInt        Int             @default(-1)
          negSmallInt   SmallInt        @default(-2)
          negFloat      Float           @default(-1.5)
          tinyFloat     Float           @default(0.0000001)
          negReal       Real            @default(-2.5)
          negDecimal    Numeric(65, 30) @default("-0.5")
          longDecimal   Numeric(65, 30) @default("12345678901234567890.123456789")
          tinyDecimal   Numeric(65, 30) @default("0.000000000000000001")
          scaleDecimal  Numeric(65, 30) @default("1.50")
          scaledDecimal Numeric(10, 2)  @default("-1.25")
          safeBigInt    BigInt          @default(5)
          negSafeBigInt BigInt          @default(-5)
          negBigInt     BigInt          @default(-9007199254740993)
          hugeBigInt    BigInt          @default(9007199254740993)

          @@map("number_defaults")
        }
        "
      `);
    });

    it('prints a default that has no PSL literal as dbgenerated with the expression Postgres printed', () => {
      const output = printTable('raw_defaults', [
        introspected('stamp', 'timestamp(3)', "'2024-01-01 00:00:00'::timestamp without time zone"),
        introspected('day', 'date', "'2024-01-01'::date"),
        introspected('jsonNull', 'jsonb', "'null'::jsonb", { nullable: true }),
        introspected('textNull', 'character varying(32)', 'NULL::character varying', {
          nullable: true,
        }),
      ]);

      expect(output).toMatchInlineSnapshot(`
        "// use prisma-8
        // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

        model RawDefaults {
          id       Int          @id
          stamp    Timestamp(3) @default(dbgenerated("'2024-01-01 00:00:00'::timestamp without time zone"))
          day      Date         @default(dbgenerated("'2024-01-01'::date"))
          jsonNull Jsonb?       @default(dbgenerated("'null'::jsonb"))
          textNull VarChar(32)? @default(dbgenerated("NULL::character varying"))

          @@map("raw_defaults")
        }
        "
      `);
    });
  });

  describe('given special values and a time with time zone, written in SQL', () => {
    it('prints each default as the quoted text its codec accepts', () => {
      const output = printTable('special_value_defaults', [
        introspected('floatNaN', 'float8', "'NaN'::double precision"),
        introspected('floatNegInf', 'float8', "'-Infinity'::double precision"),
        introspected('realNaN', 'float4', "'NaN'::real"),
        introspected('decimalNaN', 'numeric', "'NaN'::numeric"),
        introspected('timeWithZone', 'timetz', "'12:34:56+00'::time with time zone"),
      ]);

      expect(output).toMatchInlineSnapshot(`
        "// use prisma-8
        // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

        model SpecialValueDefaults {
          id           Int     @id
          floatNaN     Float   @default("NaN")
          floatNegInf  Float   @default("-Infinity")
          realNaN      Real    @default("NaN")
          decimalNaN   Numeric @default("NaN")
          timeWithZone Timetz  @default("12:34:56+00")

          @@map("special_value_defaults")
        }
        "
      `);
    });
  });

  describe('given list columns Prisma 7 created', () => {
    it('prints each element as the literal its codec accepts', () => {
      const output = printTable('list_defaults', [
        introspected('negInts', 'int4', "ARRAY['-1'::integer, 2]", { many: true }),
        introspected('negSmallInts', 'int2', "ARRAY[('-1'::integer)::smallint, (2)::smallint]", {
          many: true,
        }),
        introspected('bigInts', 'int8', 'ARRAY[(1)::bigint, (2)::bigint]', { many: true }),
        introspected('negBigInts', 'int8', "ARRAY[('-1'::integer)::bigint, (2)::bigint]", {
          many: true,
        }),
        introspected('emptyBigInts', 'int8', 'ARRAY[]::bigint[]', { many: true }),
        introspected(
          'hugeBigInts',
          'int8',
          "ARRAY['9007199254740993'::bigint, '-9007199254740993'::bigint]",
          { many: true },
        ),
        introspected(
          'negFloats',
          'float8',
          "ARRAY[('-1.5'::numeric)::double precision, (2)::double precision]",
          { many: true },
        ),
        introspected(
          'longDecimals',
          'numeric(65,30)',
          'ARRAY[12345678901234567890.123456789::numeric(65,30), 0.000000000000000001::numeric(65,30)]',
          { many: true },
        ),
        introspected(
          'scaledDecimals',
          'numeric(10,2)',
          "ARRAY['-1.25'::numeric(10,2), (2)::numeric(10,2)]",
          { many: true },
        ),
        introspected(
          'emptyVarchars',
          'character varying(32)',
          '(ARRAY[]::character varying[])::character varying(32)[]',
          { many: true },
        ),
      ]);

      expect(output).toMatchInlineSnapshot(`
        "// use prisma-8
        // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

        model ListDefaults {
          id             Int                @id
          negInts        Int[]?             @default([-1, 2]) @noCheck(elementNotNull)
          negSmallInts   SmallInt[]?        @default([-1, 2]) @noCheck(elementNotNull)
          bigInts        BigInt[]?          @default([1, 2]) @noCheck(elementNotNull)
          negBigInts     BigInt[]?          @default([-1, 2]) @noCheck(elementNotNull)
          emptyBigInts   BigInt[]?          @default([]) @noCheck(elementNotNull)
          hugeBigInts    BigInt[]?          @default([9007199254740993, -9007199254740993]) @noCheck(elementNotNull)
          negFloats      Float[]?           @default([-1.5, 2]) @noCheck(elementNotNull)
          longDecimals   Numeric(65, 30)[]? @default(["12345678901234567890.123456789", "0.000000000000000001"]) @noCheck(elementNotNull)
          scaledDecimals Numeric(10, 2)[]?  @default(["-1.25", "2"]) @noCheck(elementNotNull)
          emptyVarchars  VarChar(32)[]?     @default([]) @noCheck(elementNotNull)

          @@map("list_defaults")
        }
        "
      `);
    });

    it('prints a default with an element that has no PSL literal as dbgenerated with the expression Postgres printed', () => {
      const output = printTable('raw_list_defaults', [
        introspected(
          'timestamps',
          'timestamp(3)',
          "ARRAY['2024-01-01 00:00:00'::timestamp(3) without time zone]",
          { many: true },
        ),
      ]);

      expect(output).toMatchInlineSnapshot(`
        "// use prisma-8
        // Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

        model RawListDefaults {
          id         Int             @id
          timestamps Timestamp(3)[]? @default(dbgenerated("ARRAY['2024-01-01 00:00:00'::timestamp(3) without time zone]")) @noCheck(elementNotNull)

          @@map("raw_list_defaults")
        }
        "
      `);
    });
  });
});
