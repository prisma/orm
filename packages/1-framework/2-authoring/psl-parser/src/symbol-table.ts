import type { PslSpan } from '@internal/framework-components/psl-ast';
import { PSL_UNRESOLVED_REFERENCE } from './diagnostic';
import type { ParseDiagnostic } from './parse';
import {
  nodePslSpan,
  type ResolvedAttribute,
  type ResolvedTypeConstructorCall,
  readResolvedAttributes,
  readResolvedConstructorCall,
} from './resolve';
import { lookupMixinReference, type ScopeResolution } from './scope';
import type { PslSources, Range } from './source-file';
import type { FieldAttributeAst, ModelAttributeAst } from './syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  type FieldDeclarationAst,
  GenericBlockDeclarationAst,
  type KeyValuePairAst,
  MixinDeclarationAst,
  MixinInclusionAst,
  ModelDeclarationAst,
  type NamedTypeDeclarationAst,
  NamespaceDeclarationAst,
  TypesBlockAst,
} from './syntax/ast/declarations';
import type { IdentifierAst } from './syntax/ast/identifier';
import type { SyntaxNode } from './syntax/red';

export type {
  ResolvedAttribute,
  ResolvedAttributeArg,
  ResolvedTypeConstructorCall,
} from './resolve';

export interface SymbolTable {
  readonly topLevel: TopLevelScope;
}

export interface TopLevelScope {
  readonly namespaces: Record<string, NamespaceSymbol>;
  readonly namedTypes: Record<string, NamedTypeSymbol>;
  readonly blocks: Record<string, BlockSymbol>;
  readonly models: Record<string, ModelSymbol>;
  readonly compositeTypes: Record<string, CompositeTypeSymbol>;
  readonly mixins: Record<string, MixinSymbol>;
}

interface NamespaceDeclaration {
  readonly node: NamespaceDeclarationAst;
  readonly span: PslSpan;
}

export interface NamespaceSymbol {
  readonly kind: 'namespace';
  readonly name: string;
  readonly declarations: [NamespaceDeclaration, ...NamespaceDeclaration[]];
  readonly models: Record<string, ModelSymbol>;
  readonly compositeTypes: Record<string, CompositeTypeSymbol>;
  readonly blocks: Record<string, BlockSymbol>;
  readonly mixins: Record<string, MixinSymbol>;
}

export interface ModelSymbol {
  readonly kind: 'model';
  readonly name: string;
  readonly node: ModelDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}

export interface CompositeTypeSymbol {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly node: CompositeTypeDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}

export interface BlockSymbol {
  readonly kind: 'block';
  readonly name: string;
  readonly keyword: string;
  readonly node: GenericBlockDeclarationAst;
  readonly span: PslSpan;
  readonly entries: readonly KeyValuePairAst[];
  readonly attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}

export interface MixinSymbol {
  readonly kind: 'mixin';
  readonly name: string;
  readonly keyword: string;
  readonly node: MixinDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly entries: readonly KeyValuePairAst[];
  readonly attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}

export interface ResolvedNamedTypeBinding {
  readonly baseType?: string;
  readonly typeConstructor?: ResolvedTypeConstructorCall;
  readonly isConstructor: boolean;
  readonly attributes: readonly ResolvedAttribute<FieldAttributeAst>[];
}

/**
 * A `types {}` binding, collected without classification: whether the binding
 * refines a target scalar is pronounced by the interpreter
 * (`resolveNamedTypeDeclarations`), not by the family-blind symbol table.
 */
export interface NamedTypeSymbol extends ResolvedNamedTypeBinding {
  readonly kind: 'namedType';
  readonly name: string;
  readonly node: NamedTypeDeclarationAst;
  readonly span: PslSpan;
}

export interface FieldSymbol {
  readonly kind: 'field';
  readonly name: string;
  readonly node: FieldDeclarationAst;
  readonly span: PslSpan;
  readonly typeName: string;
  readonly typeNamespaceId?: string;
  readonly typeContractSpaceId?: string;
  readonly optional: boolean;
  readonly list: boolean;
  /** Element-nullability axis (`Foo?[]`); meaningful only when {@link list}. */
  readonly elementOptional: boolean;
  readonly typeConstructor?: ResolvedTypeConstructorCall;
  readonly attributes: readonly ResolvedAttribute<FieldAttributeAst>[];
  /** Prevents cascading unsupported-type diagnostics after invalid qualification. */
  readonly malformedType?: boolean;
}

export interface BuildSymbolTableOptions {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
}

export interface SymbolTableResult {
  readonly symbolTable: SymbolTable;
  readonly diagnostics: readonly ParseDiagnostic[];
}

/**
 * Owns duplicate-declaration detection for all PSL scopes; downstream consumers
 * should consume first-wins symbols rather than re-emitting duplicate diagnostics.
 */
export function buildSymbolTable(options: BuildSymbolTableOptions): SymbolTableResult {
  const { documents, sources } = options;
  const diagnostics: ParseDiagnostic[] = [];

  const namespaces: Record<string, NamespaceSymbol> = Object.create(null);
  const namedTypes: Record<string, NamedTypeSymbol> = Object.create(null);
  const blocks: Record<string, BlockSymbol> = Object.create(null);
  const models: Record<string, ModelSymbol> = Object.create(null);
  const compositeTypes: Record<string, CompositeTypeSymbol> = Object.create(null);
  const mixins: Record<string, MixinSymbol> = Object.create(null);
  const topLevelNames = new Set<string>();

  for (const document of documents) {
    const sourceFile = sources.sourceFileFor(document.syntax);
    const claim = (taken: Set<string>, name: IdentifierAst | undefined): string | undefined => {
      const text = name?.name();
      if (text === undefined) return undefined;
      if (taken.has(text)) {
        const range = nameRange(name, sources);
        if (range) {
          diagnostics.push({
            code: 'PSL_DUPLICATE_DECLARATION',
            message: `Duplicate declaration of "${text}"`,
            filename: sourceFile.filename,
            range,
          });
        }
        return undefined;
      }
      taken.add(text);
      return text;
    };

    for (const declaration of document.declarations()) {
      if (declaration instanceof ModelDeclarationAst) {
        const name = claim(topLevelNames, declaration.name());
        if (name !== undefined) models[name] = buildModel(name, declaration, sources, diagnostics);
      } else if (declaration instanceof CompositeTypeDeclarationAst) {
        const name = claim(topLevelNames, declaration.name());
        if (name !== undefined) {
          compositeTypes[name] = buildCompositeType(name, declaration, sources, diagnostics);
        }
      } else if (declaration instanceof GenericBlockDeclarationAst) {
        const name = claim(topLevelNames, declaration.name());
        if (name !== undefined) {
          blocks[name] = buildBlock(name, declaration, sources);
        }
      } else if (declaration instanceof MixinDeclarationAst) {
        if (lacksBlockKeyword(declaration)) continue;
        const name = claim(topLevelNames, declaration.name());
        if (name !== undefined) {
          mixins[name] = buildMixin(name, declaration, sources, diagnostics);
        }
      } else if (declaration instanceof NamespaceDeclarationAst) {
        const declaredName = declaration.name()?.name();
        if (declaredName === undefined) continue;
        let namespace = namespaces[declaredName];
        if (namespace === undefined) {
          const name = claim(topLevelNames, declaration.name());
          if (name === undefined) continue;
          namespace = {
            kind: 'namespace',
            name,
            declarations: [{ node: declaration, span: nodePslSpan(declaration.syntax, sources) }],
            models: Object.create(null),
            compositeTypes: Object.create(null),
            blocks: Object.create(null),
            mixins: Object.create(null),
          };
          namespaces[name] = namespace;
        } else {
          namespace.declarations.push({
            node: declaration,
            span: nodePslSpan(declaration.syntax, sources),
          });
        }
        extendNamespace(namespace, declaration, diagnostics, sources);
      } else if (declaration instanceof TypesBlockAst) {
        for (const binding of declaration.declarations()) {
          const name = claim(topLevelNames, binding.name());
          if (name === undefined) continue;
          const resolved = resolveNamedTypeBinding(binding, sources);
          const span = nodePslSpan(binding.syntax, sources);
          namedTypes[name] = { kind: 'namedType', name, node: binding, span, ...resolved };
        }
      }
    }
  }

  const topLevel: TopLevelScope = {
    namespaces,
    namedTypes,
    blocks,
    models,
    compositeTypes,
    mixins,
  };
  includeMixins(topLevel, sources, diagnostics);

  return { symbolTable: { topLevel }, diagnostics };
}

function buildModel(
  name: string,
  node: ModelDeclarationAst,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): ModelSymbol {
  return {
    kind: 'model',
    name,
    node,
    span: nodePslSpan(node.syntax, sources),
    fields: buildFields(name, node.fields(), sources, diagnostics),
    attributes: readResolvedAttributes(node.attributes(), sources),
  };
}

function buildCompositeType(
  name: string,
  node: CompositeTypeDeclarationAst,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): CompositeTypeSymbol {
  return {
    kind: 'compositeType',
    name,
    node,
    span: nodePslSpan(node.syntax, sources),
    fields: buildFields(name, node.fields(), sources, diagnostics),
    attributes: readResolvedAttributes(node.attributes(), sources),
  };
}

function buildBlock(
  name: string,
  node: GenericBlockDeclarationAst,
  sources: PslSources,
): BlockSymbol {
  return {
    kind: 'block',
    name,
    keyword: node.keyword()?.text ?? '',
    node,
    span: nodePslSpan(node.syntax, sources),
    entries: Array.from(node.entries()),
    attributes: readResolvedAttributes(node.attributes(), sources),
  };
}

function extendNamespace(
  namespace: NamespaceSymbol,
  node: NamespaceDeclarationAst,
  diagnostics: ParseDiagnostic[],
  sources: PslSources,
): void {
  const { models, compositeTypes, blocks, mixins } = namespace;

  for (const member of node.declarations()) {
    if (member instanceof MixinDeclarationAst && lacksBlockKeyword(member)) continue;
    const memberName = member.name()?.name();
    if (memberName === undefined) continue;
    if (
      Object.hasOwn(models, memberName) ||
      Object.hasOwn(compositeTypes, memberName) ||
      Object.hasOwn(blocks, memberName) ||
      Object.hasOwn(mixins, memberName)
    ) {
      const range = nameRange(member.name(), sources);
      if (range) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${memberName}"`,
          filename: sources.sourceFileFor(member.syntax).filename,
          range,
        });
      }
      continue;
    }
    if (member instanceof ModelDeclarationAst) {
      models[memberName] = buildModel(memberName, member, sources, diagnostics);
    } else if (member instanceof CompositeTypeDeclarationAst) {
      compositeTypes[memberName] = buildCompositeType(memberName, member, sources, diagnostics);
    } else if (member instanceof GenericBlockDeclarationAst) {
      blocks[memberName] = buildBlock(memberName, member, sources);
    } else if (member instanceof MixinDeclarationAst) {
      mixins[memberName] = buildMixin(memberName, member, sources, diagnostics);
    }
  }
}

const FIELD_BLOCK_KEYWORDS: ReadonlySet<string> = new Set(['model', 'type']);

function lacksBlockKeyword(mixin: MixinDeclarationAst): boolean {
  return mixin.keyword()?.text === 'mixin';
}

function buildMixin(
  name: string,
  node: MixinDeclarationAst,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): MixinSymbol {
  const keyword = node.keyword()?.text ?? '';
  const hasFields = FIELD_BLOCK_KEYWORDS.has(keyword);
  for (const inclusion of node.inclusions()) {
    if (inclusion.name() === undefined) continue;
    diagnostics.push(
      inclusionDiagnostic(
        hasFields ? 'PSL_INVALID_MODEL_MEMBER' : 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        'A mixin cannot include another mixin',
        inclusion,
        sources,
      ),
    );
  }
  return {
    kind: 'mixin',
    name,
    keyword,
    node,
    span: nodePslSpan(node.syntax, sources),
    fields: hasFields
      ? buildFields(name, node.fields(), sources, diagnostics)
      : Object.create(null),
    entries: hasFields ? [] : Array.from(node.entries()),
    attributes: readResolvedAttributes(node.attributes(), sources),
  };
}

function inclusionDiagnostic(
  code: string,
  message: string,
  inclusion: MixinInclusionAst,
  sources: PslSources,
): ParseDiagnostic {
  return {
    code,
    message,
    filename: sources.sourceFileFor(inclusion.syntax).filename,
    range: nodeRange(inclusion.syntax, sources),
  };
}

interface InclusionContext {
  readonly topLevel: TopLevelScope;
  readonly namespace: NamespaceSymbol | undefined;
  readonly sources: PslSources;
  readonly diagnostics: ParseDiagnostic[];
}

type IncludingSymbol = ModelSymbol | CompositeTypeSymbol | BlockSymbol;

function includeMixins(
  topLevel: TopLevelScope,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): void {
  const scopes: readonly (TopLevelScope | NamespaceSymbol)[] = [
    topLevel,
    ...Object.values(topLevel.namespaces),
  ];
  for (const scope of scopes) {
    const context: InclusionContext = {
      topLevel,
      namespace: scope === topLevel ? undefined : castNamespace(scope),
      sources,
      diagnostics,
    };
    replaceInclusions(scope.models, context, includeInFieldBlock);
    replaceInclusions(scope.compositeTypes, context, includeInFieldBlock);
    replaceInclusions(scope.blocks, context, includeInEntryBlock);
  }
}

function castNamespace(scope: TopLevelScope | NamespaceSymbol): NamespaceSymbol | undefined {
  return 'kind' in scope ? scope : undefined;
}

function replaceInclusions<TSymbol extends IncludingSymbol>(
  record: Record<string, TSymbol>,
  context: InclusionContext,
  include: (symbol: TSymbol, included: IncludedMixins, context: InclusionContext) => TSymbol,
): void {
  for (const [name, symbol] of Object.entries(record)) {
    const inclusions = Array.from(symbol.node.inclusions()).filter(
      (inclusion) => inclusion.name() !== undefined,
    );
    if (inclusions.length === 0) continue;
    record[name] = include(symbol, resolveInclusions(symbol, inclusions, context), context);
  }
}

type IncludedMixins = ReadonlyMap<SyntaxNode, MixinSymbol>;

function blockKeywordOf(symbol: IncludingSymbol): string {
  if (symbol.kind === 'model') return 'model';
  if (symbol.kind === 'compositeType') return 'type';
  return symbol.keyword;
}

function memberCodeOf(symbol: IncludingSymbol): string {
  return symbol.kind === 'block'
    ? 'PSL_INVALID_EXTENSION_BLOCK_MEMBER'
    : 'PSL_INVALID_MODEL_MEMBER';
}

function resolveInclusions(
  symbol: IncludingSymbol,
  inclusions: readonly MixinInclusionAst[],
  context: InclusionContext,
): IncludedMixins {
  const { topLevel, namespace, sources, diagnostics } = context;
  const included = new Map<SyntaxNode, MixinSymbol>();
  const seen = new Set<MixinSymbol>();
  const blockKeyword = blockKeywordOf(symbol);
  const report = (code: string, message: string, inclusion: MixinInclusionAst): void => {
    diagnostics.push(inclusionDiagnostic(code, message, inclusion, sources));
  };

  for (const inclusion of inclusions) {
    const reference = inclusion.name();
    const name = reference?.identifier()?.name();
    if (reference === undefined || name === undefined || reference.isOverQualified()) continue;
    if (reference.space() !== undefined) {
      report(
        PSL_UNRESOLVED_REFERENCE,
        'A mixin cannot be included from another contract space',
        inclusion,
      );
      continue;
    }
    const namespaceId = reference.namespace()?.name();
    const written = namespaceId === undefined ? name : `${namespaceId}.${name}`;
    const resolution = lookupMixinReference(topLevel, namespace, { namespaceId, name });
    if (resolution === undefined) {
      report(PSL_UNRESOLVED_REFERENCE, `Cannot find mixin "${written}"`, inclusion);
      continue;
    }
    if (resolution.kind !== 'mixin') {
      report(
        PSL_UNRESOLVED_REFERENCE,
        `"${written}" is ${describeResolution(resolution)}, not a mixin`,
        inclusion,
      );
      continue;
    }
    const mixin = resolution.symbol;
    if (mixin.keyword !== blockKeyword) {
      report(
        memberCodeOf(symbol),
        `Mixin "${mixin.name}" is for "${mixin.keyword}" blocks, not "${blockKeyword}" blocks`,
        inclusion,
      );
      continue;
    }
    if (seen.has(mixin)) {
      report(
        memberCodeOf(symbol),
        `Mixin "${mixin.name}" is already included in this block`,
        inclusion,
      );
      continue;
    }
    seen.add(mixin);
    included.set(inclusion.syntax, mixin);
  }
  return included;
}

function describeResolution(resolution: Exclude<ScopeResolution, { kind: 'mixin' }>): string {
  switch (resolution.kind) {
    case 'model':
      return 'a model';
    case 'compositeType':
      return 'a composite type';
    case 'namedType':
      return 'a named type';
    case 'block':
      return `${withArticle(resolution.symbol.keyword)}`;
    case 'namespace':
    case 'contributedNamespace':
      return 'a namespace';
    case 'contributedType':
      return 'a type';
  }
}

function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

function duplicateMemberDiagnostic(
  mixin: MixinSymbol,
  member: string,
  symbol: IncludingSymbol,
  inclusion: MixinInclusionAst,
  sources: PslSources,
): ParseDiagnostic {
  return inclusionDiagnostic(
    'PSL_DUPLICATE_DECLARATION',
    `Mixin "${mixin.name}" provides "${member}", which "${symbol.name}" already has`,
    inclusion,
    sources,
  );
}

function includeAttributes(
  symbol: IncludingSymbol,
  included: IncludedMixins,
): readonly ResolvedAttribute<ModelAttributeAst>[] {
  const own = new Map(symbol.attributes.map((attribute) => [attribute.node.syntax, attribute]));
  const attributes: ResolvedAttribute<ModelAttributeAst>[] = [];
  for (const child of symbol.node.syntax.childNodes()) {
    const attribute = own.get(child);
    if (attribute !== undefined) attributes.push(attribute);
    const mixin = included.get(child);
    if (mixin !== undefined) attributes.push(...mixin.attributes);
  }
  return attributes;
}

function includeInFieldBlock<TSymbol extends ModelSymbol | CompositeTypeSymbol>(
  symbol: TSymbol,
  included: IncludedMixins,
  context: InclusionContext,
): TSymbol {
  const { sources, diagnostics } = context;
  const own = new Map(
    Object.values(symbol.fields).map((field) => [field.node.syntax, field] as const),
  );
  const fields: Record<string, FieldSymbol> = Object.create(null);
  for (const child of symbol.node.syntax.childNodes()) {
    const field = own.get(child);
    if (field !== undefined) {
      if (!Object.hasOwn(fields, field.name)) {
        fields[field.name] = field;
        continue;
      }
      const range = nameRange(field.node.name(), sources);
      if (range !== undefined) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${field.name}"`,
          filename: sources.sourceFileFor(field.node.syntax).filename,
          range,
        });
      }
      continue;
    }
    const mixin = included.get(child);
    const inclusion = mixin === undefined ? undefined : MixinInclusionAst.cast(child);
    if (mixin === undefined || inclusion === undefined) continue;
    for (const mixed of Object.values(mixin.fields)) {
      if (Object.hasOwn(fields, mixed.name)) {
        diagnostics.push(duplicateMemberDiagnostic(mixin, mixed.name, symbol, inclusion, sources));
        continue;
      }
      fields[mixed.name] = mixed;
    }
  }
  return { ...symbol, fields, attributes: includeAttributes(symbol, included) };
}

function includeInEntryBlock(
  symbol: BlockSymbol,
  included: IncludedMixins,
  context: InclusionContext,
): BlockSymbol {
  const { sources, diagnostics } = context;
  const own = new Map(symbol.entries.map((entry) => [entry.syntax, entry] as const));
  const entries: KeyValuePairAst[] = [];
  const keys = new Set<string>();
  const add = (entry: KeyValuePairAst): void => {
    entries.push(entry);
    const key = entry.key()?.name();
    if (key !== undefined) keys.add(key);
  };
  for (const child of symbol.node.syntax.childNodes()) {
    const entry = own.get(child);
    if (entry !== undefined) {
      add(entry);
      continue;
    }
    const mixin = included.get(child);
    const inclusion = mixin === undefined ? undefined : MixinInclusionAst.cast(child);
    if (mixin === undefined || inclusion === undefined) continue;
    const present = new Set(keys);
    for (const mixed of mixin.entries) {
      const key = mixed.key()?.name();
      if (key !== undefined && present.has(key)) {
        diagnostics.push(duplicateMemberDiagnostic(mixin, key, symbol, inclusion, sources));
        continue;
      }
      add(mixed);
    }
  }
  return { ...symbol, entries, attributes: includeAttributes(symbol, included) };
}

function buildFields(
  ownerName: string,
  fields: Iterable<FieldDeclarationAst>,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): Record<string, FieldSymbol> {
  const result: Record<string, FieldSymbol> = Object.create(null);
  for (const field of fields) {
    const nameNode = field.name();
    const name = nameNode?.name();
    if (name === undefined) continue;
    if (Object.hasOwn(result, name)) {
      const range = nameRange(nameNode, sources);
      if (range) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${name}"`,
          filename: sources.sourceFileFor(field.syntax).filename,
          range,
        });
      }
      continue;
    }
    result[name] = buildField(ownerName, name, field, sources, diagnostics);
  }
  return result;
}

function buildField(
  ownerName: string,
  name: string,
  node: FieldDeclarationAst,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): FieldSymbol {
  const attributes = readResolvedAttributes(node.attributes(), sources);
  const span = nodePslSpan(node.syntax, sources);
  const annotation = node.typeAnnotation();
  const typeName = annotation?.name();

  if (typeName?.isOverQualified()) {
    const path = typeName.path();
    diagnostics.push({
      code: 'PSL_INVALID_QUALIFIED_TYPE',
      message: `Field "${ownerName}.${name}" has an invalid qualified type "${path.join('.')}"; use at most one namespace qualifier (e.g. "ns.TypeName")`,
      filename: sources.sourceFileFor(typeName.syntax).filename,
      range: nodeRange(typeName.syntax, sources),
    });
    return {
      kind: 'field',
      name,
      node,
      span,
      typeName: path[path.length - 1] ?? '',
      optional: false,
      list: false,
      elementOptional: false,
      malformedType: true,
      attributes,
    };
  }

  const typeConstructor = annotation?.isConstructor()
    ? readResolvedConstructorCall(annotation, sources)
    : undefined;
  const typeNamespaceId = typeName?.namespace()?.name();
  const typeContractSpaceId = typeName?.space()?.name();

  return {
    kind: 'field',
    name,
    node,
    span,
    typeName: typeName?.identifier()?.name() ?? '',
    ...(typeNamespaceId !== undefined ? { typeNamespaceId } : {}),
    ...(typeContractSpaceId !== undefined ? { typeContractSpaceId } : {}),
    optional: annotation?.isOptional() ?? false,
    list: annotation?.isList() ?? false,
    elementOptional: annotation?.isElementOptional() ?? false,
    ...(typeConstructor !== undefined ? { typeConstructor } : {}),
    attributes,
  };
}

function resolveNamedTypeBinding(
  node: NamedTypeDeclarationAst,
  sources: PslSources,
): {
  baseType?: string;
  typeConstructor?: ResolvedTypeConstructorCall;
  isConstructor: boolean;
  attributes: readonly ResolvedAttribute<FieldAttributeAst>[];
} {
  const annotation = node.typeAnnotation();
  const isConstructor = annotation?.isConstructor() ?? false;
  const baseType = annotation?.name()?.identifier()?.name();
  const typeConstructor = readResolvedConstructorCall(annotation, sources);
  return {
    isConstructor,
    ...(!isConstructor && baseType !== undefined ? { baseType } : {}),
    ...(typeConstructor !== undefined ? { typeConstructor } : {}),
    attributes: readResolvedAttributes(node.attributes(), sources),
  };
}

function nameRange(name: IdentifierAst | undefined, sources: PslSources): Range | undefined {
  if (name === undefined) return undefined;
  const sourceFile = sources.sourceFileFor(name.syntax);
  for (const token of name.syntax.tokens()) {
    if (token.kind === 'Ident') {
      return {
        start: sourceFile.positionAt(token.offset),
        end: sourceFile.positionAt(token.offset + token.text.length),
      };
    }
  }
  return undefined;
}

function nodeRange(node: SyntaxNode, sources: PslSources): Range {
  const sourceFile = sources.sourceFileFor(node);
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: sourceFile.positionAt(start),
    end: sourceFile.positionAt(end),
  };
}
