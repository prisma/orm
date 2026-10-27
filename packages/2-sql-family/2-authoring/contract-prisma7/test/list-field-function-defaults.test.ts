import { describe, expect, it } from 'vitest';
import { interpretSchemaTextResult } from './support';

function diagnosticsFor(field: string): readonly string[] {
  const result = interpretSchemaTextResult(`datasource db {
  provider = "postgresql"
}

model Post {
  id Int @id
  ${field}
}
`);
  return result.ok ? [] : result.failure.diagnostics.map(({ message }) => message);
}

describe('a function default on a list field', () => {
  it.each([
    ['counts Int[] @default(autoincrement())', 'counts', 'autoincrement()'],
    ['ids String[] @default(uuid())', 'ids', 'uuid()'],
    ['ids String[] @default(uuid(7))', 'ids', 'uuid(7)'],
    ['at DateTime[] @default(now())', 'at', 'now()'],
    ['days DateTime[] @default(now()) @db.Date', 'days', 'now()'],
  ])('is refused: %s', (field, name, call) => {
    expect(diagnosticsFor(field)).toEqual([
      `Field "Post.${name}": @default(${call}) cannot fill a list field. Write a list literal, such as @default([]), or remove @default(${call}).`,
    ]);
  });

  it('is read for dbgenerated', () => {
    expect(diagnosticsFor('labels String[] @default(dbgenerated("\'{}\'::text[]"))')).toEqual([]);
  });
});
