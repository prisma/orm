import { idForProvider } from '../../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
      output   = "../generated/prisma/client"
    }

    datasource db {
      provider = "${provider}"
    }

    model User {
      id         ${idForProvider(provider)}
      name       String
      walletLink WalletLink[]
    }

    model Wallet {
      id         ${idForProvider(provider)}
      name       String
      walletLink WalletLink[]
    }

    model WalletLink {
      id        ${idForProvider(provider)}
      name      String
      wallet    Wallet @relation(fields: [walletId], references: [id])
      user      User @relation(fields: [userId], references: [id])
      walletId  String
      userId    String
    }
  `
})
