export default ({ provider }) => {
  return /* Prisma */ `
  generator client {
    provider = "prisma-client-js"
  }
  
  datasource db {
    provider = "${provider}"
  }
  
  model CommentRequiredList {
    id      String   @id @default(auto()) @map("_id") @db.ObjectId

    country String?
    contents CommentContent[]
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
}
