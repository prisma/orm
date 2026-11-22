/** The entry `entries` owns under `name`; an inherited property such as `constructor` is no entry. */
export function ownEntry<Entry>(
  entries: Readonly<Record<string, Entry>> | undefined,
  name: string,
): Entry | undefined {
  return entries !== undefined && Object.hasOwn(entries, name) ? entries[name] : undefined;
}
