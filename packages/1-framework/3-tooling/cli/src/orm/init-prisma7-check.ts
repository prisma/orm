import { DEFAULT_CONTRACT_SOURCE_DIR } from '@internal/config/config-types';
import { buildLoadedConfig, requireConfigSections } from '@internal/config-loader';
import { contractEntryFor } from '../commands/init/contract-entry';
import {
  errorInitContributionUnavailable,
  errorInitPrisma7SchemaRefused,
  errorInitPrisma7SourceUnavailable,
} from '../commands/init/errors';
import type { ContractEntry, InitContribution } from '../commands/init/init-contribution';
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

    const entry = contractEntryFor(
      contribution,
      { kind: 'prisma7-schema', path: schemaPath },
      { packageName, unlisted: false },
    );
    const section: unknown = defineConfig({
      contract: await runContractEntry(entry, {
        cwd: ctx.cwd,
        importFromProject: ctx.importFromProject,
        loaded: { module: contribution.configModule, namespace: imported.module },
        packageName,
        schemaPath,
      }),
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

/**
 * The contract entry's value as the written config would compute it: the value itself, or the
 * result of calling the export with the arguments, imported as the project resolves it.
 */
async function runContractEntry(
  entry: ContractEntry,
  ctx: {
    readonly cwd: string;
    readonly importFromProject: ImportFromProject;
    readonly loaded: { readonly module: string; readonly namespace: Record<string, unknown> };
    readonly packageName: string;
    readonly schemaPath: string;
  },
): Promise<unknown> {
  if ('value' in entry) {
    return entry.value;
  }
  const { call } = entry;
  const namespace =
    call.module === ctx.loaded.module
      ? ctx.loaded.namespace
      : await importCallModule(call.module, ctx);
  const callee = namespace[call.export];
  if (typeof callee !== 'function') {
    throw errorInitContributionUnavailable({
      packageName: ctx.packageName,
      reason: 'invalid-shape',
      detail: `its contractEntry calls ${call.export} from ${call.module}, which exports no function of that name`,
      unlisted: false,
      missingPeers: [],
      missingPeersCommand: undefined,
    });
  }
  return Reflect.apply(callee, undefined, [...call.args]);
}

async function importCallModule(
  module: string,
  ctx: {
    readonly cwd: string;
    readonly importFromProject: ImportFromProject;
    readonly packageName: string;
    readonly schemaPath: string;
  },
): Promise<Record<string, unknown>> {
  const imported = await ctx.importFromProject(ctx.cwd, module);
  if (imported.kind === 'loaded') {
    return imported.module;
  }
  throw imported.kind === 'unloadable'
    ? errorInitPrisma7SourceUnavailable({
        schemaPath: ctx.schemaPath,
        packageName: ctx.packageName,
        reason: 'unloadable',
        module,
        cause: imported.cause instanceof Error ? imported.cause.message : String(imported.cause),
      })
    : errorInitPrisma7SourceUnavailable({
        schemaPath: ctx.schemaPath,
        packageName: ctx.packageName,
        reason: 'not-resolvable',
        module,
      });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
