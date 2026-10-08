import type { ContractSourceContext } from '@internal/config/config-types';
import type {
  AuthoringPslBlockDescriptorNamespace,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type {
  ControlMutationDefaultRegistry,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import type { ContributedPslDiagnosticCode } from '@internal/framework-components/psl-ast';
import { blindCast } from '@internal/utils/casts';
import {
  assembleAttributeSpecs,
  resolveDescribeUnresolvedType,
  resolveDescribeUnsupportedAttribute,
} from './attribute-spec/assemble';
import type {
  AttributeSpecNamespace,
  BlockAttributeSpecFactory,
} from './attribute-spec/spec-context';
import type {
  AttributeSpec,
  BlockAttributeCtx,
  FieldAttributeCtx,
  FuncCallSig,
  InspectableArgType,
  ModelAttributeCtx,
  Param,
  PositionalParam,
} from './attribute-spec/types';
import { blockSpecFactoryOf } from './block-spec/descriptor';
import { blockSpecContext } from './block-spec/spec-context';
import {
  type ContributedTypeNamespace,
  type ContributedTypeSymbol,
  contributedTypeScope,
  mergeContributedTypes,
} from './contributed-type-scope';
import { diagnosticSource } from './diagnostic';
import {
  describeWrittenEntityReference,
  type WrittenEntityReference,
  writtenEntityReference,
} from './entity-reference';
import { findBlockDescriptor } from './extension-block';
import type { ParseDiagnostic } from './parse';
import { type ResolvedAttribute, readResolvedAttributes } from './resolve';
import {
  contributedScope,
  documentScope,
  isNamespaceLike,
  lookupMember,
  namedTypeBaseScope,
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
  BooleanLiteralExprAst,
  type ExpressionAst,
  FunctionCallAst,
  NumberLiteralExprAst,
  ObjectLiteralExprAst,
  PathExprAst,
  StringLiteralExprAst,
  TaggedLiteralExprAst,
} from './syntax/ast/expressions';
import { IdentifierAst } from './syntax/ast/identifier';
import type { QualifiedNameAst } from './syntax/ast/qualified-name';
import type { SyntaxNode } from './syntax/red';
import { readWrittenScalar } from './written-scalar';

export const PSL_UNRESOLVED_REFERENCE =
  'PSL_UNRESOLVED_REFERENCE' satisfies ContributedPslDiagnosticCode;

export type BoundSpec =
  | AttributeSpec<never, ModelAttributeCtx>
  | AttributeSpec<never, FieldAttributeCtx>
  | AttributeSpec<never, BlockAttributeCtx>;

export interface AttributeSymbol {
  readonly kind: 'attribute';
  readonly name: string;
  readonly level: 'model' | 'field' | 'block';
  readonly spec: BoundSpec;
}

export interface ParameterSymbol {
  readonly kind: 'parameter';
  readonly name: string;
  readonly param: Param<unknown, never>;
}

export interface FunctionSymbol {
  readonly kind: 'function';
  readonly name: string;
  readonly signature: FuncCallSig<never>;
}

export interface ConstantSymbol {
  readonly kind: 'constant';
  readonly name: string;
  readonly documentation: string;
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
  | { readonly kind: 'parameter'; readonly symbol: ParameterSymbol }
  | { readonly kind: 'function'; readonly symbol: FunctionSymbol }
  | { readonly kind: 'constant'; readonly symbol: ConstantSymbol }
  | { readonly kind: 'crossSpace' }
  | { readonly kind: 'unresolved'; readonly name: string };

export interface Binder {
  declaredSymbol(node: SyntaxNode): PslSymbol | undefined;
  symbolForNode(node: SyntaxNode): Resolution | undefined;
  scopeAt(node: SyntaxNode): Scope;
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

export interface UnresolvedTypeReference {
  readonly field: FieldSymbol;
  readonly owner: ModelSymbol | CompositeTypeSymbol;
  readonly written: string;
}

export type DescribeUnresolvedType = (unresolved: UnresolvedTypeReference) => string | undefined;

export interface BinderContext
  extends Pick<ContractSourceContext, 'authoringContributions' | 'pslDiagnostics' | 'dataTypes'> {
  readonly controlMutationDefaults: Pick<ControlMutationDefaults, 'defaultFunctionRegistry'>;
}

export interface CreateBinderInput {
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly context: BinderContext;
}

interface BindingInputs {
  readonly sources: PslSources;
  readonly symbolTable: SymbolTable;
  readonly contributedTypes: ContributedTypeNamespace;
  readonly attributeSpecs: AttributeSpecNamespace;
  readonly defaultFunctionRegistry: ControlMutationDefaultRegistry;
  readonly dataTypes: DataTypeSupport;
  readonly pslBlockDescriptors?: AuthoringPslBlockDescriptorNamespace | undefined;
  readonly describeUnsupportedAttribute?: DescribeUnsupportedAttribute | undefined;
  readonly describeUnresolvedType?: DescribeUnresolvedType | undefined;
}

export interface BinderResult {
  readonly binder: Binder;
  readonly diagnostics: readonly ParseDiagnostic[];
}

export function typeReferenceNode(symbol: FieldSymbol | NamedTypeSymbol): SyntaxNode | undefined {
  return symbol.node.typeAnnotation()?.name()?.syntax;
}

export function contributedTypeOf(
  resolution: Resolution | undefined,
  binder: Binder,
): ContributedTypeSymbol | undefined {
  const base = resolution?.kind === 'namedType' ? typeReferenceNode(resolution.symbol) : undefined;
  const target = base === undefined ? resolution : binder.symbolForNode(base);
  return target?.kind === 'contributedType' ? target.symbol : undefined;
}

class PslBinder implements Binder {
  readonly #declarations: WeakMap<SyntaxNode, PslSymbol>;
  readonly #references: WeakMap<SyntaxNode, Resolution>;
  readonly #documentScope: Scope;
  readonly #scopes: WeakMap<SyntaxNode, Scope>;

  constructor(
    declarations: WeakMap<SyntaxNode, PslSymbol>,
    references: WeakMap<SyntaxNode, Resolution>,
    documentScope: Scope,
    scopes: WeakMap<SyntaxNode, Scope>,
  ) {
    this.#declarations = declarations;
    this.#references = references;
    this.#documentScope = documentScope;
    this.#scopes = scopes;
  }

  declaredSymbol(node: SyntaxNode): PslSymbol | undefined {
    return this.#declarations.get(node);
  }

  symbolForNode(node: SyntaxNode): Resolution | undefined {
    return this.#references.get(node);
  }

  scopeAt(node: SyntaxNode): Scope {
    return node.findAncestor((ancestor) => this.#scopes.get(ancestor)) ?? this.#documentScope;
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
  binder: Binder,
  visit: (entity: ModelSymbol | CompositeTypeSymbol, namespace?: NamespaceSymbol) => void,
): void {
  const { topLevel } = symbolTable;
  for (const entity of Object.values(topLevel.models)) visit(entity);
  for (const entity of Object.values(topLevel.compositeTypes)) visit(entity);
  for (const namespace of Object.values(topLevel.namespaces)) {
    stack.push(binder.scopeAt(namespace.declarations[0].node.syntax));
    for (const entity of Object.values(namespace.models)) visit(entity, namespace);
    for (const entity of Object.values(namespace.compositeTypes)) visit(entity, namespace);
    stack.pop();
  }
}

function declarationResolution(
  entity: ModelSymbol | CompositeTypeSymbol,
  namespace: NamespaceSymbol | undefined,
): Resolution {
  return entity.kind === 'model'
    ? { kind: 'model', symbol: entity, ...(namespace === undefined ? {} : { namespace }) }
    : { kind: 'compositeType', symbol: entity, ...(namespace === undefined ? {} : { namespace }) };
}

export function createBinder(input: CreateBinderInput): BinderResult {
  const { symbolTable, sources, context } = input;
  const contributions = context.authoringContributions;
  const describeUnsupportedAttributeFactory = resolveDescribeUnsupportedAttribute(
    context.pslDiagnostics,
  );
  const describeUnresolvedTypeFactory = resolveDescribeUnresolvedType(context.pslDiagnostics);

  return bind({
    sources,
    symbolTable,
    contributedTypes: mergeContributedTypes(contributions.field, contributions.type),
    attributeSpecs: assembleAttributeSpecs(contributions),
    pslBlockDescriptors: contributions.pslBlockDescriptors,
    defaultFunctionRegistry: context.controlMutationDefaults.defaultFunctionRegistry,
    dataTypes: context.dataTypes,
    ...(describeUnsupportedAttributeFactory !== undefined
      ? { describeUnsupportedAttribute: describeUnsupportedAttributeFactory(sources) }
      : {}),
    ...(describeUnresolvedTypeFactory !== undefined
      ? { describeUnresolvedType: describeUnresolvedTypeFactory(contributions) }
      : {}),
  });
}

function bind(options: BindingInputs): BinderResult {
  const {
    sources,
    symbolTable,
    contributedTypes,
    attributeSpecs,
    defaultFunctionRegistry,
    dataTypes,
    describeUnsupportedAttribute,
    describeUnresolvedType,
  } = options;
  const pslBlockDescriptors = options.pslBlockDescriptors ?? {};
  const contributed = contributedScope(contributedTypeScope(contributedTypes));
  const document = documentScope(symbolTable.topLevel, contributed);
  const stack = new ScopeStack(document);
  const scopes = new WeakMap<SyntaxNode, Scope>();
  const declarations = new WeakMap<SyntaxNode, PslSymbol>();
  const references = new WeakMap<SyntaxNode, Resolution>();
  const diagnostics: ParseDiagnostic[] = [];
  const binder = new PslBinder(declarations, references, document, scopes);

  const baseScope = namedTypeBaseScope(symbolTable.topLevel, contributed);
  for (const symbol of Object.values(symbolTable.topLevel.namedTypes)) {
    declarations.set(symbol.node.syntax, symbol);
    const declaredName = symbol.node.name()?.syntax;
    if (declaredName !== undefined) references.set(declaredName, { kind: 'namedType', symbol });
    const name = symbol.node.typeAnnotation()?.name();
    const outcome = resolveTypeReference(name, baseScope, references);
    if (name === undefined || outcome === undefined) continue;
    references.set(name.syntax, outcome.resolution);
    bindEntityConstructorArgument(symbol, outcome.resolution, {
      scope: baseScope,
      sources,
      references,
      diagnostics,
    });
  }
  for (const symbol of Object.values(symbolTable.topLevel.blocks)) {
    declarations.set(symbol.node.syntax, symbol);
    const declaredName = symbol.node.name()?.syntax;
    if (declaredName !== undefined) references.set(declaredName, { kind: 'block', symbol });
  }
  for (const namespace of Object.values(symbolTable.topLevel.namespaces)) {
    const scope = namespaceScope(namespace, document);
    for (const declaration of namespace.declarations) {
      declarations.set(declaration.node.syntax, namespace);
      scopes.set(declaration.node.syntax, scope);
      const declaredName = declaration.node.name()?.syntax;
      if (declaredName !== undefined) {
        references.set(declaredName, { kind: 'namespace', symbol: namespace });
      }
    }
    for (const symbol of Object.values(namespace.blocks)) {
      declarations.set(symbol.node.syntax, symbol);
      const declaredName = symbol.node.name()?.syntax;
      if (declaredName !== undefined) {
        references.set(declaredName, { kind: 'block', symbol, namespace });
      }
    }
  }

  // Attributes are parsed in a second walk once every field type is bound.
  // @relation(references: [x]) reads the referenced model's fields, and that
  // model may be declared further down the file.
  walkEntities(symbolTable, stack, binder, (entity, namespace) => {
    declarations.set(entity.node.syntax, entity);
    const declaredName = entity.node.name()?.syntax;
    if (declaredName !== undefined) {
      references.set(declaredName, declarationResolution(entity, namespace));
    }
    for (const field of Object.values(entity.fields)) {
      declarations.set(field.node.syntax, field);
      const fieldName = field.node.name()?.syntax;
      if (fieldName !== undefined) references.set(fieldName, { kind: 'field', symbol: field });
      const node = typeReferenceNode(field);
      if (node === undefined) continue;
      const name = field.node.typeAnnotation()?.name();
      const outcome = resolveTypeReference(name, stack.current(), references, (written) =>
        describeUnresolvedType?.({ field, owner: entity, written }),
      );
      if (outcome === undefined) continue;
      references.set(node, outcome.resolution);
      bindEntityConstructorArgument(field, outcome.resolution, {
        scope: stack.current(),
        sources,
        references,
        diagnostics,
      });
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

  walkEntities(symbolTable, stack, binder, (entity) => {
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
        ? { symbols: symbolTable, model: entity, defaultFunctionRegistry, dataTypes }
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
        (factory) => {
          if (specContext === undefined) return undefined;
          const node = typeReferenceNode(field);
          const typeResolution = node === undefined ? undefined : references.get(node);
          return factory({ ...specContext, field, typeResolution });
        },
        { ...context, field },
      );
    }
  });

  const blockContext = {
    pslBlockDescriptors,
    symbolTable,
    dataTypes,
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
    stack.push(binder.scopeAt(namespace.declarations[0].node.syntax));
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
  readonly dataTypes: DataTypeSupport;
}

function bindBlock(block: BlockSymbol, ctx: BlockBindContext): void {
  const descriptor = findBlockDescriptor(ctx.pslBlockDescriptors, block.keyword);
  if (descriptor === undefined) return;
  const specContext = blockSpecContext({
    symbols: ctx.symbolTable,
    dataTypes: ctx.dataTypes,
  });
  const spec = blockSpecFactoryOf(descriptor)(specContext);

  for (const entry of block.node.entries()) {
    const key = entry.key()?.name();
    if (key === undefined) continue;
    const parameter =
      spec.mode === 'struct' && Object.hasOwn(spec.parameters, key)
        ? spec.parameters[key]
        : undefined;
    const rule = spec.mode === 'struct' ? parameter?.type : spec.value.type;
    if (parameter !== undefined) {
      const keyNode = entry.key()?.syntax;
      if (keyNode !== undefined) {
        ctx.references.set(keyNode, {
          kind: 'parameter',
          symbol: { kind: 'parameter', name: key, param: parameter },
        });
      }
    }
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
    >(factory)(specContext);
    const attributeSymbol: AttributeSymbol = {
      kind: 'attribute',
      name: attribute.name,
      level: 'block',
      spec: attributeSpec,
    };
    const nameNode = attribute.node.name()?.syntax;
    if (nameNode !== undefined) {
      ctx.references.set(nameNode, { kind: 'attribute', symbol: attributeSymbol });
    }
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
          if (resolution.kind === 'unresolved') {
            references.set(node, resolution);
          }
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
      const functionSymbol: FunctionSymbol = {
        kind: 'function',
        name: rule.name,
        signature: rule.signature,
      };
      references.set(name.syntax, { kind: 'function', symbol: functionSymbol });
      let matched = true;
      let positional = 0;
      for (const arg of call.args()) {
        const key = arg.name()?.name();
        const parameter = argumentParameter(
          rule.signature,
          key,
          key === undefined ? positional++ : positional,
        );
        if (parameter === undefined) {
          matched = false;
          continue;
        }
        if (key !== undefined) {
          const keyNode = arg.name()?.syntax;
          if (keyNode !== undefined) {
            references.set(keyNode, {
              kind: 'parameter',
              symbol: { kind: 'parameter', name: key, param: parameter },
            });
          }
        }
        const value = arg.value();
        if (value === undefined) {
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
    case 'identifier': {
      if (rule.name === undefined) return { matched: true, references, diagnostics };
      const node = expression.syntax;
      const value = IdentifierAst.cast(node)?.name();
      if (value !== rule.name) return { matched: false, references, diagnostics };
      references.set(node, {
        kind: 'constant',
        symbol: { kind: 'constant', name: rule.name, documentation: rule.documentation },
      });
      return { matched: true, references, diagnostics };
    }
    case 'entityRef': {
      const node = expression.syntax;
      const written = writtenEntityReference(node);
      if (written === undefined) return { matched: false, references, diagnostics };
      const failures: ParseDiagnostic[] = [];
      const resolution = resolveEntity(written, node, { ...ctx, diagnostics: failures });
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
    case 'str':
    case 'json': {
      const matched = StringLiteralExprAst.cast(expression.syntax) !== undefined;
      return { matched, references, diagnostics };
    }
    case 'num':
    case 'int': {
      const matched = NumberLiteralExprAst.cast(expression.syntax) !== undefined;
      return { matched, references, diagnostics };
    }
    case 'bool': {
      const matched = BooleanLiteralExprAst.cast(expression.syntax) !== undefined;
      return { matched, references, diagnostics };
    }
    case 'null': {
      const matched = IdentifierAst.cast(expression.syntax)?.name() === 'null';
      return { matched, references, diagnostics };
    }
    case 'taggedLiteral': {
      const matched = TaggedLiteralExprAst.cast(expression.syntax) !== undefined;
      return { matched, references, diagnostics };
    }
    case 'dataTypeValue': {
      const literal = readWrittenScalar(expression);
      const matched = literal.ok || literal.reason !== 'not-a-literal';
      return { matched, references, diagnostics };
    }
    case 'rejecting':
      return { matched: false, references, diagnostics };
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
    const attributeSymbol: AttributeSymbol = {
      kind: 'attribute',
      name: attribute.name,
      level,
      spec,
    };
    const nameNode = nodes[index]?.name()?.syntax;
    if (nameNode !== undefined) {
      ctx.references.set(nameNode, { kind: 'attribute', symbol: attributeSymbol });
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
  const rawArgs = Array.from(attribute.node.argList()?.args() ?? []);
  let positional = 0;
  attribute.args.forEach((arg, index) => {
    const parameter = argumentParameter(
      spec,
      arg.name,
      arg.name === undefined ? positional++ : positional,
    );
    if (parameter === undefined) return;
    if (arg.name !== undefined) {
      const keyNode = rawArgs[index]?.name()?.syntax;
      if (keyNode !== undefined) {
        ctx.references.set(keyNode, {
          kind: 'parameter',
          symbol: { kind: 'parameter', name: arg.name, param: parameter },
        });
      }
    }
    if (arg.expression === undefined) return;
    bindExpression(parameter.type, arg.expression, ctx, modelContext);
  });
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

function bindEntityConstructorArgument(
  symbol: FieldSymbol | NamedTypeSymbol,
  type: Resolution,
  ctx: ReferenceContext,
): void {
  if (type.kind !== 'contributedType') return;
  const descriptor = type.symbol.descriptor;
  const index = descriptor.kind === 'typeConstructor' ? descriptor.entityRefArg?.index : undefined;
  if (index === undefined) return;
  const positional = symbol.typeConstructor?.args.filter((arg) => arg.kind === 'positional');
  const node = positional?.[index]?.expression?.syntax;
  const written = node === undefined ? undefined : writtenEntityReference(node);
  if (node === undefined || written === undefined) return;
  ctx.references.set(node, resolveEntity(written, node, ctx));
}

function resolveEntity(
  written: WrittenEntityReference,
  node: SyntaxNode,
  ctx: ReferenceContext,
): Resolution {
  const found =
    written.namespace === undefined
      ? ctx.scope.lookup(written.name)
      : qualifiedMember(
          written.namespace,
          written.name,
          bindQualifier(entityQualifier(node), ctx.scope, ctx.references),
        );
  if (found === undefined) {
    const name = describeWrittenEntityReference(written);
    if (written.name !== '') report(`Cannot find entity "${name}"`, node, ctx, 'entity');
    return { kind: 'unresolved', name };
  }
  if ('badQualifier' in found) {
    report(found.badQualifier, node, ctx, 'entity');
    return { kind: 'unresolved', name: found.qualifier };
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

interface ResolutionSink {
  set(node: SyntaxNode, resolution: Resolution): unknown;
}

function entityQualifier(node: SyntaxNode): IdentifierAst | undefined {
  const path = PathExprAst.cast(node);
  if (path === undefined) return undefined;
  const [qualifier] = path.segments();
  return qualifier;
}

function bindQualifier(
  qualifier: IdentifierAst | undefined,
  scope: Scope,
  references: ResolutionSink,
): ScopeResolution | undefined {
  const id = qualifier?.name();
  if (qualifier === undefined || id === undefined) return undefined;
  const resolution = scope.lookup(id);
  if (resolution !== undefined && isNamespaceLike(resolution)) {
    references.set(qualifier.syntax, resolution);
  }
  return resolution;
}

function resolveTypeReference(
  reference: QualifiedNameAst | undefined,
  scope: Scope,
  references: ResolutionSink,
  describeUnresolved?: (written: string) => string | undefined,
): TypeReferenceOutcome | undefined {
  if (reference === undefined || reference.isOverQualified()) return undefined;
  if (reference.space() !== undefined) return { resolution: { kind: 'crossSpace' } };
  const name = reference.identifier()?.name();
  if (name === undefined || name === '') return undefined;
  const qualifier = reference.namespace();
  const namespaceId = qualifier?.name();
  const found =
    namespaceId === undefined
      ? scope.lookup(name)
      : qualifiedMember(namespaceId, name, bindQualifier(qualifier, scope, references));
  if (found === undefined) {
    const written = namespaceId === undefined ? name : `${namespaceId}.${name}`;
    const message = describeUnresolved?.(written) ?? `Cannot find type "${written}"`;
    return {
      resolution: { kind: 'unresolved', name: written },
      message,
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
  qualifier: ScopeResolution | undefined,
): ScopeResolution | BadQualifier | undefined {
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
