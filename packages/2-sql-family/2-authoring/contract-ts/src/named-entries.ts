import { contractError } from './contract-errors';

/** What a name names, and where: the kind of entry it keys, with what the place it was declared tells. */
export type NameSite =
  | {
      readonly kind: 'namespace';
      readonly modelName: string | undefined;
      readonly tableName: string | undefined;
    }
  | { readonly kind: 'table'; readonly namespaceId: string }
  | { readonly kind: 'column'; readonly tableName: string }
  | { readonly kind: 'model'; readonly namespaceId: string | undefined }
  | { readonly kind: 'field'; readonly modelName: string | undefined }
  | { readonly kind: 'relation'; readonly modelName: string | undefined }
  | { readonly kind: 'enum'; readonly namespaceId: string | undefined }
  | { readonly kind: 'valueSet'; readonly namespaceId: string }
  | { readonly kind: 'valueObject' }
  | { readonly kind: 'valueObjectField'; readonly valueObjectName: string }
  | { readonly kind: 'databaseType' }
  | { readonly kind: 'extensionPack' }
  | { readonly kind: 'entity'; readonly entityKind: string; readonly namespaceId: string };

/** How an error message names what the name names, such as `A table in namespace "public"`. */
function nameSiteSubject(site: NameSite): string {
  switch (site.kind) {
    case 'namespace':
      if (site.modelName !== undefined) return `The namespace of model "${site.modelName}"`;
      if (site.tableName !== undefined) return `The namespace of table "${site.tableName}"`;
      return 'A namespace';
    case 'table':
      return `A table in namespace "${site.namespaceId}"`;
    case 'column':
      return `A column of table "${site.tableName}"`;
    case 'model':
      return site.namespaceId === undefined
        ? 'A model'
        : `A model in namespace "${site.namespaceId}"`;
    case 'field':
      return site.modelName === undefined
        ? 'A field of a model'
        : `A field of model "${site.modelName}"`;
    case 'relation':
      return site.modelName === undefined
        ? 'A relation of a model'
        : `A relation of model "${site.modelName}"`;
    case 'enum':
      return site.namespaceId === undefined
        ? 'An enum'
        : `An enum in namespace "${site.namespaceId}"`;
    case 'valueSet':
      return `A value set in namespace "${site.namespaceId}"`;
    case 'valueObject':
      return 'A value object';
    case 'valueObjectField':
      return `A field of value object "${site.valueObjectName}"`;
    case 'databaseType':
      return 'A database type';
    case 'extensionPack':
      return 'An extension pack';
    case 'entity':
      return `A "${site.entityKind}" entity in namespace "${site.namespaceId}"`;
  }
}

/** The error metadata that says what the name names and locates it. */
function nameSiteMeta(site: NameSite): Record<string, string> {
  const meta: Record<string, string> = {};
  for (const [key, value] of Object.entries(site)) {
    if (typeof value === 'string') meta[key] = value;
  }
  return meta;
}

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

/** Stores `entry` in `entries` under `name`. Refuses a name that cannot be an object's own key. */
export function writeNamedEntry<Entry>(
  entries: Record<string, Entry>,
  name: string,
  entry: Entry,
  site: NameSite,
): void {
  const reason = nameUnusableAsKeyReason(name);
  if (reason !== undefined) {
    throw contractError(
      'CONTRACT.NAME_UNUSABLE_AS_KEY',
      `${nameSiteSubject(site)} is named "${name}", which ${reason}. Choose another name.`,
      { meta: { name, ...nameSiteMeta(site), reason: 'name-not-a-key' } },
    );
  }
  entries[name] = entry;
}

/**
 * The object of named entries stored in `entries` under `name`, storing an empty one first when there is none. Refuses `name` as {@link writeNamedEntry} does.
 */
export function ensureNamedEntries<Entry>(
  entries: Record<string, Record<string, Entry>>,
  name: string,
  site: NameSite,
): Record<string, Entry> {
  const existing = readNamedEntry(entries, name);
  if (existing !== undefined) return existing;
  const created: Record<string, Entry> = {};
  writeNamedEntry(entries, name, created, site);
  return created;
}

/** An object of the named entries, each stored with {@link writeNamedEntry}. */
export function namedEntriesFrom<Entry>(
  pairs: Iterable<readonly [string, Entry]>,
  site: NameSite,
): Record<string, Entry> {
  const entries: Record<string, Entry> = {};
  for (const [name, entry] of pairs) {
    writeNamedEntry(entries, name, entry, site);
  }
  return entries;
}

/**
 * Refuses an author's object of named entries whose prototype is not the plain object one. In an object literal, a key written as `__proto__` sets the object's prototype and stores no entry, so no write ever sees that name.
 */
export function assertPlainNamedEntries(entries: object, site: NameSite): void {
  const prototype = Object.getPrototypeOf(entries);
  if (prototype === Object.prototype || prototype === null) return;
  throw contractError(
    'CONTRACT.NAME_UNUSABLE_AS_KEY',
    `${nameSiteSubject(site)} is written under the key "__proto__" in an object literal. JavaScript takes that key as the prototype of the object and stores no entry under it. Choose another name.`,
    { meta: { name: '__proto__', ...nameSiteMeta(site), reason: 'object-literal-prototype' } },
  );
}

/** A namespace name whose declaration names no model or table. */
export const namespaceNameSite: NameSite = {
  kind: 'namespace',
  modelName: undefined,
  tableName: undefined,
};
