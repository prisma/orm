import type { ColumnRef, IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import type { FullTextSearchLanguage } from '@internal/target-postgres/operation-types';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  isFullTextIndexableCodec,
  renderFullTextIndexExpression,
} from '@internal/target-postgres/sql-utils';
import { invariant } from '@internal/utils/assertions';
import { postgresError } from '../errors';

type FullTextIndexOptionsBase = {
  readonly language?: FullTextSearchLanguage;
  /** The SQL predicate restricting rows included in a partial index. */
  readonly where?: string;
};

/**
 * The wire-named form. `Name` stays literal so the model's `sql()` stage sees the
 * index's name and refuses a duplicate, exactly as it does for `constraints.index`.
 */
type FullTextIndexNameOptions<Name extends string = string> = FullTextIndexOptionsBase & {
  readonly name: Name;
  readonly map?: never;
};

/** The exact-named form: `map` is adopted verbatim and carries no wire name. */
type FullTextIndexMapOptions = FullTextIndexOptionsBase & {
  readonly map: string;
  readonly name?: never;
};

type FullTextIndexOptions = FullTextIndexNameOptions | FullTextIndexMapOptions;

/**
 * A GIN index over the `to_tsvector` expression `fullTextMatches`,
 * `fullTextRank` and `fullTextHeadline` lower to — the TypeScript twin of
 * `@@fullTextIndex`. Pass it to a model's `sql({ indexes: [...] })`.
 *
 * The expression is rendered at lowering, once the column's storage name is
 * known, so a `.column()` override or a column naming convention is honoured
 * rather than guessed. Pass the same `language` here and to the operation: a
 * mismatch is not an error, the query simply stops using the index.
 */
export function fullTextIndex<const Name extends string>(
  column: ColumnRef,
  options: FullTextIndexNameOptions<Name>,
): IndexConstraint<never, Name>;
export function fullTextIndex(
  column: ColumnRef,
  options: FullTextIndexMapOptions,
): IndexConstraint<never, undefined>;
export function fullTextIndex(
  column: ColumnRef,
  options: FullTextIndexOptions,
): IndexConstraint<never, string | undefined> {
  const language = options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;
  return {
    kind: 'index',
    expression: {
      fields: [column],
      render: (columns) => {
        const resolved = columns[0];
        // Lowering resolves one column per field it was given, or raises
        // `CONTRACT.FIELD_UNKNOWN`; this helper hands it exactly one.
        invariant(
          resolved !== undefined,
          `fullTextIndex resolved no column for field "${column.fieldName}"`,
        );
        if (!isFullTextIndexableCodec(resolved.codecId)) {
          throw postgresError(
            'CONTRACT.INDEX_INVALID',
            `fullTextIndex indexes a text column, but "${column.fieldName}" is stored as \`${resolved.codecId}\`.`,
            {
              why: 'to_tsvector takes text; Postgres rejects the CREATE INDEX for any other column type.',
              fix: 'Index a text, varchar, char or enum column, or drop the index.',
              meta: {
                helper: 'fullTextIndex',
                fieldName: column.fieldName,
                codecId: resolved.codecId,
              },
            },
          );
        }
        return renderFullTextIndexExpression(language, resolved.name);
      },
    },
    type: 'gin',
    ...(options.where !== undefined ? { where: options.where } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.map !== undefined ? { map: options.map } : {}),
  };
}
