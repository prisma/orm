import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }

  datasource db {
    provider = "${provider}"
  }

  model Artist {
    id ${idForProvider(provider)}
    name String
    albums Album[]

    @@unique([name])
  }


  model Album {
    id ${idForProvider(provider)}
    title String

    artistId String
    artist   Artist @relation(fields: [artistId], references: [id])
    @@index([artistId])
  }
  `
})
