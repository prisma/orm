import {
  freezeNode,
  hydrateNamespaceEntities,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { blindCast } from '@internal/utils/casts';
import { composeSqlEntityKinds } from '../src/entity-kinds';
import {
  SqlNamespaceBase,
  type SqlNamespaceEntries,
  type SqlNamespaceInput,
} from '../src/ir/sql-storage';
import type { StorageTable } from '../src/ir/storage-table';
import type { StorageValueSet } from '../src/ir/storage-value-set';

/**
 * Minimal concrete `SqlNamespaceBase` for use in `packages/2-sql-family/**` unit tests.
 *
 * This is a legitimate target concretion — not a materialised family
 * namespace.  Production code never constructs one; the target-specific
 * concretions (`PostgresSchema`, `SqliteDatabase`) are used in production.
 */
export class TestSqlNamespace extends SqlNamespaceBase {
  declare readonly kind: 'test-sql-namespace';
  readonly id: string;
  readonly entries: SqlNamespaceEntries;

  constructor(input: SqlNamespaceInput) {
    super();
    this.id = input.id;
    const dispatched = hydrateNamespaceEntities(input.entries, composeSqlEntityKinds(), 'carry');
    this.entries = Object.freeze(
      blindCast<
        SqlNamespaceEntries,
        'composeSqlEntityKinds() supplies table→StorageTable and valueSet→StorageValueSet descriptors'
      >(dispatched),
    );
    Object.defineProperty(this, 'kind', {
      value: 'test-sql-namespace',
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
  }

  get valueSet(): Readonly<Record<string, StorageValueSet>> | undefined {
    return this.entries.valueSet;
  }

  qualifyTable(tableName: string): string {
    if (this.id === UNBOUND_NAMESPACE_ID) {
      return `"${tableName}"`;
    }
    return `"${this.id}"."${tableName}"`;
  }
}

export function createTestSqlNamespace(input: SqlNamespaceInput): TestSqlNamespace {
  return new TestSqlNamespace(input);
}
