import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import type { InterpretPslDocumentToSqlContractInput } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresCodecLookup,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
  temporalCodecPresetMirrors,
  temporalConvenienceMirrors,
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
  > &
    Partial<
      Pick<
        InterpretPslDocumentToSqlContractInput,
        'composedExtensionContracts' | 'scalarColumnDescriptors' | 'dataTypes'
      >
    >,
) => {
  const { scalarColumnDescriptors = postgresNativeScalarTypeDescriptors, ...interpreterInput } =
    input;
  return interpretSqlContract(schema, {
    target: postgresTarget,
    // Literal defaults resolve through the column's codec descriptor, as they do in a real stack.
    codecLookup: postgresCodecLookup,
    scalarColumnDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: { sql: { scalarList: true } },
    ...interpreterInput,
    dataTypes: interpreterInput.dataTypes ?? {
      entries: {
        ...fixtureDataTypeSupport.entries,
        ...interpreterInput.authoringContributions?.dataTypes,
      },
      lookup: fixtureDataTypeSupport.lookup,
    },
  });
};

// The temporal preset registry inline test fixtures use to exercise the
// PSL-side preset surface for Postgres + SQLite. Real targets ship the
// same shapes via `target.authoring.field.temporal.*`.
//
// Every entry comes from the mirrors in fixtures.ts, which family-sql's
// temporal-codec-presets.test.ts asserts deep-equal the real factory output
// — so a factory change fails there rather than silently leaving these tests
// passing against a preset that no longer ships.
export const postgresTemporalContributions = {
  field: {
    temporal: {
      ...temporalConvenienceMirrors.postgres,
      timestamp: temporalCodecPresetMirrors.pgTimestamp,
      timestamptz: temporalCodecPresetMirrors.pgTimestamptz,
    },
  },
} as const;

export const sqliteTemporalContributions = {
  field: {
    temporal: {
      ...temporalConvenienceMirrors.sqlite,
      datetime: temporalCodecPresetMirrors.sqliteDatetime,
    },
  },
} as const;
