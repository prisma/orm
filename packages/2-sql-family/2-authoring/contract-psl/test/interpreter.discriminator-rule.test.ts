import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  modelsOf,
  postgresEnumInferenceCodecs,
  postgresScalarTypeDescriptors,
  postgresTarget,
  testEnumEntityContributions,
  testEnumPslBlockDescriptor,
} from './fixtures';

function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
    authoringContributions: {
      entityTypes: testEnumEntityContributions,
      type: {},
      pslBlockDescriptors: { enum: testEnumPslBlockDescriptor },
      dataTypes: fixtureDataTypeSupport.entries,
    },
    ...fixtureInterpreterTypes,
    createNamespace: createTestSqlNamespace,
    enumInferenceCodecs: postgresEnumInferenceCodecs,
    capabilities: { sql: { scalarList: true } },
  });
}

function diagnosticsOf(schema: string) {
  const result = interpret(schema);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

/** A base `Task` whose discriminator field is declared as `kind`, and a variant `Bug` with the base value `value`. */
function hierarchy(kind: string, value = '"bug"', preamble = '') {
  return `${preamble}
model Task {
  id   Int @id @default(autoincrement())
  kind ${kind}

  @@discriminator(kind)
}

model Bug {
  severity String

  @@base(Task, ${value})
}
`;
}

const kindEnum = 'enum Kind {\n  Bug = "bug"\n  Feature = "feature"\n}\n';

describe('the discriminator rule in SQL PSL', () => {
  it('refuses an optional discriminator field', () => {
    expect(diagnosticsOf(hierarchy('String?'))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Discriminator field "kind" on model "Task" must be required, but it is optional. Remove the "?"',
      },
    ]);
  });

  it('refuses a list discriminator field', () => {
    expect(diagnosticsOf(hierarchy('String[]'))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Discriminator field "kind" on model "Task" must hold one value, but it is a list. Remove the "[]"',
      },
    ]);
  });

  it('refuses a discriminator field whose data type is not text', () => {
    expect(diagnosticsOf(hierarchy('Int', '"1"'))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Discriminator field "kind" on model "Task" must be text, such as String, but is "Int"',
      },
    ]);
  });

  it('accepts an enum-typed discriminator whose @@base values are members', () => {
    const result = interpret(hierarchy('Kind', '"bug"', kindEnum));
    expect(result.ok && modelsOf(result.value)['Task']?.variants).toEqual({
      bug: expect.objectContaining({ model: 'Bug' }),
    });
  });

  it('refuses a @@base value that is not a member of the enum typing the discriminator', () => {
    expect(diagnosticsOf(hierarchy('Kind', '"story"', kindEnum))).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message:
          'Model "Bug" declares @@base value "story", which is not a member of enum "Kind", the type of discriminator field "Task.kind". Write one of: "bug", "feature"',
      },
    ]);
  });

  it('accepts a String discriminator', () => {
    const result = interpret(hierarchy('String'));
    expect(result.ok && modelsOf(result.value)['Task']?.discriminator).toEqual({ field: 'kind' });
  });
});

/** Each diagnostic's code and where its span starts and ends, as offsets into the schema text. */
function positionsOf(schema: string) {
  const result = interpret(schema);
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, span }) => ({
        code,
        start: span?.start.offset,
        end: span?.end.offset,
      }));
}

describe('where SQL PSL reports a discriminator refusal', () => {
  it('reports an optional discriminator field at its @@discriminator attribute', () => {
    const schema = hierarchy('String?');
    const start = schema.indexOf('@@discriminator(kind)');
    expect(positionsOf(schema)).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        start,
        end: start + '@@discriminator(kind)'.length,
      },
    ]);
  });

  it('reports a @@base value that is not a member at the value', () => {
    const schema = hierarchy('Kind', '"story"', kindEnum);
    const start = schema.indexOf('"story"');
    expect(positionsOf(schema)).toEqual([
      { code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT', start, end: start + '"story"'.length },
    ]);
  });
});

describe('a @@discriminator or @@base that does not parse', () => {
  it('gets no orphaned-base diagnostic for a discriminator naming no field', () => {
    expect(
      diagnosticsOf(hierarchy('String').replace('@@discriminator(kind)', '@@discriminator(nope)')),
    ).toEqual([expect.objectContaining({ code: 'PSL_UNRESOLVED_REFERENCE' })]);
  });

  it('gets no orphaned-discriminator diagnostic for a @@base whose value is not a string', () => {
    expect(diagnosticsOf(hierarchy('String', '1'))).toEqual([
      expect.objectContaining({ code: 'PSL_INVALID_ATTRIBUTE_SYNTAX' }),
    ]);
  });
});
