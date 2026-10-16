import type { CodecControlHooks } from '@internal/family-sql/control';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';
import type { StorageColumn } from '@internal/sql-contract/types';
import type { DdlColumn } from '@internal/sql-relational-core/ast';
import * as contractFree from '@internal/sql-relational-core/contract-free';
import type { SqlColumnDefaultIR, SqlColumnIR } from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { postgresDefaultToDdlColumnDefault } from './op-factory-call';
import { buildColumnTypeSql } from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';

const AUTOINCREMENT = 'autoincrement()';

/**
 * Reconstructs the `StorageColumn`-shaped fields the DDL builder functions
 * (`buildColumnTypeSql`, `resolveIdentityValue`)
 * expect, from a column node's own stamped codec identity (`codecRef` /
 * `codecBaseNativeType`, Decision 5) — never the contract. The node's fields
 * are already resolved past any `typeRef` indirection, so the builders get
 * no `storageTypes` catalog.
 */
function columnLike(
  column: SqlColumnIR,
): Pick<StorageColumn, 'codecId' | 'nullable' | 'many' | 'typeParams' | 'default'> {
  return {
    ...columnTypeLike(`column "${column.name}"`, column),
    nullable: column.nullable,
    ...ifDefined('default', column.authoredDefault ?? column.resolvedDefault),
  };
}

type ColumnCodecIdentity = Pick<SqlColumnIR, 'codecRef' | 'codecBaseNativeType' | 'many'>;

function columnTypeLike(
  owner: string,
  identity: ColumnCodecIdentity,
): Pick<StorageColumn, 'codecId' | 'many' | 'typeParams'> {
  if (identity.codecRef === undefined || identity.codecBaseNativeType === undefined) {
    throw new InternalError(
      `columnTypeLike: expected ${owner} carries no codec identity — the expected tree must be derived via contractToSchemaIR for planning`,
    );
  }
  return {
    codecId: identity.codecRef.codecId,
    // `column.many` is unset on contract-derived columns (array-ness rides
    // on the type text's `[]` suffix there instead) — `codecRef.many`
    // carries it. Hand-built/introspected columns set `column.many` directly.
    many: (identity.many ?? identity.codecRef.many) ? { elementNullable: false } : false,
    ...ifDefined(
      'typeParams',
      identity.codecRef.typeParams !== undefined
        ? blindCast<
            Record<string, unknown>,
            'CodecRef.typeParams is JsonValue-shaped; the DDL builders only ever read it as the Record the contract column originally carried'
          >(identity.codecRef.typeParams)
        : undefined,
    ),
  };
}

/**
 * Builds the `CREATE TABLE` / `ADD COLUMN` DDL column for an expected column
 * node, writing its type from the data type the node's codec represents.
 */
export function renderColumnDdl(
  name: string,
  column: SqlColumnIR,
  types: SqlTypeLookups,
): DdlColumn {
  const like = columnLike(column);
  const typeSql = buildColumnTypeSql(like, types);
  const ddlDefault = postgresDefaultToDdlColumnDefault(like.default);
  return contractFree.col(name, typeSql, {
    ...(!column.nullable ? { notNull: true } : {}),
    ...ifDefined('default', ddlDefault),
    ...ifDefined('codecRef', column.codecRef),
  });
}

/**
 * Builds the `ALTER COLUMN … TYPE` operands for an expected column node.
 */
export function renderColumnAlterType(column: SqlColumnIR, types: SqlTypeLookups): string {
  return buildColumnTypeSql(columnLike(column), types, {}, false);
}

/**
 * Resolves the identity value (monoid neutral element) SQL literal used as
 * the temporary default when adding a NOT-NULL column with no contract
 * default (`notNullAddColumnCallStrategy`'s shared-temp-default backfill).
 * `null` when the column's type has no built-in/codec-provided identity
 * value.
 */
export function resolveColumnTemporaryDefault(
  column: SqlColumnIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
  types: SqlTypeLookups,
): string | null {
  return resolveIdentityValue(columnLike(column), codecHooks, types);
}

/**
 * The column whose `SET DEFAULT` a column-default diff node asks for, carrying its authored default, or its resolved one when nothing was authored, and its type and codec, from which the adapter writes the clause. An `autoincrement()` default is carried as itself, for `setDefault` to attach a sequence, or to refuse when the column is not a smallint, integer or bigint. `undefined` when the node carries no default, or one DDL does not write.
 */
export function buildSetDefaultColumn(
  columnName: string,
  defaultNode: SqlColumnDefaultIR,
  types: SqlTypeLookups,
): DdlColumn | undefined {
  const authored = defaultNode.authored ?? defaultNode.resolved;
  if (authored === undefined) return undefined;
  const typeLike = columnTypeLike('column default', defaultNode);
  if (authored.kind === 'function' && authored.expression === AUTOINCREMENT) {
    return contractFree.col(columnName, buildColumnTypeSql(typeLike, types, {}, false), {
      default: contractFree.fn(AUTOINCREMENT),
      ...ifDefined('codecRef', defaultNode.codecRef),
    });
  }
  const ddlDefault = postgresDefaultToDdlColumnDefault(authored);
  if (ddlDefault === undefined) return undefined;
  return contractFree.col(columnName, buildColumnTypeSql(typeLike, types, {}, false), {
    default: ddlDefault,
    ...ifDefined('codecRef', defaultNode.codecRef),
  });
}
