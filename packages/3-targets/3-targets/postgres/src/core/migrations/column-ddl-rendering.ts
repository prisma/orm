import type { ColumnDefault } from '@internal/contract/types';
import type { CodecControlHooks } from '@internal/family-sql/control';
import type { DataType } from '@internal/framework-components/codec';
import type { StorageColumn } from '@internal/sql-contract/types';
import type { DdlColumn } from '@internal/sql-relational-core/ast';
import * as contractFree from '@internal/sql-relational-core/contract-free';
import {
  contractDefaultRefusal,
  defaultInCanonicalForm,
  type SqlColumnDefaultIR,
  type SqlColumnIR,
} from '@internal/sql-schema-ir/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { postgresError } from '../errors';
import { postgresDefaultToDdlColumnDefault } from './op-factory-call';
import { buildColumnDefaultSql, buildColumnTypeSql } from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';
import { buildExpectedFormatType } from './planner-sql-checks';

/**
 * Reconstructs the `StorageColumn`-shaped fields the DDL builder functions
 * (`buildColumnTypeSql`, `buildExpectedFormatType`, `resolveIdentityValue`)
 * expect, from a column node's own stamped codec identity (`codecRef` /
 * `codecBaseNativeType` / `codecNamedType`, Decision 5) — never the
 * contract. The builders were written against `StorageColumn` and are
 * unchanged here; only the shape feeding them moves from the contract to
 * the node. An empty `storageTypes` catalog is passed alongside: the
 * node's fields are already resolved past any `typeRef` indirection, so no
 * live lookup is needed, and passing a non-empty catalog would risk a
 * false `typeRef` hit against an unrelated storage type.
 */
function columnLike(
  column: SqlColumnIR,
): Pick<
  StorageColumn,
  'nativeType' | 'codecId' | 'nullable' | 'many' | 'typeParams' | 'typeRef' | 'default'
> {
  return {
    ...columnTypeLike(`column "${column.name}"`, column),
    nullable: column.nullable,
    ...ifDefined('default', column.authoredDefault ?? column.resolvedDefault),
  };
}

type ColumnCodecIdentity = Pick<
  SqlColumnIR,
  'codecRef' | 'codecBaseNativeType' | 'codecNamedType' | 'many'
>;

function columnTypeLike(
  owner: string,
  identity: ColumnCodecIdentity,
): Pick<StorageColumn, 'nativeType' | 'codecId' | 'many' | 'typeParams' | 'typeRef'> {
  if (identity.codecRef === undefined || identity.codecBaseNativeType === undefined) {
    throw new InternalError(
      `columnTypeLike: expected ${owner} carries no codec identity — the expected tree must be derived via contractToSchemaIR for planning`,
    );
  }
  return {
    nativeType: identity.codecBaseNativeType,
    codecId: identity.codecRef.codecId,
    // `column.many` is unset on contract-derived columns (array-ness rides
    // on the `nativeType` `[]` suffix there instead) — `codecRef.many`
    // carries it. Hand-built/introspected columns set `column.many` directly.
    ...ifDefined('many', identity.many ?? identity.codecRef.many),
    ...ifDefined(
      'typeParams',
      identity.codecRef.typeParams !== undefined
        ? blindCast<
            Record<string, unknown>,
            'CodecRef.typeParams is JsonValue-shaped; the DDL builders only ever read it as the Record the contract column originally carried'
          >(identity.codecRef.typeParams)
        : undefined,
    ),
    ...(identity.codecNamedType ? { typeRef: '<resolved>' } : {}),
  };
}

/**
 * A literal default in the canonical form of the column's data type, which DDL writes (ADR 254). A
 * default the type refuses, which a contract emitted by an earlier version can hold, is refused
 * here rather than written, since the database would never hold the text the contract states.
 */
function inCanonicalForm(
  columnName: string,
  columnDefault: ColumnDefault | undefined,
  dataType: DataType | undefined,
  many: boolean,
): ColumnDefault | undefined {
  if (columnDefault?.kind !== 'literal') return columnDefault;
  const refusal = contractDefaultRefusal(columnDefault, dataType?.toCanonicalForm, many);
  if (refusal !== undefined) {
    throw postgresError('CONTRACT.DEFAULT_INVALID', `Column "${columnName}": ${refusal}`, {
      meta: { reason: 'default-not-canonical', column: columnName },
    });
  }
  return {
    kind: 'literal',
    value: defaultInCanonicalForm(columnDefault.value, dataType?.toCanonicalForm, many).value,
  };
}

/**
 * Builds the `CREATE TABLE` / `ADD COLUMN` DDL column for an expected column
 * node, resolving type rendering from the node's codec identity against the
 * codec hooks the caller holds — the same builder the pre-`plan(start, end)`
 * op-path called, so the output is byte-identical.
 */
export function renderColumnDdl(
  name: string,
  column: SqlColumnIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): DdlColumn {
  const like = columnLike(column);
  const typeSql = buildColumnTypeSql(like, codecHooks, {});
  const ddlDefault = postgresDefaultToDdlColumnDefault(
    inCanonicalForm(name, like.default, column.dataType, like.many === true),
  );
  return contractFree.col(name, typeSql, {
    ...(!column.nullable ? { notNull: true } : {}),
    ...ifDefined('default', ddlDefault),
    ...ifDefined('codecRef', column.codecRef),
  });
}

/**
 * Builds the `ALTER COLUMN … TYPE` operands for an expected column node.
 */
export function renderColumnAlterType(
  column: SqlColumnIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): { readonly qualifiedTargetType: string; readonly formatTypeExpected: string } {
  const like = columnLike(column);
  return {
    qualifiedTargetType: buildColumnTypeSql(like, codecHooks, {}, false),
    formatTypeExpected: buildExpectedFormatType(like, codecHooks, {}),
  };
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
): string | null {
  return resolveIdentityValue(columnLike(column), codecHooks, {});
}

/**
 * The column's `SET DEFAULT` clause SQL, from a column-default diff node's authored default, or its resolved one when nothing was authored. `''` when the node carries neither. A list default is cast to the column type as the column's DDL writes it.
 */
export function renderColumnDefaultSql(
  columnName: string,
  defaultNode: SqlColumnDefaultIR,
  codecHooks: ReadonlyMap<string, CodecControlHooks>,
): string {
  const authored = defaultNode.authored ?? defaultNode.resolved;
  if (authored === undefined) return '';
  const typeLike = columnTypeLike('column default', defaultNode);
  const columnDefault = inCanonicalForm(
    columnName,
    authored,
    defaultNode.dataType,
    typeLike.many === true,
  );
  return buildColumnDefaultSql(columnDefault, {
    nativeType: buildColumnTypeSql(typeLike, codecHooks, {}, false),
    ...ifDefined('dataTypeId', defaultNode.dataType?.id),
    ...ifDefined('many', typeLike.many),
  });
}
