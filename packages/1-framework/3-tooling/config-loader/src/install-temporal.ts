import { Temporal } from 'temporal-polyfill/full/implementation';

/**
 * Gives the process a global `Temporal` when the runtime has none. A `Temporal` that is already
 * there, the runtime's own or one the application installed, is left as it is.
 */
export function installTemporalWhenMissing(): void {
  if (Reflect.get(globalThis, 'Temporal') !== undefined) {
    return;
  }
  Object.defineProperty(globalThis, 'Temporal', {
    value: Temporal,
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
