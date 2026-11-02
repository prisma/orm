import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import {
  type AuthoringTypeNamespaceMember,
  isAuthoringTypeChoiceDescriptor,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { composePostgresStack, readPsl, sourceContext } from '../psl-print/print-and-read-back';

const model = (...fields: readonly string[]) =>
  [
    '// use prisma-8',
    '',
    'model Account {',
    '  id Int @id',
    ...fields.map((f) => `  ${f}`),
    '}',
    '',
  ].join('\n');

const rows: readonly (readonly [convenience: string, explicit: string])[] = [
  ['Int', 'Int4'],
  ['Int(storage: int2)', 'Int2'],
  ['BigInt', 'Int8BigInt'],
  ['BigInt(as: number)', 'Int8Number'],
  ['BigInt(storage: numeric)', 'NumericBigInt'],
  ['Float', 'Float8'],
  ['Float(storage: float4)', 'Float4'],
  ['Decimal', 'NumericString'],
  ['Decimal(precision: 10, scale: 2)', 'NumericString(10, 2)'],
  ['String', 'Text'],
  ['String(storage: varchar)', 'Varchar'],
  ['String(storage: varchar, length: 12)', 'Varchar(12)'],
  ['String(storage: char, length: 3)', 'Char(3)'],
  ['Boolean', 'Bool'],
  ['Bytes', 'Bytea'],
  ['BigInt[]', 'Int8BigInt[]'],
  ['String?', 'Text?'],
];

describe('a convenience scalar type', () => {
  it.each(rows)('%s emits the contract %s emits', async (convenience, explicit) => {
    expect(await readPsl(model(`value ${convenience}`))).toEqual(
      await readPsl(model(`value ${explicit}`)),
    );
  });

  it('emits the contract a schema of explicit types emits, through a types {} alias and with defaults', async () => {
    const convenience = `// use prisma-8

types {
  Code = String(storage: varchar, length: 12) @default("none")
}

model Account {
  id      Int                              @id
  visits  Int(storage: int2)               @default(0)
  balance BigInt                           @default(0)
  rank    BigInt(as: number)
  price   Decimal(precision: 10, scale: 2) @default(1.50)
  name    String
  code    Code
  ratio   Float
  active  Boolean                          @default(true)
  avatar  Bytes?
}
`;
    const explicit = `// use prisma-8

types {
  Code = Varchar(12) @default("none")
}

model Account {
  id      Int4                 @id
  visits  Int2                 @default(0)
  balance Int8BigInt           @default(0)
  rank    Int8Number
  price   NumericString(10, 2) @default(1.50)
  name    Text
  code    Code
  ratio   Float8
  active  Bool                 @default(true)
  avatar  Bytea?
}
`;
    expect(await readPsl(convenience)).toEqual(await readPsl(explicit));
  });

  it.each([
    [
      'BigInt(storage: numeric, as: number)',
      'Argument \\"storage\\" of BigInt cannot be numeric with as: number; write one of: int8.',
    ],
    [
      'String(length: 12)',
      'Argument \\"length\\" of String does not apply to Text, the type that storage: text chooses.',
    ],
    ['Int(storage: int8)', 'Argument \\"storage\\" of Int is int8; write one of: int4, int2.'],
    [
      'Decimal(10, 2)',
      'type \\"Decimal\\" argument #1 is 10, but argument \\"storage\\" takes one of these names, written without quotes: numeric.',
    ],
  ])('refuses %s at the argument', async (written, message) => {
    await expect(readPsl(model(`value ${written}`))).rejects.toThrow(message);
  });
});

async function emitWithWarnings(text: string) {
  const stack = composePostgresStack();
  const directory = mkdtempSync(join(tmpdir(), 'convenience-scalar-types-'));
  try {
    const path = join(directory, 'contract.prisma');
    writeFileSync(path, text);
    const warnings: ContractSourceDiagnostic[] = [];
    const result = await prismaContract(path, {
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
      enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
    }).source.load({
      ...sourceContext(stack, [path]),
      reportWarning: (diagnostic) => {
        warnings.push(diagnostic);
      },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    return { contract: result.value, warnings };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('a renamed explicit type name', () => {
  it.each([
    ['SmallInt', 'Int2'],
    ['BigIntNumber', 'Int8Number'],
    ['Numeric(10, 2)', 'NumericString(10, 2)'],
    ['UnboundedInt', 'NumericBigInt'],
    ['Real', 'Float4'],
    ['VarChar(12)', 'Varchar(12)'],
    ['VarBit(8)', 'Varbit(8)'],
  ])(
    '%s warns that it is deprecated, and emits the contract %s emits',
    async (written, current) => {
      const deprecated = await emitWithWarnings(model(`value ${written}`));
      const replaced = await emitWithWarnings(model(`value ${current}`));
      const name = written.replace(/\(.*$/, '');
      const replacement = current.replace(/\(.*$/, '');

      expect(deprecated.warnings).toEqual([
        expect.objectContaining({
          code: 'PSL_DEPRECATED_SCALAR_NAME',
          message: `Scalar type "${name}" is deprecated and will be removed; use "${replacement}".`,
          severity: 'warning',
        }),
      ]);
      expect(replaced.warnings).toEqual([]);
      expect(deprecated.contract).toEqual(replaced.contract);
    },
  );
});

describe('a current type name', () => {
  const writtenBare = (member: AuthoringTypeNamespaceMember) =>
    isAuthoringTypeChoiceDescriptor(member) ||
    (isAuthoringTypeConstructorDescriptor(member) &&
      member.deprecated === undefined &&
      (member.args ?? []).every((arg) => arg.optional === true));
  const currentNames = Object.entries(postgresPackRef.authoring.type)
    .filter(([, member]) => writtenBare(member))
    .map(([name]) => name);

  it('covers every convenience type and every renamed explicit type', () => {
    expect(currentNames).toEqual(
      expect.arrayContaining([
        ...new Set(rows.flatMap((row) => row.map((written) => written.replace(/[([?].*$/, '')))),
      ]),
    );
  });

  it('never warns, whether written bare or as any convenience row', async () => {
    const fields = [...currentNames, ...rows.flat()].map(
      (written, index) => `f${index} ${written}`,
    );
    const { warnings } = await emitWithWarnings(model(...fields));
    expect(warnings).toEqual([]);
  });
});
