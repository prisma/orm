import type { MultipleSchemas } from '@prisma/get-dmmf'

import { SchemaContext } from '../cli/schemaContext'
import { MigrateTypes } from '../migrateTypes'

export function toSchemasContainer(schemas: MultipleSchemas): MigrateTypes.SchemasContainer {
  return {
    files: multipleSchemasToSchemaContainers(schemas),
  }
}

export function toSchemasWithConfigDir(
  schemaContext: SchemaContext,
  configDir: string,
): MigrateTypes.SchemasWithConfigDir {
  return {
    files: multipleSchemasToSchemaContainers(schemaContext.schemaFiles),
    configDir,
  }
}

function multipleSchemasToSchemaContainers(schemas: MultipleSchemas): MigrateTypes.SchemaContainer[] {
  return schemas.map(([path, content]) => ({
    path,
    content,
  }))
}
