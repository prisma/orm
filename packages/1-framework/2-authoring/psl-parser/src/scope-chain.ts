import type { ContributedTypeScope, ContributedTypeSymbol } from './contributed-type-scope';
import type {
  BlockSymbol,
  CompositeTypeSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  TopLevelScope,
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
  | { readonly kind: 'contributedType'; readonly symbol: ContributedTypeSymbol };

export interface Scope {
  lookup(name: string): ScopeResolution | undefined;
}

export function namespaceScope(namespace: NamespaceSymbol): Scope {
  return {
    lookup(name) {
      const model = namespace.models[name];
      if (model !== undefined) return { kind: 'model', symbol: model, namespace };
      const compositeType = namespace.compositeTypes[name];
      if (compositeType !== undefined)
        return { kind: 'compositeType', symbol: compositeType, namespace };
      const block = namespace.blocks[name];
      if (block !== undefined) return { kind: 'block', symbol: block, namespace };
      return undefined;
    },
  };
}

export function topLevelScope(topLevel: TopLevelScope): Scope {
  return {
    lookup(name) {
      const model = topLevel.models[name];
      if (model !== undefined) return { kind: 'model', symbol: model };
      const compositeType = topLevel.compositeTypes[name];
      if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
      const namedType = topLevel.namedTypes[name];
      if (namedType !== undefined) return { kind: 'namedType', symbol: namedType };
      const block = topLevel.blocks[name];
      if (block !== undefined) return { kind: 'block', symbol: block };
      const namespace = topLevel.namespaces[name];
      if (namespace !== undefined) return { kind: 'namespace', symbol: namespace };
      return undefined;
    },
  };
}

export function contributedScope(
  contributedTypes: ContributedTypeScope,
  prefix: readonly string[],
): Scope {
  return {
    lookup(name) {
      const symbol = contributedTypes.lookup([...prefix, name]);
      return symbol === undefined ? undefined : { kind: 'contributedType', symbol };
    },
  };
}

export function unqualifiedChain(
  scope: NamespaceSymbol | undefined,
  topLevel: TopLevelScope,
  contributedTypes?: ContributedTypeScope,
): readonly Scope[] {
  const outer =
    contributedTypes === undefined
      ? [topLevelScope(topLevel)]
      : [topLevelScope(topLevel), contributedScope(contributedTypes, [])];
  return scope === undefined ? outer : [namespaceScope(scope), ...outer];
}

export function qualifiedChain(
  namespaceId: string,
  topLevel: TopLevelScope,
  contributedTypes?: ContributedTypeScope,
): readonly Scope[] {
  const namespace = topLevel.namespaces[namespaceId];
  const declared = namespace === undefined ? [] : [namespaceScope(namespace)];
  return contributedTypes === undefined
    ? declared
    : [...declared, contributedScope(contributedTypes, [namespaceId])];
}

export function lookupIn(chain: readonly Scope[], name: string): ScopeResolution | undefined {
  for (const scope of chain) {
    const found = scope.lookup(name);
    if (found !== undefined) return found;
  }
  return undefined;
}
