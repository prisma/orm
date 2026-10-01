import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  type AttributeSpec,
  assembleAttributeSpecs,
  type Binder,
  type BlockAttributeSpecFactory,
  blockSpecFactoryOf,
  findBlockDescriptor,
  type SymbolTable,
  typeReferenceNode,
} from '@internal/psl-parser';
import type {
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
} from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';
import type { ArgumentGrammar } from './attribute-argument-grammar';

export interface AttributeSpecSource {
  readonly binder: Binder;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly symbolTable: SymbolTable;
  readonly authoringContributions?: AssembledAuthoringContributions;
  readonly controlMutationDefaults?: ControlMutationDefaults;
}

export interface FieldAttributeOwner {
  readonly ownerKind: 'field';
  readonly field: FieldDeclarationAst;
  readonly model: ModelDeclarationAst;
}

export interface ModelAttributeOwner {
  readonly ownerKind: 'model';
  readonly model: ModelDeclarationAst;
}

export interface BlockAttributeOwner {
  readonly ownerKind: 'block';
  readonly block: GenericBlockDeclarationAst;
  readonly blockKeyword: string;
}

export type AttributeOwner = BlockAttributeOwner | FieldAttributeOwner | ModelAttributeOwner;

export interface NamedAttribute {
  readonly attributeName: string;
}

export type AttributeArgumentOwner = AttributeOwner & NamedAttribute;

export interface BlockValueOwner {
  readonly ownerKind: 'blockValue';
  readonly block: GenericBlockDeclarationAst;
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
  const block = source.binder.declaredSymbol(owner.block.syntax);
  if (descriptor === undefined || block?.kind !== 'block') return undefined;
  const spec = blockSpecFactoryOf(descriptor)({ symbols: source.symbolTable, block });
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
      const block = source.binder.declaredSymbol(context.block.syntax);
      if (block?.kind !== 'block') return () => undefined;
      return (name) => {
        const factory = descriptor?.attributes?.[name];
        if (factory === undefined) return undefined;
        return blindCast<
          BlockAttributeSpecFactory,
          'block descriptor attributes are validated as factories at control-stack assembly but exposed through framework-components as unknown to avoid a parser dependency'
        >(factory)({ symbols: source.symbolTable, block });
      };
    }
    case 'model': {
      if (source.authoringContributions === undefined) return () => undefined;
      const model = source.binder.declaredSymbol(context.model.syntax);
      if (model?.kind !== 'model' || source.controlMutationDefaults === undefined) {
        return () => undefined;
      }
      const specs = assembleAttributeSpecs(source.authoringContributions);
      const specContext = {
        symbols: source.symbolTable,
        model,
        controlMutationDefaults: {
          ...source.controlMutationDefaults,
          dataTypeEntries: source.authoringContributions.dataTypes ?? {},
        },
      };
      return (name) => specs.model[name]?.(specContext);
    }
    case 'field': {
      if (source.authoringContributions === undefined) return () => undefined;
      const model = source.binder.declaredSymbol(context.model.syntax);
      if (model?.kind !== 'model' || source.controlMutationDefaults === undefined) {
        return () => undefined;
      }
      const field = source.binder.declaredSymbol(context.field.syntax);
      if (field?.kind !== 'field') return () => undefined;
      const specs = assembleAttributeSpecs(source.authoringContributions);
      const specContext = {
        symbols: source.symbolTable,
        model,
        controlMutationDefaults: {
          ...source.controlMutationDefaults,
          dataTypeEntries: source.authoringContributions.dataTypes ?? {},
        },
      };
      const node = typeReferenceNode(field);
      const typeResolution = node === undefined ? undefined : source.binder.symbolForNode(node);
      return (name) => specs.field[name]?.({ ...specContext, field, typeResolution });
    }
  }
}
