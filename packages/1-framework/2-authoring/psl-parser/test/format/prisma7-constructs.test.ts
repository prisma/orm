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

describe('emitDocument', () => {
  it('raises an internal error for a block member it has no rule for instead of dropping it', () => {
    const { document } = parse('view ActiveUsers {\n  id Int\n}\n', { dialect: 'prisma7' });
    expect(() => emitDocument(document, '  ', '\n')).toThrow(
      expect.objectContaining({
        isPrismaInternalError: true,
        message:
          'Formatter has no rule for a FieldDeclaration node at offset 21; formatting would drop its text',
      }),
    );
  });
});
