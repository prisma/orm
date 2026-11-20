import { enginesVersion } from '@prisma/engines'
import { describe, expect, test } from 'vitest'

import { BinaryType, getEngineVersion } from '../..'

const testIf = (condition: boolean) => (condition ? test : test.skip)

describe('getEngineVersion', () => {
  testIf(!process.env.PRISMA_SCHEMA_ENGINE_BINARY)('Schema Engine', async () => {
    const schemaEngineVersion = await getEngineVersion(undefined, BinaryType.SchemaEngineBinary)
    expect(schemaEngineVersion.split(' ')[1]).toMatch(enginesVersion)
  })
})
