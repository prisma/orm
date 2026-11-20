import * as fs from 'fs'
import * as path from 'path'

/**
 * Generates a very large Prisma schema to test handling of DMMF > 512MB
 * Creates many simple, unrelated models to reach the target size
 */
export function generateLargeSchema(): void {
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma')

  let schemaContent = `// Auto-generated large schema for testing
// This schema is designed to generate 512MB of DMMF to test large schema handling

generator client {
  provider = "prisma-client"
  output = "../generated/prisma"
}

datasource db {
  provider = "sqlite"
}

`

  // 7200 models is sufficient to generate a DMMF way larger than 512MB
  const targetModelCount = 7200

  for (let i = 0; i < targetModelCount; i++) {
    const modelName = `TestModel${i.toString().padStart(8, '0')}`

    // Create a model with various field types to make it realistic
    schemaContent += `model ${modelName} {
  id                 Int      @id @default(autoincrement())
  stringField01      String
  stringField02      String?
  stringField03      String   @default("test_default_value")
  intField01         Int
  intField02         Int?
  intField03         Int      @default(42)
  booleanField01     Boolean
  booleanField02     Boolean?
  booleanField03     Boolean  @default(false)
  dateTimeField01    DateTime
  dateTimeField02    DateTime?
  dateTimeField03    DateTime @default(now())
  floatField01       Float
  floatField02       Float?
  floatField03       Float    @default(3.14)
  bigIntField01      BigInt
  bigIntField02      BigInt?
  decimalField01     Decimal
  decimalField02     Decimal?
  bytesField01       Bytes
  bytesField02       Bytes?
  jsonField01        Json
  jsonField02        Json?

  @@index([stringField01])
  @@index([intField01, stringField01])
  @@index([dateTimeField01])
  @@unique([stringField01, intField01])
}

`
  }

  fs.writeFileSync(schemaPath, schemaContent)

  console.log(`Schema generation complete!`)
  console.log(`Schema location: ${schemaPath}`)
}

// Allow this script to be run directly
if (require.main === module) {
  generateLargeSchema()
}
