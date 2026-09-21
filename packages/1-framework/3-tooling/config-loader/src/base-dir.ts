import { AsyncLocalStorage } from 'node:async_hooks';
import { BASE_DIR_KEY } from '@internal/config/config-base-dir';

type BaseDirSlot = { [BASE_DIR_KEY]?: AsyncLocalStorage<string> };

function store(): AsyncLocalStorage<string> {
  const slot = globalThis as BaseDirSlot;
  slot[BASE_DIR_KEY] ??= new AsyncLocalStorage<string>();
  return slot[BASE_DIR_KEY];
}

/**
 * Runs `evaluate` with `dir` published as the base directory for everything
 * it awaits (ADR 253). The store is an AsyncLocalStorage so evaluations that
 * overlap in one process, such as a language server loading several
 * projects, each see their own directory. It is created here, by the loader,
 * and shared through the `Symbol.for` key the config helpers read.
 */
export function withBaseDir<T>(dir: string, evaluate: () => Promise<T>): Promise<T> {
  return store().run(dir, evaluate);
}
