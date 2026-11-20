export type JsonQuery = {
  modelName?: string
  action: JsonQueryAction
  query: JsonFieldSelection
}

export type RawJsonQuery = {
  action: 'executeRaw' | 'queryRaw'
  query: {
    arguments: {
      query: string
      parameters: string
    }
    selection: JsonSelectionSet
  }
}

export type JsonBatchQuery = {
  batch: JsonQuery[]
  transaction?: { isolationLevel?: IsolationLevel }
}

export type IsolationLevel = 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Snapshot' | 'Serializable'

export type JsonQueryAction =
  | 'findUnique'
  | 'findUniqueOrThrow'
  | 'findFirst'
  | 'findFirstOrThrow'
  | 'findMany'
  | 'createOne'
  | 'createMany'
  | 'createManyAndReturn'
  | 'updateOne'
  | 'updateMany'
  | 'updateManyAndReturn'
  | 'deleteOne'
  | 'deleteMany'
  | 'upsertOne'
  | 'aggregate'
  | 'groupBy'
  | 'executeRaw'
  | 'queryRaw'
  | 'runCommandRaw'
  | 'findRaw'
  | 'aggregateRaw'

export type JsonFieldSelection = {
  arguments?: Record<string, JsonArgumentValue> | RawTaggedValue
  selection: JsonSelectionSet
}

export type JsonSelectionSet = {
  $scalars?: boolean
  $composites?: boolean
} & {
  [fieldName: string]: boolean | JsonFieldSelection
}

export type JsonArgumentValue =
  | number
  | string
  | boolean
  | null
  | RawTaggedValue
  | JsonArgumentValue[]
  | { [key: string]: JsonArgumentValue }

export type DateTaggedValue = { $type: 'DateTime'; value: string }
export type DecimalTaggedValue = { $type: 'Decimal'; value: string }
export type BytesTaggedValue = { $type: 'Bytes'; value: string }
export type BigIntTaggedValue = { $type: 'BigInt'; value: string }
export type FieldRefTaggedValue = { $type: 'FieldRef'; value: { _ref: string; _container: string } }
export type EnumTaggedValue = { $type: 'Enum'; value: string }
export type JsonTaggedValue = { $type: 'Json'; value: string }
export type RawTaggedValue = { $type: 'Raw'; value: unknown }
export type PlaceholderTaggedValue = { $type: 'Param'; value: Placeholder }

export type JsonInputTaggedValue =
  | DateTaggedValue
  | DecimalTaggedValue
  | BytesTaggedValue
  | BigIntTaggedValue
  | FieldRefTaggedValue
  | JsonTaggedValue
  | EnumTaggedValue
  | RawTaggedValue
  | PlaceholderTaggedValue

export type JsonOutputTaggedValue =
  | DateTaggedValue
  | DecimalTaggedValue
  | BytesTaggedValue
  | BigIntTaggedValue
  | JsonTaggedValue

export type Placeholder = {
  name: string
} & PlaceholderType

export type PlaceholderType =
  | { type: 'Any' }
  | { type: 'BigInt' }
  | { type: 'Boolean' }
  | { type: 'Bytes' }
  | { type: 'DateTime' }
  | { type: 'Enum' }
  | { type: 'Float' }
  | { type: 'Int' }
  | { type: 'Json' }
  | { type: 'List'; inner: PlaceholderType }
  | { type: 'String' }
  | { type: 'Uuid' }
