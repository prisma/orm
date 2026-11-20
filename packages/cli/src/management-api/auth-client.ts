import type { ManagementApiSdk } from '@prisma/management-api-sdk'
import { createManagementApiSdk } from '@prisma/management-api-sdk'

import { FileTokenStorage } from './token-storage'

const CLIENT_ID = 'cmi4ttoor03pv2wco4526rnin'

export function createAuthenticatedManagementAPI(): ManagementApiSdk {
  const tokenStorage = new FileTokenStorage()

  return createManagementApiSdk({
    clientId: CLIENT_ID,
    redirectUri: 'http://localhost:0/auth/callback',
    tokenStorage,
  })
}
