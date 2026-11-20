import { uncapitalize } from '@prisma/client-common'
import { isObjectEnumValue } from '@prisma/client-runtime-utils'
import { Writer } from '@prisma/ts-builders'

import { ErrorFormat } from '../../getPrismaClient'
import { isValidDate } from '../../utils/date'
import { isDecimalJsLike } from '../../utils/decimalJsLike'
import { isFieldRef } from '../model/FieldRef'
import { ArrayValue } from './ArrayValue'
import { activeColors, Colors, ErrorBasicBuilder, ErrorWriter, inactiveColors } from './base'
import { ObjectField } from './ObjectField'
import { ObjectValue } from './ObjectValue'
import { ScalarValue } from './ScalarValue'

type MessageRender = (colors: Colors) => string

export class ArgumentsRenderingTree implements ErrorBasicBuilder {
  readonly arguments: ObjectValue
  private errorMessages: MessageRender[] = []

  constructor(args: ObjectValue) {
    this.arguments = args
  }

  write(writer: ErrorWriter): void {
    writer.write(this.arguments)
  }

  addErrorMessage(renderer: MessageRender) {
    this.errorMessages.push(renderer)
  }

  renderAllMessages(colors: Colors): string {
    return this.errorMessages.map((messageRenderer) => messageRenderer(colors)).join('\n')
  }
}

/**
 * Given JS call arguments, produces rendering tree for outputting rich errors into the console
 * Difference between rendering tree and plain object is that fields and values can have different attributes:
 * colors, underlines, markers on the margins. `applyValidationError` function will then apply specific formatting
 * to the rendering tree.
 *
 * @param args
 * @returns
 */
export function buildArgumentsRenderingTree(args: Record<PropertyKey, unknown>): ArgumentsRenderingTree {
  return new ArgumentsRenderingTree(buildInputObject(args))
}

function buildInputObject(inputObject: Record<PropertyKey, unknown>) {
  const object = new ObjectValue()

  for (const [key, value] of Object.entries(inputObject)) {
    const field = new ObjectField(key, buildInputValue(value))
    object.addField(field)
  }
  return object
}

function buildInputValue(value: unknown) {
  if (typeof value === 'string') {
    return new ScalarValue(JSON.stringify(value))
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return new ScalarValue(String(value))
  }

  if (typeof value === 'bigint') {
    return new ScalarValue(`${value}n`)
  }

  if (value === null) {
    return new ScalarValue('null')
  }

  if (value === undefined) {
    return new ScalarValue('undefined')
  }

  if (isDecimalJsLike(value)) {
    return new ScalarValue(`new Prisma.Decimal("${value.toFixed()}")`)
  }

  if (value instanceof Uint8Array) {
    if (Buffer.isBuffer(value)) {
      return new ScalarValue(`Buffer.alloc(${value.byteLength})`)
    }
    return new ScalarValue(`new Uint8Array(${value.byteLength})`)
  }

  if (value instanceof Date) {
    const dateStr = isValidDate(value) ? value.toISOString() : 'Invalid Date'
    return new ScalarValue(`new Date("${dateStr}")`)
  }

  if (isObjectEnumValue(value)) {
    return new ScalarValue(`Prisma.${value._getName()}`)
  }

  if (isFieldRef(value)) {
    return new ScalarValue(`prisma.${uncapitalize(value.modelName)}.$fields.${value.name}`)
  }

  if (Array.isArray(value)) {
    return buildInputArray(value)
  }

  if (typeof value === 'object') {
    return buildInputObject(value as Record<PropertyKey, unknown>)
  }

  return new ScalarValue(Object.prototype.toString.call(value))
}

function buildInputArray(array: unknown[]) {
  const result = new ArrayValue()
  for (const item of array) {
    result.addItem(buildInputValue(item))
  }
  return result
}

export function renderArgsTree(argsTree: ArgumentsRenderingTree, errorFormat: ErrorFormat) {
  const colors = errorFormat === 'pretty' ? activeColors : inactiveColors

  const message = argsTree.renderAllMessages(colors)
  const args = new Writer(0, { colors }).write(argsTree).toString()

  return { message, args }
}
