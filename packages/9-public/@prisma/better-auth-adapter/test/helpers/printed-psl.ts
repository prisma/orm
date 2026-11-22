import type { BetterAuthOptions } from '@better-auth/core';
import { getAuthTables } from '@better-auth/core/db';
import { type ContractComparison, compareContract } from '../../src/contract/compare';
import { type PrintedPsl, printPsl, renderBlocks } from '../../src/contract/print-psl';
import type { SqlContract } from './databases';

export interface AdapterOptionsForComparison {
  readonly namespace?: string;
  readonly usePlural?: boolean;
}

export const pslHeader = '// use prisma-8\n';

export function compare(
  contract: SqlContract,
  betterAuthOptions: BetterAuthOptions,
  adapterOptions: AdapterOptionsForComparison = {},
): ContractComparison {
  return compareContract({
    contract,
    tables: getAuthTables(betterAuthOptions),
    betterAuthOptions,
    namespace: adapterOptions.namespace,
    usePlural: adapterOptions.usePlural ?? false,
  });
}

/** The PSL the adapter prints for a configuration against a contract that has no models: what the conformance harness migrates with. */
export function pslForConfiguration(
  emptyContract: SqlContract,
  betterAuthOptions: BetterAuthOptions,
  adapterOptions: AdapterOptionsForComparison = {},
): string {
  return `${pslHeader}\n${printPsl(compare(emptyContract, betterAuthOptions, adapterOptions)).text}\n`;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Applies printed PSL to the PSL it was printed against, as a user following the message would: the fields printed for an existing model go into that model, and missing models are added.
 */
export function addPrintedPsl(basePsl: string, printed: PrintedPsl, namespace?: string): string {
  let result = basePsl;
  for (const block of printed.blocks.filter((candidate) => candidate.existing)) {
    const model = new RegExp(`(model ${escapeRegExp(block.modelName)} \\{[^}]*?)(\\n\\s*\\})`);
    if (!model.test(result)) throw new Error(`No model ${block.modelName} in the base PSL`);
    result = result.replace(
      model,
      (_, body: string, close: string) =>
        `${body}\n${block.fieldLines.map((line) => `  ${line}`).join('\n')}${close}`,
    );
  }
  const missing = printed.blocks.filter((candidate) => !candidate.existing);
  return missing.length === 0 ? result : `${result}\n${renderBlocks(missing, namespace)}\n`;
}
