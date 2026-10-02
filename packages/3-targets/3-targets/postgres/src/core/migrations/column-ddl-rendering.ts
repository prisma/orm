import type { ColumnDefault } from '@internal/contract/types';
import type { CodecControlHooks } from '@internal/family-sql/control';
import type { ToCanonicalForm } from '@internal/framework-components/codec';
import type { SqlTypeLookups } from '@internal/sql-contract/data-type';
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
import { buildColumnTypeSql } from './planner-ddl-builders';
import { resolveIdentityValue } from './planner-identity-values';
import { buildExpectedFormatType } from './planner-sql-checks';

/**
 * Reconstructs the `StorageColumn`-shaped fields the DDL builder functions
 * (`buildColumnTypeSql`, `buildExpectedFormatType`, `resolveIdentityValue`)
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
  };
}

/**
 * A literal default in the canonical form of the column's values, which DDL writes (ADR 254). A
 * default the form refuses, which a contract emitted by an earlier version can hold, is refused
 * here rather than written, since the database would never hold the text the contract states.
 */
function inCanonicalForm(
  columnName: string,
  columnDefault: ColumnDefault | undefined,
  toCanonicalForm: ToCanonicalForm | undefined,
  many: boolean,
): ColumnDefault | undefined {
  if (columnDefault?.kind !== 'literal') return columnDefault;
  const refusal = contractDefaultRefusal(columnDefault, toCanonicalForm, many);
  if (refusal !== undefined) {
    throw postgresError('CONTRACT.DEFAULT_INVALID', `Column "${columnName}": ${refusal}`, {
      meta: { reason: 'default-not-canonical', column: columnName },
    });
  }
  return {
    kind: 'literal',
    value: defaultInCanonicalForm(columnDefault.value, toCanonicalForm, many).value,
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
  const ddlDefault = postgresDefaultToDdlColumnDefault(
    inCanonicalForm(name, like.default, column.toCanonicalForm, like.many === true),
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
  types: SqlTypeLookups,
): { readonly qualifiedTargetType: string; readonly formatTypeExpected: string } {
  const like = columnLike(column);
  return {
    qualifiedTargetType: buildColumnTypeSql(like, types, {}, false),
    formatTypeExpected: buildExpectedFormatType(like, types),
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
  types: SqlTypeLookups,
): string | null {
  return resolveIdentityValue(columnLike(column), codecHooks, types);
}

/**
 * The column whose `SET DEFAULT` a column-default diff node asks for, carrying its authored default, or its resolved one when nothing was authored, and its type and codec, from which the adapter writes the clause. `undefined` when the node carries no default, or one DDL does not write, as for an autoincrement column.
 */
export function buildSetDefaultColumn(
  columnName: string,
  defaultNode: SqlColumnDefaultIR,
  types: SqlTypeLookups,
): DdlColumn | undefined {
  const authored = defaultNode.authored ?? defaultNode.resolved;
  if (authored === undefined) return undefined;
  const typeLike = columnTypeLike('column default', defaultNode);
  const ddlDefault = postgresDefaultToDdlColumnDefault(
    inCanonicalForm(columnName, authored, defaultNode.toCanonicalForm, typeLike.many === true),
  );
  if (ddlDefault === undefined) return undefined;
  return contractFree.col(columnName, buildColumnTypeSql(typeLike, types, {}, false), {
    default: ddlDefault,
    ...ifDefined('codecRef', defaultNode.codecRef),
  });
}
