import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type MysqlClientErrorCode =
  | 'RUNTIME.ARGUMENT_INVALID'
  | 'RUNTIME.BINDING_MISSING'
  | 'DRIVER.NOT_CONNECTED'
  | 'DRIVER.ALREADY_CONNECTED';

export function mysqlClientError(
  code: MysqlClientErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

/** A TypeScript contract whose `defineContract` came from another target's facade than the config's. */
export function typescriptContractForOtherTarget(options: {
  readonly contract: string;
  readonly builtFor: string;
  readonly configuredFor: string;
  readonly contractBuilderModule: string;
}): StructuredError {
  return structuredError(
    'CONFIG.VALIDATION_FAILED',
    `The TypeScript contract "${options.contract}" was built for target "${options.builtFor}", but this defineConfig is for target "${options.configuredFor}". Import defineContract from ${options.contractBuilderModule}.`,
    {
      why: "Its defineContract came from another target's contract-builder entry, so the contract carries that target's id and capabilities.",
      fix: `Import defineContract from ${options.contractBuilderModule}.`,
      meta: {
        contract: options.contract,
        builtFor: options.builtFor,
        configuredFor: options.configuredFor,
      },
    },
  );
}

/** A TypeScript contract path given to `defineConfig` in a file other than `.ts`, such as `.mts`. */
export function typescriptContractNotTs(targetId: string, contract: string): StructuredError {
  return structuredError(
    'CONFIG.VALIDATION_FAILED',
    `defineConfig for target "${targetId}" cannot build a contract from "${contract}".`,
    {
      why: 'A TypeScript contract must be a .ts file.',
      fix: 'Rename the contract to a .ts file, or point `contract` at a Prisma schema: a .prisma file, a folder of them, or a glob.',
      meta: { contract },
    },
  );
}
