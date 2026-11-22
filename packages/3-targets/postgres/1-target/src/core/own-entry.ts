/** The entry `entries` owns under `name`; an inherited property such as `constructor` is no entry. */
export function ownEntry<Entry>(
  entries: Readonly<Record<string, Entry>> | undefined,
  name: string,
): Entry | undefined {
  return entries !== undefined && Object.hasOwn(entries, name) ? entries[name] : undefined;
}

/** Stores `entry` under `name` as a key of `entries`; assigning to `__proto__` would replace the prototype and store nothing. */
export function setOwnEntry<Entry>(
  entries: Record<string, Entry>,
  name: string,
  entry: Entry,
): void {
  Object.defineProperty(entries, name, {
    value: entry,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}
