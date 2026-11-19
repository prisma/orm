import { describe, expect, it } from 'vitest';
import { resolveTarget } from '../../../src/commands/init/input-values';

describe('resolveTarget', () => {
  it.each([
    ['postgres', 'postgres', '@prisma/orm-postgres'],
    ['PostgreSQL', 'postgres', '@prisma/orm-postgres'],
    ['@prisma/orm-mongo', 'mongodb', '@prisma/orm-mongo'],
    ['prisma-orm-somedb', 'prisma-orm-somedb', 'prisma-orm-somedb'],
    ['@acme/orm-somedb', '@acme/orm-somedb', '@acme/orm-somedb'],
  ])('takes --target %s as %s from %s', (value, name, packageName) => {
    expect(resolveTarget(value)).toMatchObject({ name, packageName });
  });

  it('takes no flag as no target', () => {
    expect(resolveTarget(undefined)).toBeUndefined();
  });

  it.each([
    ['Not A Package!', 'name can only contain URL-friendly characters'],
    ['.hidden', 'name cannot start with a period'],
    ['UpperCase', 'name can no longer contain capital letters'],
    ['', 'name length must be greater than zero'],
    ['somedb@1.0.0', 'name can only contain URL-friendly characters'],
  ])('refuses --target %j, which is no known name and no valid package name', (value, problem) => {
    expect(() => resolveTarget(value)).toThrow(
      expect.objectContaining({
        code: 'CLI.INIT_INVALID_FLAG_VALUE',
        why: expect.stringContaining(problem),
        meta: expect.objectContaining({
          flag: 'target',
          value,
          problems: expect.arrayContaining([problem]),
        }),
      }),
    );
  });
});
