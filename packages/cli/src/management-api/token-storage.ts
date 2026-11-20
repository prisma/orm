import { CredentialsStore } from '@prisma/credentials-store'
import { Debug } from '@prisma/debug'
import type { Tokens, TokenStorage } from '@prisma/management-api-sdk'

const debug = Debug('prisma:cli:management-api:token-storage')

function tokensToCredentials(tokens: Tokens): { workspaceId: string; token: string; refreshToken?: string } {
  return {
    workspaceId: tokens.workspaceId,
    token: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  }
}

function credentialsToTokens(credentials: { workspaceId: string; token: string; refreshToken?: string }): Tokens {
  return {
    workspaceId: credentials.workspaceId,
    accessToken: credentials.token,
    refreshToken: credentials.refreshToken,
  }
}

export class FileTokenStorage implements TokenStorage {
  private credentialsStore: CredentialsStore

  constructor() {
    this.credentialsStore = new CredentialsStore()
  }

  async getTokens(): Promise<Tokens | null> {
    try {
      // Get all credentials - if there are multiple workspaces, use the first one
      // In the future, we might want to support selecting a specific workspace
      const allCredentials = await this.credentialsStore.getCredentials()
      if (allCredentials.length === 0) {
        return null
      }
      // Use the first workspace's credentials
      // The SDK will extract workspaceId from the token, so this should match
      const credentials = allCredentials[0]
      return credentialsToTokens(credentials)
    } catch (error: unknown) {
      debug(error)
      return null
    }
  }

  async setTokens(tokens: Tokens): Promise<void> {
    const credentials = tokensToCredentials(tokens)
    await this.credentialsStore.storeCredentials(credentials)
  }

  async clearTokens(): Promise<void> {
    try {
      const tokens = await this.getTokens()
      if (tokens) {
        await this.credentialsStore.deleteCredentials(tokens.workspaceId)
      }
    } catch (error: unknown) {
      // Credentials might not exist, ignore error
      debug('Failed to clear tokens:', error)
    }
  }
}
