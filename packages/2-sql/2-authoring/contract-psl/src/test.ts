import type { ContractSourceContext } from '@internal/config/config-types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { InterpretPslDocumentToSqlContractInput } from './interpreter';

export type SqlContextInput = Pick<
  InterpretPslDocumentToSqlContractInput,
  | 'authoringContributions'
  | 'scalarColumnDescriptors'
  | 'composedExtensions'
  | 'composedExtensionContracts'
  | 'controlMutationDefaults'
  | 'capabilities'
  | 'codecLookup'
  | 'dataTypeLookup'
>;

export function sqlContextInput(context: ContractSourceContext): SqlContextInput {
  return {
    authoringContributions: context.authoringContributions,
    scalarColumnDescriptors: collectScalarTypeConstructors(context.authoringContributions.type),
    ...(context.composedExtensions.length > 0
      ? { composedExtensions: [...context.composedExtensions] }
      : {}),
    composedExtensionContracts: context.composedExtensionContracts,
    controlMutationDefaults: context.controlMutationDefaults,
    capabilities: context.capabilities,
    codecLookup: context.codecLookup,
    dataTypeLookup: context.dataTypeLookup,
  };
}
