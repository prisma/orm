import { describe, expect, it } from 'vitest';
import { format } from '../../src/exports/format';

describe('format given a view block', () => {
  it('aligns field lines and their attributes like a model body', () => {
    expect(
      format('view ActiveUsers {\n  id Int @unique\n  email   String @map("user_email")\n}\n'),
    ).toBe('view ActiveUsers {\n  id    Int    @unique\n  email String @map("user_email")\n}\n');
  });

  it('separates block attributes from the fields with a blank line', () => {
    expect(format('view ActiveUsers {\n  id Int\n  @@map("active_users")\n}\n')).toBe(
      'view ActiveUsers {\n  id Int\n\n  @@map("active_users")\n}\n',
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
