import type { Contract } from '@internal/contract/types';
import { runtimeError } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { CodecDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';

export function extractCodecIds(contract: Contract<SqlStorage>): Set<string> {
  const codecIds = new Set<string>();

  for (const ns of Object.values(contract.storage.namespaces)) {
    for (const table of Object.values(ns.entries.table ?? {})) {
      for (const column of Object.values(table.columns)) {
        const codecId = column.codecId;
        codecIds.add(codecId);
      }
    }
  }

  return codecIds;
}

type ColumnCodecRef = {
  readonly namespaceId: string;
  readonly table: string;
  readonly column: string;
  readonly codecId: string;
};

function extractColumnCodecRefs(contract: Contract<SqlStorage>): ColumnCodecRef[] {
  const refs: ColumnCodecRef[] = [];

  for (const [namespaceId, ns] of Object.entries(contract.storage.namespaces)) {
    for (const [tableName, table] of Object.entries(ns.entries.table ?? {})) {
      for (const [columnName, column] of Object.entries(table.columns)) {
        refs.push({ namespaceId, table: tableName, column: columnName, codecId: column.codecId });
      }
    }
  }

  return refs;
}

export function validateContractCodecMappings(
  registry: CodecDescriptorRegistry,
  contract: Contract<SqlStorage>,
): void {
  const invalidCodecs = extractColumnCodecRefs(contract).filter(
    (ref) => registry.descriptorFor(ref.codecId) === undefined,
  );

  if (invalidCodecs.length > 0) {
    const details: Record<string, unknown> = {
      contractTarget: contract.target,
      invalidCodecs,
    };

    throw runtimeError(
      'RUNTIME.CODEC_MISSING',
      `Missing codec implementations for column codecIds: ${invalidCodecs.map((c) => `${c.namespaceId}.${c.table}.${c.column} (${c.codecId})`).join(', ')}`,
      details,
    );
  }
}

export function validateCodecRegistryCompleteness(
  registry: CodecDescriptorRegistry,
  contract: Contract<SqlStorage>,
): void {
  validateContractCodecMappings(registry, contract);
}
