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
  findBlockDescriptor,
  type SymbolTable,
} from '@internal/psl-parser';
import type {
  FieldDeclarationAst,
  GenericBlockDeclarationAst,
  ModelDeclarationAst,
} from '@internal/psl-parser/syntax';
import { blindCast } from '@internal/utils/casts';

export interface AttributeSpecSource {
  readonly binder: Binder;
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly symbolTable: SymbolTable;
  readonly authoringContributions?: AssembledAuthoringContributions;
  readonly controlMutationDefaults?: ControlMutationDefaults;
}

export type AttributeSpecOwner =
  | {
      readonly ownerKind: 'block';
      readonly block: GenericBlockDeclarationAst;
      readonly blockKeyword: string;
    }
  | {
      readonly ownerKind: 'field';
      readonly model: ModelDeclarationAst;
      readonly field: FieldDeclarationAst;
    }
  | { readonly ownerKind: 'model'; readonly model: ModelDeclarationAst };

export function attributeSpecResolver(
  context: AttributeSpecOwner,
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
      return (name) => specs.field[name]?.({ ...specContext, field });
    }
  }
}
