import type { PrismaNextConfig } from '@internal/config/config-types';
import type { PslSourceSettings } from '@internal/framework-components/control';
import { createControlStack, hasPslContractPrint } from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
import { ifDefined } from '@internal/utils/defined';
import { errorRuntime } from '../../utils/cli-errors';
import { loadContractSource } from './load-contract-source';
import { validateLoadedContract } from './validate-loaded-contract';

type ContractConfig = NonNullable<PrismaNextConfig['contract']>;

export interface ContractPrintOptions {
  readonly config: PrismaNextConfig;
  readonly contractConfig: ContractConfig;
  /** The line under the `// use prisma-8` marker saying where the file came from. */
  readonly description: string;
  readonly signal?: AbortSignal;
}

export interface ContractPrintResult {
  readonly psl: string;
  readonly sourceSettings: PslSourceSettings;
}

export interface ContractPrintDependencies {
  readonly printPsl: typeof printPsl;
}

const defaultContractPrintDependencies: ContractPrintDependencies = { printPsl };

/**
 * Loads the configured contract, validates it as `contract emit` does, and prints it as Prisma 8
 * PSL. One control stack serves the whole operation: the source is loaded against it, the family
 * instance is created from it, and its block descriptors and codec lookup render the text.
 *
 * @throws {CliStructuredError} `CONTRACT.SOURCE_LOAD_FAILED` when the source cannot produce a
 * contract, and `CONTRACT.PRINT_UNSUPPORTED` when the family or target cannot print it
 * @throws the family instance's error for a contract whose structure it rejects, as `contract emit`
 * reports it
 * @throws {DOMException} `AbortError` if cancelled via `signal`
 */
export async function executeContractPrint(
  options: ContractPrintOptions,
  dependencies: ContractPrintDependencies = defaultContractPrintDependencies,
): Promise<ContractPrintResult> {
  const { config, contractConfig, description, signal } = options;
  const stack = createControlStack(config);
  const loaded = await loadContractSource({
    stack,
    source: contractConfig.source,
    ...ifDefined('signal', signal),
  });
  if (!loaded.ok) {
    throw loaded.failure.error;
  }

  const familyInstance = config.family.create(stack);
  const contract = validateLoadedContract({ config, familyInstance, contract: loaded.value });
  if (!hasPslContractPrint(familyInstance)) {
    throw errorRuntime(
      'CONTRACT.PRINT_UNSUPPORTED',
      'contract print is not supported for this family',
      {
        why: 'The configured family cannot print a contract as PSL, so nothing was written.',
        fix: 'Use a family and target that can print a contract as PSL.',
      },
    );
  }
  const { document, sourceSettings } = familyInstance.printPslContract(contract);

  return {
    psl: dependencies.printPsl(document, {
      pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
      codecLookup: stack.codecLookup,
      description,
    }),
    sourceSettings,
  };
}
