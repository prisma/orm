import { describe, expect, it } from 'vitest';
import {
  type AuthoringId,
  configFile,
  dbFile,
  starterSchema,
  type TargetId,
  targetPackageName,
  workspaceTargetPackageName,
} from '../../../src/commands/init/templates/code-templates';
import { quickReferenceMd } from '../../../src/commands/init/templates/quick-reference';

/** Everything `init` writes into a user's project that can carry a package name. */
function scaffold(target: TargetId, authoring: AuthoringId, targetPackage: string): string {
  return [
    starterSchema(target, authoring, targetPackage),
    configFile(target, 'prisma/contract.ts', targetPackage),
    dbFile(target, targetPackage),
    quickReferenceMd(target, authoring, 'prisma/contract.ts', 'pnpm', targetPackage),
  ].join('\n');
}

/** The scoped package names a source file imports from. */
function importedPackages(source: string): string[] {
  return [...source.matchAll(/\bfrom\s+'(@[a-z0-9-]+\/[a-z0-9-]+)[^']*'/g)].map(
    ([, name]) => name ?? '',
  );
}

describe('the package a scaffold names', () => {
  describe.each(['postgres', 'mongo'] as const)('%s', (target) => {
    it('is the published target package', () => {
      expect(targetPackageName(target)).toBe(`@prisma/orm-${target}`);
      const source = scaffold(target, 'typescript', targetPackageName(target));

      expect(source).toContain(`from '@prisma/orm-${target}/contract-builder'`);
      expect(source).toContain(`from '@prisma/orm-${target}/config'`);
      expect(source).toContain(`from '@prisma/orm-${target}/runtime'`);
    });

    it('is the workspace package unless the caller names one', () => {
      expect(scaffold(target, 'typescript', workspaceTargetPackageName(target))).toEqual(
        [
          starterSchema(target, 'typescript'),
          configFile(target, 'prisma/contract.ts'),
          dbFile(target),
          quickReferenceMd(target, 'typescript', 'prisma/contract.ts', 'pnpm'),
        ].join('\n'),
      );
      expect(starterSchema(target, 'typescript')).toContain(
        `from '@internal/${target}/contract-builder'`,
      );
    });

    it('imports no package but the target package and the CLI engine', () => {
      for (const authoring of ['typescript', 'psl'] as const) {
        const packages = new Set(
          importedPackages(scaffold(target, authoring, targetPackageName(target))),
        );
        packages.delete(targetPackageName(target));
        packages.delete('@prisma/cli-engine');
        expect([...packages]).toEqual([]);
      }
    });
  });

  it('changes nothing but the package name', () => {
    const withoutPackage = (source: string) =>
      source.replaceAll(/@(?:prisma|internal)\/(?:orm-)?(?:postgres|mongo)/g, '<pkg>');

    for (const target of ['postgres', 'mongo'] as const) {
      expect(withoutPackage(scaffold(target, 'typescript', targetPackageName(target)))).toEqual(
        withoutPackage(scaffold(target, 'typescript', workspaceTargetPackageName(target))),
      );
    }
  });
});
