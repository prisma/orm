import { applySpecifierDefaultControlPolicy } from '@internal/contract/apply-specifier-default-control-policy';
import { computeStorageHash } from '@internal/contract/hashing';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { effectiveControlPolicy } from '@internal/contract/types';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import {
  checkConstraintInputFromSerialized,
  isMaterializedSqlNamespace,
  type SqlNamespaceBase,
  type SqlNamespaceInput,
  SqlStorage,
  StorageTable,
} from '@internal/sql-contract/types';
import { derivedCheckPrefixes } from '@internal/sql-schema-ir/naming';
import { invariant } from '@internal/utils/assertions';
import { ifDefined } from '@internal/utils/defined';

/**
 * Creates a namespace of the caller's target concretion. Same shape as the
 * `createNamespace` a contract specifier already threads through.
 */
export type SqlNamespaceFactory = (input: SqlNamespaceInput) => SqlNamespaceBase;

/**
 * The one step every SQL contract specifier funnels its loaded contract
 * through: stamp the specifier's default control policy, then strip derived
 * checks from every table the stamped policy leaves non-managed. Composing the
 * two here is what keeps the managed-only consequence from being skipped on
 * any specifier route.
 */
export function applySqlSpecifierControlPolicy(
  contract: Contract,
  defaultControlPolicy: ControlPolicy | undefined,
  createNamespace: SqlNamespaceFactory,
): Contract {
  return stripDerivedChecksFromNonManagedTables(
    applySpecifierDefaultControlPolicy(contract, defaultControlPolicy),
    createNamespace,
  );
}

/**
 * Removes generated enforcement checks from every table whose effective
 * control policy is not `managed`.
 *
 * A check is derived iff its wire prefix is one derivation would produce for
 * some column of its table — {@link derivedCheckPrefixes} enumerates that
 * set. Wire-naming alone no longer identifies derivation: an authored
 * `name:` check (`@@check` / `check()`) is wire-named too, so a bare
 * `check.prefix === undefined` test would delete an author's own constraint
 * from every non-`managed` table. The prefix-shape rule tests against the
 * table's own columns instead of the naming mode, so an authored check with
 * an unrelated prefix survives.
 *
 * The rule is weaker than recomputing the content hash `contract infer`
 * uses: that needs `postgresRenderCheckExpressions` to know what a kind
 * renders, and this funnel has no target descriptor to reach it through. It
 * can only ask whether some column could have produced a prefix of this
 * shape, not whether this exact column produced this exact check. The gap
 * that opens — an authored name that collides with a derived-prefix shape —
 * is closed at authoring time instead: such a name is rejected
 * (`CONTRACT.CHECK_NAME_RESERVED`) before it ever reaches storage.
 *
 * Why derivation stops at the namespace boundary: the contract *describes* an
 * external schema, it does not *prescribe* enforcement for it. Deriving a check
 * for a table Prisma 8 never creates declares a constraint the live database
 * has no reason to carry, and `external` fails verify on a declared shape the
 * database lacks — an unfixable failure, since no plan may emit DDL there
 * either.
 *
 * This is the post-build half of the rule. Authoring skips derivation for a
 * table whose policy is known in the source; this pass catches the policy a
 * contract *specifier* applies after the contract is already built, which is
 * the only signal a pack like the Supabase extension gives. Specifiers reach
 * it through `applySqlSpecifierControlPolicy` above.
 *
 * Returns the contract unchanged (same reference) when nothing is stripped.
 * When something is, the storage hash is recomputed — the stripped contract
 * describes different storage.
 */
export function stripDerivedChecksFromNonManagedTables(
  contract: Contract,
  createNamespace: SqlNamespaceFactory,
): Contract {
  const storage = contract.storage;
  if (!isSqlStorageShaped(storage)) return contract;

  let anyStripped = false;
  const namespaces: Record<string, SqlNamespaceBase> = {};

  for (const [namespaceId, namespace] of Object.entries(storage.namespaces)) {
    // A namespace that is still JSON-shaped cannot be rebuilt through the
    // target factory, and a built contract never holds one.
    if (!isMaterializedSqlNamespace(namespace)) return contract;
    const tables = namespace.entries['table'];
    if (tables === undefined) {
      namespaces[namespaceId] = namespace;
      continue;
    }

    let namespaceStripped = false;
    const nextTables: Record<string, StorageTable> = {};
    for (const [tableName, table] of Object.entries(tables)) {
      const stripped = StorageTable.is(table)
        ? withoutDerivedChecks(tableName, table, contract.defaultControlPolicy)
        : table;
      if (stripped !== table) namespaceStripped = true;
      nextTables[tableName] = stripped;
    }

    if (!namespaceStripped) {
      namespaces[namespaceId] = namespace;
      continue;
    }
    anyStripped = true;
    namespaces[namespaceId] = createNamespace({
      id: namespace.id,
      entries: { ...namespace.entries, table: nextTables },
    });
  }

  if (!anyStripped) return contract;

  const storageWithoutHash = {
    namespaces,
    ...ifDefined('types', storage.types),
  };
  return {
    ...contract,
    storage: new SqlStorage({
      ...storageWithoutHash,
      storageHash: computeStorageHash({
        target: contract.target,
        targetFamily: contract.targetFamily,
        storage: storageWithoutHash,
        ...sqlContractCanonicalizationHooks,
      }),
    }),
  };
}

/**
 * Structural stand-in for `instanceof SqlStorage`: like the checks it wraps, a
 * storage instance can arrive from a realm whose IR classes are a separate
 * copy (the dist e2e shape), where an `instanceof` test would miss.
 */
function isSqlStorageShaped(x: unknown): x is SqlStorage {
  if (typeof x !== 'object' || x === null || !('namespaces' in x)) return false;
  return typeof x.namespaces === 'object' && x.namespaces !== null;
}

/** The table itself when it keeps every check, a rebuilt one when it does not. */
function withoutDerivedChecks(
  tableName: string,
  table: StorageTable,
  contractDefault: ControlPolicy | undefined,
): StorageTable {
  const checks = table.checks;
  if (checks === undefined || checks.length === 0) return table;
  if (effectiveControlPolicy(table.control, contractDefault) === 'managed') return table;

  const columnNames = Object.keys(table.columns);
  invariant(
    columnNames.length > 0,
    `withoutDerivedChecks: table "${tableName}" carries checks but its column map is empty. The caller must pass the table's real, complete column set — an empty or partial map makes every check misclassify as non-derived and survive the strip.`,
  );
  const derivedPrefixes = derivedCheckPrefixes(tableName, columnNames);
  const kept = checks.filter(
    (check) => check.prefix === undefined || !derivedPrefixes.has(check.prefix),
  );
  if (kept.length === checks.length) return table;

  return new StorageTable({
    columns: table.columns,
    uniques: table.uniques,
    indexes: table.indexes,
    foreignKeys: table.foreignKeys,
    ...ifDefined('primaryKey', table.primaryKey),
    ...ifDefined('control', table.control),
    // Rebuilt from the flat form rather than handed back as instances: a
    // contract can arrive from a realm whose IR classes are a separate copy
    // (the dist e2e shape), where an `instanceof` normalization would miss.
    ...(kept.length > 0
      ? {
          checks: kept.map((check) =>
            checkConstraintInputFromSerialized({
              name: check.name,
              ...ifDefined('prefix', check.prefix),
              expression: check.expression,
            }),
          ),
        }
      : {}),
  });
}
