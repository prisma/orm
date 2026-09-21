/**
 * The directory relative paths in a config file resolve against: the
 * directory of the file being evaluated. The loader sets it around the
 * evaluation and the config helpers read it while the file runs. `Symbol.for`
 * so every loader and helper in a dependency tree shares one slot.
 */
export const BASE_DIR_KEY: unique symbol = Symbol.for('prisma.config.baseDir');

type BaseDirSlot = { [BASE_DIR_KEY]?: string };

export function baseDir(): string | undefined {
  return (globalThis as BaseDirSlot)[BASE_DIR_KEY];
}

/** Runs `evaluate` with `dir` as the base directory, restoring the previous value after. */
export async function withBaseDir<T>(dir: string, evaluate: () => Promise<T>): Promise<T> {
  const slot = globalThis as BaseDirSlot;
  const previous = slot[BASE_DIR_KEY];
  slot[BASE_DIR_KEY] = dir;
  try {
    return await evaluate();
  } finally {
    if (previous === undefined) {
      delete slot[BASE_DIR_KEY];
    } else {
      slot[BASE_DIR_KEY] = previous;
    }
  }
}
