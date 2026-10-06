import type { ContractSourceContext } from '@internal/config/config-types';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { InterpretPslDocumentToMongoContractInput } from './interpreter';

export type MongoContextInput = Pick<
  InterpretPslDocumentToMongoContractInput,
  | 'scalarTypeCodecIds'
  | 'controlMutationDefaults'
  | 'codecLookup'
  | 'authoringContributions'
  | 'reportWarning'
>;

export function mongoContextInput(context: ContractSourceContext): MongoContextInput {
  return {
    scalarTypeCodecIds: new Map(
      [...collectScalarTypeConstructors(context.authoringContributions.type)].map(
        ([name, output]) => [name, output.codecId],
      ),
    ),
    controlMutationDefaults: {
      ...context.controlMutationDefaults,
      dataTypeEntries: context.authoringContributions.dataTypes,
    },
    codecLookup: context.codecLookup,
    authoringContributions: context.authoringContributions,
    ...(context.reportWarning ? { reportWarning: context.reportWarning } : {}),
  };
}
