import { BinaryType } from '@prisma/fetch-engine'
import type { EngineType } from '@prisma/generator'

export function engineTypeToBinaryType(engineType: EngineType): BinaryType {
  if (engineType === 'schemaEngine') {
    return BinaryType.SchemaEngineBinary
  }

  throw new Error(`Could not convert engine type ${engineType}`)
}
