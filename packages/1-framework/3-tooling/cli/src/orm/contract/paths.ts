import type { PrismaNextConfig } from '@internal/config/config-types';
import { dirname, join, resolve } from 'pathe';

/** The file `contract infer` and `contract print` write when nothing names another. */
const PSL_CONTRACT_FILENAME = 'contract.prisma';

/**
 * Where `contract infer` and `contract print` write their PSL: `--output`,
 * else `contract.prisma` beside the emitted contract, else `contract.prisma`
 * in the invocation directory.
 */
export function pslOutputPathFor(inputs: {
  readonly config: PrismaNextConfig;
  readonly cwd: string;
  readonly output: string | undefined;
}): string {
  if (inputs.output !== undefined) {
    return resolve(inputs.cwd, inputs.output);
  }
  const contractOutput = inputs.config.contract?.output;
  if (contractOutput !== undefined) {
    return join(dirname(resolve(inputs.cwd, contractOutput)), PSL_CONTRACT_FILENAME);
  }
  return join(inputs.cwd, PSL_CONTRACT_FILENAME);
}
