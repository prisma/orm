import type {
  AuthoringPslBlockDescriptorNamespace,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  type AttributeSpec,
  assembleAttributeSpecs,
  type Binder,
  type BlockAttributeSpecFactory,
  blockSpecContext,
  blockSpecFactoryOf,
  EMPTY_DATA_TYPES,
  findBlockDescriptor,
  type MixinSymbol,
  type ModelSymbol,
  type PslSymbol,
  type SymbolTable,
  typeReferenceNode,
} from '@internal/psl-parser';
import {
  CompositeTypeDeclarationAst,
  type FieldDeclarationAst,
  GenericBlockDeclarationAst,
  MixinDeclarationAst,
  ModelDeclarationAst,
  type SyntaxNode,
} from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import type { ArgumentGrammar } from './attribute-argument-grammar';

export interface AttributeSpecSource {
  readonly binder: Binder;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly symbolTable: SymbolTable;
  readonly authoringContributions?: AssembledAuthoringContributions;
  readonly controlMutationDefaults?: ControlMutationDefaults;
  readonly dataTypes?: DataTypeSupport;
}

export type ModelBlockAst = ModelDeclarationAst | MixinDeclarationAst;

export type FieldBlockAst = ModelBlockAst | CompositeTypeDeclarationAst;

export type EntryBlockAst = GenericBlockDeclarationAst | MixinDeclarationAst;

const FIELD_BLOCK_KEYWORDS: ReadonlySet<string> = new Set(['model', 'type']);

export function castModelBlock(node: SyntaxNode): ModelBlockAst | undefined {
  const model = ModelDeclarationAst.cast(node);
  if (model !== undefined) return model;
  const mixin = MixinDeclarationAst.cast(node);
  return mixin?.keyword()?.text === 'model' ? mixin : undefined;
}

export function castFieldBlock(node: SyntaxNode): FieldBlockAst | undefined {
  const block = ModelDeclarationAst.cast(node) ?? CompositeTypeDeclarationAst.cast(node);
  if (block !== undefined) return block;
  const mixin = MixinDeclarationAst.cast(node);
  return FIELD_BLOCK_KEYWORDS.has(mixin?.keyword()?.text ?? '') ? mixin : undefined;
}

export function castEntryBlock(node: SyntaxNode): EntryBlockAst | undefined {
  const block = GenericBlockDeclarationAst.cast(node);
  if (block !== undefined) return block;
  const mixin = MixinDeclarationAst.cast(node);
  const keyword = mixin?.keyword()?.text;
  return keyword !== undefined && !FIELD_BLOCK_KEYWORDS.has(keyword) ? mixin : undefined;
}

export interface FieldAttributeOwner {
  readonly ownerKind: 'field';
  readonly field: FieldDeclarationAst;
  readonly model: ModelBlockAst;
}

export interface ModelAttributeOwner {
  readonly ownerKind: 'model';
  readonly model: ModelBlockAst;
}

export interface BlockAttributeOwner {
  readonly ownerKind: 'block';
  readonly block: EntryBlockAst;
  readonly blockKeyword: string;
}

export type AttributeOwner = BlockAttributeOwner | FieldAttributeOwner | ModelAttributeOwner;

export interface NamedAttribute {
  readonly attributeName: string;
}

export type AttributeArgumentOwner = AttributeOwner & NamedAttribute;

export interface BlockValueOwner {
  readonly ownerKind: 'blockValue';
  readonly block: EntryBlockAst;
  readonly blockKeyword: string;
  readonly key: string;
}

export type ArgumentOwner = AttributeArgumentOwner | BlockValueOwner;

export function argumentRootGrammar(
  owner: ArgumentOwner,
  source: AttributeSpecSource,
): ArgumentGrammar | undefined {
  switch (owner.ownerKind) {
    case 'field':
    case 'model':
    case 'block':
      return attributeSpecResolver(owner, source)(owner.attributeName);
    case 'blockValue':
      return blockValueGrammar(owner, source);
  }
}

function blockValueGrammar(
  owner: BlockValueOwner,
  source: AttributeSpecSource,
): ArgumentGrammar | undefined {
  const descriptor = findBlockDescriptor(source.pslBlockDescriptors, owner.blockKeyword);
  if (descriptor === undefined) return undefined;
  const spec = blockSpecFactoryOf(descriptor)(
    blockSpecContext({
      symbols: source.symbolTable,
      dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES,
    }),
  );
  if (spec.mode === 'map') return spec.value.type;
  return Object.hasOwn(spec.parameters, owner.key) ? spec.parameters[owner.key]?.type : undefined;
}

export function attributeSpecResolver(
  context: AttributeOwner,
  source: AttributeSpecSource,
): (name: string) => AttributeSpec<never, never> | undefined {
  switch (context.ownerKind) {
    case 'block': {
      const descriptor = findBlockDescriptor(source.pslBlockDescriptors, context.blockKeyword);
      return (name) => {
        const factory = descriptor?.attributes?.[name];
        if (factory === undefined) return undefined;
        return blindCast<
          BlockAttributeSpecFactory,
          'block descriptor attributes are validated as factories at control-stack assembly but exposed through framework-components as unknown to avoid a parser dependency'
        >(factory)(
          blockSpecContext({
            symbols: source.symbolTable,
            dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES,
          }),
        );
      };
    }
    case 'model': {
      if (source.authoringContributions === undefined) return () => undefined;
      const model = fieldSpecModel(source.binder.declaredSymbol(context.model.syntax));
      if (model === undefined || source.controlMutationDefaults === undefined) {
        return () => undefined;
      }
      const specs = assembleAttributeSpecs(source.authoringContributions);
      const specContext = {
        symbols: source.symbolTable,
        model,
        defaultFunctionRegistry: source.controlMutationDefaults.defaultFunctionRegistry,
        dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES,
      };
      return (name) => specs.model[name]?.(specContext);
    }
    case 'field': {
      if (source.authoringContributions === undefined) return () => undefined;
      const model = fieldSpecModel(source.binder.declaredSymbol(context.model.syntax));
      if (model === undefined || source.controlMutationDefaults === undefined) {
        return () => undefined;
      }
      const field = source.binder.declaredSymbol(context.field.syntax);
      if (field?.kind !== 'field') return () => undefined;
      const specs = assembleAttributeSpecs(source.authoringContributions);
      const specContext = {
        symbols: source.symbolTable,
        model,
        defaultFunctionRegistry: source.controlMutationDefaults.defaultFunctionRegistry,
        dataTypes: source.dataTypes ?? EMPTY_DATA_TYPES,
      };
      const node = typeReferenceNode(field);
      const typeResolution = node === undefined ? undefined : source.binder.symbolForNode(node);
      return (name) => specs.field[name]?.({ ...specContext, field, typeResolution });
    }
  }
}

function fieldSpecModel(symbol: PslSymbol | undefined): ModelSymbol | MixinSymbol | undefined {
  if (symbol?.kind === 'model') return symbol;
  return symbol?.kind === 'mixin' && symbol.keyword === 'model' ? symbol : undefined;
}
