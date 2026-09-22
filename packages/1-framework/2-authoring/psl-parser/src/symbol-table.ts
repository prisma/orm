import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type { PslExtensionBlock, PslSpan } from '@internal/framework-components/psl-ast';
import { interpretBlockAttributes, reconstructExtensionBlock } from './block-reconstruction';
import { findBlockDescriptor } from './extension-block';
import type { ParseDiagnostic } from './parse';
import {
  nodePslSpan,
  type ResolvedAttribute,
  type ResolvedTypeConstructorCall,
  readResolvedAttributes,
  readResolvedConstructorCall,
} from './resolve';
import type { PslSources, Range } from './source-file';
import {
  CompositeTypeDeclarationAst,
  type DocumentAst,
  type FieldDeclarationAst,
  GenericBlockDeclarationAst,
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
}

export interface NamespaceSymbol {
  readonly kind: 'namespace';
  readonly name: string;
  readonly declarations: {
    readonly node: NamespaceDeclarationAst;
    readonly span: PslSpan;
  }[];
  readonly models: Record<string, ModelSymbol>;
  readonly compositeTypes: Record<string, CompositeTypeSymbol>;
  readonly blocks: Record<string, BlockSymbol>;
}

export interface ModelSymbol {
  readonly kind: 'model';
  readonly name: string;
  readonly node: ModelDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly attributes: readonly ResolvedAttribute[];
}

export interface CompositeTypeSymbol {
  readonly kind: 'compositeType';
  readonly name: string;
  readonly node: CompositeTypeDeclarationAst;
  readonly span: PslSpan;
  readonly fields: Record<string, FieldSymbol>;
  readonly attributes: readonly ResolvedAttribute[];
}

export interface BlockSymbol {
  readonly kind: 'block';
  readonly name: string;
  readonly keyword: string;
  readonly node: GenericBlockDeclarationAst;
  readonly span: PslSpan;
  /** Resolved once so consumers do not independently classify block parameters. */
  readonly block: PslExtensionBlock;
}

export interface ResolvedNamedTypeBinding {
  readonly baseType?: string;
  readonly typeConstructor?: ResolvedTypeConstructorCall;
  readonly isConstructor: boolean;
  readonly attributes: readonly ResolvedAttribute[];
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
  readonly typeConstructor?: ResolvedTypeConstructorCall;
  readonly attributes: readonly ResolvedAttribute[];
  /** Prevents cascading unsupported-type diagnostics after invalid qualification. */
  readonly malformedType?: boolean;
}

export interface BuildSymbolTableOptions {
  readonly documents: readonly DocumentAst[];
  readonly sources: PslSources;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
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
  const { documents, sources, pslBlockDescriptors } = options;
  const diagnostics: ParseDiagnostic[] = [];
  const collectedBlocks: BlockSymbol[] = [];

  const namespaces: Record<string, NamespaceSymbol> = Object.create(null);
  const namedTypes: Record<string, NamedTypeSymbol> = Object.create(null);
  const blocks: Record<string, BlockSymbol> = Object.create(null);
  const models: Record<string, ModelSymbol> = Object.create(null);
  const compositeTypes: Record<string, CompositeTypeSymbol> = Object.create(null);
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
          blocks[name] = buildBlock(
            name,
            declaration,
            sources,
            pslBlockDescriptors,
            diagnostics,
            collectedBlocks,
          );
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
            declarations: [],
            models: Object.create(null),
            compositeTypes: Object.create(null),
            blocks: Object.create(null),
          };
          namespaces[name] = namespace;
        }
        extendNamespace(
          namespace,
          declaration,
          diagnostics,
          sources,
          pslBlockDescriptors,
          collectedBlocks,
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

  const symbolTable: SymbolTable = {
    topLevel: { namespaces, namedTypes, blocks, models, compositeTypes },
  };
  for (const block of collectedBlocks) {
    const descriptor = findBlockDescriptor(pslBlockDescriptors, block.keyword);
    if (descriptor !== undefined) {
      interpretBlockAttributes(block, descriptor, sources, symbolTable, diagnostics);
    }
  }
  return { symbolTable, diagnostics };
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
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
  diagnostics: ParseDiagnostic[],
  collectedBlocks: BlockSymbol[],
): BlockSymbol {
  const keyword = node.keyword()?.text ?? '';
  const descriptor = findBlockDescriptor(pslBlockDescriptors, keyword);
  const symbol: BlockSymbol = {
    kind: 'block',
    name,
    keyword,
    node,
    span: nodePslSpan(node.syntax, sources),
    block: reconstructExtensionBlock(node, descriptor, sources, diagnostics),
  };
  collectedBlocks.push(symbol);
  return symbol;
}

function extendNamespace(
  namespace: NamespaceSymbol,
  node: NamespaceDeclarationAst,
  diagnostics: ParseDiagnostic[],
  sources: PslSources,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
  collectedBlocks: BlockSymbol[],
): void {
  const { models, compositeTypes, blocks } = namespace;
  namespace.declarations.push({ node, span: nodePslSpan(node.syntax, sources) });

  for (const member of node.declarations()) {
    const memberName = member.name()?.name();
    if (memberName === undefined) continue;
    if (
      Object.hasOwn(models, memberName) ||
      Object.hasOwn(compositeTypes, memberName) ||
      Object.hasOwn(blocks, memberName)
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
      blocks[memberName] = buildBlock(
        memberName,
        member,
        sources,
        pslBlockDescriptors,
        diagnostics,
        collectedBlocks,
      );
    }
  }
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
  attributes: readonly ResolvedAttribute[];
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
