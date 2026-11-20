import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, mapTable }) => {
  const mapTableUser = mapTable === 'IDENTICAL_NAMES' ? 'some_table' : 'some_table_user'
  const mapTablePost = mapTable === 'IDENTICAL_NAMES' ? 'some_table' : 'some_table_post'

  return /* Prisma */ `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "${provider}"
  schemas  = ["base", "transactional"]
}

model User {
  id ${idForProvider(provider)}
  email String
  posts Post[]

  @@schema("base")
  ${mapTable ? `@@map("${mapTableUser}")` : ''}
}

model Post {
  id ${idForProvider(provider)}
  title     String
  authorId  String
  author    User?    @relation(fields: [authorId], references: [id])

  @@schema("transactional")
  ${mapTable ? `@@map("${mapTablePost}")` : ''}
}
  `
})
