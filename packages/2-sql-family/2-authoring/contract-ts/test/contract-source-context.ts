import type { ContractSourceContext } from '@internal/config/config-types';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';

/** A contract source context with nothing composed, for loading a contract source in a test. */
export const stubContext: ContractSourceContext = {
  composedExtensions: [],
  defaultNamespaceId: 'public',
  composedExtensionContracts: new Map(),
  authoringContributions: {
    dataTypes: {},
    type: {},
    entityTypes: {},
    pslBlockDescriptors: {},
    modelAttributes: {},
    attributeSpecs: { model: {}, field: {} },
  },
  dataTypes: { entries: {}, lookup: createDataTypeLookup([]), dataTypeOfCodec: () => undefined },
  codecLookup: {
    get: () => undefined,
    renderOutputTypeFor: () => undefined,
    descriptorFor: () => undefined,
  },
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [],
  },
  generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
  resolvedInputs: [],
  capabilities: {},
};
