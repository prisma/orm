import {
  freezeNode,
  hydrateNamespaceEntities,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import { tableEntityKind } from '@internal/sql-contract/entity-kinds';
import {
  SqlNamespaceBase,
  type SqlNamespaceEntries,
  type SqlNamespaceInput,
  type StorageTable,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { sqliteError } from './errors';
import { quoteIdentifier } from './sql-utils';

export type SqliteDatabaseInput = {
  readonly id: string;
  readonly entries: SqlNamespaceEntries;
};

const SQLITE_NAMESPACE_KIND = 'sqlite-namespace' as const;

/**
 * SQLite namespace concretion carrying table metadata under
 * `entries.table` and unqualified `qualifyTable()` emission for runtime
 * SQL rendering.
 */
export class SqliteDatabase extends SqlNamespaceBase {
  declare readonly kind: string;

  readonly id: string;
  readonly entries: SqlNamespaceEntries;

  constructor(input: SqliteDatabaseInput) {
    super();
    this.id = input.id;

    const dispatched = hydrateNamespaceEntities(
      input.entries,
      new Map([['table', tableEntityKind]]),
      'carry',
    );

    this.entries = Object.freeze(
      blindCast<
        SqlNamespaceEntries,
        "SQLite's table-only descriptor map hydrates table→StorageTable and carries every other kind raw, so this open-dict result satisfies SqlNamespaceEntries; the descriptor Map erases the per-kind Node type from the return."
      >(dispatched),
    );
    Object.defineProperty(this, 'kind', {
      value: SQLITE_NAMESPACE_KIND,
      writable: false,
      enumerable: false,
      configurable: true,
    });
    freezeNode(this);
  }

  get table(): Readonly<Record<string, StorageTable>> {
    return this.entries.table ?? Object.freeze({});
  }

  qualifier(): string {
    return '';
  }

  qualifyTable(tableName: string): string {
    return quoteIdentifier(tableName);
  }
}

/**
 * SQLite target `Namespace` concretion. SQLite has no schema or
 * database-namespacing concept at the SQL level — there is exactly one
 * effective namespace per connection, so the target ships a single
 * singleton bound to the framework's `UNBOUND_NAMESPACE_ID` slot.
 *
 * Qualifier emission elides the prefix entirely: rendered DDL and
 * queries look unqualified (`CREATE TABLE "users" (...)`), matching
 * SQLite's native dialect. Call sites stay polymorphic — they ask the
 * namespace for its qualifier and consume the empty/unqualified result
 * the same way Postgres consumes a `"schema"` prefix.
 *
 * The SQLite PSL interpreter rejects every explicit `namespace { … }`
 * block with a diagnostic naming SQLite; only the implicit
 * `__unspecified__` AST bucket reaches the SQLite interpreter, which
 * lowers it to this singleton.
 */
export class SqliteUnboundDatabase extends SqliteDatabase {
  static readonly instance: SqliteUnboundDatabase = new SqliteUnboundDatabase();

  private constructor() {
    super({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
  }
}

/**
 * The SQLite target's rejection of expression and partial indexes: the
 * family-shared authoring surfaces parse `expression:`/`where:` for every
 * SQL target, but SQLite neither renders nor introspects them (project
 * non-goal) — a contract carrying one must fail loudly at lowering instead
 * of silently producing an unverifiable index. Target-owned so no family
 * code branches on the target.
 */
function rejectSqlBodyIndexes(input: SqlNamespaceInput): void {
  const tables = input.entries['table'];
  if (tables === undefined) return;
  for (const [tableName, table] of Object.entries(tables)) {
    const indexes = blindCast<
      { readonly indexes?: readonly { name?: string; expression?: string; where?: string }[] },
      'namespace table entries are StorageTable/StorageTableInput shapes; only the index list is read here'
    >(table).indexes;
    for (const index of indexes ?? []) {
      if (index.expression !== undefined || index.where !== undefined) {
        throw sqliteError(
          'CONTRACT.ARGUMENT_INVALID',
          `SQLite does not support expression or partial indexes: index "${index.name ?? '<unnamed>'}" on table "${tableName}" declares ${index.expression !== undefined ? 'an expression' : 'a where predicate'}. Use a fields-only index, or author this index against a Postgres target.`,
        );
      }
    }
  }
}

export function buildSqliteNamespace(
  input: SqlNamespaceInput,
): SqliteDatabase | SqliteUnboundDatabase {
  rejectSqlBodyIndexes(input);
  if (input.id !== UNBOUND_NAMESPACE_ID) {
    throw sqliteError(
      'CONTRACT.NAMESPACE_INVALID',
      `buildSqliteNamespace: SQLite has no schema concept; the only valid namespace id is "${UNBOUND_NAMESPACE_ID}" (received "${input.id}").`,
      { meta: { received: input.id } },
    );
  }
  const tableKind = input.entries['table'];
  const tableCount = tableKind !== undefined ? Object.keys(tableKind).length : 0;
  const hasUnknownKinds = Object.keys(input.entries).some((kind) => kind !== 'table');
  if (tableCount === 0 && !hasUnknownKinds) {
    return SqliteUnboundDatabase.instance;
  }
  return new SqliteDatabase({ id: input.id, entries: input.entries });
}

/**
 * Target-supplied `Namespace` factory the SQLite target plumbs through
 * `defineContract({ createNamespace })`. SQLite has only one
 * effective namespace slot — the framework `UNBOUND_NAMESPACE_ID`
 * sentinel — so the factory always returns the singleton or a fresh
 * `SqliteDatabase` for the unbound slot with tables. The SQL family's
 * defensive validation in `defineContract` already rejects
 * user-declared SQLite namespaces, so this throw is a structural
 * safety net rather than a user-facing surface.
 */
export function sqliteCreateNamespace(
  input: SqlNamespaceInput,
): SqliteDatabase | SqliteUnboundDatabase {
  return buildSqliteNamespace(input);
}
