import type { BetterAuthOptions } from '@better-auth/core';
import { getAuthTables } from '@better-auth/core/db';
import {
  type ContractComparison,
  type ContractProblem,
  compareContract,
} from '../../src/contract/compare';
import { type PrintedPsl, printPsl } from '../../src/contract/print-psl';
import { idLineOf, pslTypeOf } from '../../src/contract/psl-types';
import type { SqlContract } from '../../src/models/model-lookup';
import { targetSupportFor } from '../../src/target-support';
import { shippedTargetSupports } from '../../src/targets/shipped';

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
    support: targetSupportFor(contract, shippedTargetSupports),
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
export function addPrintedPsl(basePsl: string, printed: PrintedPsl): string {
  let result = basePsl;
  let added = printed.text;
  for (const block of printed.blocks.filter((candidate) => candidate.existing)) {
    const model = new RegExp(`(model ${escapeRegExp(block.modelName)} \\{[^}]*?)(\\n\\s*\\})`);
    if (!model.test(result)) throw new Error(`No model ${block.modelName} in the base PSL`);
    result = result.replace(
      model,
      (_, body: string, close: string) =>
        `${body}\n${block.fieldLines.map((line) => `  ${line}`).join('\n')}${close}`,
    );
    added = added.replace(
      new RegExp(`^model ${escapeRegExp(block.modelName)} \\{[^}]*\\}\\n*`, 'm'),
      '',
    );
  }
  return added.trim() === '' ? result : `${result}\n${added}\n`;
}

/**
 * The comparison's problems, with a wrong type's Better Auth field shown as the PSL type the message asks for, so tests read as the message does.
 */
export function problemsOf(comparison: ContractComparison): unknown[] {
  return comparison.problems.map((problem: ContractProblem) => {
    if (problem.kind === 'optional-field-not-nullable') {
      const { attribute, reference, ...rest } = problem;
      return { ...rest, expectedType: pslTypeOf(attribute, reference, comparison) };
    }
    if (problem.kind !== 'wrong-type') return problem;
    const { attribute, reference, ...rest } = problem;
    return {
      ...rest,
      expectedType:
        attribute === undefined
          ? idLineOf(comparison.idStrategy)
          : pslTypeOf(attribute, reference, comparison),
    };
  });
}
