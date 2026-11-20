import { PrismaClientJsGenerator } from '@prisma/client-generator-js'
import { PrismaClientTsGenerator } from '@prisma/client-generator-ts'

import { GeneratorRegistry } from './registry'

export function createDefaultRegistry(cliCommand: string): GeneratorRegistry {
  const registry = new GeneratorRegistry()

  registry.add(new PrismaClientJsGenerator({ cliCommand }))

  const tsGenerator = new PrismaClientTsGenerator()
  registry.add(tsGenerator)
  registry.addAliased('prisma-client', tsGenerator)

  return registry
}

export const defaultRegistry = createDefaultRegistry('prisma')
