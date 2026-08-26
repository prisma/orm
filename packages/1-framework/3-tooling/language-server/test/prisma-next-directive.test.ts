import { describe, expect, it } from 'vitest';
import { isPrismaNextSchema } from '../src/prisma-next-directive';

describe('isPrismaNextSchema', () => {
  it('accepts a schema whose first line is the directive', () => {
    expect(isPrismaNextSchema('// use prisma-next\nmodel User {\n  id Int @id\n}\n')).toBe(true);
  });

  it('accepts the directive with no schema body', () => {
    expect(isPrismaNextSchema('// use prisma-next')).toBe(true);
  });

  it('accepts leading blank lines and indentation before the directive', () => {
    expect(isPrismaNextSchema('\n\n  // use prisma-next\nmodel User {}\n')).toBe(true);
  });

  it('accepts trailing spaces after the directive', () => {
    expect(isPrismaNextSchema('// use prisma-next   \n')).toBe(true);
  });

  it('accepts flexible spacing inside the comment', () => {
    expect(isPrismaNextSchema('//use prisma-next\n')).toBe(true);
    expect(isPrismaNextSchema('//   use   prisma-next\n')).toBe(true);
  });

  it('rejects a token attached to prisma-next', () => {
    expect(isPrismaNextSchema('// use prisma-next2\n')).toBe(false);
    expect(isPrismaNextSchema('// use prisma-nextgen\n')).toBe(false);
  });

  it('rejects a directive that is not the first content of the file', () => {
    expect(isPrismaNextSchema('model User {}\n// use prisma-next\n')).toBe(false);
  });

  it('rejects a block-comment form', () => {
    expect(isPrismaNextSchema('/* use prisma-next */\n')).toBe(false);
  });

  it('rejects unmarked and empty documents', () => {
    expect(isPrismaNextSchema('model User {\n  id Int @id\n}\n')).toBe(false);
    expect(isPrismaNextSchema('')).toBe(false);
    expect(isPrismaNextSchema('// use prisma\n')).toBe(false);
  });
});
