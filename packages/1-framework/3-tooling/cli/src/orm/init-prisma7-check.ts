import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import { buildLoadedConfig, requireConfigSections } from '@internal/config-loader';
import { ifDefined } from '@internal/utils/defined';
import type { PackageOperations } from '@prisma/cli-engine';
import { CliStructuredError } from '@prisma/cli-engine/protocol';
import { join } from 'pathe';
import { buildCatalogWarnings } from '../commands/init/catalog-warnings';
import { formatRemoveCommand, type PackageManager } from '../commands/init/detect-package-manager';
import {
  errorInitPrisma7SchemaRefused,
  errorInitPrisma7SourceUnavailable,
  type PackagesAdded,
  packagesAddedAction,
} from '../commands/init/errors';
import {
  scaffoldSpecifierResolverFor,
  type TargetId,
  targetEntrypoint,
  targetPackageName,
} from '../commands/init/templates/code-templates';
import { loadContractSource } from '../control-api/operations/contract-emit';
import { chooseAction } from '../utils/next-actions';
import { installProjectDependencies } from './init-packages';
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

export interface Prisma7SourceCheck {
  /**
   * `readable`: the target package read the schema. `unchecked`: the package is not installed and
   * `--skip-install` forbade installing it. `no-source`: the package has no Prisma 7 contract source.
   */
  readonly outcome: 'readable' | 'unchecked' | 'no-source';
  readonly packageName: string;
  /** Every package the check installed, so the install phase skips them. */
  readonly installed: readonly string[];
  /** The installed packages the project did not declare before; `undefined` when there are none. */
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
    readonly warnings: readonly string[],
  ) {
    super(failure.message);
    this.name = 'Prisma7CheckInstallFailed';
  }
}

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
 * Finds out whether the chosen target package can read the Prisma 7 schema before init changes the
 * project: installs the package and `dotenv` (the packages every init installs), loads the
 * package's config entrypoint as the project resolves it, and runs its `prisma7Schema` source
 * without writing. The CLI carries no target code, so the installed package is the only one that
 * can answer.
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
    let installed: readonly string[] = [];
    let added: PackagesAdded | undefined;

    if (ctx.install) {
      const deps = [packageName, 'dotenv'];
      const declaredBefore = declaredPackages(ctx.cwd);
      const outcome = await installProjectDependencies({
        packages: ctx.packages,
        cwd: ctx.cwd,
        deps,
        devDeps: [],
        catalogWarnings: ctx.packageManager === 'pnpm' ? buildCatalogWarnings(ctx.cwd, deps) : [],
      });
      if (outcome.failure !== undefined) {
        throw new Prisma7CheckInstallFailed(outcome.failure, target, schemaPath, outcome.warnings);
      }
      warnings.push(...outcome.warnings);
      installed = deps;
      const newlyDeclared = deps.filter((dep) => !declaredBefore.has(dep));
      added =
        newlyDeclared.length === 0
          ? undefined
          : {
              packages: newlyDeclared,
              removeCommand: formatRemoveCommand(
                outcome.manager ?? ctx.packageManager,
                newlyDeclared,
              ),
            };
    }

    const undoable = async <T>(step: () => T | Promise<T>): Promise<T> => {
      try {
        return await step();
      } catch (error) {
        throw added === undefined ? error : withPackagesAddedAction(error, added);
      }
    };

    const module = await undoable(() =>
      ctx.importFromProject(ctx.cwd, targetEntrypoint(target, 'config', resolveImportSpecifier)),
    );
    if (module === undefined) {
      if (!ctx.install) {
        warnings.push(
          `Could not check that Prisma 8 can read ${schemaPath}: ${packageName} is not installed. Install the dependencies and run \`prisma contract emit\` to check it.`,
        );
        return { outcome: 'unchecked', packageName, installed, added, warnings };
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
      return { outcome: 'no-source', packageName, installed, added, warnings };
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
    return { outcome: 'readable', packageName, installed, added, warnings };
  };
}

function declaredPackages(cwd: string): ReadonlySet<string> {
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
  } catch {
    return new Set();
  }
  if (!isRecord(manifest)) {
    return new Set();
  }
  const names = ['dependencies', 'devDependencies', 'optionalDependencies'].flatMap((field) => {
    const section = manifest[field];
    return isRecord(section) ? Object.keys(section) : [];
  });
  return new Set(names);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
