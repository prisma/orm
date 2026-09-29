import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { composePostgresStack, sourceContext } from '../psl-print/print-and-read-back';
import { authorSqlContractFromPsl, findStorageColumn } from '../scalar-lists/psl-list-authoring';

const stack = composePostgresStack();

/** The diagnostics of a schema loaded the way `defineConfig` loads it, enum inference included. */
async function diagnosticsOf(schema: string) {
  const path = join(mkdtempSync(join(tmpdir(), 'psl-codec-reads-')), 'schema.prisma');
  writeFileSync(path, `// use prisma-8\n\n${schema}`, 'utf-8');
  const result = await prismaContract(path, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  }).source.load(sourceContext(stack, [path]));
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('PSL defaults read by the Postgres codecs', () => {
  it('a Uuid default takes every uuid input PostgreSQL reads', async () => {
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
      defaults: forms.map((value) => ({ kind: 'literal', value })),
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
        code: 'PSL_INVALID_DEFAULT_LITERAL',
        message: 'Field "Token.u": pg/uuid@1 JSON value must be a UUID PostgreSQL reads',
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
          'enum "Priority" member "Low" was rejected by codec "pg/int@1": pg/int@1 JSON value must be an integer from -2147483648 to 2147483647',
      },
    ]);
  });
});
