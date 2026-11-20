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

      model company {
        companyID ${idForProvider(provider)}
        typDPH    company_typDPH?
      }

      enum company_typDPH {
        nonPaying @map("neplátce")
        paying    @map("plátce")
        special   @map("přenesená daňová povinnost")
      }
      `
})
