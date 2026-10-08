import type { ContractToSchemaIROptions } from '@internal/family-sql/control';
import { contractNamespaceToSchemaIR } from '@internal/family-sql/control';
import type { SchemaNodeRef } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { namingOf } from '@internal/sql-schema-ir/naming';
import {
  PrimaryKey,
  RelationalSchemaNodeKind,
  SqlForeignKeyIR,
  SqlIndexIR,
  SqlUniqueIR,
} from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { postgresError } from '../errors';
import { FULL_TEXT_INDEX_TYPE, fullTextIndexDefinitionOf } from '../full-text-index-definition';
import { renderFullTextIndexDocument } from '../full-text-search-document';
import { postgresAccessMethodOf } from '../index-types';
import type { PostgresRlsPolicy } from '../postgres-rls-policy';
import type { PostgresContract } from '../postgres-schema';
import { isPostgresSchema } from '../postgres-schema';
import { PostgresDatabaseSchemaNode } from '../schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../schema-ir/postgres-native-enum-schema-node';
import { PostgresPolicySchemaNode } from '../schema-ir/postgres-policy-schema-node';
import { PostgresRoleSchemaNode } from '../schema-ir/postgres-role-schema-node';
import { PostgresTableSchemaNode } from '../schema-ir/postgres-table-schema-node';
import { PostgresSchemaNodeKind } from '../schema-ir/schema-node-kinds';
import { resolveDdlSchemaForNamespaceStorage } from './resolve-ddl-schema';

/** The database root's fixed sentinel id (`PostgresDatabaseSchemaNode#id`). */
function databaseStep(): { readonly nodeKind: string; readonly id: string } {
  return { nodeKind: PostgresSchemaNodeKind.database, id: 'database' };
}

function tableDependsOn(namespaceId: string, tableName: string): SchemaNodeRef {
  return [
    databaseStep(),
    { nodeKind: PostgresSchemaNodeKind.namespace, id: namespaceId },
    { nodeKind: PostgresSchemaNodeKind.table, id: tableName },
  ];
}

function roleDependsOn(role: string): SchemaNodeRef {
  return [databaseStep(), { nodeKind: PostgresSchemaNodeKind.role, id: role }];
}

/**
 * The chains from a table-child object (foreign key, index, unique, primary
 * key) to each of the own columns it is built on, in the Postgres tree.
 * Dropping a covered column auto-drops the object, so the object's drop must
 * precede the column's; the graph derives that direction from these edges.
 */
function columnDependsOn(
  namespaceId: string,
  tableName: string,
  columns: readonly string[],
): readonly SchemaNodeRef[] {
  return columns.map((column) => [
    ...tableDependsOn(namespaceId, tableName),
    { nodeKind: RelationalSchemaNodeKind.column, id: `column:${column}` },
  ]);
}

function toPolicyNode(policy: PostgresRlsPolicy, namespaceId: string): PostgresPolicySchemaNode {
  return new PostgresPolicySchemaNode({
    naming: namingOf(policy.name, policy.prefix),
    tableName: policy.tableName,
    namespaceId,
    operation: policy.operation,
    roles: [...policy.roles],
    using: policy.using,
    withCheck: policy.withCheck,
    permissive: policy.permissive,
    dependsOn: [tableDependsOn(namespaceId, policy.tableName), ...policy.roles.map(roleDependsOn)],
  });
}

/**
 * Projects a Postgres contract into the expected schema-diff tree: a
 * `PostgresDatabaseSchemaNode` root holding one `PostgresNamespaceSchemaNode`
 * per Postgres namespace, each holding its `PostgresTableSchemaNode`s with
 * their `PostgresPolicySchemaNode`s, plus the database roles on the root.
 *
 * Not a duplicate of the family's `contractToSchemaIR`: that builds a flat,
 * single `{ tables }` map (and throws on cross-namespace name collisions, with
 * no RLS/role concept) for SQLite's single-schema world. This is the
 * Postgres-specific *tree* shape — multi-schema, RLS-policy-aware, role-aware.
 * It reuses the family's per-namespace table conversion (`contractNamespaceToSchemaIR`)
 * for column/FK/index building and only adds the Postgres tree/policy/role shape.
 *
 * Tables are grouped by their owning namespace (resolved DDL schema name) so
 * the tree mirrors Postgres's object hierarchy. The DDL schema name is
 * resolved once per namespace.
 *
 * A policy that references a table absent from its namespace is a malformed
 * contract — the loop throws rather than fabricating a stub table.
 */
export function contractToPostgresDatabaseSchemaNode(
  contract: PostgresContract | null,
  options: ContractToSchemaIROptions,
): PostgresDatabaseSchemaNode {
  if (contract === null) {
    return new PostgresDatabaseSchemaNode({
      namespaces: {},
      roles: [],
      existingSchemas: [],
      pgVersion: '',
    });
  }

  const namespaces: Record<string, PostgresNamespaceSchemaNode> = {};
  const roles: PostgresRoleSchemaNode[] = [];
  const ownedSchemas: string[] = [];

  for (const ns of Object.values(contract.storage.namespaces)) {
    if (!isPostgresSchema(ns)) continue;

    // Role entries are root-level diff subjects: they hoist to the database
    // root from every slot and never count toward whether a namespace
    // materializes a schema node.
    for (const role of Object.values(ns.role)) {
      roles.push(new PostgresRoleSchemaNode({ name: role.name, namespaceId: role.namespaceId }));
    }

    // The unbound slot resolves its DDL schema to 'public', so it
    // materializes a schema node exactly when it has non-role content — a
    // late-binding contract keeps today's behavior (the slot carries the
    // tables), while a roles-only unbound slot alongside named namespaces
    // contributes only root roles and no node (which would otherwise be a
    // spurious empty 'public' node, clobbering a real bound 'public'
    // namespace's node keyed by the same resolved schema name).
    if (ns.id === UNBOUND_NAMESPACE_ID) {
      const hasNonRoleContent = Object.entries(ns.entries).some(
        ([entriesKey, slot]) => entriesKey !== 'role' && Object.keys(slot).length > 0,
      );
      if (!hasNonRoleContent) continue;
    }

    const ddlSchema = resolveDdlSchemaForNamespaceStorage(contract.storage, ns.id);
    ownedSchemas.push(ddlSchema);

    // Convert only THIS namespace's tables (passing the full storage for
    // type/value-set/enum resolution that spans namespaces), so the same table
    // name can exist in two schemas without colliding in a bare-keyed record.
    const sqlTables = contractNamespaceToSchemaIR(contract.storage, ns.id, options).tables;

    const policiesByTable = new Map<string, PostgresPolicySchemaNode[]>();
    for (const policy of Object.values(ns.policy)) {
      const list = policiesByTable.get(policy.tableName) ?? [];
      list.push(toPolicyNode(policy, ddlSchema));
      policiesByTable.set(policy.tableName, list);
    }

    const tables: Record<string, PostgresTableSchemaNode> = {};
    for (const tableName of Object.keys(ns.table)) {
      const sqlTable = sqlTables[tableName];
      if (sqlTable === undefined) continue;
      // The family conversion stamps `referencedSchema` only for bound FK
      // targets; an absent value means the FK targets the unbound namespace.
      // Postgres restores its own coordinate for that slot (the unbound
      // singleton's id) so the raw coordinate keeps qualifying REFERENCES
      // clauses, and resolves the real live DDL schema — introspected FKs
      // already carry the live schema, so this is what lets an expected FK
      // pair (by diff-node id) with its introspected counterpart.
      const foreignKeys = sqlTable.foreignKeys.map((fk) => {
        const resolvedReferencedNamespace = resolveDdlSchemaForNamespaceStorage(
          contract.storage,
          fk.referencedSchema ?? UNBOUND_NAMESPACE_ID,
        );
        return new SqlForeignKeyIR({
          columns: fk.columns,
          referencedTable: fk.referencedTable,
          referencedColumns: fk.referencedColumns,
          referencedSchema: fk.referencedSchema ?? UNBOUND_NAMESPACE_ID,
          ...ifDefined('name', fk.name),
          ...ifDefined('onDelete', fk.onDelete),
          ...ifDefined('onUpdate', fk.onUpdate),
          ...ifDefined('annotations', fk.annotations),
          resolvedReferencedNamespace,
          dependsOn: [
            tableDependsOn(resolvedReferencedNamespace, fk.referencedTable),
            ...columnDependsOn(ddlSchema, tableName, fk.columns),
          ],
        });
      });
      // The family stamped these children's own-column `dependsOn` with the
      // flat (single-schema) chain; the Postgres tree nests them under a
      // namespace, so re-stamp with the multi-schema chain that matches this
      // tree's paths. Every other field is carried through unchanged.
      const uniques = sqlTable.uniques.map(
        (u) =>
          new SqlUniqueIR({
            columns: u.columns,
            ...ifDefined('name', u.name),
            ...ifDefined('annotations', u.annotations),
            dependsOn: columnDependsOn(ddlSchema, tableName, u.columns),
          }),
      );
      const indexes = sqlTable.indexes.map((i) => {
        const fullText = fullTextIndexDefinitionOf(i);
        if (fullText !== undefined) {
          return new SqlIndexIR({
            naming: namingOf(i.name, i.prefix),
            where: i.where,
            unique: i.unique,
            partial: i.partial,
            type: postgresAccessMethodOf(FULL_TEXT_INDEX_TYPE),
            options: undefined,
            annotations: i.annotations,
            expression: renderFullTextIndexDocument(fullText),
            dependsOn: columnDependsOn(ddlSchema, tableName, fullText.weightGroups.flat()),
          });
        }
        const base = {
          naming: namingOf(i.name, i.prefix),
          where: i.where,
          unique: i.unique,
          partial: i.partial,
          type: i.type,
          options: i.options,
          annotations: i.annotations,
          // Expression indexes stamp chains to every column of the table —
          // the same over-approximation the family derivation uses.
          dependsOn: columnDependsOn(
            ddlSchema,
            tableName,
            i.columns ?? Object.keys(sqlTable.columns),
          ),
        };
        return new SqlIndexIR(
          i.expression !== undefined
            ? { ...base, expression: i.expression }
            : { ...base, columns: i.columns ?? [] },
        );
      });
      const primaryKey =
        sqlTable.primaryKey !== undefined
          ? new PrimaryKey({
              columns: sqlTable.primaryKey.columns,
              ...ifDefined('name', sqlTable.primaryKey.name),
              dependsOn: columnDependsOn(ddlSchema, tableName, sqlTable.primaryKey.columns),
            })
          : undefined;
      tables[tableName] = new PostgresTableSchemaNode({
        name: sqlTable.name,
        columns: sqlTable.columns,
        foreignKeys,
        uniques,
        indexes,
        ...ifDefined('primaryKey', primaryKey),
        ...ifDefined('annotations', sqlTable.annotations),
        ...ifDefined('checks', sqlTable.checks),
        policies: policiesByTable.get(tableName) ?? [],
        // Marker-driven, never derived from the policy set: the `rls` entry
        // is the single authored source of enablement.
        rlsEnabled: Object.hasOwn(ns.rls, tableName),
      });
    }

    for (const [tableName, tablePolicies] of policiesByTable) {
      if (!(tableName in tables)) {
        const policyName = tablePolicies[0]?.name ?? '(unknown)';
        throw postgresError(
          'CONTRACT.POLICY_INVALID',
          `contract-to-postgres-database-schema-node: policy "${policyName}" references table "${tableName}" not present in namespace "${ddlSchema}"`,
          { meta: { policyName, tableName, namespaceId: ddlSchema, reason: 'table-missing' } },
        );
      }
      if (!Object.hasOwn(ns.rls, tableName)) {
        const policyLabel = tablePolicies[0]?.prefix ?? tablePolicies[0]?.name ?? '(unknown)';
        throw postgresError(
          'CONTRACT.POLICY_INVALID',
          `contract-to-postgres-database-schema-node: policy "${policyLabel}" targets table "${tableName}" in namespace "${ddlSchema}", which is not RLS-controlled. Mark the model with @@rls (entries.rls["${tableName}"]) or remove the policy.`,
          {
            meta: {
              policyName: policyLabel,
              tableName,
              namespaceId: ddlSchema,
              reason: 'table-not-rls-controlled',
            },
          },
        );
      }
    }

    const nativeEnums = Object.values(ns.entries.native_enum ?? {}).map(
      (entity) =>
        new PostgresNativeEnumSchemaNode({
          typeName: entity.typeName,
          namespaceId: ddlSchema,
          members: entity.members,
          ...ifDefined('control', entity.control),
        }),
    );

    namespaces[ddlSchema] = new PostgresNamespaceSchemaNode({
      schemaName: ddlSchema,
      tables,
      nativeEnums,
    });
  }

  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles,
    existingSchemas: ownedSchemas,
    pgVersion: '',
  });
}
