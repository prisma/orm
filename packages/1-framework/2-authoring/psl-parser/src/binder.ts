import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import type { AttributeSpecNamespace } from './attribute-spec/spec-context';
import type { AttributeSpec, FieldAttributeCtx, ModelAttributeCtx } from './attribute-spec/types';
import {
  type ContributedTypeScope,
  type ContributedTypeSymbol,
  contributedTypeScope,
} from './contributed-type-scope';
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

export const PSL_UNRESOLVED_REFERENCE =
  'PSL_UNRESOLVED_REFERENCE' satisfies ContributedPslDiagnosticCode;

export type BoundSpec =
  | AttributeSpec<never, ModelAttributeCtx>
  | AttributeSpec<never, FieldAttributeCtx>;

export interface AttributeSymbol {
  readonly kind: 'attribute';
  readonly name: string;
  readonly level: 'model' | 'field';
  readonly spec: BoundSpec;
}

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
  | { readonly kind: 'contributedType'; readonly symbol: ContributedTypeSymbol }
  | { readonly kind: 'field'; readonly symbol: FieldSymbol }
  | { readonly kind: 'attribute'; readonly symbol: AttributeSymbol }
  | { readonly kind: 'crossSpace' }
  | { readonly kind: 'unresolved'; readonly name: string };

export interface Binder {
  declaredSymbol(node: SyntaxNode): PslSymbol | undefined;
  symbolForNode(node: SyntaxNode): Resolution | undefined;
}

export interface UnsupportedAttribute {
  readonly attribute: ResolvedAttribute;
  readonly level: 'model' | 'field';
  readonly owner: ModelSymbol | CompositeTypeSymbol;
  readonly field: FieldSymbol | undefined;
}

export type DescribeUnsupportedAttribute = (
  unsupported: UnsupportedAttribute,
) => ParseDiagnostic | undefined;

export interface CreateBinderOptions {
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly typeConstructors: AuthoringTypeNamespace;
  readonly attributeSpecs: AttributeSpecNamespace;
  readonly controlMutationDefaults: ControlDefaultRegistries;
  readonly describeUnsupportedAttribute?: DescribeUnsupportedAttribute | undefined;
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

interface ScopedEntity {
  readonly scope: NamespaceSymbol | undefined;
  readonly entity: ModelSymbol | CompositeTypeSymbol;
}

export function createBinder(options: CreateBinderOptions): BinderResult {
  const {
    sources,
    symbolTable,
    typeConstructors,
    attributeSpecs,
    controlMutationDefaults,
    describeUnsupportedAttribute,
  } = options;
  const contributedTypes = contributedTypeScope(typeConstructors);
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

  for (const { scope, entity } of entities(symbolTable)) {
    declarations.set(entity.node.syntax, entity);
    for (const field of Object.values(entity.fields)) {
      declarations.set(field.node.syntax, field);
      const node = typeReferenceNode(field);
      if (node === undefined) continue;
      const resolution = resolveTypeReference(field, scope, symbolTable.topLevel, contributedTypes);
      if (resolution === undefined) continue;
      references.set(node, resolution);
      if (resolution.kind === 'unresolved') {
        diagnostics.push({
          code: PSL_UNRESOLVED_REFERENCE,
          message: `Cannot find type "${resolution.name}"`,
          data: { reference: 'type', name: resolution.name },
          ...diagnosticSource(sources, node).at(),
        });
      }
    }
  }

  for (const { scope, entity } of entities(symbolTable)) {
    const context = {
      owner: entity,
      scope,
      references,
      diagnostics,
      symbolTable,
      sources,
      describeUnsupportedAttribute,
    };
    const specContext =
      entity.kind === 'model'
        ? { symbols: symbolTable, model: entity, controlMutationDefaults }
        : undefined;
    bindAttributes(
      entity,
      entity.attributes,
      attributeSpecs.model,
      (factory) => (specContext === undefined ? undefined : factory(specContext)),
      { ...context, field: undefined },
    );
    for (const field of Object.values(entity.fields)) {
      bindAttributes(
        field,
        field.attributes,
        attributeSpecs.field,
        (factory) => (specContext === undefined ? undefined : factory({ ...specContext, field })),
        { ...context, field },
      );
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
  readonly describeUnsupportedAttribute: DescribeUnsupportedAttribute | undefined;
}

function bindAttributes<Factory>(
  holder: ModelSymbol | CompositeTypeSymbol | FieldSymbol,
  attributes: readonly ResolvedAttribute[],
  specs: Readonly<Record<string, Factory>>,
  instantiate: (factory: Factory) => BoundSpec | undefined,
  ctx: BindContext,
): void {
  const declared: Iterable<FieldAttributeAst | ModelAttributeAst> = holder.node.attributes();
  const nodes = Array.from(declared);
  const level = holder.kind === 'field' ? 'field' : 'model';
  attributes.forEach((attribute, index) => {
    const factory = own(specs, attribute.name);
    if (factory === undefined) {
      const diagnostic = ctx.describeUnsupportedAttribute?.({
        attribute,
        level,
        owner: ctx.owner,
        field: level === 'field' ? ctx.field : undefined,
      });
      if (diagnostic !== undefined) ctx.diagnostics.push(diagnostic);
      return;
    }
    const spec = instantiate(factory);
    if (spec === undefined) return;
    const nameNode = nodes[index]?.name()?.syntax;
    if (nameNode !== undefined) {
      ctx.references.set(nameNode, {
        kind: 'attribute',
        symbol: {
          kind: 'attribute',
          name: attribute.name,
          level,
          spec,
        },
      });
    }
    bindArguments(attribute, spec, ctx);
  });
}

function bindArguments(attribute: ResolvedAttribute, spec: BoundSpec, ctx: BindContext) {
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
  const field = ctx.owner.fields[name];
  if (field !== undefined) return { kind: 'field', symbol: field };
  report(`Cannot find field "${name}" on "${ctx.owner.name}"`, node, ctx, 'field');
  return { kind: 'unresolved', name };
}

function resolveReferencedField(name: string, node: SyntaxNode, ctx: BindContext): Resolution {
  const declaring = ctx.field;
  if (declaring === undefined) return { kind: 'unresolved', name };
  if (declaring.typeContractSpaceId !== undefined) return { kind: 'crossSpace' };
  const typeNode = typeReferenceNode(declaring);
  const target = typeNode === undefined ? undefined : ctx.references.get(typeNode);
  const fields = targetFields(target);
  const field = fields?.[name];
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
    const model = scope.models[name];
    if (model !== undefined) return { kind: 'model', symbol: model };
    const compositeType = scope.compositeTypes[name];
    if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
  }
  const model = symbolTable.topLevel.models[name];
  if (model !== undefined) return { kind: 'model', symbol: model };
  const compositeType = symbolTable.topLevel.compositeTypes[name];
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

function referenceKind(type: unknown): ReferenceKind | undefined {
  if (typeof type !== 'object' || type === null) return undefined;
  if ('kind' in type) {
    const kind = type.kind;
    if (kind === 'fieldRef' || kind === 'referencedFieldRef' || kind === 'entityRef') return kind;
  }
  if ('of' in type) return referenceKind(type.of);
  if ('alternatives' in type && Array.isArray(type.alternatives)) {
    for (const alternative of type.alternatives) {
      const kind = referenceKind(alternative);
      if (kind !== undefined) return kind;
    }
  }
  return undefined;
}

function referenceNodes(expression: ExpressionAst): readonly SyntaxNode[] {
  const array = ArrayLiteralAst.cast(expression.syntax);
  if (array === undefined) return [expression.syntax];
  return Array.from(array.elements(), (element) => element.syntax);
}

function* entities(symbolTable: SymbolTable): Iterable<ScopedEntity> {
  const { topLevel } = symbolTable;
  for (const entity of Object.values(topLevel.models)) yield { scope: undefined, entity };
  for (const entity of Object.values(topLevel.compositeTypes)) yield { scope: undefined, entity };
  for (const scope of Object.values(topLevel.namespaces)) {
    for (const entity of Object.values(scope.models)) yield { scope, entity };
    for (const entity of Object.values(scope.compositeTypes)) yield { scope, entity };
  }
}

function resolveTypeReference(
  field: FieldSymbol,
  scope: NamespaceSymbol | undefined,
  topLevel: TopLevelScope,
  contributedTypes: ContributedTypeScope,
): Resolution | undefined {
  if (field.malformedType === true) return undefined;
  if (field.typeContractSpaceId !== undefined) return { kind: 'crossSpace' };
  const name = field.typeName;
  if (name === '') return undefined;

  const namespaceId = field.typeNamespaceId;
  if (namespaceId !== undefined) {
    const namespace = topLevel.namespaces[namespaceId];
    const declared = namespace === undefined ? undefined : inNamespace(namespace, name);
    if (declared !== undefined) return declared;
    const contributedSymbol = contributedTypes.lookup([namespaceId, name]);
    if (contributedSymbol !== undefined)
      return { kind: 'contributedType', symbol: contributedSymbol };
    return { kind: 'unresolved', name: `${namespaceId}.${name}` };
  }

  const local = scope === undefined ? undefined : inNamespace(scope, name);
  if (local !== undefined) return local;
  const global = inTopLevel(topLevel, name);
  if (global !== undefined) return global;
  const contributedSymbol = contributedTypes.lookup([name]);
  if (contributedSymbol !== undefined)
    return { kind: 'contributedType', symbol: contributedSymbol };
  return { kind: 'unresolved', name };
}

function inNamespace(namespace: NamespaceSymbol, name: string): Resolution | undefined {
  const model = namespace.models[name];
  if (model !== undefined) return { kind: 'model', symbol: model };
  const compositeType = namespace.compositeTypes[name];
  if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
  const block = namespace.blocks[name];
  if (block !== undefined) return { kind: 'block', symbol: block };
  return undefined;
}

function inTopLevel(topLevel: TopLevelScope, name: string): Resolution | undefined {
  const model = topLevel.models[name];
  if (model !== undefined) return { kind: 'model', symbol: model };
  const compositeType = topLevel.compositeTypes[name];
  if (compositeType !== undefined) return { kind: 'compositeType', symbol: compositeType };
  const namedType = topLevel.namedTypes[name];
  if (namedType !== undefined) return { kind: 'namedType', symbol: namedType };
  const block = topLevel.blocks[name];
  if (block !== undefined) return { kind: 'block', symbol: block };
  return undefined;
}

function own<T>(record: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}
