import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
        previewFeatures = ["typedSql"]
      }
      
      datasource db {
        provider = "${provider}"
      }
      
      model User {
        id ${idForProvider(provider)}
        role UserRole
        favoriteAnimal Animal
      }

      enum UserRole {
        ADMIN
        USER

        @@map("user-role")
      }

      enum Animal {
        CAT
        DOG
        STEVE
      }
      `
})
