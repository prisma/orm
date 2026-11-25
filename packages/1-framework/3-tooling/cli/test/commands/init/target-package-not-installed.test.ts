import { describe, expect, it } from 'vitest';
import { errorInitTargetPackageNotInstalled } from '../../../src/commands/init/errors';

const PNP =
  "`prisma orm init` does not support Yarn Plug'n'Play: set `nodeLinker: node-modules` in `.yarnrc.yml`, run `yarn install`, then run `prisma orm init` again.";

describe('the fix of CLI.INIT_TARGET_PACKAGE_NOT_INSTALLED', () => {
  it.each([
    ['after an install', 'yarn add @prisma/orm-postgres pg'],
    ['under --skip-install', undefined],
  ])("says what to do about Yarn Plug'n'Play %s in a Yarn project", (_case, ranCommand) => {
    const error = errorInitTargetPackageNotInstalled({
      packageName: '@prisma/orm-postgres',
      installCommand: 'yarn add @prisma/orm-postgres pg',
      ranCommand,
      unlisted: false,
      packageManager: 'yarn',
    });

    expect(error.fix).toContain(PNP);
  });

  it('says nothing about Yarn in a project on another package manager', () => {
    const error = errorInitTargetPackageNotInstalled({
      packageName: '@prisma/orm-postgres',
      installCommand: 'pnpm add @prisma/orm-postgres pg',
      ranCommand: 'pnpm add @prisma/orm-postgres pg',
      unlisted: false,
      packageManager: 'pnpm',
    });

    expect(error.fix).not.toContain('Yarn');
  });
});
