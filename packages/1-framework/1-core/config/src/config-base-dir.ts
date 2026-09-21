/**
 * The directory relative paths in a config file resolve against: the
 * directory of the file being evaluated. A loader publishes it for the
 * duration of the evaluation through a store it keeps on `globalThis` under
 * this `Symbol.for` key, and the config helpers read it while the file runs.
 * This side only reads: it imports nothing, so a config helper works under any
 * runtime, and outside a loader there is simply no base directory.
 */
export const BASE_DIR_KEY: unique symbol = Symbol.for('prisma.config.baseDir');

/** What a loader publishes: the shape of an AsyncLocalStorage<string>. */
export interface BaseDirStore {
  getStore(): string | undefined;
}

type BaseDirSlot = { [BASE_DIR_KEY]?: BaseDirStore };

export function baseDir(): string | undefined {
  return (globalThis as BaseDirSlot)[BASE_DIR_KEY]?.getStore();
}
