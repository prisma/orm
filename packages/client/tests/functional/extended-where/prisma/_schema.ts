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
  
  model User {
    id ${idForProvider(provider)}
    posts Post[]
    profile Profile?
    referralId String @unique
    payment Payment? @relation(fields: [paymentId], references: [id])
    paymentId String @unique
  }

  model Profile {
    id ${idForProvider(provider)}
    user User @relation(fields: [userId], references: [id], onDelete: Cascade)
    userId String @unique
    email String @unique
    alias String @unique
    createdAt DateTime @default(now())
  }

  model Post {
    id ${idForProvider(provider)}
    title String @unique
    author User? @relation(fields: [authorId], references: [id], onDelete: Cascade)
    authorId String?
  }

  model Payment {
    id ${idForProvider(provider)}
    ccn String @unique @default(cuid())
    author User?
  }
  `
})
