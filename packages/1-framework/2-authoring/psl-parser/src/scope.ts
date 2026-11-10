import type {
  ContributedMember,
  ContributedNamespaceSymbol,
  ContributedTypeScope,
  ContributedTypeSymbol,
} from './contributed-type-scope';
import { namespaceIdOfPslName } from './namespace-names';
import type {
  BlockSymbol,
  CompositeTypeSymbol,
  MixinSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  SymbolTable,
} from './symbol-table';

export type ScopeResolution =
  | { readonly kind: 'model'; readonly symbol: ModelSymbol; readonly namespace: NamespaceSymbol }
  | {
      readonly kind: 'compositeType';
      readonly symbol: CompositeTypeSymbol;
      readonly namespace: NamespaceSymbol;
    }
  | {
      readonly kind: 'namedType';
      readonly symbol: NamedTypeSymbol;
      readonly namespace?: NamespaceSymbol;
    }
  | { readonly kind: 'block'; readonly symbol: BlockSymbol; readonly namespace: NamespaceSymbol }
  | { readonly kind: 'mixin'; readonly symbol: MixinSymbol; readonly namespace?: NamespaceSymbol }
  | { readonly kind: 'namespace'; readonly symbol: NamespaceSymbol }
  | { readonly kind: 'contributedNamespace'; readonly symbol: ContributedNamespaceSymbol }
  | { readonly kind: 'contributedType'; readonly symbol: ContributedTypeSymbol };

function* recordNames(...records: readonly Readonly<Record<string, unknown>>[]): Iterable<string> {
  for (const record of records) yield* Object.keys(record);
}

export abstract class Scope {
  constructor(protected readonly parent: Scope | undefined) {}

  abstract lookup(name: string): ScopeResolution | undefined;
  protected abstract ownNames(): Iterable<string>;

  *entries(): Iterable<readonly [string, ScopeResolution]> {
    const seen = new Set<string>();
    for (const name of this.ownNames()) {
      if (seen.has(name)) continue;
      seen.add(name);
      const resolution = this.lookup(name);
      if (resolution !== undefined) yield [name, resolution];
    }
    for (const entry of this.parent?.entries() ?? []) {
      if (!seen.has(entry[0])) yield entry;
    }
  }
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
  const mixin = namespace.mixins[name];
  if (mixin !== undefined) return { kind: 'mixin', symbol: mixin, namespace };
  return undefined;
}

class ContributedScope extends Scope {
  readonly #registry: ContributedTypeScope;

  constructor(registry: ContributedTypeScope) {
    super(undefined);
    this.#registry = registry;
  }

  lookup(name: string): ScopeResolution | undefined {
    const member = this.#registry.lookup(name);
    return member === undefined ? undefined : contributedResolution(member);
  }

  protected *ownNames(): Iterable<string> {
    for (const [name] of this.#registry.entries()) yield name;
  }
}

class DocumentScope extends Scope {
  readonly #symbols: SymbolTable;

  constructor(symbols: SymbolTable, parent: Scope | undefined) {
    super(parent);
    this.#symbols = symbols;
  }

  lookup(name: string): ScopeResolution | undefined {
    const { defaultNamespace, namedTypes, namespaces } = this.#symbols;
    const member = namespaceMember(defaultNamespace, name);
    if (member !== undefined) return member;
    const namedType = namedTypes[name];
    if (namedType !== undefined) return { kind: 'namedType', symbol: namedType };
    const namespace = namespaces[namespaceIdOfPslName(name)];
    if (namespace !== undefined) return { kind: 'namespace', symbol: namespace };
    return this.parent?.lookup(name);
  }

  protected *ownNames(): Iterable<string> {
    const { defaultNamespace, namedTypes, namespaces } = this.#symbols;
    yield* recordNames(
      defaultNamespace.models,
      defaultNamespace.compositeTypes,
      namedTypes,
      defaultNamespace.blocks,
      defaultNamespace.mixins,
    );
    for (const namespace of Object.values(namespaces)) yield namespace.name;
  }
}

class NamespaceScope extends Scope {
  readonly #namespace: NamespaceSymbol;

  constructor(namespace: NamespaceSymbol, parent: Scope | undefined) {
    super(parent);
    this.#namespace = namespace;
  }

  lookup(name: string): ScopeResolution | undefined {
    return namespaceMember(this.#namespace, name) ?? this.parent?.lookup(name);
  }

  protected ownNames(): Iterable<string> {
    const namespace = this.#namespace;
    return recordNames(
      namespace.models,
      namespace.compositeTypes,
      namespace.blocks,
      namespace.mixins,
    );
  }
}

export function contributedScope(registry: ContributedTypeScope): Scope {
  return new ContributedScope(registry);
}

export function documentScope(symbols: SymbolTable, parent: Scope | undefined): Scope {
  return new DocumentScope(symbols, parent);
}

export function namedTypeBaseScope(symbols: SymbolTable, parent: Scope | undefined): Scope {
  return new DocumentScope({ ...symbols, namedTypes: {} }, parent);
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
  yield* new NamespaceScope(qualifier.symbol, undefined).entries();
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
