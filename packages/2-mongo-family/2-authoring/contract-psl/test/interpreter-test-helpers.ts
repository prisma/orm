import type {
  ContractSourceContext,
  ContractSourceDiagnostic,
  ContractSourceDiagnostics,
} from '@internal/config/config-types';
import type { Contract } from '@internal/contract/types';
import type {
  AuthoringTypeConstructorDescriptor,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import { EMPTY_DATA_TYPES } from '@internal/psl-parser';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { Result } from '@internal/utils/result';
import { expect } from 'vitest';
import { describeUnresolvedMongoType } from '../src/describe-unresolved-type';
import type { InterpretPslDocumentToMongoContractInput } from '../src/interpreter';
import { interpretPslDocumentToMongoContract } from '../src/interpreter';
import {
  describeUnsupportedMongoAttribute,
  mongoAttributeSpecs,
} from '../src/mongo-attribute-specs';
import { mongoContextInput } from '../src/test';

function contextForInterpretOptions(
  options: Omit<
    Pick<
      InterpretPslDocumentToMongoContractInput,
      | 'authoringContributions'
      | 'controlMutationDefaults'
      | 'codecLookup'
      | 'scalarTypeCodecIds'
      | 'reportWarning'
    >,
    'codecLookup'
  > & {
    readonly codecLookup?: CodecLookupWithDescriptors;
    readonly dataTypes?: DataTypeSupport;
  },
): ContractSourceContext {
  const authoring = options.authoringContributions;
  const scalarsFromCodecIds: Record<string, AuthoringTypeConstructorDescriptor> = {};
  for (const [name, codecId] of options.scalarTypeCodecIds ?? []) {
    scalarsFromCodecIds[name] = {
      kind: 'typeConstructor',
      output: { codecId, nativeType: codecId },
    };
  }
  return {
    composedExtensions: [],
    composedExtensionContracts: new Map(),
    authoringContributions: {
      type: { ...scalarsFromCodecIds, ...authoring?.type },
      field: authoring?.field ?? {},
      entityTypes: authoring?.entityTypes ?? {},
      pslBlockDescriptors: authoring?.pslBlockDescriptors ?? {},
      modelAttributes: authoring?.modelAttributes ?? {},
      attributeSpecs: authoring?.attributeSpecs ?? mongoAttributeSpecs,
      dataTypes: authoring?.dataTypes ?? {},
    },
    pslDiagnostics: {
      describeUnsupportedAttribute: describeUnsupportedMongoAttribute,
      describeUnresolvedType: describeUnresolvedMongoType,
    },
    codecLookup: options.codecLookup ?? {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: () => undefined,
      descriptorFor: () => undefined,
    },
    dataTypes: options.dataTypes ?? EMPTY_DATA_TYPES,
    controlMutationDefaults: {
      defaultFunctionRegistry:
        options.controlMutationDefaults?.defaultFunctionRegistry ?? new Map(),
      generatorDescriptors: [],
    },
    resolvedInputs: [],
    capabilities: {},
    ...(options.reportWarning ? { reportWarning: options.reportWarning } : {}),
  };
}

export function interpretMongoContract(
  schema: string,
  options: Omit<
    InterpretPslDocumentToMongoContractInput,
    'documents' | 'sources' | 'symbolTable' | 'binder' | 'codecLookup' | 'dataTypes'
  > & {
    readonly codecLookup?: CodecLookupWithDescriptors;
    readonly dataTypes?: DataTypeSupport;
  },
  sourceId = 'schema.prisma',
): Result<Contract, ContractSourceDiagnostics> {
  const bound = bindPslSchema(schema, { sourceId, context: contextForInterpretOptions(options) });
  return withSeedDiagnostics(
    interpretPslDocumentToMongoContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...mongoContextInput(bound.context),
      ...(options.enumInferenceCodecs ? { enumInferenceCodecs: options.enumInferenceCodecs } : {}),
    }),
    bound.seedDiagnostics,
  );
}

export function expectInvalidAttributeSyntax<Success>(
  result: Result<Success, ContractSourceDiagnostics>,
  message: RegExp,
): ContractSourceDiagnostic {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected interpretation to fail');
  const diagnostics = result.failure.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'PSL_INVALID_ATTRIBUTE_SYNTAX',
  );
  expect(diagnostics).toHaveLength(1);
  const diagnostic = diagnostics[0];
  if (!diagnostic) throw new Error('Expected PSL_INVALID_ATTRIBUTE_SYNTAX diagnostic');
  expect(diagnostic.message).toMatch(message);
  return diagnostic;
}

export function expectUnresolvedReference<Success>(
  result: Result<Success, ContractSourceDiagnostics>,
  message: RegExp,
): ContractSourceDiagnostic {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error('Expected interpretation to fail');
  const diagnostics = result.failure.diagnostics.filter(
    (diagnostic) => diagnostic.code === 'PSL_UNRESOLVED_REFERENCE',
  );
  expect(diagnostics).toHaveLength(1);
  const diagnostic = diagnostics[0];
  if (!diagnostic) throw new Error('Expected PSL_UNRESOLVED_REFERENCE diagnostic');
  expect(diagnostic.message).toMatch(message);
  return diagnostic;
}
