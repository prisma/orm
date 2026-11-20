import { chmod, mkdir, readFile, writeFile } from 'fs/promises'
import path from 'path'
import XDGAppPaths from 'xdg-app-paths'

type AuthFile = {
  tokens: Credentials[]
}

export type Credentials = {
  workspaceId: string
  token: string
  refreshToken?: string
}

/**
 * This class is used to store and retrieve credentials for the Prisma Platform from the user's config directory.
 * A given class instance caches loaded credentials in memory.
 *
 * In the future this class might be adapted to store and retrieve credentials from other locations.
 * E.g. keychains or working directory specific locations.
 */
export class CredentialsStore {
  private loadedCredentials?: Credentials[]
  private authFilePath: string

  /**
   * @param authFilePathOverride - Override for the path to the auth file. Can also be set via the PRISMA_PLATFORM_AUTH_FILE environment variable. Useful for testing.
   */
  constructor(authFilePathOverride?: string) {
    this.authFilePath =
      process.env.PRISMA_PLATFORM_AUTH_FILE ||
      authFilePathOverride ||
      path.join(XDGAppPaths({ name: 'prisma-platform' }).config(), 'auth.json')
  }

  async reloadCredentialsFromDisk(): Promise<void> {
    try {
      const content = await readFile(this.authFilePath, 'utf-8')
      const data = JSON.parse(content) as AuthFile
      this.loadedCredentials = data.tokens || []
    } catch (error) {
      // Fallback if file not exists or invalid JSON
      this.loadedCredentials = []
    }
  }

  async storeCredentials(credentials: Credentials): Promise<void> {
    await this.reloadCredentialsFromDisk()
    const updatedCredentials = [
      ...(this.loadedCredentials || []).filter((c) => c.workspaceId !== credentials.workspaceId),
      credentials,
    ]
    this.loadedCredentials = updatedCredentials
    await this.writeCredentialsToDisk(updatedCredentials)
  }

  async deleteCredentials(workspaceId: string): Promise<void> {
    await this.reloadCredentialsFromDisk()
    const updatedCredentials = (this.loadedCredentials || []).filter((c) => c.workspaceId !== workspaceId)
    this.loadedCredentials = updatedCredentials
    await this.writeCredentialsToDisk(updatedCredentials)
  }

  async getCredentials(): Promise<Credentials[]> {
    if (this.loadedCredentials === undefined) {
      await this.reloadCredentialsFromDisk()
    }
    return this.loadedCredentials || []
  }

  async getCredentialsForWorkspace(workspaceId: string): Promise<Credentials | undefined> {
    return (await this.getCredentials()).filter((c) => c.workspaceId === workspaceId)[0]
  }

  private async writeCredentialsToDisk(credentials: Credentials[]): Promise<void> {
    const data: AuthFile = { tokens: credentials }
    // 0o700 dir + 0o600 file so the auth.json (containing Prisma Platform OAuth
    // tokens) is only readable by the user. writeFile's mode option only
    // applies when the file is created, so chmod after to handle the
    // pre-existing-file (overwrite) case as well.
    await mkdir(path.dirname(this.authFilePath), { recursive: true, mode: 0o700 })
    await writeFile(this.authFilePath, JSON.stringify(data, null, 2), { mode: 0o600 })
    await chmod(this.authFilePath, 0o600)
    await chmod(path.dirname(this.authFilePath), 0o700)
  }
}
