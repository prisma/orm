import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type { PslExtensionBlock, PslSpan } from '@internal/framework-components/psl-ast';
import { reconstructExtensionBlock } from './block-reconstruction';
import { findBlockDescriptor } from './extension-block';
import type { ParseDiagnostic } from './parse';
import {
  nodePslSpan,
  type ResolvedAttribute,
  type ResolvedTypeConstructorCall,
  readResolvedAttributes,
  readResolvedConstructorCall,
} from './resolve';
import type { Range, SourceFile } from './source-file';
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
  readonly document: DocumentAst;
  readonly sourceFile: SourceFile;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
}

export interface SymbolTableResult {
  readonly table: SymbolTable;
  readonly diagnostics: readonly ParseDiagnostic[];
}

/**
 * Owns duplicate-declaration detection for all PSL scopes; downstream consumers
 * should consume first-wins symbols rather than re-emitting duplicate diagnostics.
 */
export function buildSymbolTable(options: BuildSymbolTableOptions): SymbolTableResult {
  const { document, sourceFile, pslBlockDescriptors } = options;
  const diagnostics: ParseDiagnostic[] = [];

  const namespaces: Record<string, NamespaceSymbol> = Object.create(null);
  const namedTypes: Record<string, NamedTypeSymbol> = {};
  const blocks: Record<string, BlockSymbol> = {};
  const models: Record<string, ModelSymbol> = {};
  const compositeTypes: Record<string, CompositeTypeSymbol> = {};
  const topLevelNames = new Set<string>();

  const claim = (taken: Set<string>, name: IdentifierAst | undefined): string | undefined => {
    const text = name?.name();
    if (text === undefined) return undefined;
    if (taken.has(text)) {
      const range = nameRange(name, sourceFile);
      if (range) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${text}"`,
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
      if (name !== undefined) models[name] = buildModel(name, declaration, sourceFile, diagnostics);
    } else if (declaration instanceof CompositeTypeDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) {
        compositeTypes[name] = buildCompositeType(name, declaration, sourceFile, diagnostics);
      }
    } else if (declaration instanceof GenericBlockDeclarationAst) {
      const name = claim(topLevelNames, declaration.name());
      if (name !== undefined) {
        blocks[name] = buildBlock(name, declaration, sourceFile, pslBlockDescriptors, diagnostics);
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
      extendNamespace(namespace, declaration, diagnostics, sourceFile, pslBlockDescriptors);
    } else if (declaration instanceof TypesBlockAst) {
      for (const binding of declaration.declarations()) {
        const name = claim(topLevelNames, binding.name());
        if (name === undefined) continue;
        const resolved = resolveNamedTypeBinding(binding, sourceFile);
        const span = nodePslSpan(binding.syntax, sourceFile);
        namedTypes[name] = { kind: 'namedType', name, node: binding, span, ...resolved };
      }
    }
  }

  const table: SymbolTable = {
    topLevel: { namespaces, namedTypes, blocks, models, compositeTypes },
  };
  return { table, diagnostics };
}

function buildModel(
  name: string,
  node: ModelDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): ModelSymbol {
  return {
    kind: 'model',
    name,
    node,
    span: nodePslSpan(node.syntax, sourceFile),
    fields: buildFields(name, node.fields(), sourceFile, diagnostics),
    attributes: readResolvedAttributes(node.attributes(), sourceFile),
  };
}

function buildCompositeType(
  name: string,
  node: CompositeTypeDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): CompositeTypeSymbol {
  return {
    kind: 'compositeType',
    name,
    node,
    span: nodePslSpan(node.syntax, sourceFile),
    fields: buildFields(name, node.fields(), sourceFile, diagnostics),
    attributes: readResolvedAttributes(node.attributes(), sourceFile),
  };
}

function buildBlock(
  name: string,
  node: GenericBlockDeclarationAst,
  sourceFile: SourceFile,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
  diagnostics: ParseDiagnostic[],
): BlockSymbol {
  const keyword = node.keyword()?.text ?? '';
  const descriptor = findBlockDescriptor(pslBlockDescriptors, keyword);
  return {
    kind: 'block',
    name,
    keyword,
    node,
    span: nodePslSpan(node.syntax, sourceFile),
    block: reconstructExtensionBlock(node, descriptor, sourceFile, diagnostics),
  };
}

function extendNamespace(
  namespace: NamespaceSymbol,
  node: NamespaceDeclarationAst,
  diagnostics: ParseDiagnostic[],
  sourceFile: SourceFile,
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
): void {
  const { models, compositeTypes, blocks } = namespace;
  namespace.declarations.push({ node, span: nodePslSpan(node.syntax, sourceFile) });

  for (const member of node.declarations()) {
    const memberName = member.name()?.name();
    if (memberName === undefined) continue;
    if (
      Object.hasOwn(models, memberName) ||
      Object.hasOwn(compositeTypes, memberName) ||
      Object.hasOwn(blocks, memberName)
    ) {
      const range = nameRange(member.name(), sourceFile);
      if (range) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${memberName}"`,
          range,
        });
      }
      continue;
    }
    if (member instanceof ModelDeclarationAst) {
      models[memberName] = buildModel(memberName, member, sourceFile, diagnostics);
    } else if (member instanceof CompositeTypeDeclarationAst) {
      compositeTypes[memberName] = buildCompositeType(memberName, member, sourceFile, diagnostics);
    } else if (member instanceof GenericBlockDeclarationAst) {
      blocks[memberName] = buildBlock(
        memberName,
        member,
        sourceFile,
        pslBlockDescriptors,
        diagnostics,
      );
    }
  }
}

function buildFields(
  ownerName: string,
  fields: Iterable<FieldDeclarationAst>,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): Record<string, FieldSymbol> {
  const result: Record<string, FieldSymbol> = {};
  for (const field of fields) {
    const nameNode = field.name();
    const name = nameNode?.name();
    if (name === undefined) continue;
    if (Object.hasOwn(result, name)) {
      const range = nameRange(nameNode, sourceFile);
      if (range) {
        diagnostics.push({
          code: 'PSL_DUPLICATE_DECLARATION',
          message: `Duplicate declaration of "${name}"`,
          range,
        });
      }
      continue;
    }
    result[name] = buildField(ownerName, name, field, sourceFile, diagnostics);
  }
  return result;
}

function buildField(
  ownerName: string,
  name: string,
  node: FieldDeclarationAst,
  sourceFile: SourceFile,
  diagnostics: ParseDiagnostic[],
): FieldSymbol {
  const attributes = readResolvedAttributes(node.attributes(), sourceFile);
  const span = nodePslSpan(node.syntax, sourceFile);
  const annotation = node.typeAnnotation();
  const typeName = annotation?.name();

  if (typeName?.isOverQualified()) {
    const path = typeName.path();
    diagnostics.push({
      code: 'PSL_INVALID_QUALIFIED_TYPE',
      message: `Field "${ownerName}.${name}" has an invalid qualified type "${path.join('.')}"; use at most one namespace qualifier (e.g. "ns.TypeName")`,
      range: nodeRange(typeName.syntax, sourceFile),
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
    ? readResolvedConstructorCall(annotation, sourceFile)
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
  sourceFile: SourceFile,
): {
  baseType?: string;
  typeConstructor?: ResolvedTypeConstructorCall;
  isConstructor: boolean;
  attributes: readonly ResolvedAttribute[];
} {
  const annotation = node.typeAnnotation();
  const isConstructor = annotation?.isConstructor() ?? false;
  const baseType = annotation?.name()?.identifier()?.name();
  const typeConstructor = readResolvedConstructorCall(annotation, sourceFile);
  return {
    isConstructor,
    ...(!isConstructor && baseType !== undefined ? { baseType } : {}),
    ...(typeConstructor !== undefined ? { typeConstructor } : {}),
    attributes: readResolvedAttributes(node.attributes(), sourceFile),
  };
}

function nameRange(name: IdentifierAst | undefined, sourceFile: SourceFile): Range | undefined {
  if (name === undefined) return undefined;
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

function nodeRange(node: SyntaxNode, sourceFile: SourceFile): Range {
  const start = node.offset;
  const end = start + node.green.textLength;
  return {
    start: sourceFile.positionAt(start),
    end: sourceFile.positionAt(end),
  };
}
