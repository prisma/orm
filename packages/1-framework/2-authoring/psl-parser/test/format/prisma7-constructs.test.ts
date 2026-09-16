import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';
import { emitDocument } from '../../src/format/emit';
import { parse } from '../../src/parse';

describe('format given a Prisma 7 construct in a Prisma 8 document', () => {
  it('refuses a view block whose field lines carry attributes', () => {
    expect(() => format('view ActiveUsers {\n  id    Int    @unique\n  email String\n}\n')).toThrow(
      expect.objectContaining({
        code: 'PSL.PARSE_FAILED',
        message: 'Cannot format PSL with parse errors: Invalid block entry',
      }),
    );
  });

  it('refuses an enum member with an attribute', () => {
    expect(() => format('enum Role {\n  USER  @map("user")\n  ADMIN\n}\n')).toThrow(
      expect.objectContaining({
        code: 'PSL.PARSE_FAILED',
        message: 'Cannot format PSL with parse errors: Invalid block entry',
      }),
    );
  });
});

describe('emitDocument given a view block parsed with the Prisma 7 grammar', () => {
  it('keeps each field on one line with its type, aligned like a model field', () => {
    const { document } = parse('view ActiveUsers {\n  id Int\n  email   String\n}\n', {
      grammar: 'prisma7',
    });
    expect(emitDocument(document, '  ', '\n')).toEqual(
      'view ActiveUsers {\n  id    Int\n  email String\n}\n',
    );
  });

  it('keeps a field attribute on the same line as its field', () => {
    const { document } = parse('view ActiveUsers {\n  id Int @unique\n}\n', {
      grammar: 'prisma7',
    });
    expect(emitDocument(document, '  ', '\n')).toEqual('view ActiveUsers {\n  id Int @unique\n}\n');
  });
});
