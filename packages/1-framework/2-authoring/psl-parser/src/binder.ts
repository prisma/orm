import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { diagnosticSource } from './diagnostic';
import type { ParseDiagnostic } from './parse';
import type { ResolvedAttribute } from './resolve';
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
import type { FieldAttributeAst, ModelAttributeAst } from './syntax/ast/attributes';
import { ArrayLiteralAst, type ExpressionAst } from './syntax/ast/expressions';
import { IdentifierAst } from './syntax/ast/identifier';
import type { SyntaxNode } from './syntax/red';
import { type UniverseScope, type UniverseSymbol, universeScope } from './universe-scope';

export const PSL_UNRESOLVED_REFERENCE =
  'PSL_UNRESOLVED_REFERENCE' satisfies ContributedPslDiagnosticCode;

export const PSL_UNRESOLVED_ATTRIBUTE =
  'PSL_UNRESOLVED_ATTRIBUTE' satisfies ContributedPslDiagnosticCode;

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
  | { readonly kind: 'field'; readonly symbol: FieldSymbol }
  | { readonly kind: 'attributeSpec'; readonly spec: AttributeSpecView }
  | { readonly kind: 'crossSpace' }
  | { readonly kind: 'unresolved'; readonly name: string };

export interface AttributeArgTypeView {
  readonly kind: string;
  readonly of?: AttributeArgTypeView;
  readonly alternatives?: readonly AttributeArgTypeView[];
}

export interface AttributeParamView {
  readonly type: AttributeArgTypeView;
}

export interface AttributePositionalParamView extends AttributeParamView {
  readonly key: string;
}

export interface AttributeSpecView {
  readonly positional: readonly AttributePositionalParamView[];
  readonly named: Readonly<Record<string, AttributeParamView>>;
}

export interface AttributeSpecRegistry {
  model(name: string, owner: ModelSymbol | CompositeTypeSymbol): AttributeSpecView | undefined;
  field(
    name: string,
    owner: ModelSymbol | CompositeTypeSymbol,
    field: FieldSymbol,
  ): AttributeSpecView | undefined;
}

export interface Binder {
  declaredSymbol(node: SyntaxNode): PslSymbol | undefined;
  symbolForNode(node: SyntaxNode): Resolution | undefined;
}

export interface CreateBinderOptions {
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly typeConstructors: AuthoringTypeNamespace;
  readonly attributeSpecs: AttributeSpecRegistry;
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
  const { sources, symbolTable, typeConstructors, attributeSpecs } = options;
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
          data: { reference: 'type' },
          ...diagnosticSource(sources, node).at(),
        });
      }
    }
  }

  for (const { scope, symbol } of owners(symbolTable)) {
    const context = {
      owner: symbol,
      scope,
      references,
      diagnostics,
      symbolTable,
      sources,
    };
    bindAttributes(symbol, symbol.attributes, (name) => attributeSpecs.model(name, symbol), {
      ...context,
      field: undefined,
    });
    for (const field of Object.values(symbol.fields)) {
      bindAttributes(field, field.attributes, (name) => attributeSpecs.field(name, symbol, field), {
        ...context,
        field,
      });
    }
  }

  return { binder: new PslBinder(declarations, references), diagnostics };
}

interface BindContext {
  readonly owner: ModelSymbol | CompositeTypeSymbol;
  readonly scope: NamespaceSymbol | undefined;
  readonly field: FieldSymbol | undefined;
  readonly references: WeakMap<SyntaxNode, Resolution>;
  readonly diagnostics: ParseDiagnostic[];
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
}

function bindAttributes(
  holder: ModelSymbol | CompositeTypeSymbol | FieldSymbol,
  attributes: readonly ResolvedAttribute[],
  lookupSpec: (name: string) => AttributeSpecView | undefined,
  ctx: BindContext,
): void {
  const marker = holder.kind === 'field' ? '@' : '@@';
  const declared: Iterable<FieldAttributeAst | ModelAttributeAst> = holder.node.attributes();
  const nodes = Array.from(declared);
  attributes.forEach((attribute, index) => {
    const spec = lookupSpec(attribute.name);
    const nameNode = nodes[index]?.name()?.syntax;
    if (nameNode !== undefined) {
      if (spec === undefined) {
        ctx.references.set(nameNode, { kind: 'unresolved', name: attribute.name });
        ctx.diagnostics.push({
          code: PSL_UNRESOLVED_ATTRIBUTE,
          message: `Cannot find attribute "${marker}${attribute.name}"`,
          data: { reference: 'attribute' },
          ...diagnosticSource(ctx.sources, nameNode).at(),
        });
      } else {
        ctx.references.set(nameNode, { kind: 'attributeSpec', spec });
      }
    }
    if (spec !== undefined) bindArguments(attribute, spec, ctx);
  });
}

function bindArguments(attribute: ResolvedAttribute, spec: AttributeSpecView, ctx: BindContext) {
  let positional = 0;
  for (const arg of attribute.args) {
    const param =
      arg.name === undefined ? spec.positional[positional++] : own(spec.named, arg.name);
    if (param === undefined || arg.expression === undefined) continue;
    const kind = referenceKind(param.type);
    if (kind === undefined) continue;
    for (const node of referenceNodes(arg.expression)) {
      const resolution = resolveArgument(kind, node, ctx);
      if (resolution !== undefined) ctx.references.set(node, resolution);
    }
  }
}

function resolveArgument(
  kind: ReferenceKind,
  node: SyntaxNode,
  ctx: BindContext,
): Resolution | undefined {
  const name = IdentifierAst.cast(node)?.name();
  if (name === undefined) return undefined;
  switch (kind) {
    case 'fieldRef':
      return resolveOwnerField(name, node, ctx);
    case 'referencedFieldRef':
      return resolveReferencedField(name, node, ctx);
    case 'entityRef':
      return resolveEntity(name, node, ctx);
  }
}

function resolveOwnerField(name: string, node: SyntaxNode, ctx: BindContext): Resolution {
  const field = own(ctx.owner.fields, name);
  if (field !== undefined) return { kind: 'field', symbol: field };
  report(`Cannot find field "${name}" on "${ctx.owner.name}"`, node, ctx, 'field');
  return { kind: 'unresolved', name };
}

function resolveReferencedField(
  name: string,
  node: SyntaxNode,
  ctx: BindContext,
): Resolution | undefined {
  const declaring = ctx.field;
  if (declaring === undefined) return undefined;
  if (declaring.typeContractSpaceId !== undefined) return { kind: 'crossSpace' };
  const typeNode = typeReferenceNode(declaring);
  const target = typeNode === undefined ? undefined : ctx.references.get(typeNode);
  const fields = targetFields(target);
  const field = fields === undefined ? undefined : own(fields, name);
  if (field !== undefined) return { kind: 'field', symbol: field };
  report(
    `Cannot find field "${name}" on the type of "${ctx.owner.name}.${declaring.name}"`,
    node,
    ctx,
    'field',
  );
  return { kind: 'unresolved', name };
}

function targetFields(
  target: Resolution | undefined,
): Readonly<Record<string, FieldSymbol>> | undefined {
  if (target === undefined) return undefined;
  if (target.kind === 'model' || target.kind === 'compositeType') return target.symbol.fields;
  return undefined;
}

function resolveEntity(name: string, node: SyntaxNode, ctx: BindContext): Resolution {
  const entity = entityNamed(name, ctx);
  if (entity !== undefined) return entity;
  report(`Cannot find entity "${name}"`, node, ctx, 'entity');
  return { kind: 'unresolved', name };
}

function entityNamed(name: string, ctx: BindContext): Resolution | undefined {
  const { scope, symbolTable } = ctx;
  if (scope !== undefined) {
    const model = own(scope.models, name);
    if (model !== undefined) return { kind: 'model', symbol: model };
    const compositeType = own(scope.compositeTypes, name);
    if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
  }
  const model = own(symbolTable.topLevel.models, name);
  if (model !== undefined) return { kind: 'model', symbol: model };
  const compositeType = own(symbolTable.topLevel.compositeTypes, name);
  if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
  return undefined;
}

function report(
  message: string,
  node: SyntaxNode,
  ctx: BindContext,
  reference: 'field' | 'entity',
): void {
  ctx.diagnostics.push({
    code: PSL_UNRESOLVED_REFERENCE,
    message,
    data: { reference },
    ...diagnosticSource(ctx.sources, node).at(),
  });
}

type ReferenceKind = 'fieldRef' | 'referencedFieldRef' | 'entityRef';

function referenceKind(type: AttributeArgTypeView): ReferenceKind | undefined {
  if (type.kind === 'fieldRef' || type.kind === 'referencedFieldRef' || type.kind === 'entityRef') {
    return type.kind;
  }
  if (type.of !== undefined) return referenceKind(type.of);
  for (const alternative of type.alternatives ?? []) {
    const kind = referenceKind(alternative);
    if (kind !== undefined) return kind;
  }
  return undefined;
}

function referenceNodes(expression: ExpressionAst): readonly SyntaxNode[] {
  const array = ArrayLiteralAst.cast(expression.syntax);
  if (array === undefined) return [expression.syntax];
  return Array.from(array.elements(), (element) => element.syntax);
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
