import { foreignKeyForProvider, idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Post {
    id ${idForProvider(provider)}
    media PostMedia[]
  }

  model Media {
    id ${idForProvider(provider)}
    posts PostMedia[]
  }

  model PostMedia {
    id ${idForProvider(provider)}
    post    Post  @relation(fields: [postId], references: [id])
    media   Media @relation(fields: [mediaId], references: [id])
    postId  ${foreignKeyForProvider(provider)}
    mediaId ${foreignKeyForProvider(provider)}
    @@unique([postId, mediaId])
  }
  `
})
