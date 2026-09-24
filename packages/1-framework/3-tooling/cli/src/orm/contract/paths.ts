import { realpath, stat } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { basename, dirname, extname, join, normalize, resolve } from 'pathe';

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

/**
 * Where a config that names `contractPath` and sets no `output` has
 * `contract emit` write its JSON: beside the contract file, named after it.
 */
export function emittedJsonPathFor(contractPath: string): string {
  const extension = extname(contractPath);
  return `${extension.length === 0 ? contractPath : contractPath.slice(0, -extension.length)}.json`;
}

/**
 * The nearest part of `path` that exists, with symbolic links resolved, and
 * the names below it that do not exist yet.
 */
async function existingPart(
  path: string,
): Promise<{ readonly existing: string; readonly missing: readonly string[] }> {
  const missing: string[] = [];
  let candidate = path;
  for (;;) {
    try {
      return { existing: normalize(await realpath(candidate)), missing };
    } catch {
      const parent = dirname(candidate);
      if (parent === candidate) {
        return { existing: candidate, missing };
      }
      missing.unshift(basename(candidate));
      candidate = parent;
    }
  }
}

function withCaseSwapped(path: string): string {
  return [...path]
    .map((character) => {
      const upper = character.toUpperCase();
      return character === upper ? character.toLowerCase() : upper;
    })
    .join('');
}

/** Whether `existingPath` names the same file with the case of its letters swapped. */
async function volumeIgnoresCase(existingPath: string): Promise<boolean> {
  const swapped = withCaseSwapped(existingPath);
  if (swapped === existingPath) {
    return false;
  }
  try {
    const [original, variant] = await Promise.all([stat(existingPath), stat(swapped)]);
    return original.dev === variant.dev && original.ino === variant.ino;
  } catch {
    return false;
  }
}

/**
 * A key that is the same for two paths naming the same file. Symbolic links
 * are resolved, in the path itself or in its nearest existing parent, and the
 * key is lower case when that parent is on a volume that ignores case.
 */
export async function filePathKey(path: string): Promise<string> {
  const { existing, missing } = await existingPart(path);
  const resolved = join(existing, ...missing);
  return (await volumeIgnoresCase(existing)) ? resolved.toLowerCase() : resolved;
}
