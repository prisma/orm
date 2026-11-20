import { ReadonlyDeep } from './util'

export type Document = ReadonlyDeep<{
  datamodel: Datamodel
  schema: Schema
  mappings: Mappings
}>

export type Mappings = ReadonlyDeep<{
  modelOperations: ModelMapping[]
  otherOperations: {
    read: string[]
    write: string[]
  }
}>

export type OtherOperationMappings = ReadonlyDeep<{
  read: string[]
  write: string[]
}>

export type DatamodelEnum = ReadonlyDeep<{
  name: string
  values: EnumValue[]
  dbName?: string | null
  documentation?: string
}>

export type SchemaEnum = ReadonlyDeep<{
  name: string
  values: string[]
}>

export type EnumValue = ReadonlyDeep<{
  name: string
  dbName: string | null
}>

export type Datamodel = ReadonlyDeep<{
  models: Model[]
  enums: DatamodelEnum[]
  types: Model[]
  indexes: Index[]
}>

export type uniqueIndex = ReadonlyDeep<{
  name: string
  fields: string[]
}>
export type PrimaryKey = ReadonlyDeep<{
  name: string | null
  fields: string[]
}>
export type Model = ReadonlyDeep<{
  name: string
  dbName: string | null
  schema: string | null
  fields: Field[]
  uniqueFields: string[][]
  uniqueIndexes: uniqueIndex[]
  documentation?: string
  primaryKey: PrimaryKey | null
  isGenerated?: boolean
}>

export type FieldKind = 'scalar' | 'object' | 'enum' | 'unsupported'

export type FieldNamespace = 'model' | 'prisma'
export type FieldLocation = 'scalar' | 'inputObjectTypes' | 'outputObjectTypes' | 'enumTypes' | 'fieldRefTypes'

export type Field = ReadonlyDeep<{
  kind: FieldKind
  name: string
  isRequired: boolean
  isList: boolean
  isUnique: boolean
  isId: boolean
  isReadOnly: boolean
  isGenerated?: boolean // does not exist on 'type' but does on 'model'
  isUpdatedAt?: boolean // does not exist on 'type' but does on 'model'
  /**
   * Describes the data type in the same the way it is defined in the Prisma schema:
   * BigInt, Boolean, Bytes, DateTime, Decimal, Float, Int, JSON, String, $ModelName
   */
  type: string
  /**
   * Native database type, if specified.
   * For example, `@db.VarChar(191)` is encoded as `['VarChar', ['191']]`,
   * `@db.Text` is encoded as `['Text', []]`.
   */
  nativeType?: [string, string[]] | null
  dbName?: string | null
  hasDefaultValue: boolean
  default?: FieldDefault | FieldDefaultScalar | FieldDefaultScalar[]
  relationFromFields?: string[]
  relationToFields?: string[]
  relationOnDelete?: string
  relationOnUpdate?: string
  relationName?: string
  documentation?: string
}>

export type FieldDefault = ReadonlyDeep<{
  name: string
  args: Array<string | number>
}>

export type FieldDefaultScalar = string | boolean | number

export type Index = ReadonlyDeep<{
  model: string
  type: IndexType
  isDefinedOnField: boolean
  name?: string
  dbName?: string
  algorithm?: string
  clustered?: boolean
  fields: IndexField[]
}>

export type IndexType = 'id' | 'normal' | 'unique' | 'fulltext'

export type IndexField = ReadonlyDeep<{
  name: string
  sortOrder?: SortOrder
  length?: number
  operatorClass?: string
}>

export type SortOrder = 'asc' | 'desc'

export type Schema = ReadonlyDeep<{
  rootQueryType?: string
  rootMutationType?: string
  inputObjectTypes: {
    // For now there are no `model` InputTypes
    model?: InputType[]
    prisma?: InputType[]
  }
  outputObjectTypes: {
    model: OutputType[]
    prisma: OutputType[]
  }
  enumTypes: {
    model?: SchemaEnum[]
    prisma: SchemaEnum[]
  }
  fieldRefTypes: {
    prisma?: FieldRefType[]
  }
}>

export type Query = ReadonlyDeep<{
  name: string
  args: SchemaArg[]
  output: QueryOutput
}>

export type QueryOutput = ReadonlyDeep<{
  name: string
  isRequired: boolean
  isList: boolean
}>

export type TypeRef<AllowedLocations extends FieldLocation> = {
  isList: boolean
  type: string
  location: AllowedLocations
  namespace?: FieldNamespace
}

export type InputTypeRef = TypeRef<'scalar' | 'inputObjectTypes' | 'enumTypes' | 'fieldRefTypes'>

export type SchemaArg = ReadonlyDeep<{
  name: string
  comment?: string
  isNullable: boolean
  isRequired: boolean
  inputTypes: InputTypeRef[]
  isParameterizable: boolean
  requiresOtherFields?: string[]
  deprecation?: Deprecation
}>

export type OutputType = ReadonlyDeep<{
  name: string
  fields: SchemaField[]
}>

export type SchemaField = ReadonlyDeep<{
  name: string
  isNullable?: boolean
  outputType: OutputTypeRef
  args: SchemaArg[]
  deprecation?: Deprecation
  documentation?: string
}>

export type OutputTypeRef = TypeRef<'scalar' | 'outputObjectTypes' | 'enumTypes'>

export type Deprecation = ReadonlyDeep<{
  sinceVersion: string
  reason: string
  plannedRemovalVersion?: string
}>

export type InputType = ReadonlyDeep<{
  name: string
  constraints: {
    maxNumFields: number | null
    minNumFields: number | null
    fields?: string[]
  }
  meta?: {
    source?: string
    grouping?: string
  }
  fields: SchemaArg[]
}>

export type FieldRefType = ReadonlyDeep<{
  name: string
  allowTypes: FieldRefAllowType[]
  fields: SchemaArg[]
}>

export type FieldRefAllowType = TypeRef<'scalar' | 'enumTypes'>

export type ModelMapping = ReadonlyDeep<{
  model: string
  plural: string
  findUnique?: string | null
  findUniqueOrThrow?: string | null
  findFirst?: string | null
  findFirstOrThrow?: string | null
  findMany?: string | null
  create?: string | null
  createMany?: string | null
  createManyAndReturn?: string | null
  update?: string | null
  updateMany?: string | null
  updateManyAndReturn?: string | null
  upsert?: string | null
  delete?: string | null
  deleteMany?: string | null
  aggregate?: string | null
  groupBy?: string | null
  count?: string | null
  findRaw?: string | null
  aggregateRaw?: string | null
}>

export enum ModelAction {
  findUnique = 'findUnique',
  findUniqueOrThrow = 'findUniqueOrThrow',
  findFirst = 'findFirst',
  findFirstOrThrow = 'findFirstOrThrow',
  findMany = 'findMany',
  create = 'create',
  createMany = 'createMany',
  createManyAndReturn = 'createManyAndReturn',
  update = 'update',
  updateMany = 'updateMany',
  updateManyAndReturn = 'updateManyAndReturn',
  upsert = 'upsert',
  delete = 'delete',
  deleteMany = 'deleteMany',
  groupBy = 'groupBy',
  count = 'count', // TODO: count does not actually exist in DMMF
  aggregate = 'aggregate',
  findRaw = 'findRaw',
  aggregateRaw = 'aggregateRaw',
}
