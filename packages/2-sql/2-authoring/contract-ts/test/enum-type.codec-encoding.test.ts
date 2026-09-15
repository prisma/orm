import type { Contract, JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type CodecLookup,
  emptyCodecLookup,
} from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { buildSqlContractFromDefinition } from '../src/build-contract';
import type { ContractDefinition } from '../src/contract-definition';
import { enumType, member } from '../src/enum-type';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const pgText = { codecId: 'pg/text@1' as const, nativeType: 'text' } as const;
const pgInt = { codecId: 'pg/int4@1' as const, nativeType: 'int4' } as const;

function stubCodec(id: string, encodeJson: (value: unknown) => JsonValue): Codec {
  return {
    id,
    encodeJson: encodeJson as Codec['encodeJson'],
    decodeJson: ((json: JsonValue) => json) as Codec['decodeJson'],
    encode: (() => Promise.reject(new Error('unused'))) as Codec['encode'],
    decode: () => {
      throw new Error('unused');
    },
  };
}

function codecLookupOf(codecs: Record<string, Codec>): CodecLookup {
  return { ...emptyCodecLookup, get: (id: string) => codecs[id] };
}

function definitionWith(enumHandle: ReturnType<typeof enumType>): ContractDefinition {
  return {
    target: postgresTargetPack,
    createNamespace: createTestSqlNamespace,
    storageTypes: {},
    warnings: undefined,
    models: [],
    enums: { [enumHandle.enumName]: enumHandle },
  } as ContractDefinition;
}

function valueSetValues(contract: Contract<SqlStorage>, name: string): readonly JsonValue[] {
  const ns = contract.storage.namespaces['public'];
  return (ns !== undefined ? ns.entries.valueSet?.[name]?.values : undefined) ?? [];
}

function memberValues(contract: Contract<SqlStorage>, name: string): readonly JsonValue[] {
  const ns = contract.domain.namespaces['public'];
  return (ns?.enum?.[name]?.members ?? []).map((m) => m.value);
}

describe('enum lowering encodes member values through the codec', () => {
  it('text enum encodes members and value-set values as strings', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
    const codecLookup = codecLookupOf({
      'pg/text@1': stubCodec('pg/text@1', (v) => v as JsonValue),
    });

    const contract = buildSqlContractFromDefinition(definitionWith(Role), codecLookup);

    expect(valueSetValues(contract, 'Role')).toEqual(['user', 'admin']);
    expect(memberValues(contract, 'Role')).toEqual(['user', 'admin']);
  });

  it('int-backed enum keeps member and value-set values as numbers, not strings', () => {
    const Priority = enumType('Priority', pgInt, member('Low', 1), member('High', 10));
    const codecLookup = codecLookupOf({
      'pg/int4@1': stubCodec('pg/int4@1', (v) => v as JsonValue),
    });

    const contract = buildSqlContractFromDefinition(definitionWith(Priority), codecLookup);

    expect(valueSetValues(contract, 'Priority')).toEqual([1, 10]);
    expect(memberValues(contract, 'Priority')).toEqual([1, 10]);
  });

  it('routes each value through codec.encodeJson, not String()', () => {
    const Role = enumType('Role', pgText, member('User', 'user'), member('Admin', 'admin'));
    const codecLookup = codecLookupOf({
      'pg/text@1': stubCodec('pg/text@1', (v) => String(v).toUpperCase()),
    });

    const contract = buildSqlContractFromDefinition(definitionWith(Role), codecLookup);

    expect(valueSetValues(contract, 'Role')).toEqual(['USER', 'ADMIN']);
    expect(memberValues(contract, 'Role')).toEqual(['USER', 'ADMIN']);
  });
});
