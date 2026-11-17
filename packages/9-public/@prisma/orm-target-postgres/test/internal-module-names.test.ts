import { rewriteInternalModuleNames, ShellConfigError } from '@repo/tsdown/shell-build';
import { describe, expect, it } from 'vitest';

describe('the shell build rewrites internal module names in declarations', () => {
  it('rewrites a module augmentation and an inline import to their published specifiers', () => {
    const declarations = [
      "declare module '@internal/sql-relational-core/collection-methods' {",
      '  interface CollectionMethodRegistry {}',
      '}',
      'type Reference = import("@internal/sql-relational-core/index-reference").IndexReference;',
    ].join('\n');

    expect(rewriteInternalModuleNames(declarations, '@prisma/orm-target-postgres')).toBe(
      [
        "declare module '@prisma/orm-family-sql/relational-core/collection-methods' {",
        '  interface CollectionMethodRegistry {}',
        '}',
        'type Reference = import("@prisma/orm-family-sql/relational-core/index-reference").IndexReference;',
      ].join('\n'),
    );
  });

  it('throws for an augmentation of an internal module with no published mapping', () => {
    expect(() =>
      rewriteInternalModuleNames(
        "declare module '@internal/no-such-package' {}",
        '@prisma/orm-target-postgres',
      ),
    ).toThrow(ShellConfigError);
  });
});
