import { pathToFileURL } from 'node:url';
import type { ContractConfig } from '@internal/config/config-types';
import { applySpecifierDefaultControlPolicy } from '@internal/contract/apply-specifier-default-control-policy';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { ok } from '@internal/utils/result';
import { contractError } from './contract-errors';

export interface TypeScriptContractSpecifierOptions {
  readonly defaultControlPolicy?: ControlPolicy;
}

// This helper stays family-agnostic and intentionally accepts the base Contract shape even when
// re-exported from a Mongo-specific package.
export function typescriptContract(
  contract: Contract,
  output?: string,
  options?: TypeScriptContractSpecifierOptions,
): ContractConfig {
  return {
    source: {
      format: 'typescript',
      load: async () =>
        ok(applySpecifierDefaultControlPolicy(contract, options?.defaultControlPolicy)),
    },
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
        return ok(applySpecifierDefaultControlPolicy(contract, options?.defaultControlPolicy));
      },
    },
    ...ifDefined('output', output),
  };
}
