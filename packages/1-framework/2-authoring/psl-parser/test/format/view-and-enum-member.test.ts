import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

const prisma7 = { grammar: 'prisma-7' } as const;

describe('format given a view block, in the prisma-7 grammar', () => {
  it('aligns field lines and their attributes like a model body', () => {
    expect(
      format(
        'view ActiveUsers {\n  id Int @unique\n  email   String @map("user_email")\n}\n',
        undefined,
        prisma7,
      ),
    ).toBe('view ActiveUsers {\n  id    Int    @unique\n  email String @map("user_email")\n}\n');
  });

  it('aligns field lines that carry no attributes', () => {
    expect(format('view ActiveUsers {\nid Int\nemail   String\n}\n', undefined, prisma7)).toBe(
      'view ActiveUsers {\n  id    Int\n  email String\n}\n',
    );
  });

  it('separates block attributes from the fields with a blank line', () => {
    expect(
      format('view ActiveUsers {\n  id Int\n  @@map("active_users")\n}\n', undefined, prisma7),
    ).toBe('view ActiveUsers {\n  id Int\n\n  @@map("active_users")\n}\n');
  });
});

describe('format given a view block, by default', () => {
  it('refuses a field attribute in the view, as in any block the parser does not know', () => {
    expect(() => format('view ActiveUsers {\n  id Int @unique\n}\n')).toThrow(
      expect.objectContaining({ code: 'PSL.PARSE_FAILED' }),
    );
  });

  it('writes each word of a plain field line as its own entry, as in any block the parser does not know', () => {
    expect(format('view ActiveUsers {\nid Int\nemail   String\n}\n')).toBe(
      'view ActiveUsers {\n  id\n  Int\n  email\n  String\n}\n',
    );
  });
});

describe('format given enum members', () => {
  it('keeps an attribute on its member, leaving its validity to the interpreter', () => {
    expect(format('enum Role {\n  USER  @map("user")\n  ADMIN\n}\n')).toBe(
      'enum Role {\n  USER @map("user")\n  ADMIN\n}\n',
    );
  });

  it('puts members written on one line on separate lines', () => {
    expect(format('enum Role { USER ADMIN }\n')).toBe('enum Role {\n  USER\n  ADMIN\n}\n');
  });
});

describe('format given datasource, generator, enum and model blocks', () => {
  it('formats every block in one document', () => {
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
});
