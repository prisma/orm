export const GraphQLScalarToJSTypeTable = {
  String: 'string',
  Int: 'number',
  Float: 'number',
  Boolean: 'boolean',
  Long: 'number',
  DateTime: ['Date', 'string'],
  ID: 'string',
  UUID: 'string',
  Json: 'runtime.JsonValue',
  Bytes: 'runtime.Bytes',
  Decimal: ['runtime.Decimal', 'runtime.DecimalJsLike', 'number', 'string'],
  BigInt: ['bigint', 'number'],
}

export const JSOutputTypeToInputType: Record<string, string | undefined> = {
  JsonValue: 'InputJsonValue',
}

export const JSTypeToGraphQLType = {
  string: 'String',
  boolean: 'Boolean',
  object: 'Json',
  symbol: 'Symbol',
}
