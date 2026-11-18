import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import type { InterpretPslDocumentToSqlContractInput } from '../src/interpreter';
import { fixtureTypeLookups } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport, fixtureTextDataTypes } from './fixture-data-types';
import { fixtureGeneratorFunctions } from './fixture-generator-functions';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

export const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
export const interpretPostgresSchema = (
  schema: string,
  input: Omit<
    InterpretPslDocumentToSqlContractInput,
    | 'documents'
    | 'sources'
    | 'symbolTable'
    | 'binder'
    | 'target'
    | 'scalarColumnDescriptors'
    | 'composedExtensionContracts'
    | 'createNamespace'
    | 'capabilities'
    | 'dataTypes'
    | 'codecLookup'
    | 'generatorFunctions'
  > &
    Partial<
      Pick<
        InterpretPslDocumentToSqlContractInput,
        | 'composedExtensionContracts'
        | 'scalarColumnDescriptors'
        | 'dataTypes'
        | 'codecLookup'
        | 'generatorFunctions'
      >
    >,
) => {
  const { scalarColumnDescriptors = postgresNativeScalarTypeDescriptors, ...interpreterInput } =
    input;
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    generatorFunctions: fixtureGeneratorFunctions,
    ...interpreterInput,
    // Literal defaults resolve through the column's codec descriptor, as they do in a real stack.
    codecLookup: interpreterInput.codecLookup ?? fixtureTypeLookups.codecLookup,
    dataTypes: interpreterInput.dataTypes ?? {
      entries: {
        ...fixtureDataTypeSupport.entries,
        ...interpreterInput.authoringContributions?.dataTypes,
      },
      lookup: fixtureTypeLookups.dataTypeLookup,
      textDataTypes: fixtureTextDataTypes,
      dataTypeOfCodec: (codecId) => fixtureTypeLookups.codecLookup.descriptorFor(codecId)?.dataType,
    },
  });
};
