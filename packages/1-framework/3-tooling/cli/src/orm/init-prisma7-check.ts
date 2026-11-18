import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import { buildLoadedConfig, requireConfigSections } from '@internal/config-loader';
import {
  errorInitContributionUnavailable,
  errorInitPrisma7SchemaRefused,
  errorInitPrisma7SourceUnavailable,
  type PackagesAdded,
  PRISMA7_CHECK,
} from '../commands/init/errors';
import type { InitContribution } from '../commands/init/init-contribution';
import { loadContractSource } from '../control-api/operations/load-contract-source';
import { withPackagesAddedAction } from './init-target-package';
import type { ImportFromProject } from './project-modules';

export type Prisma7QuickReference = NonNullable<InitContribution['prisma7QuickReference']>;

/** `readable`: the target package read the schema. `no-source`: it has no Prisma 7 contract source. */
export type Prisma7SourceCheck =
  | { readonly outcome: 'readable'; readonly quickReference: Prisma7QuickReference }
  | { readonly outcome: 'no-source' };

export type CheckPrisma7Source = (request: {
  readonly packageName: string;
  readonly contribution: InitContribution;
  readonly schemaPath: string;
  /** What installing the target package added to the project, for the undo instruction. */
  readonly added: PackagesAdded | undefined;
}) => Promise<Prisma7SourceCheck>;

/**
 * Finds out whether the installed target package can read the Prisma 7 schema before init changes
 * the project: loads the package's config module as the project resolves it and runs its
 * `prisma7Schema` source without writing. The CLI carries no target code, so the installed
 * package is the only one that can answer. A `prisma7Schema` export is the only sign that a
 * package takes a Prisma 7 schema, and such a package must give `prisma7QuickReference`.
 */
export function createPrisma7SourceCheck(ctx: {
  readonly cwd: string;
  readonly importFromProject: ImportFromProject;
}): CheckPrisma7Source {
  return async ({ packageName, contribution, schemaPath, added }) => {
    const undoable = async <T>(step: () => T | Promise<T>): Promise<T> => {
      try {
        return await step();
      } catch (error) {
        throw added === undefined ? error : withPackagesAddedAction(error, added, PRISMA7_CHECK);
      }
    };

    const imported = await ctx.importFromProject(ctx.cwd, contribution.configModule);
    if (imported.kind === 'unloadable') {
      throw errorInitPrisma7SourceUnavailable({
        schemaPath,
        packageName,
        reason: 'unloadable',
        module: contribution.configModule,
        cause: imported.cause instanceof Error ? imported.cause.message : String(imported.cause),
        added,
      });
    }
    if (imported.kind !== 'loaded') {
      throw errorInitPrisma7SourceUnavailable({
        schemaPath,
        packageName,
        reason: 'not-resolvable',
        module: contribution.configModule,
        added,
      });
    }

    const { defineConfig, prisma7Schema } = imported.module;
    if (typeof prisma7Schema !== 'function') {
      return { outcome: 'no-source' };
    }
    if (typeof defineConfig !== 'function') {
      const broken = errorInitContributionUnavailable({
        packageName,
        reason: 'invalid-shape',
        detail: `${contribution.configModule} exports prisma7Schema, but not a defineConfig function`,
      });
      throw added === undefined ? broken : withPackagesAddedAction(broken, added, PRISMA7_CHECK);
    }
    const quickReference = contribution.prisma7QuickReference;
    if (quickReference === undefined) {
      const missing = errorInitContributionUnavailable({
        packageName,
        reason: 'invalid-shape',
        detail: `${contribution.configModule} exports prisma7Schema, but the contribution has no prisma7QuickReference`,
      });
      throw added === undefined ? missing : withPackagesAddedAction(missing, added, PRISMA7_CHECK);
    }

    const config = await undoable(() => {
      const section: unknown = defineConfig({
        contract: prisma7Schema(schemaPath),
        output: DEFAULT_CONTRACT_SOURCE_DIR,
      });
      const loaded = buildLoadedConfig(isRecord(section) ? section : {}, ctx.cwd);
      const required = requireConfigSections(loaded, ['family', 'target', 'adapter', 'contract']);
      if (!required.ok) {
        throw required.failure;
      }
      return required.value;
    });
    const result = await undoable(() => loadContractSource(config));
    if (!result.ok) {
      throw errorInitPrisma7SchemaRefused({
        schemaPath,
        packageName,
        summary: result.failure.summary,
        diagnostics: result.failure.diagnostics,
        added,
      });
    }
    return { outcome: 'readable', quickReference };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
