import { Decimal, PrismaClientValidationError } from '@prisma/client-runtime-utils'

import { isDate, isValidDate } from './date'

export function serializeRawParameters(parameters: any[], clientVersion: string): string {
  try {
    return serializeRawParametersInternal(parameters, 'fast', clientVersion)
  } catch (error) {
    // Got TypeError (e.g., BigInt which JSON.stringify rejects), try replacing
    // values unsupported by JSON with strings inside arrays and objects.
    if (error instanceof TypeError) {
      return serializeRawParametersInternal(parameters, 'slow', clientVersion)
    }
    throw error
  }
}

function serializeRawParametersInternal(
  parameters: any[],
  objectSerialization: 'fast' | 'slow',
  clientVersion: string,
): string {
  return JSON.stringify(parameters.map((parameter) => encodeParameter(parameter, objectSerialization, clientVersion)))
}

function encodeParameter(parameter: any, objectSerialization: 'fast' | 'slow', clientVersion: string): unknown {
  if (Array.isArray(parameter)) {
    return parameter.map((item) => encodeParameter(item, objectSerialization, clientVersion))
  }
  if (typeof parameter === 'bigint') {
    return {
      prisma__type: 'bigint',
      prisma__value: parameter.toString(),
    }
  }

  if (isDate(parameter)) {
    if (!isValidDate(parameter)) {
      throw new PrismaClientValidationError('Provided Date object is invalid', { clientVersion })
    }
    return {
      prisma__type: 'date',
      prisma__value: parameter.toJSON(),
    }
  }

  if (Decimal.isDecimal(parameter)) {
    return {
      prisma__type: 'decimal',
      prisma__value: parameter.toJSON(),
    }
  }

  if (Buffer.isBuffer(parameter)) {
    return {
      prisma__type: 'bytes',
      prisma__value: parameter.toString('base64'),
    }
  }

  if (isArrayBufferLike(parameter)) {
    return {
      prisma__type: 'bytes',
      prisma__value: Buffer.from(parameter).toString('base64'),
    }
  }

  if (ArrayBuffer.isView(parameter)) {
    const { buffer, byteOffset, byteLength } = parameter
    return {
      prisma__type: 'bytes',
      prisma__value: Buffer.from(buffer, byteOffset, byteLength).toString('base64'),
    }
  }

  if (typeof parameter === 'object' && objectSerialization === 'slow') {
    return preprocessObject(parameter)
  }

  return parameter
}

function isArrayBufferLike(value: any): value is ArrayBufferLike {
  if (value instanceof ArrayBuffer || value instanceof SharedArrayBuffer) {
    return true
  }

  if (typeof value === 'object' && value !== null) {
    return value[Symbol.toStringTag] === 'ArrayBuffer' || value[Symbol.toStringTag] === 'SharedArrayBuffer'
  }

  return false
}

function preprocessObject(obj: any): unknown {
  if (typeof obj !== 'object' || obj === null) {
    return obj
  }

  if (typeof obj.toJSON === 'function') {
    return obj.toJSON()
  }

  // TODO: map from blaze would've been convenient here to map arrays and objects uniformly,
  // but importing it in this file causes compilation errors in tsd tests.

  if (Array.isArray(obj)) {
    return obj.map(preprocessValueInObject)
  }

  const result = {} as any

  for (const key of Object.keys(obj as object)) {
    result[key] = preprocessValueInObject(obj[key])
  }

  return result
}

function preprocessValueInObject(value: any): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }

  return preprocessObject(value)
}
