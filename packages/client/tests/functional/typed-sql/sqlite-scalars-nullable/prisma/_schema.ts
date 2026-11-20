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

      model TestModel {
        id ${idForProvider(provider)}
        string String?
        int Int?
        bytes Bytes?
        json Json?
        double Float?
        bool Boolean?
        bigInt BigInt?
        decimal Decimal?
        dateTime DateTime?
      }
      `
})
