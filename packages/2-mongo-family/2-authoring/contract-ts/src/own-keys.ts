/** The entry `entries` owns under `name`; an inherited property such as `constructor` is no entry. */
export function ownEntry<Entry>(
  entries: Readonly<Record<string, Entry>>,
  name: string,
): Entry | undefined {
  return Object.hasOwn(entries, name) ? entries[name] : undefined;
}

/** Stores `value` as an own key of `target`, so a name such as `__proto__` is a key rather than the prototype. */
export function defineOwn<Value>(target: Record<string, Value>, key: string, value: Value): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
