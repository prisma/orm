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

model Resource {
  id           ${idForProvider(provider)}
  requiredJson Json
  optionalJson Json?
}
`
})
