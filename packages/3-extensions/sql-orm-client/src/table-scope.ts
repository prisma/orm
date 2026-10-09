import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ColumnRef, type TableSource } from '@internal/sql-relational-core/ast';
import { tableSourceForContract } from './storage-resolution';

const MAX_ALIAS_BYTES = 63;

export interface TableStorageCoordinate {
  readonly namespaceId: string;
  readonly tableName: string;
}

export interface AliasedTable {
  readonly alias: string;
  readonly storage: TableStorageCoordinate;
  column(name: string): ColumnRef;
  tableSource(contract: Contract<SqlStorage>): TableSource;
}

export interface TableScope {
  alias(preferred: string): string;
  aliasTable(storage: TableStorageCoordinate): AliasedTable;
  copy(): TableScope;
  merge(others: readonly TableScope[]): TableScope;
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
  readonly #aliases: Set<string>;

  constructor(aliases: Iterable<string> = []) {
    this.#aliases = new Set(aliases);
  }

  alias(preferred: string): string {
    for (let n = 1; ; n += 1) {
      const suffix = n === 1 ? '' : `_${n}`;
      const candidate = `${shortenToBytes(preferred, MAX_ALIAS_BYTES - suffix.length)}${suffix}`;
      if (!this.#aliases.has(candidate)) {
        this.#aliases.add(candidate);
        return candidate;
      }
    }
  }

  aliasTable(storage: TableStorageCoordinate): AliasedTable {
    const alias = this.alias(storage.tableName);
    const coordinate = Object.freeze({ ...storage });
    return Object.freeze({
      alias,
      storage: coordinate,
      column: (name: string) => ColumnRef.of(alias, name),
      tableSource: (contract: Contract<SqlStorage>) =>
        tableSourceForContract(contract, coordinate.namespaceId, coordinate.tableName, alias),
    });
  }

  copy(): TableScope {
    return new TableScopeImpl(this.#aliases);
  }

  merge(others: readonly TableScopeImpl[]): TableScope {
    return new TableScopeImpl([this, ...others].flatMap((scope) => [...scope.#aliases]));
  }
}

export function createTableScope(): TableScope {
  return new TableScopeImpl();
}
