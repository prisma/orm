import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
      generator client {
        provider = "prisma-client-js"
      }

      datasource db {
        provider = "${provider}"
      }

      model A {
        id ${idForProvider(provider)}

        model_b B[]
      }

      model B {
        id ${idForProvider(provider)}

        a_id String
        a    A   @relation(fields: [a_id], references: [id])

        private_field String

        c_id String
        c    C   @relation(fields: [c_id], references: [id])
      }

      model C {
        id ${idForProvider(provider)}

        public_field String
        B            B[]
      }
      `
})
