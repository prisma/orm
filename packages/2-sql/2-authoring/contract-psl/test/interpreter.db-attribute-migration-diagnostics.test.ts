import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresNativeScalarTypeDescriptors,
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';

const baseInput = {
  dataTypeLookup: fixtureDataTypeSupport.lookup,
  target: postgresTarget,
  scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
  authoringContributions: { type: postgresScalarAuthoringTypes },
  composedExtensionContracts: new Map(),
  createNamespace: createTestSqlNamespace,
  capabilities: { sql: { scalarList: true } },
  controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
} as const;

function diagnosticCodesAndMessages(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  const result = interpretPslDocumentToSqlContract({ ...baseInput, ...document });

  expect(result.ok).toBe(false);
  if (result.ok) return [];
  return result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

describe('legacy db attribute migration diagnostics', () => {
  it('recommends zero-argument and parameterized constructors for named types', () => {
    expect(
      diagnosticCodesAndMessages(`types {
  Id   = String @db.Uuid
  Slug = String @db.VarChar(191)
}

model Event {
  id Int @id
}
`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: '@db.Uuid is no longer supported; use Uuid in type position',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: '@db.VarChar(191) is no longer supported; use VarChar(191) in type position',
      },
    ]);
  });

  it('renders duplicate, malformed, named, and unknown arguments in source order', () => {
    expect(
      diagnosticCodesAndMessages(`types {
  Duplicate = String  @db.VarChar(10) @db.Char(2)
  BadScale  = Decimal @db.Numeric(10, -1)
  NamedArgs = Decimal @db.Numeric(scale: -1, precision: 10)
  Unknown   = String  @db.Unknown("raw", flag: true)
}

model Event {
  id Int @id
}
`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: '@db.VarChar(10) is no longer supported; use VarChar(10) in type position',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: '@db.Char(2) is no longer supported; use Char(2) in type position',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message: '@db.Numeric(10, -1) is no longer supported; use Numeric(10, -1) in type position',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          '@db.Numeric(scale: -1, precision: 10) is no longer supported; use Numeric(scale: -1, precision: 10) in type position',
      },
      {
        code: 'PSL_UNSUPPORTED_NAMED_TYPE_ATTRIBUTE',
        message:
          '@db.Unknown("raw", flag: true) is no longer supported; use Unknown("raw", flag: true) in type position',
      },
    ]);
  });

  it('recommends constructors for field-position db attributes', () => {
    expect(
      diagnosticCodesAndMessages(`model User {
  id   String @id @db.Uuid
  slug String @db.VarChar(191)
}
`),
    ).toEqual([
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: '@db.Uuid is no longer supported; use Uuid in type position',
      },
      {
        code: 'PSL_UNSUPPORTED_FIELD_ATTRIBUTE',
        message: '@db.VarChar(191) is no longer supported; use VarChar(191) in type position',
      },
    ]);
  });
});
