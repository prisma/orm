import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    datasource db {
      provider = "${provider}"
    }

    generator client {
      provider = "prisma-client-js"
    }

    model User {
      id         ${idForProvider(provider)}
      email      String @unique
    }
  `
})
