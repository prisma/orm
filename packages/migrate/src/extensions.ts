export type Extension = {
  types: ExtensionType[]
}

export type ExtensionType = {
  prismaName: string
  dbName: string
  dbNamespace?: string
  dbTypeModifiers?: string[]
  numberOfDbTypeModifiers: number
}

export type SchemaExtensionConfig = {
  types: ExtensionType[]
}
