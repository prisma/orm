import type {
  ColumnRef,
  DeferredIndexColumn,
  IndexConstraint,
} from '@internal/sql-contract-ts/contract-builder';
import type { FullTextSearchLanguage } from '@internal/target-postgres/operation-types';
import {
  DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
  describeWeightGroupProblem,
  FULL_TEXT_INDEX_TYPE,
  type FullTextFieldsInput,
  isFullTextIndexableCodec,
  weightGroupProblems,
  weightGroupsOf,
} from '@internal/target-postgres/sql-utils';
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
 * honoured rather than guessed. Pass the same groups and `language` to the
 * query operations: a mismatch is not an error, the query simply stops using
 * the index.
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
  const groups = weightGroupsOf(fields, isColumnRef).map((group) =>
    group.map((ref) => ref.fieldName),
  );
  const [problem] = weightGroupProblems(groups);
  if (problem !== undefined) {
    throw postgresError(
      'CONTRACT.INDEX_INVALID',
      describeWeightGroupProblem('fullTextIndex', problem),
      {
        why: 'Each top-level item of the fields is one weight group; Postgres has four weights, A to D, and each field belongs to one group.',
        fix: 'List each field once, in at most four non-empty groups.',
        meta: { helper: 'fullTextIndex', fields: groups },
      },
    );
  }
  const language = options.language ?? DEFAULT_FULL_TEXT_SEARCH_LANGUAGE;
  const fieldNames = groups.flat();
  return {
    kind: 'index',
    fields: fieldNames,
    type: FULL_TEXT_INDEX_TYPE,
    resolveOptions: (columns) => {
      const columnsByField = new Map(
        fieldNames.map((fieldName, position) => [fieldName, columns[position]]),
      );
      return {
        fields: groups.map((group) =>
          group.map((fieldName) => indexableColumn(fieldName, columnsByField.get(fieldName)).name),
        ),
        language,
      };
    },
    ...(options.where !== undefined ? { where: options.where } : {}),
    ...(options.name !== undefined ? { name: options.name } : {}),
    ...(options.map !== undefined ? { map: options.map } : {}),
  };
}

function indexableColumn(
  fieldName: string,
  column: DeferredIndexColumn | undefined,
): DeferredIndexColumn {
  if (column === undefined || !isFullTextIndexableCodec(column.codecId)) {
    throw postgresError(
      'CONTRACT.INDEX_INVALID',
      `fullTextIndex indexes text columns, but "${fieldName}" is ${column === undefined ? 'not a stored field' : `stored as \`${column.codecId}\``}.`,
      {
        why: 'to_tsvector takes text; Postgres rejects the CREATE INDEX for any other column type.',
        fix: 'Index text, varchar or char columns only.',
        meta: { helper: 'fullTextIndex', fieldName, codecId: column?.codecId },
      },
    );
  }
  return column;
}
