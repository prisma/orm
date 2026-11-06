import type { SqlDescribedContractSpace } from '@internal/family-sql/control';
import type { RelationField } from '@internal/family-sql/psl-infer';
import { buildChildRelationField, deriveRelationFieldName } from '@internal/family-sql/psl-infer';
import { coordinateKey, elementCoordinates } from '@internal/framework-components/ir';
import type { SqlModelStorage } from '@internal/sql-contract/types';
import type { SqlForeignKeyIR } from '@internal/sql-schema-ir/types';
import { SqlTableIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { postgresError } from '../errors';
import {
  type ResolvedColumnFieldName,
  resolveColumnFieldName,
  type TableColumnFieldNameMap,
} from './infer-names';

/**
 * Coordinates every element a set of already-assembled contracts declare,
 * mapped to the {@link SqlDescribedContractSpace} that owns it and keyed by
 * the shared {@link coordinateKey} helper. `contract infer` uses this to omit
 * database elements a stack extension pack's contract space already
 * describes — reusing the same coordinate walk the contract-space aggregate
 * and cross-space collision check use (`elementCoordinates`), rather than a
 * bespoke per-entity-kind membership test — and, for a foreign key whose
 * referenced table an entry owns, to resolve the qualified cross-space
 * relation it describes.
 */
export function describedContractOwners(
  describedContracts: readonly SqlDescribedContractSpace[],
): ReadonlyMap<string, SqlDescribedContractSpace> {
  const owners = new Map<string, SqlDescribedContractSpace>();
  for (const entry of describedContracts) {
    for (const coordinate of elementCoordinates(entry.contract.storage)) {
      owners.set(coordinateKey(coordinate), entry);
    }
  }
  return owners;
}

/**
 * The domain model a described contract maps a `(namespaceId, tableName)`
 * storage coordinate to, plus the pack's own space id and column→field-name
 * mapping — everything `buildModel`/`buildRelationField` need to emit the
 * cross-space relation `<spaceId>:<namespaceId>.<modelName>` and resolve its
 * `references` argument to the pack's own field names rather than a generic
 * column-name guess.
 */
type CrossSpaceTarget = {
  readonly spaceId: string;
  readonly namespaceId: string;
  readonly modelName: string;
  readonly fieldNamesByColumn: TableColumnFieldNameMap;
};

function resolveCrossSpaceTarget(
  owner: SqlDescribedContractSpace,
  namespaceId: string,
  tableName: string,
): CrossSpaceTarget | undefined {
  const domainNamespace = owner.contract.domain.namespaces[namespaceId];
  if (domainNamespace === undefined) {
    return undefined;
  }

  for (const [modelName, model] of Object.entries(domainNamespace.models)) {
    const storage = blindCast<SqlModelStorage, 'SQL contract model storage'>(model.storage);
    if (storage.namespaceId !== namespaceId || storage.table !== tableName) {
      continue;
    }

    const fieldNamesByColumn = new Map<string, ResolvedColumnFieldName>();
    for (const [fieldName, fieldStorage] of Object.entries(storage.fields)) {
      fieldNamesByColumn.set(fieldStorage.column, { fieldName });
    }

    return { spaceId: owner.spaceId, namespaceId, modelName, fieldNamesByColumn };
  }

  return undefined;
}

export type ForeignKeyResolution = {
  /** `tables`, with every cross-space or dangling foreign key removed. */
  readonly tables: Record<string, SqlTableIR>;
  /** Cross-space relation fields to merge onto `inferRelations`'s output, keyed by host table name. */
  readonly extraRelationsByTable: ReadonlyMap<string, readonly RelationField[]>;
  /** Synthetic field-name maps for cross-space-referenced pack tables, merged into `fieldNamesByTable`. */
  readonly crossSpaceFieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>;
  /** Dangling foreign keys dropped per host table, kept so the model can explain the drop. */
  readonly danglingForeignKeysByTable: ReadonlyMap<string, readonly DanglingForeignKeyInfo[]>;
};

/** A foreign key dropped because its target lives outside the introspected scope. */
export type DanglingForeignKeyInfo = {
  readonly columns: readonly string[];
  readonly referencedSchema: string | undefined;
  readonly referencedTable: string;
};

/**
 * Classifies every foreign key on a surviving table into one of three cases.
 * A foreign key that carries a `referencedSchema` is checked against the
 * pack-owned coordinates first, so a pack-owned target wins even when a local
 * table happens to share its bare name; only foreign keys with no owned
 * coordinate fall through to the local/dangling distinction.
 *
 * - **Cross-space**: `referencedSchema` is set and a described contract owns
 *   the coordinate `(referencedSchema, 'table', referencedTable)`. The
 *   referenced table is absent from the tree (omitted because the pack
 *   describes it, or never introspected — `contract infer` walks a single
 *   namespace). Removed from `foreignKeys` (so `inferRelations` never falls
 *   back to a bare, unqualified table name for it) and replaced with a
 *   `RelationField` qualified with the owning pack's space id and namespace
 *   id. `owners` holds only pack-declared coordinates, so an app's own table
 *   (e.g. `public.users`) is never owned and cannot be captured here.
 * - **Local**: not a pack-owned coordinate, and the referenced table survived
 *   introspection — left untouched, `inferRelations` handles it as before.
 * - **Dangling**: not a pack-owned coordinate, and the referenced table is
 *   neither in the tree nor owned by any described contract. Removed from
 *   `foreignKeys`, keeping the scalar column, rather than emitting a relation
 *   to a model that was never defined.
 *
 * A pack that owns the referenced coordinate but declares no domain model
 * mapped to it is malformed; that case throws rather than degrading to a
 * silent drop, which would contradict the dangling definition above.
 */
export function resolveForeignKeys(
  tables: Readonly<Record<string, SqlTableIR>>,
  owners: ReadonlyMap<string, SqlDescribedContractSpace>,
): ForeignKeyResolution {
  const resultTables: Record<string, SqlTableIR> = {};
  const extraRelationsByTable = new Map<string, RelationField[]>();
  const crossSpaceFieldNamesByTable = new Map<string, TableColumnFieldNameMap>();
  const danglingForeignKeysByTable = new Map<string, DanglingForeignKeyInfo[]>();

  for (const [tableName, table] of Object.entries(tables)) {
    const keptForeignKeys: SqlForeignKeyIR[] = [];

    for (const fk of table.foreignKeys) {
      if (fk.referencedSchema !== undefined) {
        const owner = owners.get(
          coordinateKey({
            namespaceId: fk.referencedSchema,
            entityKind: 'table',
            entityName: fk.referencedTable,
          }),
        );
        if (owner !== undefined) {
          const target = resolveCrossSpaceTarget(owner, fk.referencedSchema, fk.referencedTable);
          if (target === undefined) {
            throw postgresError(
              'CONTRACT.PACK_CONTRIBUTION_INVALID',
              `contract infer: described contract space "${owner.spaceId}" owns storage ` +
                `coordinate "${fk.referencedSchema}.${fk.referencedTable}" but declares no ` +
                'domain model mapped to it. A pack that describes a table must also declare the ' +
                'domain model it maps to; this pack is malformed.',
              { meta: { spaceId: owner.spaceId, tableName: fk.referencedTable } },
            );
          }

          if (!crossSpaceFieldNamesByTable.has(fk.referencedTable)) {
            crossSpaceFieldNamesByTable.set(fk.referencedTable, target.fieldNamesByColumn);
          }

          const fieldName = deriveRelationFieldName(fk.columns, fk.referencedTable);
          const optional = fk.columns.some(
            (columnName) => table.columns[columnName]?.nullable ?? false,
          );
          const relationField: RelationField = {
            ...buildChildRelationField(fieldName, target.modelName, fk, optional, undefined, table),
            typeNamespaceId: target.namespaceId,
            typeContractSpaceId: target.spaceId,
          };

          const existingRelations = extraRelationsByTable.get(tableName);
          if (existingRelations) {
            existingRelations.push(relationField);
          } else {
            extraRelationsByTable.set(tableName, [relationField]);
          }
          continue;
        }
      }

      // Not a pack-owned coordinate: keep the foreign key if the referenced
      // table survived introspection (local), otherwise drop it while keeping
      // the scalar column (dangling) — recording it so the model can explain
      // the drop instead of the relation vanishing without a trace.
      if (tables[fk.referencedTable] !== undefined) {
        keptForeignKeys.push(fk);
      } else {
        const dangling: DanglingForeignKeyInfo = {
          columns: fk.columns,
          referencedSchema: fk.referencedSchema,
          referencedTable: fk.referencedTable,
        };
        const existingDangling = danglingForeignKeysByTable.get(tableName);
        if (existingDangling) {
          existingDangling.push(dangling);
        } else {
          danglingForeignKeysByTable.set(tableName, [dangling]);
        }
      }
    }

    resultTables[tableName] =
      keptForeignKeys.length === table.foreignKeys.length
        ? table
        : new SqlTableIR({ ...table, foreignKeys: keptForeignKeys });
  }

  return {
    tables: resultTables,
    extraRelationsByTable,
    crossSpaceFieldNamesByTable,
    danglingForeignKeysByTable,
  };
}

/**
 * Explains a foreign key `resolveForeignKeys` dropped as dangling: the
 * database enforces it, but its target lives outside the introspected
 * schema, so infer has no model to point a relation at. The suggested fix
 * targets the common cause — an unconfigured extension pack's schema
 * (e.g. Supabase's `auth`).
 */
export function buildDanglingForeignKeyWarning(
  danglingForeignKeys: readonly DanglingForeignKeyInfo[],
  fieldNamesByTable: ReadonlyMap<string, TableColumnFieldNameMap>,
  tableName: string,
): string {
  const descriptions = danglingForeignKeys.map((fk) => {
    const fieldNames = fk.columns.map((columnName) =>
      resolveColumnFieldName(fieldNamesByTable, tableName, columnName),
    );
    const target =
      fk.referencedSchema !== undefined
        ? `${fk.referencedSchema}.${fk.referencedTable}`
        : fk.referencedTable;
    return `"${fieldNames.join(', ')}" -> "${target}"`;
  });
  return (
    `Foreign key ${descriptions.join(', ')} exists in the database, but its target schema is ` +
    'outside the introspected scope, so no relation field was generated. If the target schema ' +
    'is described by an extension pack, add it to extensions and re-run infer.'
  );
}
