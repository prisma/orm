import type { Contract, ControlPolicy } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { validateSqlContractFully } from '@internal/sql-contract/validators';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  createBuiltinLikeControlMutationDefaults,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();

function interpretSchema(schema: string) {
  const document = symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' });
  return interpretPslDocumentToSqlContract({
    ...document,
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    controlMutationDefaults: builtinControlMutationDefaults,
    createNamespace: createTestSqlNamespace,
    dataTypeLookup: fixtureDataTypeSupport.lookup,
    capabilities: { sql: { scalarList: true } },
  });
}

function expectDiagnostic(
  schema: string,
  diagnostic: { readonly code: string; readonly message: string },
): void {
  const result = interpretSchema(schema);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.failure.diagnostics).toEqual(
    expect.arrayContaining([expect.objectContaining(diagnostic)]),
  );
}

describe('@@control model attribute', () => {
  const policies = [
    'managed',
    'tolerated',
    'external',
    'observed',
  ] as const satisfies readonly ControlPolicy[];

  it('lowers each policy onto the storage table control field', () => {
    for (const policy of policies) {
      const result = interpretSchema(`model User {
  id Int @id
  @@control(${policy})
}`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const tables = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value));
      expect(tables['User']?.control).toBe(policy);
    }
  });

  it('omits control on the storage table when @@control is absent', () => {
    const result = interpretSchema(`model User {
  id Int @id
}`);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const tables = unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value));
    expect(tables['User']).not.toHaveProperty('control');
  });

  it('round-trips tolerated, external, and observed through JSON', () => {
    const cases = [
      { model: 'ToleratedThing', policy: 'tolerated' as const, table: 'tolerated_thing' },
      { model: 'ExternalThing', policy: 'external' as const, table: 'external_thing' },
      { model: 'ObservedThing', policy: 'observed' as const, table: 'observed_thing' },
    ] as const;

    for (const { model, policy, table } of cases) {
      const result = interpretSchema(`model ${model} {
  id Int @id
  @@map("${table}")
  @@control(${policy})
}`);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const envelope = JSON.parse(JSON.stringify(result.value)) as unknown;
      const roundTripped = validateSqlContractFully<Contract<SqlStorage>>(envelope);
      const tables = unboundTables(roundTripped.storage);
      expect(tables[table]?.control).toBe(policy);
    }
  });

  it('emits PSL_INVALID_ATTRIBUTE_SYNTAX when @@control has no argument', () => {
    expectDiagnostic(
      `model User {
  id Int @id
  @@control()
}`,
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "control" is missing required argument "policy"',
      },
    );
  });

  it('emits PSL_INVALID_ATTRIBUTE_SYNTAX when @@control has multiple positional arguments', () => {
    expectDiagnostic(
      `model User {
  id Int @id
  @@control(external, managed)
}`,
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "control" received too many positional arguments',
      },
    );
  });

  it('emits PSL_INVALID_ATTRIBUTE_SYNTAX when @@control argument is unknown', () => {
    expectDiagnostic(
      `model User {
  id Int @id
  @@control(invalid)
}`,
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected one of: managed | tolerated | external | observed',
      },
    );
  });

  it('emits PSL_DUPLICATE_ATTRIBUTE when @@control is declared twice', () => {
    expectDiagnostic(
      `model User {
  id Int @id
  @@control(external)
  @@control(managed)
}`,
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: '`@@control` declared more than once on model "User".',
      },
    );
  });

  it('emits PSL_DUPLICATE_ATTRIBUTE when a malformed @@control is followed by another', () => {
    expectDiagnostic(
      `model User {
  id Int @id
  @@control(invalid)
  @@control(managed)
}`,
      {
        code: 'PSL_DUPLICATE_ATTRIBUTE',
        message: '`@@control` declared more than once on model "User".',
      },
    );
  });

  it('emits PSL_INVALID_ATTRIBUTE_SYNTAX when @@control uses a named argument', () => {
    expectDiagnostic(
      `model User {
  id Int @id
  @@control(policy: external)
}`,
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "control" received unknown argument "policy"',
      },
    );
  });
});
