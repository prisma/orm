import { foreignKeyForProvider, idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "${provider}"
      }

      model UserGroup {
        id ${idForProvider(provider)}
        name String
        users User[]
      }

      model User {
        id ${idForProvider(provider)}
        email String @unique
        password String
        highScore Int @default(0)
        groupId ${foreignKeyForProvider(provider, { optional: true })}
        group UserGroup? @relation(fields: [groupId], references: [id])
      }
      `
})
