import { requireSqlExpression, type SqlExpression } from '@internal/sql-contract/sql-expression';
import type {
  ColumnRef,
  IndexConstraint,
  IndexOptionsFunction,
} from '@internal/sql-contract-ts/contract-builder';
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

type FullTextIndexOptionsBase<Language extends FullTextSearchLanguage = FullTextSearchLanguage> = {
  readonly language?: Language;
  /** The SQL predicate restricting rows included in a partial index. */
  readonly where?: SqlExpression;
};

/**
 * The wire-named form. `Name` stays literal so the model's `sql()` stage sees the
 * index's name and refuses a duplicate, exactly as it does for `constraints.index`.
 */
type FullTextIndexNameOptions<
  Name extends string = string,
  Language extends FullTextSearchLanguage = FullTextSearchLanguage,
> = FullTextIndexOptionsBase<Language> & {
  readonly name: Name;
  readonly map?: never;
};

/** The exact-named form: `map` is adopted verbatim and carries no wire name. */
type FullTextIndexMapOptions<
  Map extends string = string,
  Language extends FullTextSearchLanguage = FullTextSearchLanguage,
> = FullTextIndexOptionsBase<Language> & {
  readonly map: Map;
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
type FieldNameOf<Ref> = Ref extends ColumnRef<infer FieldName> ? FieldName : string;

// The weight groups as field names: one field is one group; each item of a list is a group of one field or of a list of fields.
type GroupFieldNames<Group> = Group extends readonly unknown[]
  ? { readonly [Member in keyof Group]: FieldNameOf<Group[Member]> }
  : readonly [FieldNameOf<Group>];

type FieldGroups<Fields> = Fields extends ColumnRef
  ? readonly [readonly [FieldNameOf<Fields>]]
  : { readonly [Group in keyof Fields]: GroupFieldNames<Fields[Group]> };

type FlattenGroups<Groups> = Groups extends readonly [
  infer First extends readonly string[],
  ...infer Rest,
]
  ? readonly [...First, ...FlattenGroups<Rest>]
  : readonly [];

type GroupColumns<Group, ColumnOf> = {
  readonly [Member in keyof Group]: Group[Member] extends keyof ColumnOf
    ? ColumnOf[Group[Member]]
    : Group[Member];
};

type ColumnGroups<Groups, ColumnOf> = {
  readonly [Group in keyof Groups]: GroupColumns<Groups[Group], ColumnOf>;
};

/** The options the build writes for a full-text index: its weight groups as column names, and its language. */
export interface FullTextIndexOptionsOf<Groups, Language extends FullTextSearchLanguage>
  extends IndexOptionsFunction {
  readonly options: FullTextOptions<Groups, Language, this['columnOf']>;
}

type FullTextOptions<Groups, Language, ColumnOf> = {
  readonly language: Language;
  readonly weightGroups: ColumnGroups<Groups, ColumnOf>;
};

type FullTextIndexConstraint<
  Fields,
  Name extends string | undefined,
  Map extends string | undefined,
  Language extends FullTextSearchLanguage,
> = IndexConstraint<
  FlattenGroups<FieldGroups<Fields>>,
  Name,
  {
    readonly map: Map;
    readonly type: typeof FULL_TEXT_INDEX_TYPE;
    readonly options: FullTextIndexOptionsOf<FieldGroups<Fields>, Language>;
  }
>;

export function fullTextIndex<
  const Name extends string,
  const Fields extends FullTextFieldsInput<ColumnRef> = FullTextFieldsInput<ColumnRef>,
  const Language extends FullTextSearchLanguage = typeof DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
>(
  fields: Fields,
  options: FullTextIndexNameOptions<Name, Language>,
): FullTextIndexConstraint<Fields, Name, undefined, Language>;
export function fullTextIndex<
  const Map extends string,
  const Fields extends FullTextFieldsInput<ColumnRef> = FullTextFieldsInput<ColumnRef>,
  const Language extends FullTextSearchLanguage = typeof DEFAULT_FULL_TEXT_SEARCH_LANGUAGE,
>(
  fields: Fields,
  options: FullTextIndexMapOptions<Map, Language>,
): FullTextIndexConstraint<Fields, undefined, Map, Language>;
export function fullTextIndex(
  fields: FullTextFieldsInput<ColumnRef>,
  options: FullTextIndexOptions,
): IndexConstraint {
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
