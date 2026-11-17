import { describe, expect, it } from 'vitest';
import {
  buildOwnerIndex,
  platformEntrypointOf,
  ShellMappingError,
} from '../src/platform-entrypoints';
import type { ShellDefinition, ShellName } from '../src/shells';

describe('platformEntrypointOf', () => {
  it('reports the owning shell alongside the entrypoint', () => {
    expect(platformEntrypointOf('@internal/sql-contract/types')).toEqual({
      shell: '@prisma/orm-family-sql',
      id: '@prisma/orm-family-sql/contract/types',
    });
  });

  it('drops the entry namespace for a package that occupies the shell itself', () => {
    expect(platformEntrypointOf('@internal/postgres/migration')).toEqual({
      shell: '@prisma/orm-postgres',
      id: '@prisma/orm-postgres/migration',
    });
  });

  it('names the shell itself for a package that occupies it, with no subpath', () => {
    expect(platformEntrypointOf('@internal/postgres')).toEqual({
      shell: '@prisma/orm-postgres',
      id: '@prisma/orm-postgres',
    });
  });

  it('refuses a specifier no shell maps', () => {
    expect(() => platformEntrypointOf('@internal/not-a-package')).toThrow(ShellMappingError);
    expect(() => platformEntrypointOf('@internal/not-a-package')).toThrow(
      /is not mapped to any published shell/,
    );
  });
});

describe('buildOwnerIndex', () => {
  const shell = (packages: ShellDefinition['packages']): ShellDefinition => ({
    dir: 'packages/9-public/@prisma/orm-framework',
    kind: 'platform',
    packages,
  });

  it('indexes each package against the shell that publishes it', () => {
    const index = buildOwnerIndex(
      new Map<ShellName, ShellDefinition>([
        ['@prisma/orm-framework', shell([{ dir: 'a', name: '@internal/a', entry: 'a' }])],
        ['@prisma/orm-family-sql', shell([{ dir: 'b', name: '@internal/b', entry: '' }])],
      ]),
    );

    expect(index.get('@internal/a')).toEqual({ shell: '@prisma/orm-framework', entry: 'a' });
    expect(index.get('@internal/b')).toEqual({ shell: '@prisma/orm-family-sql', entry: '' });
  });

  it('refuses a package claimed by two shells, which would publish it twice', () => {
    const duplicated = new Map<ShellName, ShellDefinition>([
      ['@prisma/orm-framework', shell([{ dir: 'a', name: '@internal/a', entry: 'a' }])],
      ['@prisma/orm-family-sql', shell([{ dir: 'a2', name: '@internal/a', entry: 'a' }])],
    ]);

    expect(() => buildOwnerIndex(duplicated)).toThrow(ShellMappingError);
    expect(() => buildOwnerIndex(duplicated)).toThrow(
      /@internal\/a is mapped to both @prisma\/orm-framework and @prisma\/orm-family-sql/,
    );
  });
});
