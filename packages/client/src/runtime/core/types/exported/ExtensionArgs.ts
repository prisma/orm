import { JsArgs } from './JsApi'
import { RawQueryArgs } from './RawQueryArgs'
import { Optional } from './Utils'

export type ExtensionArgs = Optional<RequiredExtensionArgs>
export type RequiredExtensionArgs = NameArgs & ResultArgs & ModelArgs & ClientArgs & QueryOptions

export type NameArgs = {
  name?: string
}

export type ResultArgs = {
  result: {
    [ModelName in string]: ResultArg
  }
}

export type ResultArgsFieldCompute = (model: any, modelName: string) => unknown

export type ResultArg = {
  [FieldName in string]: ResultFieldDefinition
}

export type ResultFieldDefinition = {
  needs?: { [FieldName in string]: boolean }
  compute: ResultArgsFieldCompute
}

export type ModelArgs = {
  model: {
    [ModelName in string]: ModelArg
  }
}

export type ModelArg = {
  [MethodName in string]: unknown
}

export type ClientArgs = {
  client: ClientArg
}

export type ClientArg = {
  [MethodName in string]: unknown
}

export type QueryOptionsCbArgs = {
  model?: string
  operation: string
  args: JsArgs | RawQueryArgs
  query: (args: JsArgs | RawQueryArgs) => Promise<unknown>
}

export type ModelQueryOptionsCbArgs = {
  model: string
  operation: string
  args: JsArgs
  query: (args: JsArgs) => Promise<unknown>
}

export type QueryOptionsCb = (args: QueryOptionsCbArgs) => Promise<any>
export type ModelQueryOptionsCb = (args: ModelQueryOptionsCbArgs) => Promise<any>

export type QueryOptions = {
  query: {
    [ModelName in string]:
      | {
          [ModelAction in string]: ModelQueryOptionsCb
        }
      | QueryOptionsCb // for all queries (eg. raw queries)
  }
}
