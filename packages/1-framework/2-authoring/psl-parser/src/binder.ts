import type {
  AuthoringPslBlockDescriptorNamespace,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import type { ControlDefaultRegistries } from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import type {
  AttributeSpecNamespace,
  BlockAttributeSpecFactory,
} from './attribute-spec/spec-context';
import type {
  AttributeSpec,
  FieldAttributeCtx,
  InspectableArgType,
  ModelAttributeCtx,
  Param,
  PositionalParam,
} from './attribute-spec/types';
import { blockSpecFactoryOf } from './block-spec/descriptor';
import { contributedTypeScope } from './contributed-type-scope';
import { diagnosticSource } from './diagnostic';
import { findBlockDescriptor } from './extension-block';
import type { ParseDiagnostic } from './parse';
import { type ResolvedAttribute, readResolvedAttributes } from './resolve';
import {
  contributedScope,
  documentScope,
  isNamespaceLike,
  lookupMember,
  namespaceScope,
  type Scope,
  type ScopeResolution,
} from './scope';
import type { PslSources } from './source-file';
import type {
  BlockSymbol,
  CompositeTypeSymbol,
  FieldSymbol,
  ModelSymbol,
  NamedTypeSymbol,
  NamespaceSymbol,
  SymbolTable,
} from './symbol-table';
import type { FieldAttributeAst, ModelAttributeAst } from './syntax/ast/attributes';
import {
  ArrayLiteralAst,
  type ExpressionAst,
  FunctionCallAst,
  ObjectLiteralExprAst,
} from './syntax/ast/expressions';
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
  | ScopeResolution
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
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace | undefined;
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

class ScopeStack {
  readonly #base: Scope;
  readonly #scopes: Scope[];

  constructor(base: Scope) {
    this.#base = base;
    this.#scopes = [base];
  }

  current(): Scope {
    return this.#scopes[this.#scopes.length - 1] ?? this.#base;
  }

  push(scope: Scope): void {
    this.#scopes.push(scope);
  }

  pop(): void {
    this.#scopes.pop();
  }
}

function walkEntities(
  symbolTable: SymbolTable,
  stack: ScopeStack,
  visit: (entity: ModelSymbol | CompositeTypeSymbol) => void,
): void {
  const { topLevel } = symbolTable;
  for (const entity of Object.values(topLevel.models)) visit(entity);
  for (const entity of Object.values(topLevel.compositeTypes)) visit(entity);
  for (const namespace of Object.values(topLevel.namespaces)) {
    stack.push(namespaceScope(namespace, stack.current()));
    for (const entity of Object.values(namespace.models)) visit(entity);
    for (const entity of Object.values(namespace.compositeTypes)) visit(entity);
    stack.pop();
  }
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
  const pslBlockDescriptors = options.pslBlockDescriptors ?? {};
  const stack = new ScopeStack(
    documentScope(symbolTable.topLevel, contributedScope(contributedTypeScope(typeConstructors))),
  );
  const declarations = new WeakMap<SyntaxNode, PslSymbol>();
  const references = new WeakMap<SyntaxNode, Resolution>();
  const diagnostics: ParseDiagnostic[] = [];
  const binder = new PslBinder(declarations, references);

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

  // Attributes are parsed in a second walk once every field type is bound.
  // @relation(references: [x]) reads the referenced model's fields, and that
  // model may be declared further down the file.
  walkEntities(symbolTable, stack, (entity) => {
    declarations.set(entity.node.syntax, entity);
    for (const field of Object.values(entity.fields)) {
      declarations.set(field.node.syntax, field);
      const node = typeReferenceNode(field);
      if (node === undefined) continue;
      const outcome = resolveTypeReference(field, stack.current());
      if (outcome === undefined) continue;
      references.set(node, outcome.resolution);
      if (outcome.message !== undefined) {
        diagnostics.push({
          code: PSL_UNRESOLVED_REFERENCE,
          message: outcome.message,
          data: {
            reference: 'type',
            name: outcome.name,
            constructorCall: field.typeConstructor !== undefined,
          },
          ...diagnosticSource(sources, node).at(),
        });
      }
    }
  });

  walkEntities(symbolTable, stack, (entity) => {
    const context = {
      owner: entity,
      scope: stack.current(),
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
  });

  const blockContext = {
    pslBlockDescriptors,
    symbolTable,
    sources,
    references,
    diagnostics,
  };
  const bindBlocks = (blocks: Readonly<Record<string, BlockSymbol>>) => {
    const context = { ...blockContext, scope: stack.current() };
    for (const block of Object.values(blocks)) bindBlock(block, context);
  };
  bindBlocks(symbolTable.topLevel.blocks);
  for (const namespace of Object.values(symbolTable.topLevel.namespaces)) {
    stack.push(namespaceScope(namespace, stack.current()));
    bindBlocks(namespace.blocks);
    stack.pop();
  }

  return { binder, diagnostics };
}

interface ReferenceContext {
  readonly scope: Scope;
  readonly sources: PslSources;
  readonly references: WeakMap<SyntaxNode, Resolution>;
  readonly diagnostics: ParseDiagnostic[];
}

interface BlockBindContext extends ReferenceContext {
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly symbolTable: SymbolTable;
}

function bindBlock(block: BlockSymbol, ctx: BlockBindContext): void {
  const descriptor = findBlockDescriptor(ctx.pslBlockDescriptors, block.keyword);
  if (descriptor === undefined) return;
  const spec = blockSpecFactoryOf(descriptor)({ symbols: ctx.symbolTable, block });

  for (const entry of block.node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    const rule =
      spec.mode === 'struct'
        ? Object.hasOwn(spec.parameters, key)
          ? spec.parameters[key]?.type
          : undefined
        : spec.value.type;
    const value = entry.value();
    if (rule === undefined || value === undefined) continue;
    bindExpression(rule, value, ctx);
  }

  const attributeSpecs = descriptor.attributes ?? {};
  if (Object.keys(attributeSpecs).length === 0) return;
  for (const attribute of readResolvedAttributes(block.node.attributes(), ctx.sources)) {
    const factory = attributeSpecs[attribute.name];
    if (factory === undefined) continue;
    const attributeSpec = blindCast<
      BlockAttributeSpecFactory,
      'framework core cannot name AttributeSpec, so block-attribute factories transit the descriptor erased as unknown; the binder restores the factory type the descriptor surface documents'
    >(factory)({ symbols: ctx.symbolTable, block });
    bindArguments(attribute, attributeSpec, ctx);
  }
}

function bindExpression(
  rule: InspectableArgType<never>,
  expression: ExpressionAst,
  ctx: ReferenceContext,
  modelContext?: BindContext,
): void {
  const trial = tryBindExpression(rule, expression, ctx, modelContext);
  for (const [node, resolution] of trial.references) ctx.references.set(node, resolution);
  ctx.diagnostics.push(...trial.diagnostics.values());
}

interface BindingTrial {
  readonly matched: boolean;
  readonly references: Map<SyntaxNode, Resolution>;
  readonly diagnostics: Map<SyntaxNode, ParseDiagnostic>;
}

function tryBindExpression(
  rule: InspectableArgType<never>,
  expression: ExpressionAst,
  ctx: ReferenceContext,
  modelContext?: BindContext,
): BindingTrial {
  const references = new Map<SyntaxNode, Resolution>();
  const diagnostics = new Map<SyntaxNode, ParseDiagnostic>();
  switch (rule.kind) {
    case 'oneOf': {
      for (const alternative of rule.alternatives) {
        const trial = tryBindExpression(alternative, expression, ctx, modelContext);
        if (trial.matched) return trial;
        for (const [node, diagnostic] of trial.diagnostics) diagnostics.set(node, diagnostic);
        for (const [node, resolution] of trial.references) {
          if (resolution.kind === 'unresolved') references.set(node, resolution);
        }
      }
      return { matched: false, references, diagnostics };
    }
    case 'list':
    case 'record': {
      const children =
        rule.kind === 'list'
          ? ArrayLiteralAst.cast(expression.syntax)?.elements()
          : recordValues(expression);
      if (children === undefined) return { matched: false, references, diagnostics };
      let matched = true;
      for (const child of children) {
        const trial = tryBindExpression(rule.of, child, ctx, modelContext);
        matched = trial.matched && matched;
        for (const [node, resolution] of trial.references) references.set(node, resolution);
        for (const [node, diagnostic] of trial.diagnostics) diagnostics.set(node, diagnostic);
      }
      return { matched, references, diagnostics };
    }
    case 'funcCall': {
      const call = FunctionCallAst.cast(expression.syntax);
      const name = call?.name();
      if (
        call === undefined ||
        name === undefined ||
        name.dot() !== undefined ||
        name.colon() !== undefined ||
        name.identifier()?.name() !== rule.name
      )
        return { matched: false, references, diagnostics };
      let matched = true;
      let positional = 0;
      for (const arg of call.args()) {
        const key = arg.name()?.name();
        const parameter = argumentParameter(
          rule.signature,
          key,
          key === undefined ? positional++ : positional,
        );
        const value = arg.value();
        if (parameter === undefined || value === undefined) {
          matched = false;
          continue;
        }
        const trial = tryBindExpression(parameter.type, value, ctx, modelContext);
        matched = trial.matched && matched;
        for (const [node, resolution] of trial.references) references.set(node, resolution);
        for (const [node, diagnostic] of trial.diagnostics) diagnostics.set(node, diagnostic);
      }
      return { matched, references, diagnostics };
    }
    case 'entityRef': {
      const node = expression.syntax;
      const name = IdentifierAst.cast(node)?.name();
      if (name === undefined) return { matched: false, references, diagnostics };
      const failures: ParseDiagnostic[] = [];
      const resolution = resolveEntity(name, node, { ...ctx, diagnostics: failures });
      references.set(node, resolution);
      for (const diagnostic of failures) diagnostics.set(node, diagnostic);
      return {
        matched: resolution.kind !== 'unresolved',
        references,
        diagnostics,
      };
    }
    case 'fieldRef': {
      const node = expression.syntax;
      const name = IdentifierAst.cast(node)?.name();
      if (name === undefined || modelContext === undefined)
        return { matched: false, references, diagnostics };
      const failures: ParseDiagnostic[] = [];
      const resolution = resolveOwnerField(name, node, { ...modelContext, diagnostics: failures });
      references.set(node, resolution);
      for (const diagnostic of failures) diagnostics.set(node, diagnostic);
      return {
        matched: resolution.kind !== 'unresolved',
        references,
        diagnostics,
      };
    }
    case 'referencedFieldRef': {
      const node = expression.syntax;
      const name = IdentifierAst.cast(node)?.name();
      if (name === undefined || modelContext === undefined)
        return { matched: false, references, diagnostics };
      const failures: ParseDiagnostic[] = [];
      const resolution = resolveReferencedField(name, node, {
        ...modelContext,
        diagnostics: failures,
      });
      references.set(node, resolution);
      for (const diagnostic of failures) diagnostics.set(node, diagnostic);
      return {
        matched: resolution.kind !== 'unresolved',
        references,
        diagnostics,
      };
    }
    default:
      return { matched: true, references, diagnostics };
  }
}

function recordValues(expression: ExpressionAst): Iterable<ExpressionAst> | undefined {
  const record = ObjectLiteralExprAst.cast(expression.syntax);
  if (record === undefined) return undefined;
  return (function* () {
    for (const field of record.fields()) {
      const value = field.value();
      if (value !== undefined) yield value;
    }
  })();
}

interface BindContext extends ReferenceContext {
  readonly owner: ModelSymbol | CompositeTypeSymbol;
  readonly field: FieldSymbol | undefined;
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
    bindArguments(attribute, spec, ctx, ctx);
  });
}

function bindArguments(
  attribute: ResolvedAttribute,
  spec: BindingArguments,
  ctx: ReferenceContext,
  modelContext?: BindContext,
): void {
  let positional = 0;
  for (const arg of attribute.args) {
    const parameter = argumentParameter(
      spec,
      arg.name,
      arg.name === undefined ? positional++ : positional,
    );
    if (parameter === undefined || arg.expression === undefined) continue;
    bindExpression(parameter.type, arg.expression, ctx, modelContext);
  }
}

interface BindingArguments {
  readonly positional?: readonly PositionalParam<unknown, never>[];
  readonly named?: Readonly<Record<string, Param<unknown, never>>>;
}

function argumentParameter(
  spec: BindingArguments,
  name: string | undefined,
  position: number,
): Param<unknown, never> | undefined {
  if (name === undefined) return spec.positional?.[position];
  return spec.named === undefined ? undefined : own(spec.named, name);
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

function resolveEntity(name: string, node: SyntaxNode, ctx: ReferenceContext): Resolution {
  const found = ctx.scope.lookup(name);
  if (found === undefined) {
    report(`Cannot find entity "${name}"`, node, ctx, 'entity');
    return { kind: 'unresolved', name };
  }
  return found;
}

function report(
  message: string,
  node: SyntaxNode,
  ctx: ReferenceContext,
  reference: 'field' | 'entity',
): void {
  ctx.diagnostics.push({
    code: PSL_UNRESOLVED_REFERENCE,
    message,
    data: { reference },
    ...diagnosticSource(ctx.sources, node).at(),
  });
}

interface TypeReferenceOutcome {
  readonly resolution: Resolution;
  readonly message?: string;
  readonly name?: string;
}

function resolveTypeReference(field: FieldSymbol, scope: Scope): TypeReferenceOutcome | undefined {
  if (field.malformedType === true) return undefined;
  if (field.typeContractSpaceId !== undefined) return { resolution: { kind: 'crossSpace' } };
  const name = field.typeName;
  if (name === '') return undefined;
  const namespaceId = field.typeNamespaceId;
  const found =
    namespaceId === undefined ? scope.lookup(name) : qualifiedMember(namespaceId, name, scope);
  if (found === undefined) {
    const written = namespaceId === undefined ? name : `${namespaceId}.${name}`;
    return {
      resolution: { kind: 'unresolved', name: written },
      message: `Cannot find type "${written}"`,
      name: written,
    };
  }
  if ('badQualifier' in found) {
    return {
      resolution: { kind: 'unresolved', name: found.qualifier },
      message: found.badQualifier,
      name: found.qualifier,
    };
  }
  if (found.kind === 'namespace' || found.kind === 'contributedNamespace') {
    const written = namespaceId === undefined ? name : `${namespaceId}.${name}`;
    return {
      resolution: found,
      message: `"${written}" is a namespace; a type reference must name a model, composite type, enum, or named type`,
      name: written,
    };
  }
  return { resolution: found };
}

interface BadQualifier {
  readonly badQualifier: string;
  readonly qualifier: string;
}

function qualifiedMember(
  namespaceId: string,
  name: string,
  scope: Scope,
): ScopeResolution | BadQualifier | undefined {
  const qualifier = scope.lookup(namespaceId);
  if (qualifier === undefined) return undefined;
  if (!isNamespaceLike(qualifier)) {
    return {
      badQualifier: `"${namespaceId}" is ${describeQualifier(qualifier)}, not a namespace`,
      qualifier: namespaceId,
    };
  }
  return lookupMember(qualifier, name);
}

function describeQualifier(resolution: ScopeResolution): string {
  switch (resolution.kind) {
    case 'model':
      return 'a model';
    case 'compositeType':
      return 'a composite type';
    case 'namedType':
      return 'a named type';
    case 'block':
      return `${resolution.symbol.keyword === 'enum' ? 'an' : 'a'} ${resolution.symbol.keyword}`;
    default:
      return 'a scalar type';
  }
}

function own<T>(record: Record<string, T>, name: string): T | undefined {
  return Object.hasOwn(record, name) ? record[name] : undefined;
}
