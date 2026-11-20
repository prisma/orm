import type { MultipleSchemas } from '@prisma/get-dmmf'

export function extractSchemaContent(multipleSchemas: MultipleSchemas): string[] {
  return multipleSchemas.map(([, content]) => content)
}
