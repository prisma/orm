import { contractError } from './contract-errors';

/** Why `name` cannot be an object's own key, if it cannot. */
export function nameUnusableAsKeyReason(name: string): string | undefined {
  return name === '__proto__'
    ? 'JavaScript reads as the prototype of an object rather than as a key'
    : undefined;
}

/** The entry of `entries` named `name`, when `entries` owns one; an inherited property such as `constructor` is not an entry. */
export function readNamedEntry<Entry>(
  entries: Readonly<Record<string, Entry>>,
  name: string,
): Entry | undefined {
  return Object.hasOwn(entries, name) ? entries[name] : undefined;
}

/**
 * Stores `entry` in `entries` under `name`. Refuses a name that cannot be an object's own key; `nameOf` says what the name names and where, such as `the namespace of model "User"`.
 */
export function writeNamedEntry<Entry>(
  entries: Record<string, Entry>,
  name: string,
  entry: Entry,
  nameOf: string,
): void {
  const reason = nameUnusableAsKeyReason(name);
  if (reason !== undefined) {
    throw contractError(
      'CONTRACT.NAME_UNUSABLE_AS_KEY',
      `${nameOf.charAt(0).toUpperCase()}${nameOf.slice(1)} is named "${name}", which ${reason}. Choose another name.`,
      { meta: { name, nameOf } },
    );
  }
  entries[name] = entry;
}

/** The object of named entries stored in `entries` under `name`, storing an empty one first when there is none. */
export function namedEntriesIn<Entry>(
  entries: Record<string, Record<string, Entry>>,
  name: string,
  nameOf: string,
): Record<string, Entry> {
  const existing = readNamedEntry(entries, name);
  if (existing !== undefined) return existing;
  const created: Record<string, Entry> = {};
  writeNamedEntry(entries, name, created, nameOf);
  return created;
}

/** An object of the named entries, each stored with {@link writeNamedEntry}. */
export function namedEntriesFrom<Entry>(
  pairs: Iterable<readonly [string, Entry]>,
  nameOf: string,
): Record<string, Entry> {
  const entries: Record<string, Entry> = {};
  for (const [name, entry] of pairs) {
    writeNamedEntry(entries, name, entry, nameOf);
  }
  return entries;
}
