import type {
  ContributedMember,
  ContributedNamespaceSymbol,
  ContributedTypeScope,
  ContributedTypeSymbol,
} from './contributed-type-scope';
import type {
  BlockSymbol,
  CompositeTypeSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  TopLevelScope as TopLevelRecords,
} from './symbol-table';

export type ScopeResolution =
  | { readonly kind: 'model'; readonly symbol: ModelSymbol; readonly namespace?: NamespaceSymbol }
  | {
      readonly kind: 'compositeType';
      readonly symbol: CompositeTypeSymbol;
      readonly namespace?: NamespaceSymbol;
    }
  | {
      readonly kind: 'namedType';
      readonly symbol: NamedTypeSymbol;
      readonly namespace?: NamespaceSymbol;
    }
  | { readonly kind: 'block'; readonly symbol: BlockSymbol; readonly namespace?: NamespaceSymbol }
  | { readonly kind: 'namespace'; readonly symbol: NamespaceSymbol }
  | { readonly kind: 'contributedNamespace'; readonly symbol: ContributedNamespaceSymbol }
  | { readonly kind: 'contributedType'; readonly symbol: ContributedTypeSymbol };

export interface Scope {
  lookup(name: string): ScopeResolution | undefined;
  entries(): Iterable<readonly [string, ScopeResolution]>;
}

function ownMember<T>(record: Readonly<Record<string, T>>, name: string): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}

function* recordNames(...records: readonly Readonly<Record<string, unknown>>[]): Iterable<string> {
  for (const record of records) yield* Object.keys(record);
}

function* visibleEntries(
  names: Iterable<string>,
  lookup: (name: string) => ScopeResolution | undefined,
  parent?: Scope,
): Iterable<readonly [string, ScopeResolution]> {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) continue;
    seen.add(name);
    const resolution = lookup(name);
    if (resolution !== undefined) yield [name, resolution];
  }
  for (const entry of parent?.entries() ?? []) {
    if (!seen.has(entry[0])) yield entry;
  }
}

function contributedResolution(member: ContributedMember): ScopeResolution {
  return member.kind === 'contributedType'
    ? { kind: 'contributedType', symbol: member }
    : { kind: 'contributedNamespace', symbol: member };
}

function namespaceMember(namespace: NamespaceSymbol, name: string): ScopeResolution | undefined {
  const model = ownMember(namespace.models, name);
  if (model !== undefined) return { kind: 'model', symbol: model, namespace };
  const compositeType = ownMember(namespace.compositeTypes, name);
  if (compositeType !== undefined)
    return { kind: 'compositeType', symbol: compositeType, namespace };
  const block = ownMember(namespace.blocks, name);
  if (block !== undefined) return { kind: 'block', symbol: block, namespace };
  return undefined;
}

class ContributedScope implements Scope {
  readonly #registry: ContributedTypeScope;

  constructor(registry: ContributedTypeScope) {
    this.#registry = registry;
  }

  lookup(name: string): ScopeResolution | undefined {
    const member = this.#registry.lookup(name);
    return member === undefined ? undefined : contributedResolution(member);
  }

  *entries(): Iterable<readonly [string, ScopeResolution]> {
    for (const [name, member] of this.#registry.entries()) {
      yield [name, contributedResolution(member)];
    }
  }
}

class DocumentScope implements Scope {
  readonly #records: TopLevelRecords;
  readonly #parent: Scope | undefined;

  constructor(records: TopLevelRecords, parent: Scope | undefined) {
    this.#records = records;
    this.#parent = parent;
  }

  lookup(name: string): ScopeResolution | undefined {
    const records = this.#records;
    const model = ownMember(records.models, name);
    if (model !== undefined) return { kind: 'model', symbol: model };
    const compositeType = ownMember(records.compositeTypes, name);
    if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
    const namedType = ownMember(records.namedTypes, name);
    if (namedType !== undefined) return { kind: 'namedType', symbol: namedType };
    const block = ownMember(records.blocks, name);
    if (block !== undefined) return { kind: 'block', symbol: block };
    const namespace = ownMember(records.namespaces, name);
    if (namespace !== undefined) return { kind: 'namespace', symbol: namespace };
    return this.#parent?.lookup(name);
  }

  entries(): Iterable<readonly [string, ScopeResolution]> {
    const records = this.#records;
    return visibleEntries(
      recordNames(
        records.models,
        records.compositeTypes,
        records.namedTypes,
        records.blocks,
        records.namespaces,
      ),
      (name) => this.lookup(name),
      this.#parent,
    );
  }
}

class NamespaceScope implements Scope {
  readonly #namespace: NamespaceSymbol;
  readonly #parent: Scope;

  constructor(namespace: NamespaceSymbol, parent: Scope) {
    this.#namespace = namespace;
    this.#parent = parent;
  }

  lookup(name: string): ScopeResolution | undefined {
    return namespaceMember(this.#namespace, name) ?? this.#parent.lookup(name);
  }

  entries(): Iterable<readonly [string, ScopeResolution]> {
    const namespace = this.#namespace;
    return visibleEntries(
      recordNames(namespace.models, namespace.compositeTypes, namespace.blocks),
      (name) => this.lookup(name),
      this.#parent,
    );
  }
}

export function contributedScope(registry: ContributedTypeScope): Scope {
  return new ContributedScope(registry);
}

export function documentScope(records: TopLevelRecords, parent: Scope | undefined): Scope {
  return new DocumentScope(records, parent);
}

export function namespaceScope(namespace: NamespaceSymbol, parent: Scope): Scope {
  return new NamespaceScope(namespace, parent);
}

export function isNamespaceLike(
  resolution: ScopeResolution,
): resolution is Extract<ScopeResolution, { kind: 'namespace' | 'contributedNamespace' }> {
  return resolution.kind === 'namespace' || resolution.kind === 'contributedNamespace';
}

export function* memberEntries(
  qualifier: Extract<ScopeResolution, { kind: 'namespace' | 'contributedNamespace' }>,
): Iterable<readonly [string, ScopeResolution]> {
  if (qualifier.kind === 'contributedNamespace') {
    for (const [name, member] of qualifier.symbol.members) {
      yield [name, contributedResolution(member)];
    }
    return;
  }
  const namespace = qualifier.symbol;
  yield* visibleEntries(
    recordNames(namespace.models, namespace.compositeTypes, namespace.blocks),
    (name) => lookupMember(qualifier, name),
  );
}

export function lookupMember(
  qualifier: Extract<ScopeResolution, { kind: 'namespace' | 'contributedNamespace' }>,
  name: string,
): ScopeResolution | undefined {
  if (qualifier.kind === 'contributedNamespace') {
    const member = qualifier.symbol.members.get(name);
    return member === undefined ? undefined : contributedResolution(member);
  }
  return namespaceMember(qualifier.symbol, name);
}
