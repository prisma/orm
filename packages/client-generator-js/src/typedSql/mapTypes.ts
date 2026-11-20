import { QueryIntrospectionBuiltinType, QueryIntrospectionType } from '@prisma/generator'
import { isValidJsIdentifier } from '@prisma/internals'
import * as ts from '@prisma/ts-builders'

import { DbEnumsList } from './buildDbEnums'

type TypeMappingConfig = {
  in: ts.TypeBuilder
  out: ts.TypeBuilder
}

const decimal = ts.namedType('$runtime.Decimal')
const uint8Array = ts.namedType('$runtime.Bytes')
const date = ts.namedType('Date')
const inputJsonValue = ts.namedType('$runtime.InputJsonObject')
const jsonValue = ts.namedType('$runtime.JsonValue')

const bigintIn = ts.unionType([ts.numberType, ts.bigintType])
const decimalIn = ts.unionType([ts.numberType, decimal])

const typeMappings: Record<QueryIntrospectionBuiltinType, TypeMappingConfig | ts.TypeBuilder> = {
  unknown: ts.unknownType,
  string: ts.stringType,
  int: ts.numberType,
  bigint: {
    in: bigintIn,
    out: ts.bigintType,
  },
  decimal: {
    in: decimalIn,
    out: decimal,
  },
  float: ts.numberType,
  double: ts.numberType,
  enum: ts.stringType, // TODO:
  bytes: uint8Array,
  bool: ts.booleanType,
  char: ts.stringType,
  json: {
    in: inputJsonValue,
    out: jsonValue,
  },
  xml: ts.stringType,
  uuid: ts.stringType,
  date: date,
  datetime: date,
  time: date,
  null: ts.nullType,
  'int-array': ts.array(ts.numberType),
  'string-array': ts.array(ts.stringType),
  'json-array': {
    in: ts.array(inputJsonValue),
    out: ts.array(jsonValue),
  },
  'uuid-array': ts.array(ts.stringType),
  'xml-array': ts.array(ts.stringType),
  'bigint-array': {
    in: ts.array(bigintIn),
    out: ts.array(ts.bigintType),
  },
  'float-array': ts.array(ts.numberType),
  'double-array': ts.array(ts.numberType),
  'char-array': ts.array(ts.stringType),
  'bytes-array': ts.array(uint8Array),
  'bool-array': ts.array(ts.booleanType),
  'date-array': ts.array(date),
  'time-array': ts.array(date),
  'datetime-array': ts.array(date),
  'decimal-array': {
    in: ts.array(decimalIn),
    out: ts.array(decimal),
  },
}

export function getInputType(
  introspectionType: QueryIntrospectionType,
  nullable: boolean,
  enums: DbEnumsList,
): ts.TypeBuilder {
  const inn = getMappingConfig(introspectionType, enums).in

  if (!nullable) {
    return inn
  } else {
    return new ts.UnionType(inn).addVariant(ts.nullType)
  }
}

export function getOutputType(
  introspectionType: QueryIntrospectionType,
  nullable: boolean,
  enums: DbEnumsList,
): ts.TypeBuilder {
  const out = getMappingConfig(introspectionType, enums).out

  if (!nullable) {
    return out
  } else {
    return new ts.UnionType(out).addVariant(ts.nullType)
  }
}

function getMappingConfig(
  introspectionType: QueryIntrospectionType,
  enums: DbEnumsList,
): { in: ts.TypeBuilder; out: ts.TypeBuilder } {
  const config = typeMappings[introspectionType]

  if (!config) {
    if (enums.hasEnum(introspectionType)) {
      const type = getEnumType(introspectionType)

      return { in: type, out: type }
    }

    throw new Error('Unknown type')
  }

  if (config instanceof ts.TypeBuilder) {
    return { in: config, out: config }
  }

  return config
}

function getEnumType(name: string) {
  if (isValidJsIdentifier(name)) {
    return ts.namedType(`$DbEnums.${name}`)
  }
  return ts.namedType('$DbEnums').subKey(name)
}
