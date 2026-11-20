import { BinaryType } from '@prisma/fetch-engine'
import type { EngineType } from '@prisma/generator'

export function binaryTypeToEngineType(binaryType: BinaryType): EngineType {
  if (binaryType === BinaryType.SchemaEngineBinary) {
    return 'schemaEngine'
  }

  throw new Error(`Could not convert binary type ${binaryType}`)
}
