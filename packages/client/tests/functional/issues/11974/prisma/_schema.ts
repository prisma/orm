import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "${provider}"
      }

      model Comment {
        id String @id

        upVotedUsers   User[] @relation("upVotes")
        downVotedUsers User[] @relation("downVotes")
      }

      model User {
        uid String @id

        upVotedComments   Comment[] @relation("upVotes")
        downVotedComments Comment[] @relation("downVotes")
      }
  `
})
