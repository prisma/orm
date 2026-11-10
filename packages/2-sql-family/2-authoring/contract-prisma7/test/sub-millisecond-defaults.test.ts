import { describe, expect, it } from 'vitest';
import { interpretSchemaText, serializedTable } from './support';

describe('a DateTime default with digits below a millisecond', () => {
  it('is kept as the SQL the target writes for it, which a Date cannot hold as a value, single or in a list', () => {
    const contract = interpretSchemaText(`datasource db {
  provider = "postgresql"
}

model Post {
  id      Int      @id
  tsMicro DateTime @default("2024-01-02T03:04:05.123456Z") @db.Timestamp(6)
  tsMs    DateTime @default("2024-01-02T03:04:05.123Z")
  ts6l    DateTime[] @default(["2024-01-02T03:04:05.123Z", "2024-01-02T03:04:05.123456Z"]) @db.Timestamp(6)
}
`);
    const { columns } = serializedTable(contract, 'Post');
    expect({
      tsMicro: columns['tsMicro']?.['default'],
      tsMs: columns['tsMs']?.['default'],
      ts6l: columns['ts6l']?.['default'],
    }).toEqual({
      tsMicro: { kind: 'function', expression: "'2024-01-02T03:04:05.123456'::timestamp(6)" },
      tsMs: { kind: 'literal', value: '2024-01-02T03:04:05.123' },
      ts6l: {
        kind: 'function',
        expression:
          "ARRAY['2024-01-02T03:04:05.123', '2024-01-02T03:04:05.123456']::timestamp(6)[]",
      },
    });
  });
});
