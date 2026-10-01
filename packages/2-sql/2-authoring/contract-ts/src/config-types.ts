import { pathToFileURL } from 'node:url';
import type { ContractConfig } from '@internal/config/config-types';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlNamespaceBase, SqlNamespaceInput } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { ok } from '@internal/utils/result';
import { extname } from 'pathe';
import { buildSqlContractFromDefinition } from './build-contract';
import { contractError } from './contract-errors';
import { applySqlSpecifierControlPolicy, type SqlNamespaceFactory } from './derived-checks';

/**
 * Derives the emit output path from the TS contract input so artefacts land
 * colocated with the source (e.g. `prisma/contract.ts` →
 * `prisma/contract.json`). Mirrors the same default-derivation logic in
 * `@internal/sql-contract-psl/provider`.
 */
function defaultOutputFromContractPath(contractPath: string): string {
  const ext = extname(contractPath);
  if (ext.length === 0) return `${contractPath}.json`;
  return `${contractPath.slice(0, -ext.length)}.json`;
}

/**
 * Stamping a default control policy carries a consequence — derived checks are
 * stripped from tables the policy leaves non-managed — and the strip rebuilds
 * namespaces through the target's factory, so the two travel together.
 */
export interface TypeScriptContractSpecifierOptions {
  readonly defaultControlPolicy: ControlPolicy;
  readonly createNamespace: SqlNamespaceFactory;
}

export function emptyContract(options: {
  readonly output?: string;
  readonly target: TargetPackRef<'sql', string>;
  readonly createNamespace: (input: SqlNamespaceInput) => SqlNamespaceBase;
  readonly defaultControlPolicy?: ControlPolicy;
}): ContractConfig {
  return {
    source: {
      format: 'typescript',
      load: async () => {
        const built = buildSqlContractFromDefinition({
          warnings: undefined,
          target: options.target,
          createNamespace: options.createNamespace,
          models: [],
        });
        return ok(
          applySqlSpecifierControlPolicy(
            built,
            options.defaultControlPolicy,
            options.createNamespace,
          ),
        );
      },
    },
    ...ifDefined('output', options.output),
  };
}

export function typescriptContract(
  contract: Contract,
  output?: string,
  options?: TypeScriptContractSpecifierOptions,
): ContractConfig {
  return {
    source: {
      format: 'typescript',
      load: async () =>
        ok(
          options === undefined
            ? contract
            : applySqlSpecifierControlPolicy(
                contract,
                options.defaultControlPolicy,
                options.createNamespace,
              ),
        ),
    },
    // The in-memory variant has no input path to anchor on; fall through to
    // the global default in `normalizeContractConfig` when caller doesn't pin it.
    ...ifDefined('output', output),
  };
}

export function typescriptContractFromPath(
  contractPath: string,
  output?: string,
  options?: TypeScriptContractSpecifierOptions,
): ContractConfig {
  return {
    source: {
      format: 'typescript',
      inputs: [contractPath],
      load: async (context) => {
        const [absolutePath] = context.resolvedInputs;
        if (absolutePath === undefined) {
          throw new InternalError(
            'typescriptContractFromPath: context.resolvedInputs is empty. The CLI config loader should populate it from source.inputs.',
          );
        }
        const mod = await import(pathToFileURL(absolutePath).href);
        const contract: Contract | undefined = mod.default ?? mod.contract;
        if (contract === undefined) {
          throw contractError(
            'CONTRACT.MODULE_EXPORT_MISSING',
            `typescriptContractFromPath: module at "${absolutePath}" has no "default" or "contract" export.`,
            { meta: { path: absolutePath } },
          );
        }
        return ok(
          options === undefined
            ? contract
            : applySqlSpecifierControlPolicy(
                contract,
                options.defaultControlPolicy,
                options.createNamespace,
              ),
        );
      },
    },
    output: output ?? defaultOutputFromContractPath(contractPath),
  };
}
