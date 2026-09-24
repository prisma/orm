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
}

function contributedResolution(member: ContributedMember): ScopeResolution {
  return member.kind === 'contributedType'
    ? { kind: 'contributedType', symbol: member }
    : { kind: 'contributedNamespace', symbol: member };
}

function namespaceMember(namespace: NamespaceSymbol, name: string): ScopeResolution | undefined {
  const model = namespace.models[name];
  if (model !== undefined) return { kind: 'model', symbol: model, namespace };
  const compositeType = namespace.compositeTypes[name];
  if (compositeType !== undefined)
    return { kind: 'compositeType', symbol: compositeType, namespace };
  const block = namespace.blocks[name];
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
    const model = records.models[name];
    if (model !== undefined) return { kind: 'model', symbol: model };
    const compositeType = records.compositeTypes[name];
    if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
    const namedType = records.namedTypes[name];
    if (namedType !== undefined) return { kind: 'namedType', symbol: namedType };
    const block = records.blocks[name];
    if (block !== undefined) return { kind: 'block', symbol: block };
    const namespace = records.namespaces[name];
    if (namespace !== undefined) return { kind: 'namespace', symbol: namespace };
    return this.#parent?.lookup(name);
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
