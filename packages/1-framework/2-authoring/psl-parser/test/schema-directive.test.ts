import { describe, expect, it } from 'vitest';
import { isPrisma8Schema, renameLegacyDirective } from '../src/schema-directive';

describe('isPrisma8Schema', () => {
  it('accepts a schema whose first line is the directive', () => {
    expect(isPrisma8Schema('// use prisma-8\nmodel User {\n  id Int @id\n}\n')).toBe(true);
  });

  it('accepts the directive earlier releases wrote', () => {
    expect(isPrisma8Schema('// use prisma-next\nmodel User {\n  id Int @id\n}\n')).toBe(true);
    expect(isPrisma8Schema('  //  use   prisma-next  \n')).toBe(true);
    expect(isPrisma8Schema('// use prisma-nextgen\n')).toBe(false);
  });

  it('accepts the directive with no schema body', () => {
    expect(isPrisma8Schema('// use prisma-8')).toBe(true);
  });

  it('accepts leading blank lines and indentation before the directive', () => {
    expect(isPrisma8Schema('\n\n  // use prisma-8\nmodel User {}\n')).toBe(true);
  });

  it('accepts trailing spaces after the directive', () => {
    expect(isPrisma8Schema('// use prisma-8   \n')).toBe(true);
  });

  it('accepts flexible spacing inside the comment', () => {
    expect(isPrisma8Schema('//use prisma-8\n')).toBe(true);
    expect(isPrisma8Schema('//   use   prisma-8\n')).toBe(true);
  });

  it('rejects a token attached to the directive name', () => {
    for (const suffix of ['2', 'gen']) {
      expect(isPrisma8Schema(`// use prisma-8${suffix}\n`)).toBe(false);
    }
  });

  it('rejects a directive that is not the first content of the file', () => {
    expect(isPrisma8Schema('model User {}\n// use prisma-8\n')).toBe(false);
  });

  it('rejects a block-comment form', () => {
    expect(isPrisma8Schema('/* use prisma-8 */\n')).toBe(false);
  });

  it('rejects unmarked and empty documents', () => {
    expect(isPrisma8Schema('model User {\n  id Int @id\n}\n')).toBe(false);
    expect(isPrisma8Schema('')).toBe(false);
    expect(isPrisma8Schema('// use prisma\n')).toBe(false);
  });
});

describe('renameLegacyDirective', () => {
  it('rewrites the directive earlier releases wrote, keeping the spacing around it', () => {
    expect(renameLegacyDirective('// use prisma-next\nmodel User {}\n')).toBe(
      '// use prisma-8\nmodel User {}\n',
    );
    expect(renameLegacyDirective('\n  //  use   prisma-next  \nmodel User {}\n')).toBe(
      '\n  //  use   prisma-8  \nmodel User {}\n',
    );
  });

  it('leaves the current directive, later comments, and unmarked documents alone', () => {
    for (const text of [
      '// use prisma-8\nmodel User {}\n',
      'model User {}\n// use prisma-next\n',
      '// use prisma-nextgen\n',
      '',
    ]) {
      expect(renameLegacyDirective(text)).toBe(text);
    }
  });
});
