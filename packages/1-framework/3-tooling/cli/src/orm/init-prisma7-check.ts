import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import { buildLoadedConfig, requireConfigSections } from '@internal/config-loader';
import type { PackageOperations } from '@prisma/cli-engine';
import type { CliStructuredError } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { buildCatalogWarnings } from '../commands/init/catalog-warnings';
import { formatRemoveCommand, type PackageManager } from '../commands/init/detect-package-manager';
import {
  errorInitPrisma7SchemaRefused,
  errorInitPrisma7SourceUnavailable,
  type PackagesAdded,
} from '../commands/init/errors';
import {
  scaffoldSpecifierResolverFor,
  type TargetId,
  targetEntrypoint,
  targetPackageName,
} from '../commands/init/templates/code-templates';
import { loadContractSource } from '../control-api/operations/contract-emit';
import { installProjectDependencies } from './init-packages';

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

export interface Prisma7SourceCheck {
  /**
   * `readable`: the target package read the schema. `unchecked`: the package
   * is not installed and `--skip-install` forbade installing it. `no-source`:
   * the package has no Prisma 7 contract source.
   */
  readonly outcome: 'readable' | 'unchecked' | 'no-source';
  readonly packageName: string;
  /** What the check installed; `undefined` when it installed nothing. */
  readonly added: PackagesAdded | undefined;
  readonly warnings: readonly string[];
}

export type CheckPrisma7Source = (request: {
  readonly target: TargetId;
  readonly schemaPath: string;
}) => Promise<Prisma7SourceCheck>;

/** The install before the check failed; nothing else has happened yet. */
export class Prisma7CheckInstallFailed extends Error {
  constructor(
    readonly failure: CliStructuredError,
    readonly target: TargetId,
    readonly schemaPath: string,
  ) {
    super(failure.message);
    this.name = 'Prisma7CheckInstallFailed';
  }
}

/**
 * Finds out whether the chosen target package can read the Prisma 7 schema
 * before init changes the project: installs the package and `dotenv` (the
 * packages every init installs), loads the package's config entrypoint as the
 * project resolves it, and runs its `prisma7Schema` source without writing.
 * The CLI carries no target code, so the installed package is the only one
 * that can answer.
 */
export function createPrisma7SourceCheck(ctx: {
  readonly cwd: string;
  readonly packages: PackageOperations;
  readonly packageManager: PackageManager;
  readonly install: boolean;
  readonly importFromProject: ImportFromProject;
}): CheckPrisma7Source {
  return async ({ target, schemaPath }) => {
    const resolveImportSpecifier = scaffoldSpecifierResolverFor(target);
    const packageName = targetPackageName(target, resolveImportSpecifier);
    const warnings: string[] = [];
    let added: PackagesAdded | undefined;

    if (ctx.install) {
      const deps = [packageName, 'dotenv'];
      const outcome = await installProjectDependencies({
        packages: ctx.packages,
        cwd: ctx.cwd,
        deps,
        devDeps: [],
        catalogWarnings: ctx.packageManager === 'pnpm' ? buildCatalogWarnings(ctx.cwd, deps) : [],
      });
      if (outcome.failure !== undefined) {
        throw new Prisma7CheckInstallFailed(outcome.failure, target, schemaPath);
      }
      warnings.push(...outcome.warnings);
      added = { packages: deps, removeCommand: formatRemoveCommand(ctx.packageManager, deps) };
    }

    const module = await ctx.importFromProject(
      ctx.cwd,
      targetEntrypoint(target, 'config', resolveImportSpecifier),
    );
    if (module === undefined) {
      if (!ctx.install) {
        warnings.push(
          `Could not check that Prisma 8 can read ${schemaPath}: ${packageName} is not installed. Install the dependencies and run \`prisma contract emit\` to check it.`,
        );
        return { outcome: 'unchecked', packageName, added, warnings };
      }
      throw errorInitPrisma7SourceUnavailable({
        schemaPath,
        packageName,
        reason: 'not-resolvable',
        added,
      });
    }

    const { defineConfig, prisma7Schema } = module;
    if (typeof defineConfig !== 'function' || typeof prisma7Schema !== 'function') {
      return { outcome: 'no-source', packageName, added, warnings };
    }

    const section: unknown = defineConfig({
      contract: prisma7Schema(schemaPath),
      output: DEFAULT_CONTRACT_SOURCE_DIR,
    });
    const loaded = buildLoadedConfig(isRecord(section) ? section : {}, ctx.cwd);
    const config = requireConfigSections(loaded, ['family', 'target', 'adapter', 'contract']);
    if (!config.ok) {
      throw config.failure;
    }
    const result = await loadContractSource(config.value);
    if (!result.ok) {
      throw errorInitPrisma7SchemaRefused({
        schemaPath,
        packageName,
        summary: result.failure.summary,
        diagnostics: result.failure.diagnostics,
        added,
      });
    }
    return { outcome: 'readable', packageName, added, warnings };
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
