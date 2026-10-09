import { requireSqlExpression, type SqlExpression } from '@internal/sql-contract/sql-expression';
import type { ColumnRef, IndexConstraint } from '@internal/sql-contract-ts/contract-builder';
import {
  describeFullTextIndexProblem,
  FULL_TEXT_INDEX_TYPE,
  type FullTextFieldsInput,
  type FullTextIndexCandidate,
  fullTextIndexProblems,
  postgresCodecTraitsOf,
  weightGroupsOf,
} from '@internal/target-postgres/full-text-index-authoring';
import type { FullTextSearchLanguage } from '@internal/target-postgres/operation-types';
import { DEFAULT_FULL_TEXT_SEARCH_LANGUAGE } from '@internal/target-postgres/sql-utils';
import { assertDefined } from '@internal/utils/assertions';
import { postgresError } from '../errors';

type FullTextIndexOptionsBase = {
  readonly language?: FullTextSearchLanguage;
  /** The SQL predicate restricting rows included in a partial index. */
  readonly where?: SqlExpression;
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

function isColumnRef(value: unknown): value is ColumnRef {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A GIN index over the search document `fullTextMatches` and `fullTextRank`
 * search — the TypeScript twin of `@@fullTextIndex`. Pass it to a model's
 * `sql({ indexes: [...] })`.
 *
 * `fields` is one column, or a list whose items are columns or lists of
 * columns. Each top-level item is a weight group, strongest first, at most
 * four. The contract stores the groups as storage column names, resolved at
 * lowering, so a `.column()` override or a column naming convention is
 * honoured rather than guessed. To search it, pass the index from the
 * table's `indexes` to the query operations, which then search its groups in
 * its language.
 */
export function fullTextIndex<const Name extends string>(
  fields: FullTextFieldsInput<ColumnRef>,
  options: FullTextIndexNameOptions<Name>,
): IndexConstraint<readonly string[], Name>;
export function fullTextIndex(
  fields: FullTextFieldsInput<ColumnRef>,
  options: FullTextIndexMapOptions,
): IndexConstraint<readonly string[], undefined>;
export function fullTextIndex(
  fields: FullTextFieldsInput<ColumnRef>,
  options: FullTextIndexOptions,
): IndexConstraint<readonly string[], string | undefined> {
  const fieldGroups = weightGroupsOf(fields, isColumnRef).map((group) =>
    group.map((ref) => ref.fieldName),
  );
  refuseInvalid({ weightGroups: fieldGroups });
  const language = options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;
  const fieldNames = fieldGroups.flat();
  return {
    kind: 'index',
    fields: fieldNames,
    type: FULL_TEXT_INDEX_TYPE,
    options: (columns) => {
      const columnOf = new Map(fieldNames.map((fieldName, i) => [fieldName, columns[i]]));
      refuseInvalid({
        weightGroups: fieldGroups,
        codecs: {
          codecIdOf: (fieldName) => columnOf.get(fieldName)?.codecId,
          traitsOf: postgresCodecTraitsOf,
        },
      });
      const columnNameOf = (fieldName: string) => {
        const column = columnOf.get(fieldName);
        assertDefined(column, `fullTextIndex field "${fieldName}" was resolved to a column`);
        return column.name;
      };
      return { weightGroups: fieldGroups.map((group) => group.map(columnNameOf)), language };
    },
    ...(options.where !== undefined
      ? {
          where: requireSqlExpression(
            options.where,
            `${fullTextIndexOwner(fieldNames, options)} where`,
          ),
        }
      : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.map !== undefined ? { map: options.map } : {}),
  };
}

function fullTextIndexOwner(fieldNames: readonly string[], options: FullTextIndexOptions): string {
  const name = options.name ?? options.map;
  return name === undefined
    ? `Full-text index on fields ${fieldNames.map((fieldName) => `"${fieldName}"`).join(', ')}`
    : `Full-text index "${name}"`;
}

function refuseInvalid(candidate: FullTextIndexCandidate): void {
  const [problem] = fullTextIndexProblems(candidate);
  if (problem === undefined) return;
  throw postgresError(
    'CONTRACT.INDEX_INVALID',
    describeFullTextIndexProblem('fullTextIndex', problem),
    {
      why: 'Each top-level item of the fields is one weight group; Postgres has four weights, A to D, each field belongs to one group, and to_tsvector takes text.',
      fix: 'List each text field once, in at most four non-empty groups.',
      meta: { helper: 'fullTextIndex', fields: candidate.weightGroups },
    },
  );
}
