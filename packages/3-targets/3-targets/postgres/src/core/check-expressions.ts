import type { CheckKind } from '@internal/sql-schema-ir/naming';
import { invariant } from '@internal/utils/assertions';
import { escapeLiteral, quoteIdentifier } from './sql-utils';

/**
 * What a rendered check enforces. The contract builder turns this into the
 * wire-name prefix's trailing segment, so the kind stays readable in the
 * physical constraint name. The vocabulary is the family's, so this names
 * `CheckKind` rather than restating its members.
 */
export type PostgresCheckKind = CheckKind;

/**
 * One column's shape, as the contract builder knows it. `memberValues` is
 * present only for a domain enum authored through an `enumType()` handle —
 * a column bound to a native enum type carries its enforcement in the type
 * itself and arrives here with `memberValues` undefined.
 */
export interface PostgresCheckExpressionInput {
  readonly tableName: string;
  readonly columnName: string;
  readonly many: boolean;
  readonly memberValues: readonly (string | number)[] | undefined;
}

/**
 * A check the target wants written. The target contributes only what it
 * uniquely knows — which predicate, spelled how — while the family owns the
 * naming: it composes the prefix from the table, the column, and the kind,
 * caps it, and appends the content hash. Nothing here is a name.
 */
export interface PostgresCheckExpressionCandidate {
  readonly kind: PostgresCheckKind;
  /** The column this predicate constrains; the family names the check after it. */
  readonly columnName: string;
  /** Opaque SQL: the predicate body, without the surrounding `CHECK (…)`. */
  readonly expression: string;
}

/**
 * Renders the checks a Postgres column needs, as opaque predicate text.
 *
 * A domain enum has no type-level enforcement, so membership is a
 * predicate: `IN` for a scalar, and `<@` containment for an array — an array
 * column cannot use `IN` at all (`operator does not exist: text[] = text`),
 * and containment additionally rejects NULL elements. Every list column also
 * gets an element-non-null check, which no Postgres column type can express.
 *
 * Array containment casts both operands to `numeric[]` for numeric members or
 * `text[]` for string members, so different storage types share an operator
 * without comparing numbers as text. The scalar `IN` form needs no cast.
 */
export function postgresRenderCheckExpressions(
  input: PostgresCheckExpressionInput,
): readonly PostgresCheckExpressionCandidate[] {
  const candidates: PostgresCheckExpressionCandidate[] = [];
  const column = quoteIdentifier(input.columnName);

  if (input.memberValues !== undefined) {
    invariant(
      input.memberValues.length > 0,
      `check for "${input.tableName}"."${input.columnName}": empty member set; both authoring surfaces reject a member-less enum before rendering`,
    );
    const members = input.memberValues
      .map((value) => {
        if (typeof value === 'string') return `'${escapeLiteral(value)}'`;
        invariant(
          Number.isFinite(value),
          `check for "${input.tableName}"."${input.columnName}": non-finite numeric member`,
        );
        return String(value);
      })
      .join(', ');
    const arrayType = input.memberValues.every((value) => typeof value === 'number')
      ? 'numeric[]'
      : 'text[]';
    candidates.push({
      kind: 'membership',
      columnName: input.columnName,
      expression: input.many
        ? `${column}::${arrayType} <@ ARRAY[${members}]::${arrayType}`
        : `${column} IN (${members})`,
    });
  }

  if (input.many) {
    candidates.push({
      kind: 'elementNotNull',
      columnName: input.columnName,
      expression: `array_position(${column}, NULL) IS NULL`,
    });
  }

  return candidates;
}
