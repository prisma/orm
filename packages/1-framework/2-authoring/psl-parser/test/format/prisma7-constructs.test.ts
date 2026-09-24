import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';
import { emitDocument } from '../../src/format/emit';
import { parse } from '../../src/parse';

describe('format given Prisma 7 syntax', () => {
  it('refuses a view block whose field lines carry attributes', () => {
    expect(() => format('view ActiveUsers {\n  id    Int    @unique\n  email String\n}\n')).toThrow(
      expect.objectContaining({
        code: 'PSL.PARSE_FAILED',
        message: 'Cannot format PSL with parse errors: Invalid block entry',
      }),
    );
  });

  it('formats a Prisma 7 schema with no view block', () => {
    const schema = [
      'datasource db {',
      '  provider = "postgresql"',
      '  url = env("DATABASE_URL")',
      '}',
      'generator client {',
      '  provider = "prisma-client-js"',
      '}',
      'enum Role {',
      '  USER @map("user")',
      '  ADMIN   @map("admin")',
      '}',
      'model User {',
      '  id Int @id @default(autoincrement())',
      '  role Role @default(USER)',
      '  @@map("users")',
      '}',
      '',
    ].join('\n');
    expect(format(schema)).toBe(
      [
        'datasource db {',
        '  provider = "postgresql"',
        '  url = env("DATABASE_URL")',
        '}',
        '',
        'generator client {',
        '  provider = "prisma-client-js"',
        '}',
        '',
        'enum Role {',
        '  USER @map("user")',
        '  ADMIN @map("admin")',
        '}',
        '',
        'model User {',
        '  id   Int  @id @default(autoincrement())',
        '  role Role @default(USER)',
        '',
        '  @@map("users")',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('keeps an attribute on an enum member, leaving its validity to the interpreter', () => {
    expect(format('enum Role {\n  USER  @map("user")\n  ADMIN\n}\n')).toContain(
      'USER @map("user")',
    );
  });
});

describe('emitDocument given a view block parsed with the Prisma 7 grammar', () => {
  it('keeps each field on one line with its type, aligned like a model field', () => {
    const { document } = parse('view ActiveUsers {\n  id Int\n  email   String\n}\n', 'test.psl', {
      grammar: 'prisma7',
    });
    expect(emitDocument(document, '  ', '\n')).toEqual(
      'view ActiveUsers {\n  id    Int\n  email String\n}\n',
    );
  });

  it('keeps a field attribute on the same line as its field', () => {
    const { document } = parse('view ActiveUsers {\n  id Int @unique\n}\n', 'test.psl', {
      grammar: 'prisma7',
    });
    expect(emitDocument(document, '  ', '\n')).toEqual('view ActiveUsers {\n  id Int @unique\n}\n');
  });
});
