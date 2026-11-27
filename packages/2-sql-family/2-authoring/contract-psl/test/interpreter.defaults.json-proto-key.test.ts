import { canonicalizeContractToObject } from '@internal/contract/hashing';
import { normalizeSqlStorage } from '@internal/sql-contract/canonicalization-hooks';
import { castAs } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureTypeLookups } from './fixture-codec-descriptors';
import { fixtureDataTypeSupport } from './fixture-data-types';
import { fixtureGeneratorFunctions } from './fixture-generator-functions';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresNativeScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';

function contractWithDefault(json: string) {
  const result = interpretSqlContract(
    `model Lit {\n  id Int @id\n  meta Jsonb @default(json\`${json}\`)\n}\n`,
    {
      target: postgresTarget,
      scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
      controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
      generatorFunctions: fixtureGeneratorFunctions,
      codecLookup: fixtureTypeLookups.codecLookup,
      dataTypes: {
        entries: fixtureDataTypeSupport.entries,
        lookup: fixtureTypeLookups.dataTypeLookup,
        dataTypeOfCodec: () => undefined,
      },
    },
  );
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value;
}

function canonicalDefault(json: string): unknown {
  const canonical = canonicalizeContractToObject(contractWithDefault(json), {
    serializeContract: (contract) => castAs<JsonObject>(JSON.parse(JSON.stringify(contract))),
    normalizeStorage: normalizeSqlStorage,
  });
  const storage = canonical['storage'] as {
    namespaces: Record<
      string,
      { entries: { table: Record<string, { columns: Record<string, { default: unknown }> }> } }
    >;
  };
  return storage.namespaces['public']?.entries.table['Lit']?.columns['meta']?.default;
}

describe('a JSON column default holding a key named __proto__', () => {
  const written = '{ "__proto__": { "x": 1 }, "a": 2 }';

  it('keeps the key in the contract the interpreter builds', () => {
    const columnDefault = sqlStorageFromSuccessfulSqlInterpretation(contractWithDefault(written))
      .namespaces['public']?.entries.table?.['Lit']?.columns['meta']?.default;
    const value = columnDefault?.kind === 'literal' ? columnDefault.value : undefined;
    expect({
      ownProto: Object.getOwnPropertyDescriptor(value ?? {}, '__proto__')?.value,
      keys: Object.keys(value ?? {}),
    }).toEqual({ ownProto: { x: 1 }, keys: ['__proto__', 'a'] });
  });

  it('keeps the key in the canonical contract', () => {
    expect(JSON.stringify(canonicalDefault(written))).toBe(
      JSON.stringify({ kind: 'literal', value: JSON.parse('{ "__proto__": { "x": 1 }, "a": 2 }') }),
    );
  });

  it('hashes what the key holds into the storage hash', () => {
    expect(contractWithDefault(written).storage.storageHash).not.toBe(
      contractWithDefault('{ "__proto__": { "x": 2 }, "a": 2 }').storage.storageHash,
    );
  });
});
