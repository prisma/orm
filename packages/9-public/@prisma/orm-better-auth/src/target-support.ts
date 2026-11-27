import type { DBFieldAttribute } from '@better-auth/core/db';
import { BetterAuthError } from '@better-auth/core/error';
import type { ComparisonMethods, Condition } from '@prisma/orm-family-sql/orm-client';
import { type Expression, isExpression } from '@prisma/orm-family-sql/relational-core/expression';
import type { IdStrategy } from './models/better-auth-models';
import { hasMethod, type WhereFunctions } from './orm';

export const valueKinds = [
  'string',
  'enum',
  'uuid',
  'date',
  'number',
  'boolean',
  'json',
  'other',
] as const;

/** The kind of JavaScript value a codec reads and writes. */
export type ValueKind = (typeof valueKinds)[number];

/** A field accessor of a column that holds text: one whose codec has the `textual` trait, so the ORM offers `like` on it. */
export type TextColumn = Expression<{ codecId: string; nullable: boolean }> &
  ComparisonMethods<string, 'equality' | 'textual', string>;

const textColumnMethods = ['eq', 'neq', 'in', 'notIn', 'like'] as const;

export function isTextColumn(value: unknown): value is TextColumn {
  return isExpression(value) && textColumnMethods.every((method) => hasMethod(value, method));
}

/** The functions of the ORM's `where` callback a text comparison may use. */
export type TextFunctions = Pick<WhereFunctions, 'raw' | 'eq' | 'ne'>;

/** One comparison of a text column that Better Auth asks for. A pattern is never empty and a list never empty: the adapter answers those itself. */
export type TextComparison = (
  | {
      readonly operator: 'eq' | 'ne' | 'contains' | 'starts_with' | 'ends_with';
      readonly value: string;
    }
  | { readonly operator: 'in' | 'not_in'; readonly values: readonly [string, ...string[]] }
) & {
  readonly column: TextColumn;
  readonly codecId: string;
  readonly insensitive: boolean;
  readonly fns: TextFunctions;
};

/** A Better Auth field the contract check and `auth generate` print in PSL. */
export interface PslField {
  readonly attribute: DBFieldAttribute;
  readonly idStrategy: IdStrategy;
  /** Whether the field holds the `id` of another model. */
  readonly isIdReference: boolean;
  /** Whether the field holds the `id` of a model in the contract whose `id` this support's `valueKind` calls `uuid`, under an id strategy that accepts UUIDs. */
  readonly referencesUuidId: boolean;
}

/** What the adapter must know about one target. */
export interface TargetSupport {
  /** The target name, as the client's contract reports it in `contract.target`. */
  readonly target: string;
  /** The kind of value a codec reads and writes, or `undefined` for a codec the support does not know. */
  valueKind(codecId: string): ValueKind | undefined;
  /** The ORM condition for a comparison of a text column. A case-sensitive `eq` must be able to use the column's index. */
  compareText(comparison: TextComparison): Condition;
  /** Whether two table names, or two column names, are the same name on this database. */
  sameStorageName(a: string, b: string, kind: 'table' | 'column'): boolean;
  /** The namespace a model is in when the contract names none. */
  readonly defaultNamespace: string;
  /** The PSL type of a Better Auth field, without `?`. */
  pslType(field: PslField): string;
}

function quotedList(names: readonly string[]): string {
  const quoted = names.map((name) => `"${name}"`);
  return quoted.length <= 1
    ? quoted.join('')
    : `${quoted.slice(0, -1).join(', ')} and ${quoted[quoted.length - 1]}`;
}

const sqlFamily = 'sql';

/** The support for a client's target, among `supports`. A client that is not for a SQL database is refused first. */
export function targetSupportFor(
  contract: { readonly targetFamily: string; readonly target: string },
  supports: readonly TargetSupport[],
): TargetSupport {
  if (contract.targetFamily !== sqlFamily) {
    throw new BetterAuthError(
      `@prisma/orm-better-auth supports only SQL databases, and this Prisma client is for a "${contract.targetFamily}" database. Pass the client of a SQL database.`,
    );
  }
  const support = supports.find(({ target }) => target === contract.target);
  if (support === undefined) {
    throw new BetterAuthError(
      `@prisma/orm-better-auth does not support this Prisma client's database, "${contract.target}". It supports ${quotedList(supports.map(({ target }) => target))}.`,
    );
  }
  return support;
}
