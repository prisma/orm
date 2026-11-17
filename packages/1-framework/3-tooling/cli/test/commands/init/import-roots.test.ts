import {
  createScaffoldSpecifierResolver,
  internalImportRoot,
  type ScaffoldImportRoot,
  transitiveImports,
} from '@internal/publish-surface/import-roots';
import { describe, expect, it } from 'vitest';
import {
  type AuthoringId,
  configFile,
  dbFile,
  starterSchema,
  type TargetId,
  targetPackageName,
} from '../../../src/commands/init/templates/code-templates';
import { quickReferenceMd } from '../../../src/commands/init/templates/quick-reference';

const facadeFor: Record<TargetId, ScaffoldImportRoot> = {
  postgres: { mode: 'facade', facade: '@prisma/orm-postgres' },
  mongo: { mode: 'facade', facade: '@prisma/orm-mongo' },
};

/** Everything `init` writes into a user's project that can carry a package name. */
function scaffold(target: TargetId, authoring: AuthoringId, root: ScaffoldImportRoot): string {
  const resolve = createScaffoldSpecifierResolver(root);
  return [
    targetPackageName(target, resolve),
    starterSchema(target, authoring, resolve),
    configFile(target, 'prisma/contract.ts', resolve),
    dbFile(target, resolve),
    quickReferenceMd(target, authoring, 'prisma/contract.ts', 'pnpm', resolve),
  ].join('\n');
}

describe('scaffolded project files under each import root', () => {
  describe.each(['postgres', 'mongo'] as const)('%s', (target) => {
    it('names the workspace facade under the internal root', () => {
      expect(targetPackageName(target)).toBe(`@internal/${target}`);
      expect(scaffold(target, 'typescript', internalImportRoot)).toContain(
        `from '@internal/${target}/contract-builder'`,
      );
    });

    it('names the published facade under the facade root', () => {
      const root = facadeFor[target];
      const source = scaffold(target, 'typescript', root);

      expect(targetPackageName(target, createScaffoldSpecifierResolver(root))).toBe(
        `@prisma/orm-${target}`,
      );
      expect(source).toContain(`from '@prisma/orm-${target}/contract-builder'`);
      expect(source).toContain(`from '@prisma/orm-${target}/config'`);
      expect(source).toContain(`from '@prisma/orm-${target}/runtime'`);
    });

    it('imports nothing the application would not depend on directly', () => {
      for (const authoring of ['typescript', 'psl'] as const) {
        for (const root of [internalImportRoot, facadeFor[target]]) {
          expect(transitiveImports(scaffold(target, authoring, root), root)).toEqual([]);
        }
      }
    });
  });

  it('changes nothing but the specifiers', () => {
    // Both scopes a scaffold can carry: the published `@prisma/orm-*` name and
    // the `@internal/*` workspace name the internal root leaves as authored.
    const withoutSpecifiers = (source: string) =>
      source.replaceAll(/@(?:prisma|internal)\/[a-z0-9-]+/g, '<pkg>');

    for (const target of ['postgres', 'mongo'] as const) {
      expect(withoutSpecifiers(scaffold(target, 'typescript', facadeFor[target]))).toEqual(
        withoutSpecifiers(scaffold(target, 'typescript', internalImportRoot)),
      );
    }
  });
});
