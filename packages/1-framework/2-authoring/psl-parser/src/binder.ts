import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { diagnosticSource } from './diagnostic';
import type { ParseDiagnostic } from './parse';
import type { PslSources } from './source-file';
import type {
  BlockSymbol,
  CompositeTypeSymbol,
  FieldSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  SymbolTable,
  TopLevelScope,
} from './symbol-table';
import type { SyntaxNode } from './syntax/red';
import { type UniverseScope, type UniverseSymbol, universeScope } from './universe-scope';

export const PSL_UNRESOLVED_REFERENCE =
  'PSL_UNRESOLVED_REFERENCE' satisfies ContributedPslDiagnosticCode;

export type PslSymbol =
  | ModelSymbol
  | CompositeTypeSymbol
  | NamedTypeSymbol
  | BlockSymbol
  | NamespaceSymbol
  | FieldSymbol;

export type Resolution =
  | { readonly kind: 'model'; readonly symbol: ModelSymbol }
  | { readonly kind: 'compositeType'; readonly symbol: CompositeTypeSymbol }
  | { readonly kind: 'namedType'; readonly symbol: NamedTypeSymbol }
  | { readonly kind: 'block'; readonly symbol: BlockSymbol }
  | { readonly kind: 'universe'; readonly symbol: UniverseSymbol }
  | { readonly kind: 'crossSpace' }
  | { readonly kind: 'unresolved'; readonly name: string };

export interface Binder {
  declaredSymbol(node: SyntaxNode): PslSymbol | undefined;
  symbolForNode(node: SyntaxNode): Resolution | undefined;
}

export interface CreateBinderOptions {
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly typeConstructors: AuthoringTypeNamespace;
}

export interface BinderResult {
  readonly binder: Binder;
  readonly diagnostics: readonly ParseDiagnostic[];
}

export function typeReferenceNode(field: FieldSymbol): SyntaxNode | undefined {
  return field.node.typeAnnotation()?.name()?.syntax;
}

class PslBinder implements Binder {
  readonly #declarations: WeakMap<SyntaxNode, PslSymbol>;
  readonly #references: WeakMap<SyntaxNode, Resolution>;

  constructor(
    declarations: WeakMap<SyntaxNode, PslSymbol>,
    references: WeakMap<SyntaxNode, Resolution>,
  ) {
    this.#declarations = declarations;
    this.#references = references;
  }

  declaredSymbol(node: SyntaxNode): PslSymbol | undefined {
    return this.#declarations.get(node);
  }

  symbolForNode(node: SyntaxNode): Resolution | undefined {
    return this.#references.get(node);
  }
}

interface Owner {
  readonly scope: NamespaceSymbol | undefined;
  readonly symbol: ModelSymbol | CompositeTypeSymbol;
}

export function createBinder(options: CreateBinderOptions): BinderResult {
  const { sources, symbolTable, typeConstructors } = options;
  const universe = universeScope(typeConstructors);
  const declarations = new WeakMap<SyntaxNode, PslSymbol>();
  const references = new WeakMap<SyntaxNode, Resolution>();
  const diagnostics: ParseDiagnostic[] = [];

  for (const symbol of Object.values(symbolTable.topLevel.namedTypes)) {
    declarations.set(symbol.node.syntax, symbol);
  }
  for (const symbol of Object.values(symbolTable.topLevel.blocks)) {
    declarations.set(symbol.node.syntax, symbol);
  }
  for (const namespace of Object.values(symbolTable.topLevel.namespaces)) {
    for (const declaration of namespace.declarations) {
      declarations.set(declaration.node.syntax, namespace);
    }
    for (const symbol of Object.values(namespace.blocks)) {
      declarations.set(symbol.node.syntax, symbol);
    }
  }

  for (const { scope, symbol } of owners(symbolTable)) {
    declarations.set(symbol.node.syntax, symbol);
    for (const field of Object.values(symbol.fields)) {
      declarations.set(field.node.syntax, field);
      const node = typeReferenceNode(field);
      if (node === undefined) continue;
      const resolution = resolveTypeReference(field, scope, symbolTable.topLevel, universe);
      if (resolution === undefined) continue;
      references.set(node, resolution);
      if (resolution.kind === 'unresolved') {
        diagnostics.push({
          code: PSL_UNRESOLVED_REFERENCE,
          message: `Cannot find type "${resolution.name}"`,
          ...diagnosticSource(sources, node).at(),
        });
      }
    }
  }

  return { binder: new PslBinder(declarations, references), diagnostics };
}

function* owners(symbolTable: SymbolTable): Iterable<Owner> {
  const { topLevel } = symbolTable;
  for (const symbol of Object.values(topLevel.models)) yield { scope: undefined, symbol };
  for (const symbol of Object.values(topLevel.compositeTypes)) yield { scope: undefined, symbol };
  for (const scope of Object.values(topLevel.namespaces)) {
    for (const symbol of Object.values(scope.models)) yield { scope, symbol };
    for (const symbol of Object.values(scope.compositeTypes)) yield { scope, symbol };
  }
}

function resolveTypeReference(
  field: FieldSymbol,
  scope: NamespaceSymbol | undefined,
  topLevel: TopLevelScope,
  universe: UniverseScope,
): Resolution | undefined {
  if (field.malformedType === true) return undefined;
  if (field.typeContractSpaceId !== undefined) return { kind: 'crossSpace' };
  const name = field.typeName;
  if (name === '') return undefined;

  const namespaceId = field.typeNamespaceId;
  if (namespaceId !== undefined) {
    const namespace = own(topLevel.namespaces, namespaceId);
    const declared = namespace === undefined ? undefined : inNamespace(namespace, name);
    if (declared !== undefined) return declared;
    const universeSymbol = universe.lookup([namespaceId, name]);
    if (universeSymbol !== undefined) return { kind: 'universe', symbol: universeSymbol };
    return { kind: 'unresolved', name: `${namespaceId}.${name}` };
  }

  const local = scope === undefined ? undefined : inNamespace(scope, name);
  if (local !== undefined) return local;
  const global = inTopLevel(topLevel, name);
  if (global !== undefined) return global;
  const universeSymbol = universe.lookup([name]);
  if (universeSymbol !== undefined) return { kind: 'universe', symbol: universeSymbol };
  return { kind: 'unresolved', name };
}

function inNamespace(namespace: NamespaceSymbol, name: string): Resolution | undefined {
  const model = own(namespace.models, name);
  if (model !== undefined) return { kind: 'model', symbol: model };
  const compositeType = own(namespace.compositeTypes, name);
  if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
  const block = own(namespace.blocks, name);
  if (block !== undefined) return { kind: 'block', symbol: block };
  return undefined;
}

function inTopLevel(topLevel: TopLevelScope, name: string): Resolution | undefined {
  const model = own(topLevel.models, name);
  if (model !== undefined) return { kind: 'model', symbol: model };
  const compositeType = own(topLevel.compositeTypes, name);
  if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
  const namedType = own(topLevel.namedTypes, name);
  if (namedType !== undefined) return { kind: 'namedType', symbol: namedType };
  const block = own(topLevel.blocks, name);
  if (block !== undefined) return { kind: 'block', symbol: block };
  return undefined;
}

function own<T>(record: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}
