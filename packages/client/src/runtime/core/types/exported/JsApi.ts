import { ObjectEnumValue } from '@prisma/client-runtime-utils'
import type * as DMMF from '@prisma/dmmf'

import { DecimalJsLike } from './DecimalJsLike'
import { FieldRef } from './FieldRef'
import { Skip } from './Skip'

export type { JsOutputValue } from '@prisma/client-engine-runtime'

export type Action = keyof typeof DMMF.ModelAction | 'executeRaw' | 'queryRaw' | 'runCommandRaw'

export type JsInputValue =
  | null
  | undefined
  | string
  | number
  | boolean
  | bigint
  | Uint8Array // covers node Buffer as well, but does not introduce dependency on Node typings
  | Date
  | DecimalJsLike
  | ObjectEnumValue
  | RawParameters
  | JsonConvertible
  | FieldRef<string, unknown>
  | JsInputValue[]
  | Skip
  | { [key: string]: JsInputValue }

export interface JsonConvertible {
  toJSON(): unknown
}

export type JsArgs = {
  select?: Selection
  include?: Selection
  omit?: Omission
  [argName: string]: JsInputValue
}

export type Selection = Record<string, boolean | Skip | JsArgs>

export type Omission = Record<string, boolean | Skip>

export type RawParameters = {
  __prismaRawParameters__: true
  values: string
}
