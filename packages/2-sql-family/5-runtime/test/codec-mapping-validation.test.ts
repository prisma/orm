import type { Contract } from '@internal/contract/types';
import { coreHash, profileHash } from '@internal/contract/types';
import type { CodecDescriptor } from '@internal/framework-components/codec';
import type { SqlNamespace, SqlStorage } from '@internal/sql-contract/types';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../1-core/contract/test/test-support';
import { extractCodecIds, validateContractCodecMappings } from '../src/codecs/validation';

const DATA_TYPE_OF_CODEC: Readonly<Record<string, string>> = {
  'ext/missing@1': 'ext/missing',
  'pg/text@1': 'pg/text',
};

function dataTypeOf(codecId: string): string {
  const dataType = DATA_TYPE_OF_CODEC[codecId];
  if (dataType === undefined) throw new Error(`no data type listed for codec ${codecId}`);
  return dataType;
}

function registryWith(...codecIds: string[]): CodecDescriptorRegistry {
  const descriptors = new Map(
    codecIds.map((id) => [id, { codecId: id } as CodecDescriptor<unknown>]),
  );
  return {
    descriptorFor: (codecId) => descriptors.get(codecId),
    codecRefForColumn: () => undefined,
    values: () => descriptors.values(),
  };
}

function tableWithColumn(codecId: string) {
  return {
    columns: { value: { dataType: dataTypeOf(codecId), codecId } },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

function contractWithNamespaces(namespaces: Record<string, SqlNamespace>): Contract<SqlStorage> {
  return {
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: profileHash('test'),
    roots: {},
    storage: { storageHash: coreHash('test'), namespaces },
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
  } as Contract<SqlStorage>;
}

describe('validateContractCodecMappings', () => {
  it('passes when every column codec is registered', () => {
    const contract = contractWithNamespaces({
      app: createTestSqlNamespace({
        id: 'app',
        entries: { table: { docs: tableWithColumn('pg/text@1') } },
      }),
    });
    expect(() => validateContractCodecMappings(registryWith('pg/text@1'), contract)).not.toThrow();
  });

  it('reports a missing codec even when another namespace has the same table.column with a registered codec', () => {
    const contract = contractWithNamespaces({
      app: createTestSqlNamespace({
        id: 'app',
        entries: { table: { docs: tableWithColumn('pg/text@1') } },
      }),
      analytics: createTestSqlNamespace({
        id: 'analytics',
        entries: { table: { docs: tableWithColumn('ext/missing@1') } },
      }),
    });
    expect(() => validateContractCodecMappings(registryWith('pg/text@1'), contract)).toThrow(
      /analytics\.docs\.value \(ext\/missing@1\)/,
    );
  });

  it('passes when a namespace has no table entries at all', () => {
    const contract = contractWithNamespaces({
      app: createTestSqlNamespace({ id: 'app', entries: {} }),
    });
    expect(() => validateContractCodecMappings(registryWith(), contract)).not.toThrow();
  });
});

describe('extractCodecIds', () => {
  it('returns an empty set for a contract with no tables', () => {
    const contract = contractWithNamespaces({
      app: createTestSqlNamespace({ id: 'app', entries: {} }),
    });
    expect(extractCodecIds(contract)).toEqual(new Set());
  });

  it('collects codec ids across all columns and tables', () => {
    const contract = contractWithNamespaces({
      app: createTestSqlNamespace({
        id: 'app',
        entries: { table: { docs: tableWithColumn('pg/text@1') } },
      }),
    });
    expect(extractCodecIds(contract)).toEqual(new Set(['pg/text@1']));
  });

  it('deduplicates repeated codec ids across namespaces', () => {
    const contract = contractWithNamespaces({
      app: createTestSqlNamespace({
        id: 'app',
        entries: { table: { docs: tableWithColumn('pg/text@1') } },
      }),
      analytics: createTestSqlNamespace({
        id: 'analytics',
        entries: { table: { events: tableWithColumn('pg/text@1') } },
      }),
    });
    expect(extractCodecIds(contract)).toEqual(new Set(['pg/text@1']));
  });
});
