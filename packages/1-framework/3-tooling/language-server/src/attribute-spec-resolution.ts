import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type {
  AssembledAuthoringContributions,
  ControlMutationDefaults,
} from '@internal/framework-components/control';
import {
  type AttributeSpec,
  assembleAttributeSpecs,
  type BlockAttributeSpecFactory,
  findBlockDescriptor,
  type SymbolTable,
} from '@internal/psl-parser';
import { blindCast } from '@internal/utils/casts';
import type {
  AttributeArgumentCompletionContext,
  AttributeNameCompletionContext,
} from './completion-context';
import { fieldSymbolForNode, modelSymbolForNode } from './completion-symbols';

export interface AttributeSpecSource {
  readonly pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace;
  readonly symbolTable: SymbolTable;
  readonly authoringContributions?: AssembledAuthoringContributions;
  readonly controlMutationDefaults?: ControlMutationDefaults;
}

export function attributeSpecResolver(
  context: AttributeNameCompletionContext | AttributeArgumentCompletionContext,
  source: AttributeSpecSource,
): (name: string) => AttributeSpec<never, never> | undefined {
  switch (context.kind) {
    case 'blockAttributeName':
    case 'blockAttributeNamedKey':
    case 'blockAttributeArgumentSlot':
    case 'blockAttributeValue': {
      const descriptor = findBlockDescriptor(source.pslBlockDescriptors, context.blockKeyword);
      return (name) => {
        const factory = descriptor?.attributes?.[name];
        if (factory === undefined) return undefined;
        return blindCast<
          BlockAttributeSpecFactory,
          'block descriptor attributes are validated as factories at control-stack assembly but exposed through framework-components as unknown to avoid a parser dependency'
        >(factory)();
      };
    }
    case 'modelAttributeName':
    case 'modelAttributeNamedKey':
    case 'modelAttributeArgumentSlot':
    case 'modelAttributeValue': {
      if (source.authoringContributions === undefined) return () => undefined;
      const model = modelSymbolForNode(source.symbolTable, context.model);
      if (model === undefined || source.controlMutationDefaults === undefined) {
        return () => undefined;
      }
      const specs = assembleAttributeSpecs(source.authoringContributions);
      const specContext = {
        symbols: source.symbolTable,
        model,
        controlMutationDefaults: source.controlMutationDefaults.defaultFunctionRegistry,
      };
      return (name) => specs.model[name]?.(specContext);
    }
    case 'fieldAttributeName':
    case 'fieldAttributeNamedKey':
    case 'fieldAttributeArgumentSlot':
    case 'fieldAttributeValue': {
      if (source.authoringContributions === undefined) return () => undefined;
      const model = modelSymbolForNode(source.symbolTable, context.model);
      if (model === undefined || source.controlMutationDefaults === undefined) {
        return () => undefined;
      }
      const field = fieldSymbolForNode(model, context.field);
      if (field === undefined) return () => undefined;
      const specs = assembleAttributeSpecs(source.authoringContributions);
      const specContext = {
        symbols: source.symbolTable,
        model,
        controlMutationDefaults: source.controlMutationDefaults.defaultFunctionRegistry,
      };
      return (name) => specs.field[name]?.({ ...specContext, field });
    }
  }
}
