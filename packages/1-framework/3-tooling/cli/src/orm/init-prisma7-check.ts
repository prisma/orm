import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import { buildLoadedConfig, requireConfigSections } from '@internal/config-loader';
import {
  errorInitContributionUnavailable,
  errorInitPrisma7SchemaRefused,
  errorInitPrisma7SourceUnavailable,
} from '../commands/init/errors';
import type { InitContribution } from '../commands/init/init-contribution';
import { loadContractSource } from '../control-api/operations/load-contract-source';
import type { ImportFromProject } from './project-modules';

export type Prisma7QuickReference = NonNullable<InitContribution['prisma7QuickReference']>;

/** `readable`: the facade read the schema. `no-source`: it has no Prisma 7 contract source. */
export type Prisma7SourceCheck =
  | { readonly outcome: 'readable'; readonly quickReference: Prisma7QuickReference }
  | { readonly outcome: 'no-source' };

export type CheckPrisma7Source = (request: {
  readonly packageName: string;
  readonly contribution: InitContribution;
  readonly schemaPath: string;
}) => Promise<Prisma7SourceCheck>;

/**
 * Finds out whether the installed facade can read the Prisma 7 schema before init changes
 * the project: loads the package's config module as the project resolves it and runs its
 * `prisma7Schema` source without writing. The CLI carries no target code, so the installed
 * package is the only one that can answer. A `prisma7Schema` export is the only sign that a
 * package takes a Prisma 7 schema, and such a package must give `prisma7QuickReference`.
 */
export function createPrisma7SourceCheck(ctx: {
  readonly cwd: string;
  readonly importFromProject: ImportFromProject;
}): CheckPrisma7Source {
  return async ({ packageName, contribution, schemaPath }) => {
    const imported = await ctx.importFromProject(ctx.cwd, contribution.configModule);
    if (imported.kind === 'unloadable') {
      throw errorInitPrisma7SourceUnavailable({
        schemaPath,
        packageName,
        reason: 'unloadable',
        module: contribution.configModule,
        cause: imported.cause instanceof Error ? imported.cause.message : String(imported.cause),
      });
    }
    if (imported.kind !== 'loaded') {
      throw errorInitPrisma7SourceUnavailable({
        schemaPath,
        packageName,
        reason: 'not-resolvable',
        module: contribution.configModule,
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
        unlisted: false,
        missingPeers: [],
        missingPeersCommand: undefined,
      });
      throw broken;
    }
    const quickReference = contribution.prisma7QuickReference;
    if (quickReference === undefined) {
      const missing = errorInitContributionUnavailable({
        packageName,
        reason: 'invalid-shape',
        detail: `${contribution.configModule} exports prisma7Schema, but the contribution has no prisma7QuickReference`,
        unlisted: false,
        missingPeers: [],
        missingPeersCommand: undefined,
      });
      throw missing;
    }

    const section: unknown = defineConfig({
      contract: prisma7Schema(schemaPath),
      output: DEFAULT_CONTRACT_SOURCE_DIR,
    });
    const loaded = buildLoadedConfig(isRecord(section) ? section : {}, ctx.cwd);
    const required = requireConfigSections(loaded, ['family', 'target', 'adapter', 'contract']);
    if (!required.ok) {
      throw required.failure;
    }
    const result = await loadContractSource(required.value);
    if (!result.ok) {
      throw errorInitPrisma7SchemaRefused({
        schemaPath,
        packageName,
        summary: result.failure.summary,
        diagnostics: result.failure.diagnostics,
      });
    }
    return { outcome: 'readable', quickReference };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
