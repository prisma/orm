export type MongoMutationDefaultsOp = 'create' | 'update';

export interface MongoMutationDefaultsOptions {
  readonly op: MongoMutationDefaultsOp;
  readonly namespace: string;
  /** The collection the write targets. */
  readonly entry: string;
  /** The fields the write sets explicitly. A field whose value is `undefined` counts as absent. */
  readonly values: Readonly<Record<string, unknown>>;
  /** Shared across every call of one ORM operation, so `'query'`-stable generators yield one value per operation. */
  readonly defaultValueCache?: Map<string, unknown>;
}

export interface MongoAppliedMutationDefault {
  readonly field: string;
  readonly value: unknown;
}

/**
 * Applies the contract's execution defaults to one document of a write. The ORM depends on this interface; the Mongo execution context implements it.
 */
export interface MongoMutationDefaults {
  applyMutationDefaults(
    options: MongoMutationDefaultsOptions,
  ): ReadonlyArray<MongoAppliedMutationDefault>;
}
