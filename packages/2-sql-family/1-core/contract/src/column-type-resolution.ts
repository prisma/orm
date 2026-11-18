// `string extends keyof SCT` detects the open `Record<string, never>` default that non-emitted contracts carry.
export type StorageColumnMapAt<
  SCT,
  NsId extends string,
  TableName extends string,
> = string extends keyof SCT
  ? never
  : NsId extends keyof SCT
    ? string extends keyof SCT[NsId]
      ? never
      : TableName extends keyof SCT[NsId]
        ? SCT[NsId][TableName]
        : never
    : never;

export type StorageColumnTypeAcrossNamespaces<
  SCT,
  TableName extends string,
  ColumnName extends string,
> = {
  [Ns in keyof SCT]: TableName extends keyof SCT[Ns]
    ? ColumnName extends keyof SCT[Ns][TableName]
      ? SCT[Ns][TableName][ColumnName]
      : never
    : never;
}[keyof SCT];

type ExecutionDefaultEntryOf<C> = C extends {
  readonly execution?: infer Execution;
}
  ? Execution extends {
      readonly mutations: { readonly defaults: ReadonlyArray<infer Entry> };
    }
    ? Entry
    : never
  : never;

/**
 * Whether the contract's execution defaults generate a value for the column on create. An entry with only `onUpdate` does not. With `NsId` `never`, the entry may be in any namespace.
 */
export type HasExecutionCreateDefault<
  C,
  NsId extends string,
  TableName extends string,
  ColumnName extends string,
> = [
  Extract<
    ExecutionDefaultEntryOf<C>,
    {
      readonly ref: {
        readonly entry: TableName;
        readonly field: ColumnName;
      } & ([NsId] extends [never] ? unknown : { readonly namespace: NsId });
      readonly onCreate: unknown;
    }
  >,
] extends [never]
  ? false
  : true;

/**
 * Whether a create or insert may leave out the column: it is nullable, has a storage default, or the contract generates its value on create. A column is required only when the contract proves none of these.
 */
export type IsOptionalCreateColumn<
  C,
  Column,
  NsId extends string,
  TableName extends string,
  ColumnName extends string,
> = [Column] extends [{ readonly nullable: false }]
  ? [Column] extends [{ readonly default: unknown }]
    ? true
    : HasExecutionCreateDefault<C, NsId, TableName, ColumnName>
  : true;
