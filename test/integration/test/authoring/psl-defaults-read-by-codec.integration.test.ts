import { describe, expect, it } from 'vitest';
import { authorSqlContractFromPsl, findStorageColumn } from '../scalar-lists/psl-list-authoring';

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
});
