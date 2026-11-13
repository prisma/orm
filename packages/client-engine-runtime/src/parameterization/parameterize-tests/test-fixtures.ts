import { getInternalDMMF } from '@prisma/get-dmmf'
import { ParamGraph } from '@prisma/param-graph'
import { buildAndSerializeParamGraph } from '@prisma/param-graph-builder'

/**
 * Prisma schema that simulates a User model with common fields and filters,
 * along with related Post and Profile models.
 */
const testSchema = /* prisma */ `
  datasource db {
    provider = "postgresql"
  }

  enum Status {
    ACTIVE
    INACTIVE
  }

  model User {
    id        Int       @id @default(autoincrement())
    email     String    @unique
    name      String?
    age       Int?
    salary    Float?
    isActive  Boolean   @default(true)
    deletedAt DateTime?
    createdAt DateTime  @default(now())
    balance   Decimal?
    status    Status    @default(ACTIVE)
    avatar    Bytes?
    metadata  Json?

    posts     Post[]
    profile   Profile?

    // Self-relation for testing nested relation filters (author field in tests)
    authorId  Int?
    author    User?   @relation("UserAuthor", fields: [authorId], references: [id])
    authored  User[]  @relation("UserAuthor")
  }

  model Post {
    id        Int      @id @default(autoincrement())
    title     String
    content   String?
    userId    Int
    user      User     @relation(fields: [userId], references: [id])
    createdAt DateTime @default(now())
  }

  model Profile {
    id     Int     @id @default(autoincrement())
    bio    String?
    userId Int     @unique
    user   User    @relation(fields: [userId], references: [id])
  }
`

export const testRuntimeDataModel = {
  models: {},
  enums: {
    Status: {
      values: [
        { name: 'ACTIVE', dbName: null },
        { name: 'INACTIVE', dbName: null },
      ],
      dbName: null,
    },
  },
  types: {},
}

let cached: ParamGraph | undefined

/**
 * Returns the ParamGraph for the test schema, building it on first call.
 */
export function getParamGraph(): ParamGraph {
  if (cached) {
    return cached
  }

  const dmmf = getInternalDMMF({ datamodel: testSchema })
  if ('error' in dmmf) {
    throw dmmf.error
  }

  const serialized = buildAndSerializeParamGraph(dmmf)
  cached = ParamGraph.deserialize(serialized, (enumName) => {
    const enumDef = testRuntimeDataModel.enums[enumName]
    const mapping: Record<string, string> = {}
    for (const value of enumDef?.values ?? []) {
      mapping[value.name] = value.dbName ?? value.name
    }
    return mapping
  })
  return cached
}
