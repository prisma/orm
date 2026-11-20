import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider  = "prisma-client-js"
    }

    datasource db {
      provider = "${provider}"
    }

    model Item {
      id ${idForProvider(provider, { includeDefault: true })}
      name String
      tags String[]
    }
  `
})
