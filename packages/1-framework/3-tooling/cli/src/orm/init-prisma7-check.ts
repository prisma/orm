import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import { buildLoadedConfig, requireConfigSections } from '@internal/config-loader';
import { ifDefined } from '@internal/utils/defined';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import {
  errorInitPrisma7SchemaRefused,
  errorInitPrisma7SourceUnavailable,
  type PackagesAdded,
  packagesAddedAction,
} from '../commands/init/errors';
import type { InitContribution } from '../commands/init/init-contribution';
import { loadContractSource } from '../control-api/operations/load-contract-source';
import { chooseAction } from '../utils/next-actions';
import { normalizeError } from './normalize-error';

/** A module as the project itself resolves it; `undefined` when the project cannot resolve it. */
export type ImportFromProject = (
  cwd: string,
  specifier: string,
) => Promise<Record<string, unknown> | undefined>;

export const importFromProject: ImportFromProject = async (cwd, specifier) => {
  let resolved: string;
  try {
    resolved = createRequire(join(cwd, 'package.json')).resolve(specifier);
  } catch {
    return undefined;
  }
  const module: Record<string, unknown> = await import(pathToFileURL(resolved).href);
  return module;
};

/** What the contribution writes for a project that keeps its Prisma 7 schema. */
export interface Prisma7Templates {
  readonly configFile: NonNullable<InitContribution['prisma7ConfigFile']>;
  readonly quickReference: NonNullable<InitContribution['prisma7QuickReference']>;
}

/** `readable`: the target package read the schema. `no-source`: it has no Prisma 7 contract source. */
export type Prisma7SourceCheck =
  | { readonly outcome: 'readable'; readonly templates: Prisma7Templates }
  | { readonly outcome: 'no-source' };

export type CheckPrisma7Source = (request: {
  readonly packageName: string;
  readonly contribution: InitContribution;
  readonly schemaPath: string;
  /** What installing the target package added to the project, for the undo instruction. */
  readonly added: PackagesAdded | undefined;
}) => Promise<Prisma7SourceCheck>;

/**
 * Adds the check's undo instruction to an error raised after the check installed packages, such
 * as the engine's own consent or cancellation errors, which init cannot word itself. An error with
 * no structured code becomes `CLI.UNEXPECTED`, as it would at the handler boundary.
 */
export function withPackagesAddedAction(error: unknown, added: PackagesAdded): CliStructuredError {
  const engineError = normalizeError(error);
  return new CliStructuredError(engineError.code, engineError.message, {
    severity: engineError.severity,
    nextActions: [...engineError.nextActions, chooseAction(packagesAddedAction(added))],
    diagnostics: engineError.diagnostics,
    meta: { ...engineError.meta, packagesAdded: added.packages },
    ...ifDefined('why', engineError.why),
    ...ifDefined('where', engineError.where),
    ...ifDefined('docsUrl', engineError.docsUrl),
    cause: error,
  });
}

/**
 * Finds out whether the installed target package can read the Prisma 7 schema before init changes
 * the project: loads the package's config module as the project resolves it and runs its
 * `prisma7Schema` source without writing. The CLI carries no target code, so the installed
 * package is the only one that can answer. A contribution with no `prisma7ConfigFile` cannot take
 * a Prisma 7 schema.
 */
export function createPrisma7SourceCheck(ctx: {
  readonly cwd: string;
  readonly importFromProject: ImportFromProject;
}): CheckPrisma7Source {
  return async ({ packageName, contribution, schemaPath, added }) => {
    const { prisma7ConfigFile, prisma7QuickReference } = contribution;
    if (prisma7ConfigFile === undefined || prisma7QuickReference === undefined) {
      return { outcome: 'no-source' };
    }

    const undoable = async <T>(step: () => T | Promise<T>): Promise<T> => {
      try {
        return await step();
      } catch (error) {
        throw added === undefined ? error : withPackagesAddedAction(error, added);
      }
    };

    const module = await undoable(() => ctx.importFromProject(ctx.cwd, contribution.configModule));
    if (module === undefined) {
      throw errorInitPrisma7SourceUnavailable({
        schemaPath,
        packageName,
        reason: 'not-resolvable',
        added,
      });
    }

    const { defineConfig, prisma7Schema } = module;
    if (typeof defineConfig !== 'function' || typeof prisma7Schema !== 'function') {
      return { outcome: 'no-source' };
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
    return {
      outcome: 'readable',
      templates: { configFile: prisma7ConfigFile, quickReference: prisma7QuickReference },
    };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
