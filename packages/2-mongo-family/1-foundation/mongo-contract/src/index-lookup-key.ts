import { canonicalize } from './canonicalize';
import type { MongoIndexKey } from './contract-types';
import type { MongoIndexInput } from './ir/mongo-index';

/**
 * Returns a function that accepts a list of options only when it names every member of `Option`;
 * a list missing one fails to compile, naming the missing option.
 */
export function listsEveryOption<Option extends string>() {
  return <const T extends readonly Option[]>(
    options: T &
      ([Exclude<Option, T[number]>] extends [never]
        ? unknown
        : { readonly unlistedOption: Exclude<Option, T[number]> }),
  ): T => options;
}

/** The index options that tell two indexes on the same keys apart: every option of an index. */
export const MONGO_INDEX_OPTION_KEYS = listsEveryOption<Exclude<keyof MongoIndexInput, 'keys'>>()([
  'unique',
  'sparse',
  'expireAfterSeconds',
  'partialFilterExpression',
  'wildcardProjection',
  'collation',
  'weights',
  'default_language',
  'language_override',
] as const);

export type MongoIndexOptionKey = (typeof MONGO_INDEX_OPTION_KEYS)[number];

/** An index as `indexLookupKey` reads it: the contract's `MongoIndex` and the schema IR's index both fit. */
export type MongoIndexLookupInput = { readonly keys: ReadonlyArray<MongoIndexKey> } & {
  readonly [Option in MongoIndexOptionKey]?: MongoIndexInput[Option] | undefined;
};

/** Identifies an index by its keys and the options it sets; an option set to `false` counts as unset. No field name or option value can make two different indexes share a key. */
export function indexLookupKey(index: MongoIndexLookupInput): string {
  const options = Object.fromEntries(
    MONGO_INDEX_OPTION_KEYS.flatMap((option) => {
      const value = index[option];
      return value === undefined || value === null || value === false ? [] : [[option, value]];
    }),
  );
  return canonicalize({ keys: index.keys.map((k) => [k.field, k.direction]), options });
}
