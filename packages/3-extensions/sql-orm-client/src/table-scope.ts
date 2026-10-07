import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ColumnRef, type TableSource } from '@internal/sql-relational-core/ast';
import { tableSourceForContract } from './storage-resolution';

const MAX_NAME_BYTES = 63;

export interface TableScope {
  name(preferred: string): string;
}

export interface TableStorageCoordinate {
  readonly namespaceId: string;
  readonly tableName: string;
}

export interface TableBinding {
  readonly reference: string;
  readonly storage: TableStorageCoordinate;
  column(name: string): ColumnRef;
  tableSource(contract: Contract<SqlStorage>): TableSource;
}

const encoder = new TextEncoder();

function shortenToBytes(value: string, maxBytes: number): string {
  let shortened = '';
  let bytes = 0;
  for (const character of value) {
    bytes += encoder.encode(character).length;
    if (bytes > maxBytes) {
      break;
    }
    shortened += character;
  }
  return shortened;
}

class TableScopeImpl implements TableScope {
  readonly #names = new Set<string>();

  name(preferred: string): string {
    for (let n = 1; ; n += 1) {
      const suffix = n === 1 ? '' : `_${n}`;
      const candidate = `${shortenToBytes(preferred, MAX_NAME_BYTES - suffix.length)}${suffix}`;
      if (!this.#names.has(candidate)) {
        this.#names.add(candidate);
        return candidate;
      }
    }
  }
}

export function createTableScope(): TableScope {
  return new TableScopeImpl();
}

export function bindTable(scope: TableScope, storage: TableStorageCoordinate): TableBinding {
  const reference = scope.name(storage.tableName);
  const coordinate = Object.freeze({ ...storage });
  return Object.freeze({
    reference,
    storage: coordinate,
    column: (name: string) => ColumnRef.of(reference, name),
    tableSource: (contract: Contract<SqlStorage>) =>
      tableSourceForContract(contract, coordinate.namespaceId, coordinate.tableName, reference),
  });
}
