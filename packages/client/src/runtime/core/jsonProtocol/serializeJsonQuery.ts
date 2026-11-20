import { RuntimeDataModel, RuntimeModel, uncapitalize } from '@prisma/client-common'
import { isObjectEnumValue } from '@prisma/client-runtime-utils'
import { assertNever } from '@prisma/internals'

import { ErrorFormat } from '../../getPrismaClient'
import { CallSite } from '../../utils/CallSite'
import { isDate, isValidDate } from '../../utils/date'
import { isDecimalJsLike } from '../../utils/decimalJsLike'
import { isJSONConvertible } from '../../utils/jsonConvertible'
import {
  JsonArgumentValue,
  JsonFieldSelection,
  JsonQuery,
  JsonQueryAction,
  JsonSelectionSet,
  OutputTypeDescription,
  RawTaggedValue,
} from '../engines'
import { throwValidationException } from '../errorRendering/throwValidationException'
import { MergedExtensionsList } from '../extensions/MergedExtensionsList'
import { computeEngineSideOmissions, computeEngineSideSelection } from '../extensions/resultUtils'
import { isFieldRef } from '../model/FieldRef'
import { isParam } from '../model/Param'
import { isSkip, Skip } from '../types'
import { Action, JsArgs, JsInputValue, Omission, RawParameters, Selection } from '../types/exported/JsApi'
import { ValidationError } from '../types/ValidationError'

const jsActionToProtocolAction: Record<Action, JsonQueryAction> = {
  findUnique: 'findUnique',
  findUniqueOrThrow: 'findUniqueOrThrow',
  findFirst: 'findFirst',
  findFirstOrThrow: 'findFirstOrThrow',
  findMany: 'findMany',
  count: 'aggregate',
  create: 'createOne',
  createMany: 'createMany',
  createManyAndReturn: 'createManyAndReturn',
  update: 'updateOne',
  updateMany: 'updateMany',
  updateManyAndReturn: 'updateManyAndReturn',
  upsert: 'upsertOne',
  delete: 'deleteOne',
  deleteMany: 'deleteMany',
  executeRaw: 'executeRaw',
  queryRaw: 'queryRaw',
  aggregate: 'aggregate',
  groupBy: 'groupBy',
  runCommandRaw: 'runCommandRaw',
  findRaw: 'findRaw',
  aggregateRaw: 'aggregateRaw',
}

export type GlobalOmitOptions = {
  [modelName: string]: {
    [fieldName: string]: boolean
  }
}

export type SerializeParams = {
  runtimeDataModel: RuntimeDataModel
  modelName?: string
  action: Action
  args?: JsArgs
  extensions?: MergedExtensionsList
  callsite?: CallSite
  clientMethod: string
  clientVersion: string
  errorFormat: ErrorFormat
  previewFeatures: string[]
  globalOmit?: GlobalOmitOptions
  wrapRawValues?: boolean
}

const STRICT_UNDEFINED_ERROR_MESSAGE = 'explicitly `undefined` values are not allowed'

export function serializeJsonQuery({
  modelName,
  action,
  args,
  runtimeDataModel,
  extensions = MergedExtensionsList.empty(),
  callsite,
  clientMethod,
  errorFormat,
  clientVersion,
  previewFeatures,
  globalOmit,
  wrapRawValues,
}: SerializeParams): JsonQuery {
  const context = new SerializeContext({
    runtimeDataModel,
    modelName,
    action,
    rootArgs: args,
    callsite,
    extensions,
    selectionPath: [],
    argumentPath: [],
    originalMethod: clientMethod,
    errorFormat,
    clientVersion,
    previewFeatures,
    globalOmit,
    wrapRawValues,
  })
  return {
    modelName,
    action: jsActionToProtocolAction[action],
    query: serializeFieldSelection(args, context),
  }
}

function serializeFieldSelection(
  { select, include, ...args }: JsArgs = {},
  context: SerializeContext,
): JsonFieldSelection {
  const omit = args.omit
  delete args.omit
  return {
    arguments: serializeArgumentsObject(args, context),
    selection: serializeSelectionSet(select, include, omit, context),
  }
}

function serializeSelectionSet(
  select: Selection | undefined,
  include: Selection | undefined,
  omit: Omission | undefined,
  context: SerializeContext,
): JsonSelectionSet {
  if (select) {
    if (include) {
      context.throwValidationError({
        kind: 'MutuallyExclusiveFields',
        firstField: 'include',
        secondField: 'select',
        selectionPath: context.getSelectionPath(),
      })
    } else if (omit) {
      context.throwValidationError({
        kind: 'MutuallyExclusiveFields',
        firstField: 'omit',
        secondField: 'select',
        selectionPath: context.getSelectionPath(),
      })
    }
    return createExplicitSelection(select, context)
  }

  return createImplicitSelection(context, include, omit)
}

function createImplicitSelection(
  context: SerializeContext,
  include: Selection | undefined,
  omit: Omission | undefined,
) {
  const selectionSet: JsonSelectionSet = {}

  if (context.modelOrType && !context.isRawAction()) {
    selectionSet.$composites = true
    selectionSet.$scalars = true
  }

  if (include) {
    addIncludedRelations(selectionSet, include, context)
  }

  omitFields(selectionSet, omit, context)

  return selectionSet
}

function addIncludedRelations(selectionSet: JsonSelectionSet, include: Selection, context: SerializeContext) {
  for (const [key, value] of Object.entries(include)) {
    if (isSkip(value)) {
      continue
    }
    const nestedContext = context.nestSelection(key)
    validateSelectionForUndefined(value, nestedContext)
    if (value === false || value === undefined) {
      selectionSet[key] = false
      continue
    }

    const field = context.findField(key)
    if (field && field.kind !== 'object') {
      context.throwValidationError({
        kind: 'IncludeOnScalar',
        selectionPath: context.getSelectionPath().concat(key),
        outputType: context.getOutputTypeDescription(),
      })
    }
    if (field) {
      selectionSet[key] = serializeFieldSelection(value === true ? {} : value, nestedContext)
      continue
    }

    if (value === true) {
      selectionSet[key] = true
      continue
    }

    // value is an object, field is unknown
    // this can either be user error (in that case, qe will respond with an error)
    // or virtual field not present on datamodel (like `_count`).
    // Since we don't know which one cast is, we still attempt to serialize selection
    selectionSet[key] = serializeFieldSelection(value, nestedContext)
  }
}

function omitFields(selectionSet: JsonSelectionSet, localOmit: Omission | undefined, context: SerializeContext) {
  const computedFields = context.getComputedFields()
  const combinedOmits = { ...context.getGlobalOmit(), ...localOmit }
  const omitWithComputedFields = computeEngineSideOmissions(combinedOmits, computedFields)
  for (const [key, value] of Object.entries(omitWithComputedFields)) {
    if (isSkip(value)) {
      continue
    }
    validateSelectionForUndefined(value, context.nestSelection(key))
    const field = context.findField(key)
    if (computedFields?.[key] && !field) {
      continue
    }
    selectionSet[key] = !value
  }
}

function createExplicitSelection(select: Selection, context: SerializeContext) {
  const selectionSet: JsonSelectionSet = {}
  const computedFields = context.getComputedFields()
  const selectWithComputedFields = computeEngineSideSelection(select, computedFields)

  for (const [key, value] of Object.entries(selectWithComputedFields)) {
    if (isSkip(value)) {
      continue
    }
    const nestedContext = context.nestSelection(key)
    validateSelectionForUndefined(value, nestedContext)
    const field = context.findField(key)
    if (computedFields?.[key] && !field) {
      continue
    }
    if (value === false || value === undefined || isSkip(value)) {
      selectionSet[key] = false
      continue
    }
    if (value === true) {
      if (field?.kind === 'object') {
        selectionSet[key] = serializeFieldSelection({}, nestedContext)
      } else {
        selectionSet[key] = true
      }
      continue
    }
    selectionSet[key] = serializeFieldSelection(value, nestedContext)
  }
  return selectionSet
}

function serializeArgumentsValue(
  jsValue: Exclude<JsInputValue, undefined | Skip>,
  context: SerializeContext,
): JsonArgumentValue {
  if (jsValue === null) {
    return null
  }

  if (typeof jsValue === 'string' || typeof jsValue === 'number' || typeof jsValue === 'boolean') {
    return jsValue
  }

  if (typeof jsValue === 'bigint') {
    return { $type: 'BigInt', value: String(jsValue) }
  }

  if (isDate(jsValue)) {
    if (isValidDate(jsValue)) {
      return { $type: 'DateTime', value: jsValue.toISOString() }
    } else {
      context.throwValidationError({
        kind: 'InvalidArgumentValue',
        selectionPath: context.getSelectionPath(),
        argumentPath: context.getArgumentPath(),
        argument: {
          name: context.getArgumentName(),
          typeNames: ['Date'],
        },
        underlyingError: 'Provided Date object is invalid',
      })
    }
  }

  if (isParam(jsValue)) {
    return { $type: 'Param', value: jsValue.name }
  }

  if (isFieldRef(jsValue)) {
    return { $type: 'FieldRef', value: { _ref: jsValue.name, _container: jsValue.modelName } }
  }

  if (Array.isArray(jsValue)) {
    return serializeArgumentsArray(jsValue, context)
  }

  if (ArrayBuffer.isView(jsValue)) {
    const { buffer, byteOffset, byteLength } = jsValue
    // TODO(perf): get rid of this conversion
    return { $type: 'Bytes', value: Buffer.from(buffer, byteOffset, byteLength).toString('base64') }
  }

  if (isRawParameters(jsValue)) {
    return jsValue.values
  }

  if (isDecimalJsLike(jsValue)) {
    return { $type: 'Decimal', value: jsValue.toFixed() }
  }

  if (isObjectEnumValue(jsValue)) {
    const name = jsValue._getName()
    if (name !== 'DbNull' && name !== 'JsonNull' && name !== 'AnyNull') {
      throw new Error(`Invalid ObjectEnumValue: expected DbNull, JsonNull, or AnyNull, got ${name}`)
    }
    return { $type: 'Enum', value: name }
  }

  if (isJSONConvertible(jsValue)) {
    return jsValue.toJSON() as JsonArgumentValue
  }

  if (typeof jsValue === 'object') {
    return serializeArgumentsObject(jsValue, context)
  }

  context.throwValidationError({
    kind: 'InvalidArgumentValue',
    selectionPath: context.getSelectionPath(),
    argumentPath: context.getArgumentPath(),
    argument: {
      name: context.getArgumentName(),
      typeNames: [],
    },
    underlyingError: `We could not serialize ${Object.prototype.toString.call(
      jsValue,
    )} value. Serialize the object to JSON or implement a ".toJSON()" method on it`,
  })
}

function serializeArgumentsObject(
  object: Record<string, JsInputValue>,
  context: SerializeContext,
): Record<string, JsonArgumentValue> | RawTaggedValue {
  if (context.shouldWrapRawValues()) {
    if (object['$type']) {
      return { $type: 'Raw', value: object }
    }
  }
  const result: Record<string, JsonArgumentValue> = {}
  for (const key in object) {
    const value = object[key]
    const nestedContext = context.nestArgument(key)
    if (isSkip(value)) {
      continue
    }
    if (value !== undefined) {
      result[key] = serializeArgumentsValue(value, nestedContext)
    } else if (context.isPreviewFeatureOn('strictUndefinedChecks')) {
      context.throwValidationError({
        kind: 'InvalidArgumentValue',
        argumentPath: nestedContext.getArgumentPath(),
        selectionPath: context.getSelectionPath(),
        argument: { name: context.getArgumentName(), typeNames: [] },
        underlyingError: STRICT_UNDEFINED_ERROR_MESSAGE,
      })
    }
  }
  return result
}

function serializeArgumentsArray(array: JsInputValue[], context: SerializeContext): JsonArgumentValue[] {
  const result: JsonArgumentValue[] = []
  for (let i = 0; i < array.length; i++) {
    const itemContext = context.nestArgument(String(i))
    const value = array[i]
    if (value === undefined || isSkip(value)) {
      const valueName = value === undefined ? 'undefined' : `Prisma.skip`
      context.throwValidationError({
        kind: 'InvalidArgumentValue',
        selectionPath: itemContext.getSelectionPath(),
        argumentPath: itemContext.getArgumentPath(),
        argument: {
          name: `${context.getArgumentName()}[${i}]`,
          typeNames: [],
        },
        underlyingError: `Can not use \`${valueName}\` value within array. Use \`null\` or filter out \`${valueName}\` values`,
      })
    }
    result.push(serializeArgumentsValue(value, itemContext))
  }
  return result
}

function isRawParameters(value: JsInputValue): value is RawParameters {
  return typeof value === 'object' && value !== null && value['__prismaRawParameters__'] === true
}

function validateSelectionForUndefined(value: unknown, context: SerializeContext) {
  if (value === undefined && context.isPreviewFeatureOn('strictUndefinedChecks')) {
    context.throwValidationError({
      kind: 'InvalidSelectionValue',
      selectionPath: context.getSelectionPath(),
      underlyingError: STRICT_UNDEFINED_ERROR_MESSAGE,
    })
  }
}

type ContextParams = {
  runtimeDataModel: RuntimeDataModel
  originalMethod: string
  rootArgs: JsArgs | undefined
  extensions: MergedExtensionsList
  selectionPath: string[]
  argumentPath: string[]
  modelName?: string
  action: Action
  callsite?: CallSite
  errorFormat: ErrorFormat
  clientVersion: string
  previewFeatures: string[]
  globalOmit?: GlobalOmitOptions
  wrapRawValues?: boolean
}

class SerializeContext {
  public readonly modelOrType: RuntimeModel | undefined
  constructor(private params: ContextParams) {
    if (this.params.modelName) {
      // TODO: throw if not found
      this.modelOrType =
        this.params.runtimeDataModel.models[this.params.modelName] ??
        this.params.runtimeDataModel.types[this.params.modelName]
    }
  }

  throwValidationError(error: ValidationError): never {
    throwValidationException({
      errors: [error],
      originalMethod: this.params.originalMethod,
      args: this.params.rootArgs ?? {},
      callsite: this.params.callsite,
      errorFormat: this.params.errorFormat,
      clientVersion: this.params.clientVersion,
      globalOmit: this.params.globalOmit,
    })
  }

  getSelectionPath() {
    return this.params.selectionPath
  }

  getArgumentPath() {
    return this.params.argumentPath
  }

  getArgumentName() {
    return this.params.argumentPath[this.params.argumentPath.length - 1]
  }

  getOutputTypeDescription(): OutputTypeDescription | undefined {
    if (!this.params.modelName || !this.modelOrType) {
      return undefined
    }
    return {
      name: this.params.modelName,
      fields: this.modelOrType.fields.map((field) => ({
        name: field.name,
        typeName: 'boolean',
        isRelation: field.kind === 'object',
      })),
    }
  }

  isRawAction() {
    return ['executeRaw', 'queryRaw', 'runCommandRaw', 'findRaw', 'aggregateRaw'].includes(this.params.action)
  }

  isPreviewFeatureOn(previewFeature: string) {
    return this.params.previewFeatures.includes(previewFeature)
  }

  shouldWrapRawValues(): boolean {
    return this.params.wrapRawValues ?? true
  }

  getComputedFields() {
    if (!this.params.modelName) {
      return undefined
    }

    return this.params.extensions.getAllComputedFields(this.params.modelName)
  }

  findField(name: string) {
    return this.modelOrType?.fields.find((field) => field.name === name)
  }

  nestSelection(fieldName: string) {
    const field = this.findField(fieldName)
    const modelName = field?.kind === 'object' ? field.type : undefined

    return new SerializeContext({
      ...this.params,
      modelName,
      selectionPath: this.params.selectionPath.concat(fieldName),
    })
  }

  getGlobalOmit(): Record<string, boolean> {
    if (this.params.modelName && this.shouldApplyGlobalOmit()) {
      return this.params.globalOmit?.[uncapitalize(this.params.modelName)] ?? {}
    }
    return {}
  }

  shouldApplyGlobalOmit(): boolean {
    switch (this.params.action) {
      case 'findFirst':
      case 'findFirstOrThrow':
      case 'findUniqueOrThrow':
      case 'findMany':
      case 'upsert':
      case 'findUnique':
      case 'createManyAndReturn':
      case 'create':
      case 'update':
      case 'updateManyAndReturn':
      case 'delete':
        return true
      case 'executeRaw':
      case 'aggregateRaw':
      case 'runCommandRaw':
      case 'findRaw':
      case 'createMany':
      case 'deleteMany':
      case 'groupBy':
      case 'updateMany':
      case 'count':
      case 'aggregate':
      case 'queryRaw':
        return false
      default:
        assertNever(this.params.action, 'Unknown action')
    }
  }

  nestArgument(fieldName: string) {
    return new SerializeContext({
      ...this.params,
      argumentPath: this.params.argumentPath.concat(fieldName),
    })
  }
}
