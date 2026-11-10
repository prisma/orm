import type { PslSpan } from '@internal/framework-components/psl-ast';
import {
  namespaceIdOfPslName,
  pslNameOfNamespaceId,
  pslNamesOfNamespaceId,
} from './namespace-names';
import type { ParseDiagnostic } from './parse';
import {
  nodePslSpan,
  type ResolvedAttribute,
  type ResolvedTypeConstructorCall,
  readResolvedAttributes,
  readResolvedConstructorCall,
} from './resolve';
import type { PslSources, Range } from './source-file';
import { type FieldAttributeAst, ModelAttributeAst } from './syntax/ast/attributes';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  KeyValuePairAst,
  MixinDeclarationAst,
  type MixinInclusionAst,
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
  readonly defaultNamespace: NamespaceSymbol;
  readonly namespaces: Record<string, NamespaceSymbol>;
  readonly namedTypes: Record<string, NamedTypeSymbol>;
}

interface NamespaceDeclaration {
  readonly node: NamespaceDeclarationAst;
  readonly span: PslSpan;
}

/** `NamespaceSymbol` with a writable `declarations` array: `buildSymbolTable` appends each `namespace` block it reads, and returns the namespace as the read-only `NamespaceSymbol`. */
interface MutableNamespaceSymbol extends NamespaceSymbol {
  readonly declarations: NamespaceDeclaration[];
}

export interface NamespaceSymbol {
  readonly kind: 'namespace';
  readonly id: string;
  readonly name: string;
  readonly declarations: readonly NamespaceDeclaration[];
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
  fields: Record<string, FieldSymbol>;
  attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}

export interface CompositeTypeSymbol {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly node: CompositeTypeDeclarationAst;
  readonly span: PslSpan;
  fields: Record<string, FieldSymbol>;
  attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}

export interface BlockSymbol {
  readonly kind: 'block';
  readonly name: string;
  readonly keyword: string;
  readonly node: GenericBlockDeclarationAst;
  readonly span: PslSpan;
  entries: readonly KeyValuePairAst[];
  attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
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
  readonly defaultNamespaceId: string;
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
  const { documents, sources, defaultNamespaceId } = options;
  const diagnostics: ParseDiagnostic[] = [];

  const namespaces: Record<string, MutableNamespaceSymbol> = Object.create(null);
  const namedTypes: Record<string, NamedTypeSymbol> = Object.create(null);
  const blocks: Record<string, BlockSymbol> = Object.create(null);
  const models: Record<string, ModelSymbol> = Object.create(null);
  const compositeTypes: Record<string, CompositeTypeSymbol> = Object.create(null);
  const mixins: Record<string, MixinSymbol> = Object.create(null);
  const topLevelNames = new Set<string>(pslNamesOfNamespaceId(defaultNamespaceId));
  const defaultNamespace: MutableNamespaceSymbol = {
    kind: 'namespace',
    id: defaultNamespaceId,
    name: pslNameOfNamespaceId(defaultNamespaceId),
    declarations: [],
    models,
    compositeTypes,
    blocks,
    mixins,
  };
  namespaces[defaultNamespaceId] = defaultNamespace;

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
        const name = claim(topLevelNames, declaration.name());
        if (name !== undefined) {
          mixins[name] = buildMixin(name, declaration, sources, diagnostics);
        }
      } else if (declaration instanceof NamespaceDeclarationAst) {
        const declaredName = declaration.name()?.name();
        if (declaredName === undefined) continue;
        const id = namespaceIdOfPslName(declaredName);
        let namespace = namespaces[id];
        if (namespace === undefined) {
          const names = pslNamesOfNamespaceId(id);
          const taken = names.some((name) => topLevelNames.has(name))
            ? new Set(names)
            : topLevelNames;
          if (claim(taken, declaration.name()) === undefined) continue;
          for (const name of names) topLevelNames.add(name);
          namespace = {
            kind: 'namespace',
            id,
            name: pslNameOfNamespaceId(id),
            declarations: [{ node: declaration, span: nodePslSpan(declaration.syntax, sources) }],
            models: Object.create(null),
            compositeTypes: Object.create(null),
            blocks: Object.create(null),
            mixins: Object.create(null),
          };
          namespaces[id] = namespace;
        } else {
          namespace.declarations.push({
            node: declaration,
            span: nodePslSpan(declaration.syntax, sources),
          });
        }
        extendNamespace(
          namespace,
          declaration,
          diagnostics,
          sources,
          namespace === defaultNamespace ? topLevelNames : new Set(),
        );
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

  return {
    symbolTable: { defaultNamespace, namespaces, namedTypes },
    diagnostics,
  };
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

const FIELD_BLOCK_KEYWORDS: ReadonlySet<string> = new Set(['model', 'type']);

function buildMixin(
  name: string,
  node: MixinDeclarationAst,
  sources: PslSources,
  diagnostics: ParseDiagnostic[],
): MixinSymbol {
  const keyword = node.keyword()?.text ?? '';
  const hasFields = FIELD_BLOCK_KEYWORDS.has(keyword);
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

function extendNamespace(
  namespace: NamespaceSymbol,
  node: NamespaceDeclarationAst,
  diagnostics: ParseDiagnostic[],
  sources: PslSources,
  documentNames: Set<string>,
): void {
  const { models, compositeTypes, blocks, mixins } = namespace;

  for (const member of node.declarations()) {
    const memberName = member.name()?.name();
    if (memberName === undefined) continue;
    if (
      Object.hasOwn(models, memberName) ||
      Object.hasOwn(compositeTypes, memberName) ||
      Object.hasOwn(blocks, memberName) ||
      Object.hasOwn(mixins, memberName) ||
      documentNames.has(memberName)
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
    documentNames.add(memberName);
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

export interface PlaceMixinMembersInput {
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly mixinOf: (inclusion: MixinInclusionAst) => MixinSymbol | undefined;
}

export function placeMixinMembers(input: PlaceMixinMembersInput): readonly ParseDiagnostic[] {
  const diagnostics: ParseDiagnostic[] = [];
  for (const records of Object.values(input.symbolTable.namespaces)) {
    for (const symbol of Object.values(records.models)) placeFields(symbol, input, diagnostics);
    for (const symbol of Object.values(records.compositeTypes)) {
      placeFields(symbol, input, diagnostics);
    }
    for (const symbol of Object.values(records.blocks)) placeEntries(symbol, input, diagnostics);
  }
  return diagnostics;
}

type IncludingSymbol = ModelSymbol | CompositeTypeSymbol | BlockSymbol;

function includesMixin(symbol: IncludingSymbol, input: PlaceMixinMembersInput): boolean {
  for (const inclusion of symbol.node.inclusions()) {
    if (input.mixinOf(inclusion) !== undefined) return true;
  }
  return false;
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

function mixinToPlace(
  inclusion: MixinInclusionAst,
  symbol: IncludingSymbol,
  placed: Set<MixinSymbol>,
  input: PlaceMixinMembersInput,
  diagnostics: ParseDiagnostic[],
): MixinSymbol | undefined {
  const mixin = input.mixinOf(inclusion);
  if (mixin === undefined) return undefined;
  if (placed.has(mixin)) {
    diagnostics.push(
      inclusionDiagnostic(
        symbol.kind === 'block' ? 'PSL_INVALID_EXTENSION_BLOCK_MEMBER' : 'PSL_INVALID_MODEL_MEMBER',
        `Mixin "${mixin.name}" is already included in this block`,
        inclusion,
        input.sources,
      ),
    );
    return undefined;
  }
  placed.add(mixin);
  return mixin;
}

function alreadyProvided(
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

function writtenAttributes(
  symbol: IncludingSymbol,
): ReadonlyMap<SyntaxNode, ResolvedAttribute<ModelAttributeAst>> {
  return new Map(symbol.attributes.map((attribute) => [attribute.node.syntax, attribute] as const));
}

function placeFields(
  symbol: ModelSymbol | CompositeTypeSymbol,
  input: PlaceMixinMembersInput,
  diagnostics: ParseDiagnostic[],
): void {
  if (!includesMixin(symbol, input)) return;
  const { sources } = input;
  const ownFields = new Map(
    Object.values(symbol.fields).map((field) => [field.node.syntax, field] as const),
  );
  const ownAttributes = writtenAttributes(symbol);
  const fields: Record<string, FieldSymbol> = Object.create(null);
  const attributes: ResolvedAttribute<ModelAttributeAst>[] = [];
  const placed = new Set<MixinSymbol>();

  for (const member of symbol.node.members()) {
    if (member instanceof FieldDeclarationAst) {
      const field = ownFields.get(member.syntax);
      if (field === undefined) continue;
      if (Object.hasOwn(fields, field.name)) {
        const diagnostic = duplicateDeclaration(field.name, member.name(), sources);
        if (diagnostic !== undefined) diagnostics.push(diagnostic);
      } else {
        fields[field.name] = field;
      }
    } else if (member instanceof ModelAttributeAst) {
      const attribute = ownAttributes.get(member.syntax);
      if (attribute !== undefined) attributes.push(attribute);
    } else {
      const mixin = mixinToPlace(member, symbol, placed, input, diagnostics);
      if (mixin === undefined) continue;
      for (const field of Object.values(mixin.fields)) {
        if (Object.hasOwn(fields, field.name)) {
          diagnostics.push(alreadyProvided(mixin, field.name, symbol, member, sources));
        } else {
          fields[field.name] = field;
        }
      }
      attributes.push(...mixin.attributes);
    }
  }

  symbol.fields = fields;
  symbol.attributes = attributes;
}

function placeEntries(
  symbol: BlockSymbol,
  input: PlaceMixinMembersInput,
  diagnostics: ParseDiagnostic[],
): void {
  if (!includesMixin(symbol, input)) return;
  const ownAttributes = writtenAttributes(symbol);
  const entries: KeyValuePairAst[] = [];
  const attributes: ResolvedAttribute<ModelAttributeAst>[] = [];
  const placed = new Set<MixinSymbol>();

  for (const member of symbol.node.members()) {
    if (member instanceof KeyValuePairAst) {
      entries.push(member);
    } else if (member instanceof ModelAttributeAst) {
      const attribute = ownAttributes.get(member.syntax);
      if (attribute !== undefined) attributes.push(attribute);
    } else {
      const mixin = mixinToPlace(member, symbol, placed, input, diagnostics);
      if (mixin === undefined) continue;
      const present = new Set(entries.map((entry) => entry.key()?.name()));
      for (const entry of mixin.entries) {
        const key = entry.key()?.name();
        if (key !== undefined && present.has(key)) {
          diagnostics.push(alreadyProvided(mixin, key, symbol, member, input.sources));
        } else {
          entries.push(entry);
        }
      }
      attributes.push(...mixin.attributes);
    }
  }

  symbol.entries = entries;
  symbol.attributes = attributes;
}

function duplicateDeclaration(
  name: string,
  nameNode: IdentifierAst | undefined,
  sources: PslSources,
): ParseDiagnostic | undefined {
  const range = nameRange(nameNode, sources);
  if (nameNode === undefined || range === undefined) return undefined;
  return {
    code: 'PSL_DUPLICATE_DECLARATION',
    message: `Duplicate declaration of "${name}"`,
    filename: sources.sourceFileFor(nameNode.syntax).filename,
    range,
  };
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
      const diagnostic = duplicateDeclaration(name, nameNode, sources);
      if (diagnostic !== undefined) diagnostics.push(diagnostic);
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
