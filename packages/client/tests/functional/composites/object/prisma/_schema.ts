import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider, contentProperty }) => {
  const commentContentType = contentProperty === 'optional' ? 'CommentContent?' : 'CommentContent'
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model Comment {
    id      String   @id @default(auto()) @map("_id") @db.ObjectId

    country String?
    content ${commentContentType}
  }

  type CommentContent {
    text    String
    upvotes CommentContentUpvotes[]
  }

  type CommentContentUpvotes {
    vote Boolean
    userId String
  }
  `
})
