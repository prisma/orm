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
import {
  EMPTY_GENERATOR_FUNCTIONS,
  type GeneratorFunctionRegistry,
} from '@internal/framework-components/components';
import { mongoCodecLookup } from '@internal/mongo-contract/test';
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
import { mongoDataTypeSupport } from './mongo-type-lookups';

type InterpretOptionsWithDefaultLookups = Omit<
  InterpretPslDocumentToMongoContractInput,
  | 'documents'
  | 'sources'
  | 'symbolTable'
  | 'binder'
  | 'codecLookup'
  | 'dataTypes'
  | 'generatorFunctions'
  | 'target'
> & {
  /** Scalar type names and the codec each stores, contributed as type constructors. */
  readonly scalarTypes?: ReadonlyMap<string, string>;
  readonly codecLookup?: CodecLookupWithDescriptors;
  readonly dataTypes?: DataTypeSupport;
  readonly generatorFunctions?: GeneratorFunctionRegistry;
};

function contextForInterpretOptions(
  options: InterpretOptionsWithDefaultLookups,
): ContractSourceContext {
  const authoring = options.authoringContributions;
  const scalarsFromCodecIds: Record<string, AuthoringTypeConstructorDescriptor> = {};
  for (const [name, codecId] of options.scalarTypes ?? []) {
    scalarsFromCodecIds[name] = {
      kind: 'typeConstructor',
      output: { codecId },
    };
  }
  return {
    composedExtensions: [],
    defaultNamespaceId: '__unbound__',
    composedExtensionContracts: new Map(),
    authoringContributions: {
      type: { ...scalarsFromCodecIds, ...authoring?.type },
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
    codecLookup: options.codecLookup ?? mongoCodecLookup,
    dataTypes: options.dataTypes ?? mongoDataTypeSupport,
    controlMutationDefaults: {
      defaultFunctionRegistry: options.defaultFunctionRegistry,
      generatorDescriptors: [],
    },
    generatorFunctions: options.generatorFunctions ?? EMPTY_GENERATOR_FUNCTIONS,
    resolvedInputs: [],
    capabilities: {},
    ...(options.reportWarning ? { reportWarning: options.reportWarning } : {}),
  };
}

export function interpretMongoContract(
  schema: string,
  options: InterpretOptionsWithDefaultLookups,
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
      ...(options.extensionPacks ? { extensionPacks: options.extensionPacks } : {}),
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
