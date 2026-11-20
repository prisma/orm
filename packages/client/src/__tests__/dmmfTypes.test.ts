import { getDMMF } from '@prisma/internals'
import fs from 'fs'
import path from 'path'
import sortKeys from 'sort-keys'

const blog = `datasource db {
  provider = "postgres"
}

model Post {
  id        Int   @id @default(autoincrement())
  author    User  @relation(fields: [authorId], references: [id])
  authorId  Int
  title     String
  published Boolean @default(false)
}
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  posts Post[]
}
`

// Skip because it cannot work anymore via @swc/jest
// TODO: Port this test to the new functional test setup
test.skip('dmmf types', async () => {
  const dmmf = await getDMMF({ datamodel: blog })
  const file = `import type * as DMMF from '@prisma/dmmf'

const dmmf: DMMF.Document = ${JSON.stringify(sortKeys(dmmf, { deep: true }), null, 2)}
`
  const target = path.join(__dirname, '__helpers__/dmmf-types.ts')
  fs.writeFileSync(target, file)

  try {
    await import('./__helpers__/dmmf-types')
  } catch (e) {
    // we need to do this, as jest can't print the errors
    // resulting from the dynamic import
    console.error(e)
    throw e
  }
  expect(1).toBe(1)
})
