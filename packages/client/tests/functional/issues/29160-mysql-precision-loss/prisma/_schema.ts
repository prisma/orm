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

    model AssetAccount {
      assetId ${idForProvider(provider)}
      amount Decimal @default(0) @db.Decimal(30, 0)
    }
  `
})
