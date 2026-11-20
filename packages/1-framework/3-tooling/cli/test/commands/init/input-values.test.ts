import { describe, expect, it } from 'vitest';
import { resolveTarget, resolveTargetName } from '../../../src/commands/init/input-values';
import { reportedTargetName } from '../../../src/commands/init/target-packages';

describe('resolveTarget', () => {
  it.each([
    ['postgres', 'postgres', '@prisma/orm-postgres'],
    ['PostgreSQL', 'postgres', '@prisma/orm-postgres'],
    ['@prisma/orm-mongo', 'mongodb', '@prisma/orm-mongo'],
    ['prisma-orm-somedb', 'prisma-orm-somedb', 'prisma-orm-somedb'],
    ['@acme/orm-somedb', '@acme/orm-somedb', '@acme/orm-somedb'],
  ])('takes --target %s as %s from %s', (value, name, packageName) => {
    const target = resolveTarget(value);

    expect(target?.packageName).toBe(packageName);
    expect(target === undefined ? undefined : reportedTargetName(target)).toBe(name);
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
        meta: {
          flag: 'target',
          value,
          allowed: ['postgres', 'mongodb'],
          acceptsPackageName: true,
          problems: expect.arrayContaining([problem]),
        },
      }),
    );
  });

  it('says a package name is accepted, with one placeholder for it', () => {
    expect(() => resolveTarget('Not A Package!')).toThrow(
      expect.objectContaining({
        message: 'Invalid value for --target',
        why: expect.stringContaining('is not one of the short names (postgres, mongodb)'),
        fix: 'Pass a short name (--target postgres, --target mongodb) or the name of a target package (`--target <package>`).',
      }),
    );
  });

  it('words a name typed into the picker as an answer, not a flag', () => {
    expect(() => resolveTargetName('../outside', 'prompt')).toThrow(
      expect.objectContaining({
        code: 'CLI.INIT_INVALID_FLAG_VALUE',
        message: 'Invalid target package name',
        why: expect.stringMatching(
          /^`\.\.\/outside`, typed as the name of the target package, is not a valid package name: /,
        ),
        fix: expect.stringContaining('type the target package'),
      }),
    );
  });
});
